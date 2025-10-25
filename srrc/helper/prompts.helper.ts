// src/helpers/chat.helpers.ts
//
// Small pure helpers used by ChatService + workflow prompts.
// Keep them dependency-free so they're easy to test and reuse.

import type { MemoryObject } from "../chat/memory.repository";

/**
 * Build the compact "facts" header line that prepends prompts.
 * Example:
 *   [GREET_OK=true] PERFIL: Nombre=Michael | Tel=? | Email=?
 */
export function buildFactsHeader(
  mem: MemoryObject | undefined,
  greetOk: boolean
): string {
  const name  = mem?.profile?.name  ?? "?";
  const phone = mem?.contact?.phone ?? "?";
  const email = mem?.contact?.email ?? "?";

  const prefix = `[GREET_OK=${greetOk ? "true" : "false"}]`;
  const perfil = `PERFIL: Nombre=${name} | Tel=${phone} | Email=${email}`;
  return `${prefix} ${perfil}`;
}

/**
 * Build a compact recent conversation window in "U:/A:" lines.
 * - Takes the last k turns
 * - Normalizes whitespace per line
 * - Truncates to maxChars from the end (most recent content)
 */
export function buildRecentWindow(
  turns: Array<{ role: "user" | "agent"; message: string }>,
  k = 8,
  maxChars = 1600
): string {
  const lastK = (turns ?? []).slice(-k);
  const lines = lastK.map((t) =>
    `${t.role === "user" ? "U" : "A"}: ${String(t.message ?? "")
      .replace(/\s+/g, " ")
      .trim()}`
  );

  let joined = lines.join("\n");
  if (joined.length > maxChars) {
    // Keep the most recent tail if over limit
    joined = joined.slice(-maxChars);
  }
  return joined;
}
