import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
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
      description: "KMS key for encrypting DynamoDB tables and Lambda env vars",
    });

    //
    // 🏢 TenantClinicMetadata table
    //
    const tenantTable = new dynamodb.Table(this, "TenantClinicMetadata", {
      tableName: "TenantClinicMetadata",
      partitionKey: { name: "tenantId", type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // ❗ change to RETAIN in production
    });

    //
    // 💬 ChatSessions table
    //
    const chatTable = new dynamodb.Table(this, "ChatSessions", {
      tableName: "ChatSessions",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // ❗ change to RETAIN in production
    });

    //
    // 🧠 Lambda (Python)
    //
    const agentLambda = new lambda.Function(this, "AiAgentHandler", {
      functionName: "ai-agent-handler",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "app.app.lambda_handler", // 👈 src/app/app.py → def lambda_handler()
      code: lambda.Code.fromAsset(path.join(__dirname, "../src")),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environmentEncryption: dataKey,
      environment: {
        TENANT_TABLE: tenantTable.tableName,
        CHAT_TABLE: chatTable.tableName,

        // 👇 Add this so Python knows where to find your deps and app modules
        PYTHONPATH: "/var/task/deps:/var/task/app",
      },
    });

    //
    // ✅ Grant permissions
    //
    tenantTable.grantReadData(agentLambda);
    chatTable.grantReadWriteData(agentLambda);
    dataKey.grantEncryptDecrypt(agentLambda);

    //
    // 💬 Outputs
    //
    new cdk.CfnOutput(this, "TenantClinicMetadataTableName", {
      value: tenantTable.tableName,
    });
    new cdk.CfnOutput(this, "ChatSessionsTableName", {
      value: chatTable.tableName,
    });
    new cdk.CfnOutput(this, "AiAgentLambdaName", {
      value: agentLambda.functionName,
    });
  }
}
