import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";

import * as path from "path";

export class AiAgentsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =========================================================================
    // KMS
    // =========================================================================
    const dataKey = new kms.Key(this, "DataEncryptionKey", {
      alias: "ai-agents-data-key",
      enableKeyRotation: true,
    });

    // =========================================================================
    // Secrets
    // =========================================================================
    const geminiSecret = new secretsmanager.Secret(this, "GeminiApiKeySecret", {
      secretName: "GeminiApiKey",
      encryptionKey: dataKey,
    });

    const openAiSecret = new secretsmanager.Secret(this, "OpenAIApiKeySecret", {
      secretName: "OpenAIApiKey",
      encryptionKey: dataKey,
    });

    const whatsAppSecretArn = `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:WhatsappCredentials-`;

    // =========================================================================
    // DynamoDB
    // =========================================================================
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

    const memoryTable = new dynamodb.Table(this, "MemorySummaries", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // =========================================================================
    // SQS
    // =========================================================================
    const chatIngressFifoDlq = new sqs.Queue(this, "ChatIngressFifoDLQ", {
      retentionPeriod: cdk.Duration.days(14),
      fifo: true,
    });

    const standardDlq = new sqs.Queue(this, "StandardQueuesDLQ", {
      retentionPeriod: cdk.Duration.days(14),
    });

    const chatIngressQueue = new sqs.Queue(this, "ChatIngressQueue", {
      visibilityTimeout: cdk.Duration.seconds(120),
      fifo: true,
      deadLetterQueue: {
        queue: chatIngressFifoDlq,
        maxReceiveCount: 1,
      },
    });

    const deliverMessagesQueue = new sqs.Queue(this, "DeliverMessagesQueue", {
      visibilityTimeout: cdk.Duration.seconds(120),
      deadLetterQueue: {
        queue: standardDlq,
        maxReceiveCount: 1,
      },
    });

    const persisMessagesQueue = new sqs.Queue(this, "PersistMessagesQueue", {
      visibilityTimeout: cdk.Duration.seconds(120),
      deadLetterQueue: {
        queue: standardDlq,
        maxReceiveCount: 1,
      },
    });

    // =========================================================================
    // Lambdas
    // =========================================================================

    // Webhook Lambda
    const webhookLambda = new lambda.Function(this, "WebhookLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "webhook.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist")),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        CHAT_INGRESS_QUEUE_URL: chatIngressQueue.queueUrl,
        CHAT_PERSIST_QUEUE_URL: persisMessagesQueue.queueUrl,
        TENANT_TABLE_NAME: tenantTable.tableName,
        TENANT_GSI_PHONE: "PhoneNumberIdIndex",
      },
    });

    // Python deps layer
    const depsLayer = new lambda.LayerVersion(this, "DepsLayer", {
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../py_src/lambdas/dependencies/deps")
      ),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      compatibleArchitectures: [lambda.Architecture.X86_64],
    });

    // Chat Service Lambda (Python)
    const chatServiceLambda = new lambda.Function(this, "python-lambda", {
      functionName: "chat-service-lambda",
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "agentLambda.main.handler",
      code: lambda.Code.fromAsset("py_src/lambdas/dist/lambda_function.zip"),
      architecture: lambda.Architecture.X86_64,
      environment: {
        MEMORY_TABLE_NAME: memoryTable.tableName,
        OPENAI_SECRET_ID: openAiSecret.secretArn,
        CHAT_PERSIS_MESSAGE_QUEUE: persisMessagesQueue.queueUrl,
        CHAT_DELIVER_MESSAGE_QUEUE: deliverMessagesQueue.queueUrl,
        CHAT_SESSIONS_TABLE_NAME: chatTable.tableName,
      },
      layers: [depsLayer],
    });

    // Persist Messages Lambda
    const persistMessagesLambda = new lambda.Function(
      this,
      "persistMessagesLambda",
      {
        functionName: "Pesist-Meesages-Lambda",
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        handler: "persistMessages.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../dist")),
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
        environment: {
          CHAT_SESSIONS_TABLE_NAME: chatTable.tableName,
          SERVICE_NAME: "persist-messages-lambda",
        },
      }
    );

    // Deliver Messages Lambda
    const deliverMessagesLambda = new lambda.Function(
      this,
      "deliverMessagesLambda",
      {
        functionName: "Deliver-Meesages-Lambda",
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        handler: "deliverMessages.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../dist")),
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
        environment: {
          WHATSAPP_SECRET_ARN: whatsAppSecretArn,
          SERVICE_NAME: "deliver-messages-lambda",
        },
      }
    );

    // Clinic Lambda (appointments + clinic APIs)
    const clinicLambda = new lambda.Function(this, "ClinicLambda", {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: "clinic.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../dist")),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        SERVICE_NAME: "clinic-lambda",
        APPOINTMENTS_TABLE_NAME: appointmentsTable.tableName,
        APPOINTMENTS_GSI_USER: "UserAppointmentsIndex",
        APPOINTMENTS_GSI_DOCTOR: "DoctorScheduleIndex",
        APPOINTMENTS_GSI_STATUS: "StatusIndex",
        DOCTORS_TABLE_NAME: doctorsTable.tableName,
        TENANT_TABLE_NAME: tenantTable.tableName,
        TENANT_GSI_PHONE: "PhoneNumberIdIndex",
      },
    });

    chatServiceLambda.addEnvironment("CLINIC_LAMBDA_NAME", clinicLambda.functionName);
    clinicLambda.grantInvoke(chatServiceLambda);

    // =========================================================================
    // Event Sources (SQS -> Lambda)
    // =========================================================================
    persistMessagesLambda.addEventSource(
      new SqsEventSource(persisMessagesQueue, {
        batchSize: 1,
      })
    );

    deliverMessagesLambda.addEventSource(
      new SqsEventSource(deliverMessagesQueue, {
        batchSize: 1,
      })
    );

    chatServiceLambda.addEventSource(
      new SqsEventSource(chatIngressQueue, {
        batchSize: 1,
      })
    );

    // =========================================================================
    // Permissions / Grants
    // =========================================================================

    // Webhook grants
    tenantTable.grantReadData(webhookLambda);
    dataKey.grantDecrypt(webhookLambda);
    chatIngressQueue.grantSendMessages(webhookLambda);
    persisMessagesQueue.grantSendMessages(webhookLambda);

    // Chat service grants
    memoryTable.grantReadWriteData(chatServiceLambda);
    dataKey.grantEncryptDecrypt(chatServiceLambda);
    openAiSecret.grantRead(chatServiceLambda);
    persisMessagesQueue.grantSendMessages(chatServiceLambda);
    deliverMessagesQueue.grantSendMessages(chatServiceLambda);
    // persist message lambda grants
    dataKey.grantEncrypt(persistMessagesLambda);
    chatTable.grantWriteData(persistMessagesLambda);
    // Deliver Message lambda grants
    dataKey.grantDecrypt(deliverMessagesLambda);
    deliverMessagesLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        resources: [`${whatsAppSecretArn}*`],
      })
    );

    // Clinic lambda data access
    appointmentsTable.grantReadWriteData(clinicLambda);
    tenantTable.grantReadData(clinicLambda);
    doctorsTable.grantReadData(clinicLambda);

    // =========================================================================
    // API Gateway
    // =========================================================================
    const api = new apigateway.LambdaRestApi(this, "AgentsApi", {
      handler: webhookLambda,
      proxy: false,
    });

    const webhook = api.root.addResource("webhook");
    const clinic = api.root.addResource("clinic");

    const webhookIntegration = new apigateway.LambdaIntegration(webhookLambda);
    webhook.addMethod("GET", webhookIntegration);
    webhook.addMethod("POST", webhookIntegration);

    const appointmentsResource = api.root.addResource("appointments");
    const appointmentIdResource =
      appointmentsResource.addResource("{appointmentId}");
    const availabilityResource =
      appointmentsResource.addResource("availability");
    const doctorResources = clinic.addResource("doctors");

    const clinicIntegration = new apigateway.LambdaIntegration(clinicLambda);

    appointmentsResource.addMethod("POST", clinicIntegration);
    appointmentsResource.addMethod("PATCH", clinicIntegration);
    appointmentsResource.addMethod("DELETE", clinicIntegration);
    appointmentIdResource.addMethod("PATCH", clinicIntegration);
    appointmentIdResource.addMethod("DELETE", clinicIntegration);
    availabilityResource.addMethod("GET", clinicIntegration);

    // Clinic endpoints now routed through clinic lambda
    clinic.addMethod("GET", clinicIntegration);
    doctorResources.addMethod("GET", clinicIntegration);

    // =========================================================================
    // Cross-resource wiring
    // =========================================================================
    chatServiceLambda.addEnvironment(
      "APPOINTMENTS_API_BASE_URL",
      cdk.Fn.join("", [api.url, "appointments"])
    );

    // =========================================================================
    // Outputs
    // =========================================================================
    new cdk.CfnOutput(this, "AppointmentsTableName", {
      value: appointmentsTable.tableName,
    });

    new cdk.CfnOutput(this, "DoctorsTableName", {
      value: doctorsTable.tableName,
    });

    new cdk.CfnOutput(this, "WebhookUrl", { value: `${api.url}webhook` });

    new cdk.CfnOutput(this, "MemoryTableName", {
      value: memoryTable.tableName,
    });
  }
}
