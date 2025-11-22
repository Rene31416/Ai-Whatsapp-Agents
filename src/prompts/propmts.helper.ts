
import { MemoryObject } from "../chat/memory.repository";

export function buildFactsHeader(mem: MemoryObject | undefined, greetOk: boolean): string {
  const name  = mem?.profile?.name   ?? "?";
  const phone = mem?.contact?.phone  ?? "?";
  const email = mem?.contact?.email  ?? "?";

  // Flag al inicio + PERFIL compacto (evita espacios alrededor del "=" en la flag)
  const prefix = `[GREET_OK=${greetOk ? "true" : "false"}]`;
  const perfil = `PERFIL: Nombre=${name} | Tel=${phone} | Email=${email}`;

  return `${prefix} ${perfil}`;
}


export function buildRecentWindow(
  turns: Array<{ role: "user" | "agent"; message: string }>,
  k = 8,
  maxChars = 1600
): string {
  const lastK = (turns ?? []).slice(-k);
  const lines = lastK.map(
    (t) => `${t.role === "user" ? "U" : "A"}: ${String(t.message ?? "")
      .replace(/\s+/g, " ")
      .trim()}`
  );
  let joined = lines.join("\n");
  if (joined.length > maxChars) joined = joined.slice(-maxChars);
  return joined;
}

/**
 * Returns true if 8 hours have passed from `sinceIso` to now.
 * @param sinceIso ISO-8601 timestamp (e.g. "2025-10-23T08:15:00.000Z")
 * @param now Optional override for "current" time (useful in tests)
 */
export function hasEightHoursElapsed(sinceIso: string, now: Date = new Date()): boolean {
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) return false;        // invalid input → false
  const diffMs = now.getTime() - since.getTime();         // negative if since is in the future
  return diffMs >= 4 * 60 * 60 * 1000;                    // 4 hours in ms
}

