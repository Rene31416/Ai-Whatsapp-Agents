import { cookies } from "next/headers";

export const SESSION_COOKIE = "portal-auth-session";

export type PortalSession = {
  email?: string;
  sub?: string;
  issuedAt: number;
  expiresAt: number;
};

export function encodeSession(session: PortalSession): string {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

export function decodeSession(value: string): PortalSession | null {
  try {
    const json = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as PortalSession;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    if (typeof parsed.issuedAt !== "number" || typeof parsed.expiresAt !== "number") {
      return null;
    }
    return parsed;
  } catch (err) {
    console.error("Failed to decode session cookie", err);
    return null;
  }
}

export function readSessionFromCookies(): PortalSession | null {
  const store = cookies();
  const cookie = store.get(SESSION_COOKIE);
  if (!cookie?.value) {
    return null;
  }
  return decodeSession(cookie.value);
}
