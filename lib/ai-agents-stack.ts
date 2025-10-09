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

    // ✅ Create a Lambda Layer for dependencies
    const depsLayer = new lambda.LayerVersion(this, "DepsLayer", {
      code: lambda.Code.fromAsset(path.join(process.cwd(), "layer")),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: "LangChain + Google GenAI dependencies",
    });

    // ✅ Main Lambda (lightweight now)
    const agentLambda = new lambda.Function(this, "AiAgentsFunction", {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      handler: "app.app.lambda_handler",
      code: lambda.Code.fromAsset(path.join(process.cwd(), "src"), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            "bash",
            "-c",
            [
              "cp -r app /asset-output/",
              "cp app/clinic_context.json /asset-output/app/",
            ].join(" && "),
          ],
        },
      }),
      layers: [depsLayer],
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
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
