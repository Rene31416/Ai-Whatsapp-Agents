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
    const openAiSecret = new secretsmanager.Secret(this, "OpenAIApiKeySecret", {
      secretName: "OpenAIApiKey",
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

    const doctorsTable = new dynamodb.Table(this, "Doctors", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const appointmentsTable = new dynamodb.Table(this, "Appointments", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    appointmentsTable.addGlobalSecondaryIndex({
      indexName: "UserAppointmentsIndex",
      partitionKey: { name: "UserKey", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "StartKey", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    appointmentsTable.addGlobalSecondaryIndex({
      indexName: "DoctorScheduleIndex",
      partitionKey: { name: "DoctorKey", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "StartKey", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    appointmentsTable.addGlobalSecondaryIndex({
      indexName: "StatusIndex",
      partitionKey: { name: "StatusKey", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "StartKey", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
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

    const chatIngressFifoDlq = new sqs.Queue(this, "ChatIngressFifoDLQ", {
      retentionPeriod: cdk.Duration.days(14),
      fifo: true,
    });

    const chatIngressQueue = new sqs.Queue(this, "ChatIngressQueue", {
      visibilityTimeout: cdk.Duration.seconds(120),
      fifo: true,
      deadLetterQueue: {
        queue: chatIngressFifoDlq,
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
        GEMINI_SECRET_ARN: geminiSecret.secretArn,
        WHATSAPP_SECRET_ARN: whatsAppSecretArn,
        CHAT_INGRESS_QUEUE_URL: chatIngressQueue.queueUrl,
        TENANT_TABLE_NAME: tenantTable.tableName,
        TENANT_GSI_PHONE: "PhoneNumberIdIndex",
      },
    });

    geminiSecret.grantRead(webhookLambda);
    tenantTable.grantReadData(webhookLambda);
    chatTable.grantReadWriteData(webhookLambda);
    dataKey.grantEncryptDecrypt(webhookLambda);
    chatIngressQueue.grantSendMessages(webhookLambda);

    webhookLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
        resources: [`${whatsAppSecretArn}*`],
      })
    );

    // 🤖 ChatService Lambda (consumes FIFO ingress queue)
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
        TENANT_TABLE_NAME: tenantTable.tableName,
        TENANT_GSI_PHONE: "PhoneNumberIdIndex",
        CHAT_SESSIONS_TABLE_NAME: chatTable.tableName,
        // 🧠 NEW: pass memory table name
        MEMORY_TABLE_NAME: memoryTable.tableName,
        DOCTORS_TABLE_NAME: doctorsTable.tableName,
        OPENAI_SECRET_ARN: openAiSecret.secretArn,
      },
    });

    tenantTable.grantReadData(chatServiceLambda);
    chatTable.grantReadWriteData(chatServiceLambda);
    // grant ChatService read/write to memory table
    memoryTable.grantReadWriteData(chatServiceLambda);
    doctorsTable.grantReadData(chatServiceLambda);

    geminiSecret.grantRead(chatServiceLambda);
    openAiSecret.grantRead(chatServiceLambda);
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
      new SqsEventSource(chatIngressQueue, {
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

    const appointmentsLambda = new lambda.Function(this, "AppointmentsLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "appointments.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist")),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        SERVICE_NAME: "appointments-lambda",
        APPOINTMENTS_TABLE_NAME: appointmentsTable.tableName,
        APPOINTMENTS_GSI_USER: "UserAppointmentsIndex",
        APPOINTMENTS_GSI_DOCTOR: "DoctorScheduleIndex",
        APPOINTMENTS_GSI_STATUS: "StatusIndex",
      },
    });

    appointmentsTable.grantReadWriteData(appointmentsLambda);

    // 🌐 API Gateway
    const api = new apigateway.LambdaRestApi(this, "AgentsApi", {
      handler: webhookLambda,
      proxy: false,
    });

    const webhook = api.root.addResource("webhook");
    webhook.addMethod("GET", new apigateway.LambdaIntegration(webhookLambda));
    webhook.addMethod("POST", new apigateway.LambdaIntegration(webhookLambda));

    const appointmentsResource = api.root.addResource("appointments");
    const appointmentIdResource = appointmentsResource.addResource("{appointmentId}");
    const availabilityResource = appointmentsResource.addResource("availability");
    const appointmentsIntegration = new apigateway.LambdaIntegration(appointmentsLambda);

    appointmentsResource.addMethod("POST", appointmentsIntegration);
    appointmentsResource.addMethod("PATCH", appointmentsIntegration);
    appointmentsResource.addMethod("DELETE", appointmentsIntegration);
    appointmentIdResource.addMethod("PATCH", appointmentsIntegration);
    appointmentIdResource.addMethod("DELETE", appointmentsIntegration);
    availabilityResource.addMethod("GET", appointmentsIntegration);

    chatServiceLambda.addEnvironment(
      "APPOINTMENTS_API_BASE_URL",
      cdk.Fn.join("", [api.url, "appointments"])
    );

    new cdk.CfnOutput(this, "AppointmentsTableName", { value: appointmentsTable.tableName });
    new cdk.CfnOutput(this, "DoctorsTableName", { value: doctorsTable.tableName });
    new cdk.CfnOutput(this, "WebhookUrl", { value: `${api.url}webhook` });
    new cdk.CfnOutput(this, "MemoryTableName", { value: memoryTable.tableName });
  }
}
