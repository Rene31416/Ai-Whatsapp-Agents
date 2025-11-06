import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
  DeleteSecretCommand,
} from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({});

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export const handler = async (event: any) => {
  console.log("Incoming event:", JSON.stringify(event));

  const method =
    (event?.requestContext?.http?.method ??
      event?.httpMethod ??
      "POST")?.toString()?.toUpperCase() ?? "POST";

  const body =
    typeof event.body === "string" ? JSON.parse(event.body || "{}") : event.body || {};

  const tenantId = (body?.tenantId as string | undefined) ?? "default";

  const oauthSecretArn = process.env.GOOGLE_OAUTH_SECRET_ARN;
  const tokenSecretPrefix = process.env.CALENDAR_TOKEN_SECRET_PREFIX;

  if (!oauthSecretArn || !tokenSecretPrefix) {
    console.error("Missing required environment variables.");
    return jsonResponse(
      500,
      { status: "error", message: "Server misconfiguration. Contact support." }
    );
  }

  if (!tenantId || tenantId.trim().length === 0) {
    return jsonResponse(
      400,
      { status: "error", message: "Missing 'tenantId' in request body." }
    );
  }

  if (method === "DELETE") {
    try {
      console.log("Disconnecting calendar integration for tenant", { tenantId });
      await removeTokens({
        tokenSecretPrefix,
        tenantId,
      });
      return jsonResponse(200, {
        status: "ok",
        message: "Calendar disconnected successfully.",
        tenantId,
      });
    } catch (err: any) {
      console.error("Failed to disconnect calendar integration", err);
      return jsonResponse(
        500,
        { status: "error", message: err?.message ?? "Failed to disconnect calendar." }
      );
    }
  }

  if (method !== "POST") {
    return jsonResponse(
      405,
      { status: "error", message: `Method ${method} not allowed.` }
    );
  }

  const code = body?.code as string | undefined;
  if (!code) {
    return jsonResponse(
      400,
      { status: "error", message: "Missing OAuth 'code' in request body." }
    );
  }

  try {
    console.log("Loading Google OAuth config");
    const googleConfig = await loadGoogleConfig(oauthSecretArn);
    if (!googleConfig.clientId || !googleConfig.clientSecret || !googleConfig.redirectUri) {
      return jsonResponse(500, {
        status: "error",
        message:
          "Google OAuth configuration incomplete. Update secret with clientId, clientSecret, redirectUri.",
      });
    }

    console.log("Exchanging authorization code for tokens", {
      tenantId,
      redirectUri: googleConfig.redirectUri,
    });
    const tokenResp = await exchangeCodeForTokens({
      code,
      clientId: googleConfig.clientId,
      clientSecret: googleConfig.clientSecret,
      redirectUri: googleConfig.redirectUri,
    });
    if (tokenResp.error) {
      console.error("OAuth token exchange error:", tokenResp);
      return jsonResponse(
        400,
        { status: "error", message: tokenResp.error_description ?? tokenResp.error }
      );
    }

    if (!tokenResp.refresh_token) {
      return jsonResponse(
        400,
        {
          status: "error",
          message:
            "Google did not return a refresh_token. Ensure 'access_type=offline' and prompt=consent.",
        }
      );
    }

    console.log("Storing refresh token for tenant", { tenantId });
    await storeTokens({
      tokenSecretPrefix,
      tenantId,
      payload: {
        provider: "google",
        refresh_token: tokenResp.refresh_token,
        scope: tokenResp.scope,
        receivedAt: new Date().toISOString(),
      },
    });

    return jsonResponse(200, {
      status: "ok",
      message: "Refresh token stored successfully.",
      tenantId,
    });
  } catch (err: any) {
    console.error("Unhandled error in calendar auth handler:", err);
    return jsonResponse(
      500,
      { status: "error", message: err?.message ?? "Unhandled server error" }
    );
  }
};

async function loadGoogleConfig(secretArn: string): Promise<GoogleConfig> {
  const secretValue = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: secretArn,
    })
  );

  const raw = secretValue.SecretString ? JSON.parse(secretValue.SecretString) : {};

  return {
    clientId: raw.clientId ?? raw.client_id ?? "",
    clientSecret: raw.clientSecret ?? raw.client_secret ?? "",
    redirectUri: raw.redirectUri ?? raw.redirect_uri ?? "",
  };
}

async function exchangeCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const { code, clientId, clientSecret, redirectUri } = params;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  const json = (await response.json()) as TokenResponse;
  console.log("Google token endpoint response", {
    status: response.status,
    hasRefreshToken: Boolean(json.refresh_token),
    error: json.error,
  });
  if (!response.ok) {
    console.error("Google token endpoint error:", json);
    return json;
  }
  return json;
}

async function storeTokens(params: {
  tokenSecretPrefix: string;
  tenantId: string;
  payload: Record<string, unknown>;
}) {
  const { tokenSecretPrefix, tenantId, payload } = params;
  const secretName = `${tokenSecretPrefix}${tenantId}`;
  const secretString = JSON.stringify(payload);

  try {
    console.log("Updating existing secret", { secretName });
    await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: secretString,
      })
    );
  } catch (err: any) {
    if (err?.name === "ResourceNotFoundException") {
      console.log("Secret not found, creating new secret", { secretName });
      await secretsClient.send(
        new CreateSecretCommand({
          Name: secretName,
          SecretString: secretString,
        })
      );
    } else {
      console.error("Failed to store tokens in Secrets Manager", err);
      throw err;
    }
  }
}

async function removeTokens(params: { tokenSecretPrefix: string; tenantId: string }) {
  const { tokenSecretPrefix, tenantId } = params;
  const secretName = `${tokenSecretPrefix}${tenantId}`;
  try {
    await secretsClient.send(
      new DeleteSecretCommand({
        SecretId: secretName,
        ForceDeleteWithoutRecovery: true,
      })
    );
    console.log("Calendar secret deleted", { secretName });
  } catch (err: any) {
    if (err?.name === "ResourceNotFoundException") {
      console.warn("Calendar secret not found during delete", { secretName });
      return;
    }
    throw err;
  }
}

function jsonResponse(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}
