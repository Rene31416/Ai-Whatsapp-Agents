import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json({ status: "error", error }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ status: "missing_code" }, { status: 400 });
  }

  console.log("Cognito returned code:", code);

  return NextResponse.json({
    status: "received",
    message: "Login exitoso; code recibido.",
  });
}
