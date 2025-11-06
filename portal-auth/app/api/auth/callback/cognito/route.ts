import { NextResponse } from "next/server";
import { encodeSession, SESSION_COOKIE } from "@/lib/session";

type CognitoTokenResponse = {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

type CognitoIdTokenPayload = {
  email?: string;
  sub?: string;
  "cognito:username"?: string;
  exp?: number;
  iat?: number;
};

const COGNITO_DOMAIN = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
const COGNITO_CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
const COGNITO_REDIRECT_URI = process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI;

function decodeJwtPayload(token: string): CognitoIdTokenPayload {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new Error("Invalid ID token format");
  }

  const payload = parts[1]!;
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const json = Buffer.from(padded, "base64").toString("utf8");

  return JSON.parse(json) as CognitoIdTokenPayload;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  const redirectUrl = new URL("/dashboard", url.origin);
  if (state) {
    redirectUrl.searchParams.set("state", state);
  }

  if (error) {
    redirectUrl.searchParams.set("error", error);
    return NextResponse.redirect(redirectUrl);
  }

  if (!code) {
    redirectUrl.searchParams.set("error", "missing_authorization_code");
    return NextResponse.redirect(redirectUrl);
  }

  if (!COGNITO_DOMAIN || !COGNITO_CLIENT_ID || !COGNITO_REDIRECT_URI) {
    console.error("Cognito callback missing environment configuration", {
      domain: !!COGNITO_DOMAIN,
      clientId: !!COGNITO_CLIENT_ID,
      redirectUri: !!COGNITO_REDIRECT_URI,
    });
    redirectUrl.searchParams.set("error", "server_configuration_error");
    return NextResponse.redirect(redirectUrl);
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: COGNITO_CLIENT_ID,
    code,
    redirect_uri: COGNITO_REDIRECT_URI,
  });

  let tokens: CognitoTokenResponse;

  try {
    const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Failed to exchange code with Cognito", {
        status: response.status,
        statusText: response.statusText,
        body: text,
      });
      redirectUrl.searchParams.set("error", "cognito_token_exchange_failed");
      return NextResponse.redirect(redirectUrl);
    }

    tokens = (await response.json()) as CognitoTokenResponse;
  } catch (err) {
    console.error("Unexpected error exchanging code with Cognito", err);
    redirectUrl.searchParams.set("error", "cognito_token_exchange_error");
    return NextResponse.redirect(redirectUrl);
  }

  if (!tokens.id_token) {
    console.error("Cognito response missing id_token", tokens);
    redirectUrl.searchParams.set("error", "cognito_missing_id_token");
    return NextResponse.redirect(redirectUrl);
  }

  let payload: CognitoIdTokenPayload;
  try {
    payload = decodeJwtPayload(tokens.id_token);
  } catch (err) {
    console.error("Unable to decode Cognito id_token", err);
    redirectUrl.searchParams.set("error", "invalid_id_token");
    return NextResponse.redirect(redirectUrl);
  }

  const email = payload.email ?? undefined;
  const sub = payload.sub ?? payload["cognito:username"];

  if (!email && !sub) {
    console.error("Cognito id_token missing identity claims", payload);
    redirectUrl.searchParams.set("error", "id_token_missing_identity");
    return NextResponse.redirect(redirectUrl);
  }

  const issuedAt = typeof payload.iat === "number" ? payload.iat : Math.floor(Date.now() / 1000);
  const expiresAtFromToken = typeof payload.exp === "number" ? payload.exp : undefined;
  const fallbackLifetime =
    typeof tokens.expires_in === "number" ? Math.floor(Date.now() / 1000) + tokens.expires_in : issuedAt + 3600;
  const expiresAt = expiresAtFromToken ?? fallbackLifetime;

  const session = {
    email,
    sub,
    issuedAt,
    expiresAt,
  };

  const encodedSession = encodeSession(session);

  redirectUrl.searchParams.set("authStatus", "ok");
  if (email) {
    redirectUrl.searchParams.set("user", email);
  } else if (sub) {
    redirectUrl.searchParams.set("user", sub);
  }

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set({
    name: SESSION_COOKIE,
    value: encodedSession,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt * 1000),
  });

  return response;
}
