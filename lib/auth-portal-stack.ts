import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";

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
}

export class AuthPortalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: AuthPortalStackProps) {
    super(scope, id, props);

    const callbackUrls =
      props?.callbackUrls ?? ["http://localhost:3000/api/auth/callback/cognito"];
    const logoutUrls = props?.logoutUrls ?? ["http://localhost:3000/"];

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
      props?.cognitoDomainPrefix ?? `portal-${this.account?.slice(-6) ?? "demo"}`;

    const userPoolDomain = userPool.addDomain("PortalUserPoolDomain", {
      cognitoDomain: {
        domainPrefix,
      },
    });

    const calendarAuthHandler = new lambda.Function(
      this,
      "CalendarAuthHandler",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromInline(`
          exports.handler = async (event) => {
            console.log("Received event:", JSON.stringify(event));
            return {
              statusCode: 200,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ok: true }),
            };
          };
        `),
      }
    );

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
  }
}
