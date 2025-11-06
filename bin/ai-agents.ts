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

const normalizeContextArray = (value: unknown): string[] | undefined => {
  if (!value) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => !!entry);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => !!entry);
  }
  return undefined;
};

new AiAgentsStack(app, "AiAgentsStack", {
  env,
});

const authPortalProps: AuthPortalStackProps = {
  env,
  cognitoDomainPrefix:
    (app.node.tryGetContext("authPortalCognitoDomainPrefix") as string | undefined) ??
    app.node.tryGetContext("cognitoDomainPrefix") ??
    "ai-agents-portal",
  callbackUrls:
    normalizeContextArray(app.node.tryGetContext("authPortalCallbackUrls")) ??
    normalizeContextArray(app.node.tryGetContext("portalCallbackUrls")) ?? [
      "http://localhost:3000/api/auth/callback/cognito",
    ],
  logoutUrls:
    normalizeContextArray(app.node.tryGetContext("authPortalLogoutUrls")) ??
    normalizeContextArray(app.node.tryGetContext("portalLogoutUrls")) ?? ["http://localhost:3000/"],
  tenantTableKmsKeyArn: app.node.tryGetContext("authPortalTenantTableKmsKeyArn") as
    | string
    | undefined,
};

new AuthPortalStack(app, "AuthPortalStack", authPortalProps);
