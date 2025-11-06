import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

const COGNITO_DOMAIN = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
const COGNITO_CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
const COGNITO_LOGOUT_REDIRECT =
  process.env.NEXT_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI ?? process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI;

export async function GET(request: Request) {
  const url = new URL(request.url);

  const fallbackRedirect = COGNITO_LOGOUT_REDIRECT ?? `${url.origin}/`;

  let redirectTarget = fallbackRedirect;

  if (COGNITO_DOMAIN && COGNITO_CLIENT_ID && fallbackRedirect) {
    const params = new URLSearchParams({
      client_id: COGNITO_CLIENT_ID,
      logout_uri: fallbackRedirect,
    });
    redirectTarget = `${COGNITO_DOMAIN}/logout?${params.toString()}`;
  }

  const response = NextResponse.redirect(redirectTarget);

  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });

  return response;
}
