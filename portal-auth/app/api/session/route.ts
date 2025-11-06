import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/session";

export async function GET() {
  const session = readSessionFromCookies();

  if (!session) {
    return NextResponse.json(
      {
        status: "unauthenticated",
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return NextResponse.json(
    {
      status: "ok",
      session,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
