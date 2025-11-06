import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
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

  const body =
    typeof event.body === "string" ? JSON.parse(event.body || "{}") : event.body || {};

  const code = body?.code;
  const tenantId = body?.tenantId ?? "default";
  if (!code) {
    return jsonResponse(
      400,
      { status: "error", message: "Missing OAuth 'code' in request body." }
    );
  }

  const oauthSecretArn = process.env.GOOGLE_OAUTH_SECRET_ARN;
  const tokenSecretPrefix = process.env.CALENDAR_TOKEN_SECRET_PREFIX;

  if (!oauthSecretArn || !tokenSecretPrefix) {
    console.error("Missing required environment variables.");
    return jsonResponse(
      500,
      { status: "error", message: "Server misconfiguration. Contact support." }
    );
  }

  try {
    const googleConfig = await loadGoogleConfig(oauthSecretArn);
    if (!googleConfig.clientId || !googleConfig.clientSecret || !googleConfig.redirectUri) {
      return jsonResponse(500, {
        status: "error",
        message:
          "Google OAuth configuration incomplete. Update secret with clientId, clientSecret, redirectUri.",
      });
    }

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
    await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: secretString,
      })
    );
  } catch (err: any) {
    if (err?.name === "ResourceNotFoundException") {
      await secretsClient.send(
        new CreateSecretCommand({
          Name: secretName,
          SecretString: secretString,
        })
      );
    } else {
      throw err;
    }
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
