import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";

export interface AuthPortalStackProps extends cdk.StackProps {
  /**
   * Domain prefix for the Cognito Hosted UI (must be globally unique).
   */
  readonly cognitoDomainPrefix?: string;
  /**
   * OAuth callback URLs for the user pool client.
   */
  readonly callbackUrls?: string[];
  /**
   * OAuth logout URLs for the user pool client.
   */
  readonly logoutUrls?: string[];
  /**
   * Optional DynamoDB table for tenant metadata.
   */
  readonly tenantTableName?: string;
  /**
   * Optional KMS key ARN used to encrypt the tenant metadata table.
   */
  readonly tenantTableKmsKeyArn?: string;
  /**
   * Optional ARN or name of the base secret where calendar credentials will be stored.
   */
  readonly calendarSecretBaseArn?: string;
}

export class AuthPortalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: AuthPortalStackProps) {
    super(scope, id, props);

    const callbackUrlsFromContext = this.node.tryGetContext("authPortalCallbackUrls") as
      | string[]
      | undefined;
    const logoutUrlsFromContext = this.node.tryGetContext("authPortalLogoutUrls") as
      | string[]
      | undefined;
    const domainPrefixFromContext = this.node.tryGetContext("authPortalCognitoDomainPrefix") as
      | string
      | undefined;
    const tenantTableKmsKeyArnFromContext = this.node.tryGetContext(
      "authPortalTenantTableKmsKeyArn"
    ) as string | undefined;

    const callbackUrls =
      props?.callbackUrls ??
      callbackUrlsFromContext ??
      ["http://localhost:3000/api/auth/callback/cognito"];
    const logoutUrls =
      props?.logoutUrls ?? logoutUrlsFromContext ?? ["http://localhost:3000/"];

    const userPool = new cognito.UserPool(this, "PortalUserPool", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: false,
        requireSymbols: false,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
      },
    });

    const userPoolClient = userPool.addClient("PortalUserPoolClient", {
      authFlows: {
        userPassword: true,
      },
      generateSecret: false,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls,
        logoutUrls,
      },
      preventUserExistenceErrors: true,
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    });

    const domainPrefix =
      props?.cognitoDomainPrefix ??
      domainPrefixFromContext ??
      `portal-${this.account?.slice(-6) ?? "demo"}`;

    const userPoolDomain = userPool.addDomain("PortalUserPoolDomain", {
      cognitoDomain: {
        domainPrefix,
      },
    });

    const oauthConfigSecret = new secretsmanager.Secret(this, "GoogleOAuthConfigSecret", {
      secretName: `${cdk.Stack.of(this).stackName}-google-oauth-config`,
      secretObjectValue: {
        clientId: cdk.SecretValue.unsafePlainText("SET_GOOGLE_CLIENT_ID"),
        clientSecret: cdk.SecretValue.unsafePlainText("SET_GOOGLE_CLIENT_SECRET"),
        redirectUri: cdk.SecretValue.unsafePlainText("SET_REDIRECT_URI"),
      },
    });

    const tokenSecretPrefix =
      props?.calendarSecretBaseArn ??
      (this.node.tryGetContext("calendarTokenSecretPrefix") as string | undefined) ??
      `${this.stackName}/calendar/token/tenant-`;

    const calendarAuthHandler = new nodeLambda.NodejsFunction(
      this,
      "CalendarAuthHandler",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: "src/app/lambda-handlers/calendar-auth-handler.ts",
        handler: "handler",
        bundling: {
          externalModules: [],
          target: "es2020",
        },
        timeout: cdk.Duration.seconds(20),
        environment: {
          GOOGLE_OAUTH_SECRET_ARN: oauthConfigSecret.secretArn,
          CALENDAR_TOKEN_SECRET_PREFIX: tokenSecretPrefix,
        },
      }
    );

    oauthConfigSecret.grantRead(calendarAuthHandler);

    calendarAuthHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "secretsmanager:CreateSecret",
          "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecret",
          "secretsmanager:DescribeSecret",
          "secretsmanager:DeleteSecret",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${tokenSecretPrefix}*`,
        ],
      })
    );

    const tenantTableName =
      props?.tenantTableName ??
      (this.node.tryGetContext("tenantTableName") as string | undefined) ??
      "AiAgentsStack-TenantClinicMetadataE1836452-7A05UY6RC43G";
    const tenantTableKmsKeyArn =
      props?.tenantTableKmsKeyArn ?? tenantTableKmsKeyArnFromContext;

    const tenantMetadataHandler = new nodeLambda.NodejsFunction(
      this,
      "TenantMetadataHandler",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: "src/app/lambda-handlers/tenant-metadata-handler.ts",
        handler: "handler",
        bundling: {
          externalModules: [],
          target: "es2020",
        },
        timeout: cdk.Duration.seconds(15),
        environment: {
          TENANT_TABLE_NAME: tenantTableName,
          CALENDAR_TOKEN_SECRET_PREFIX: tokenSecretPrefix,
        },
      }
    );

    tenantMetadataHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${tokenSecretPrefix}*`,
        ],
      })
    );

    if (tenantTableName) {
      const tenantTable = dynamodb.Table.fromTableName(
        this,
        "TenantMetadataTable",
        tenantTableName
      );
      tenantTable.grantReadData(tenantMetadataHandler);
      if (tenantTableKmsKeyArn) {
        const tenantTableKey = kms.Key.fromKeyArn(
          this,
          "TenantMetadataTableKey",
          tenantTableKmsKeyArn
        );
        tenantTableKey.grantDecrypt(tenantMetadataHandler);
      }
    }

    const httpApi = new apigwv2.HttpApi(this, "AuthPortalHttpApi", {
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ["*"],
      },
    });

    httpApi.addRoutes({
      path: "/calendar/callback",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        "CalendarAuthIntegration",
        calendarAuthHandler
      ),
    });

    httpApi.addRoutes({
      path: "/calendar/token",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: new integrations.HttpLambdaIntegration(
        "CalendarAuthDeleteIntegration",
        calendarAuthHandler
      ),
    });

    httpApi.addRoutes({
      path: "/tenants/me",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "TenantMetadataIntegration",
        tenantMetadataHandler
      ),
    });

    new cdk.CfnOutput(this, "AuthPortalApiUrl", {
      value: httpApi.apiEndpoint,
    });

    new cdk.CfnOutput(this, "AuthPortalUserPoolId", {
      value: userPool.userPoolId,
    });

    new cdk.CfnOutput(this, "AuthPortalUserPoolClientId", {
      value: userPoolClient.userPoolClientId,
    });

    new cdk.CfnOutput(this, "AuthPortalCognitoDomain", {
      value: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
    });

    new cdk.CfnOutput(this, "GoogleOAuthConfigSecretArn", {
      value: oauthConfigSecret.secretArn,
    });
    new cdk.CfnOutput(this, "CalendarTokenSecretPrefix", {
      value: tokenSecretPrefix,
    });
  }
}
