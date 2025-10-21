import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as path from "path";
import * as kms from "aws-cdk-lib/aws-kms";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";

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

    // 💬 Buffer table (Streams/TTL removed to avoid noise)
    const chatBufferTable = new dynamodb.Table(this, "ChatMessageBuffer", {
      partitionKey: { name: "UserKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // ⛔ no stream
      // ⛔ no TTL configuration
    });

    // 🧠 NEW: Memory summaries table (one short summary per user)
    // PK: UserKey = "<tenantId>#<userId>"
    // Attributes (runtime): summary (S), updatedAt (S ISO), version (N) if you choose to use it
    const memoryTable = new dynamodb.Table(this, "MemorySummaries", {
      partitionKey: { name: "UserKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 📨 Queues
    const chatIngressDlq = new sqs.Queue(this, "ChatIngressDLQ", {
      retentionPeriod: cdk.Duration.days(14),
    });

    const chatIngressQueue = new sqs.Queue(this, "ChatIngressQueue", {
      visibilityTimeout: cdk.Duration.seconds(120),
      deadLetterQueue: {
        queue: chatIngressDlq,
        maxReceiveCount: 1,
      },
    });

    // ✅ Flush ticket queue (per-message delay set by Aggregator)
    const flushTicketQueue = new sqs.Queue(this, "FlushTicketQueue", {
      visibilityTimeout: cdk.Duration.seconds(120),
      deadLetterQueue: {
        queue: chatIngressDlq,
        maxReceiveCount: 1,
      },
    });

    // Outbound queue consumed by ChatService
    const flushOutputQueue = new sqs.Queue(this, "FlushOutputQueue", {
      visibilityTimeout: cdk.Duration.seconds(120),
      deadLetterQueue: {
        queue: chatIngressDlq,
        maxReceiveCount: 1,
      },
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
        CHAT_BUFFER_TABLE_NAME: chatBufferTable.tableName,
        GEMINI_SECRET_ARN: geminiSecret.secretArn,
        WHATSAPP_SECRET_ARN: whatsAppSecretArn,
        CHAT_INGRESS_QUEUE_URL: chatIngressQueue.queueUrl,
      },
    });

    geminiSecret.grantRead(webhookLambda);
    tenantTable.grantReadData(webhookLambda);
    chatTable.grantReadWriteData(webhookLambda);
    chatBufferTable.grantReadWriteData(webhookLambda);
    dataKey.grantEncryptDecrypt(webhookLambda);
    chatIngressQueue.grantSendMessages(webhookLambda);

    webhookLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
        resources: [`${whatsAppSecretArn}*`],
      })
    );

    // 🧩 Aggregator Lambda (buffers + emits "flush ticket" with delay)
    const aggregatorLambda = new lambda.Function(this, "AggregatorLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "aggregator.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist")),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        CHAT_BUFFER_TABLE_NAME: chatBufferTable.tableName,
        CHAT_INGRESS_QUEUE_URL: chatIngressQueue.queueUrl,
        FLUSH_TICKET_QUEUE_URL: flushTicketQueue.queueUrl,
        DEBOUNCE_SECONDS: "8",
      },
    });

    aggregatorLambda.addEventSourceMapping("IngressQueueMapping", {
      eventSourceArn: chatIngressQueue.queueArn,
      batchSize: 10,
    });
    chatIngressQueue.grantConsumeMessages(aggregatorLambda);
    chatBufferTable.grantReadWriteData(aggregatorLambda);
    dataKey.grantEncryptDecrypt(aggregatorLambda);
    flushTicketQueue.grantSendMessages(aggregatorLambda);

    // 🧠 Flush Lambda (triggered by FlushTicketQueue)
    const flushLambda = new lambda.Function(this, "FlushLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "flush.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist")),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        CHAT_BUFFER_TABLE_NAME: chatBufferTable.tableName,
        FLUSH_OUTPUT_QUEUE_URL: flushOutputQueue.queueUrl,
      },
    });

    flushLambda.addEventSource(
      new SqsEventSource(flushTicketQueue, {
        batchSize: 1,
      })
    );

    chatBufferTable.grantReadWriteData(flushLambda);
    flushOutputQueue.grantSendMessages(flushLambda);
    dataKey.grantEncryptDecrypt(flushLambda);

    // 🤖 ChatService Lambda (consumes FlushOutputQueue)
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
        TENANT_TABLE_NAME: tenantTable.tableName,
        TENANT_GSI_PHONE: "PhoneNumberIdIndex",
        CHAT_SESSIONS_TABLE_NAME: chatTable.tableName,
        // 🧠 NEW: pass memory table name
        MEMORY_TABLE_NAME: memoryTable.tableName,
      },
    });

    tenantTable.grantReadData(chatServiceLambda);
    chatBufferTable.grantReadWriteData(chatServiceLambda);
    chatTable.grantReadWriteData(chatServiceLambda);
    // grant ChatService read/write to memory table
    memoryTable.grantReadWriteData(chatServiceLambda);

    geminiSecret.grantRead(chatServiceLambda);
    dataKey.grantEncryptDecrypt(chatServiceLambda);

    chatServiceLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [`${tenantTable.tableArn}/index/*`],
      })
    );

    chatServiceLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:DescribeTable"],
        resources: [tenantTable.tableArn],
      })
    );

    chatServiceLambda.addEventSource(
      new SqsEventSource(flushOutputQueue, {
        batchSize: 1,
      })
    );

    chatServiceLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [chatTable.tableArn, `${chatTable.tableArn}/index/*`],
      })
    );

    chatServiceLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
        resources: [`${whatsAppSecretArn}*`],
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

    new cdk.CfnOutput(this, "WebhookUrl", { value: `${api.url}webhook` });
    new cdk.CfnOutput(this, "MemoryTableName", { value: memoryTable.tableName });
  }
}
