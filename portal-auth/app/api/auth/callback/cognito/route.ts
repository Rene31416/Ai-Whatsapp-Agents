import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

  const redirectUrl = new URL("/dashboard", url.origin);

  if (error) {
    redirectUrl.searchParams.set("error", error);
    return NextResponse.redirect(redirectUrl);
  }

  if (state) {
    redirectUrl.searchParams.set("state", state);
  }

  if (code) {
    console.log("Cognito returned code:", code);
    redirectUrl.searchParams.set("code", code);
  }

  return NextResponse.redirect(redirectUrl);
}
