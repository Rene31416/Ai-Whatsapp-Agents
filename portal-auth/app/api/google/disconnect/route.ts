import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE;
  if (!apiBase) {
    return NextResponse.json(
      {
        status: "error",
        message: "missing_api_base",
      },
      { status: 500 }
    );
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        message: "invalid_payload",
      },
      { status: 400 }
    );
  }

  const tenantId = payload?.tenantId;
  if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
    return NextResponse.json(
      {
        status: "error",
        message: "missing_tenant_id",
      },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(`${apiBase}/calendar/token`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenantId }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          status: "error",
          message: data?.message ?? `calendar_disconnect_failed_${response.status}`,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(
      data ?? {
        status: "ok",
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        status: "error",
        message: err?.message ?? "calendar_disconnect_exception",
      },
      { status: 500 }
    );
  }
}
