#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AiAgentsStack } from "../lib/ai-agents-stack";
import {
  AuthPortalStack,
  AuthPortalStackProps,
} from "../lib/auth-portal-stack";

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

new AiAgentsStack(app, "AiAgentsStack", {
  env,
});

const authPortalProps: AuthPortalStackProps = {
  env,
  cognitoDomainPrefix: app.node.tryGetContext("cognitoDomainPrefix") ?? "ai-agents-portal",
  callbackUrls: app.node
    .tryGetContext("portalCallbackUrls")
    ?.split(",")
    .map((url: string) => url.trim())
    .filter((url: string) => !!url) ?? ["http://localhost:3000/api/auth/callback/cognito"],
  logoutUrls: app.node
    .tryGetContext("portalLogoutUrls")
    ?.split(",")
    .map((url: string) => url.trim())
    .filter((url: string) => !!url) ?? ["http://localhost:3000/"],
};

new AuthPortalStack(app, "AuthPortalStack", authPortalProps);
