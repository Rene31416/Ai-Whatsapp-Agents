import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";

export class AiAgentsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //
    // 🔐 KMS Key
    //
    const dataKey = new kms.Key(this, "DataEncryptionKey", {
      alias: "ai-agents-data-key",
      enableKeyRotation: true,
      description: "KMS key for encrypting data and environment variables",
    });

    //
    // 🧩 Secrets Manager (Gemini API Key)
    //
    const geminiSecret = new secretsmanager.Secret(this, "GeminiApiKeySecret", {
      secretName: "GeminiApiKey",
      description: "Gemini API key for LangChain model",
      encryptionKey: dataKey,
    });

    //
    // 🏢 DynamoDB Tables
    //
    const tenantTable = new dynamodb.Table(this, "TenantClinicMetadata", {
      tableName: "TenantClinicMetadata",
      partitionKey: { name: "tenantId", type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const chatTable = new dynamodb.Table(this, "ChatSessions", {
      tableName: "ChatSessions",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    //
    // 💬 Lambda (TypeScript build)
    //
    const agentLambda = new lambda.Function(this, "DentalChatLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist")),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        GEMINI_SECRET_ARN: geminiSecret.secretArn,
      },
    });

    geminiSecret.grantRead(agentLambda);

    //
    // 🌐 API Gateway
    //
    const api = new apigateway.LambdaRestApi(this, "DentalChatApi", {
      handler: agentLambda,
      proxy: false,
      restApiName: "Dental Chat API",
      description: "API for the Opal dental assistant chatbot",
    });

    const chat = api.root.addResource("chat");
    chat.addMethod("POST");

    //
    // ✅ Grant permissions
    //
    tenantTable.grantReadData(agentLambda);
    chatTable.grantReadWriteData(agentLambda);
    dataKey.grantEncryptDecrypt(agentLambda);

    //
    // 💬 Outputs
    //
    new cdk.CfnOutput(this, "ApiEndpoint", { value: api.url });
  }
}
