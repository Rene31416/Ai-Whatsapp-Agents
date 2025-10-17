import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import { DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import * as kms from "aws-cdk-lib/aws-kms";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

export class AiAgentsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 🔐 KMS key
    const dataKey = new kms.Key(this, "DataEncryptionKey", {
      alias: "ai-agents-data-key",
      enableKeyRotation: true,
    });

    // 💬 Secrets
    const geminiSecret = new secretsmanager.Secret(this, "GeminiApiKeySecret", {
      secretName: "GeminiApiKey",
      encryptionKey: dataKey,
    });
    const whatsAppSecretArn = `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:WhatsappCredentials-`;

    // 🏢 DynamoDB tables
    const tenantTable = new dynamodb.Table(this, "TenantClinicMetadata", {
      partitionKey: { name: "tenantId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    tenantTable.addGlobalSecondaryIndex({
      indexName: "PhoneNumberIdIndex",
      partitionKey: {
        name: "phoneNumberId",
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const chatTable = new dynamodb.Table(this, "ChatSessions", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 🧩 Message buffer table (now with stream)
    const chatBufferTable = new dynamodb.Table(this, "ChatMessageBuffer", {
      partitionKey: { name: "UserKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // 🔥 enable stream
    });

    // 🌐 Webhook Lambda
    const webhookLambda = new lambda.Function(this, "WebhookLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "webhook.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist")),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        CHAT_BUFFER_TABLE_NAME: chatBufferTable.tableName, // ✅ updated
        GEMINI_SECRET_ARN: geminiSecret.secretArn,
        WHATSAPP_SECRET_ARN: whatsAppSecretArn,
      },
    });

    geminiSecret.grantRead(webhookLambda);
    tenantTable.grantReadData(webhookLambda);
    chatTable.grantReadWriteData(webhookLambda);
    chatBufferTable.grantReadWriteData(webhookLambda);
    dataKey.grantEncryptDecrypt(webhookLambda);
    webhookLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        resources: [`${whatsAppSecretArn}*`],
      })
    );

    // 🤖 ChatService Lambda
    const chatServiceLambda = new lambda.Function(this, "ChatServiceLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "chatService.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist")),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        GEMINI_SECRET_ARN: geminiSecret.secretArn,
        WHATSAPP_SECRET_ARN: whatsAppSecretArn,
        CHAT_BUFFER_TABLE_NAME: chatBufferTable.tableName,
      },
    });

    // ✅ GSI permissions for tenant lookup
    chatServiceLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["dynamodb:Query"],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${tenantTable.tableName}/index/PhoneNumberIdIndex`,
        ],
      })
    );

    tenantTable.grantReadData(chatServiceLambda);
    chatBufferTable.grantReadWriteData(chatServiceLambda);
    chatTable.grantReadWriteData(chatServiceLambda);
    geminiSecret.grantRead(chatServiceLambda);
    dataKey.grantEncryptDecrypt(chatServiceLambda);

    const tenantGsiArn = `${tenantTable.tableArn}/index/PhoneNumberIdIndex`;

    chatServiceLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:Query",
          "dynamodb:DescribeTable",
          "dynamodb:ListTagsOfResource",
        ],
        resources: [tenantTable.tableArn, tenantGsiArn],
      })
    );

    // 🔄 Stream trigger for ChatService
    chatServiceLambda.addEventSource(
      new DynamoEventSource(chatBufferTable, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 100,
        enabled: true,
      })
    );

    // 🌐 API Gateway
    const api = new apigateway.LambdaRestApi(this, "AgentsApi", {
      handler: webhookLambda,
      proxy: false,
    });

    const webhook = api.root.addResource("webhook");
    webhook.addMethod("GET", new apigateway.LambdaIntegration(webhookLambda));
    webhook.addMethod("POST", new apigateway.LambdaIntegration(webhookLambda));

    new cdk.CfnOutput(this, "WebhookUrl", {
      value: `${api.url}webhook`,
    });
  }
}
