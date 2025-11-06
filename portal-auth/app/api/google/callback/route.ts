import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const currentUrl = new URL(request.url);
  const code = currentUrl.searchParams.get("code");
  const error = currentUrl.searchParams.get("error");
  const state = currentUrl.searchParams.get("state") ?? "default";
  const apiBase = process.env.NEXT_PUBLIC_API_BASE;

  const redirectUrl = new URL("/dashboard", currentUrl.origin);

  if (error) {
    redirectUrl.searchParams.set("calendarStatus", "error");
    redirectUrl.searchParams.set("calendarError", error);
    return NextResponse.redirect(redirectUrl);
  }

  if (!code) {
    redirectUrl.searchParams.set("calendarStatus", "error");
    redirectUrl.searchParams.set("calendarError", "missing_code");
    return NextResponse.redirect(redirectUrl);
  }

  if (!apiBase) {
    redirectUrl.searchParams.set("calendarStatus", "error");
    redirectUrl.searchParams.set("calendarError", "missing_api_base");
    return NextResponse.redirect(redirectUrl);
  }

  try {
    const response = await fetch(`${apiBase}/calendar/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        tenantId: state || "default",
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      redirectUrl.searchParams.set("calendarStatus", "error");
      redirectUrl.searchParams.set(
        "calendarError",
        data?.message ?? `callback_failed_${response.status}`
      );
      return NextResponse.redirect(redirectUrl);
    }

    redirectUrl.searchParams.set("calendarStatus", "ok");
    return NextResponse.redirect(redirectUrl);
  } catch (err: any) {
    redirectUrl.searchParams.set("calendarStatus", "error");
    redirectUrl.searchParams.set(
      "calendarError",
      err?.message ?? "callback_exception"
    );
    return NextResponse.redirect(redirectUrl);
  }
}
