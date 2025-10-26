// src/helper/prompts.helper.ts
// Helpers to build:
//  - a compact "facts header" line the LLM can read
//  - a recent conversation window (U:/A: ...)

import { MemoryObject } from "../chat/memory.repository";

/**
 * Build the "FACTS:" string we pass to the LLM.
 * Includes greet flag and the user's known contact info.
 *
 * Example:
 *   "[GREET_OK=true] CONTACT: Name=Michael | Phone=503... | Email=mike@x.com | TZ=CST"
 *
 * Rules:
 * - If a field is missing/undefined, use "?" so the model sees it's unknown.
 * - Null means "user said this should be cleared", we surface that as "null".
 */
export function buildFactsHeader(
  mem: MemoryObject | undefined,
  greetOk: boolean
): string {
  const cp = mem?.contactProfile;

  // normalize each piece as a short printable string
  const name =
    cp && "name" in cp ? (cp.name === null ? "null" : cp.name ?? "?") : "?";

  const phone =
    cp && "phone" in cp ? (cp.phone === null ? "null" : cp.phone ?? "?") : "?";

  const email =
    cp && "email" in cp ? (cp.email === null ? "null" : cp.email ?? "?") : "?";

  const tz =
    cp && "timezoneHint" in cp
      ? cp.timezoneHint === null
        ? "null"
        : cp.timezoneHint ?? "?"
      : "?";

  // We keep the GREET_OK flag first because the LLM logic uses it
  // to decide whether to re-greet / introduce itself.
  const prefix = `[GREET_OK=${greetOk ? "true" : "false"}]`;

  // Keep this compact and stable; the LLM prompt refers to "FACTS:"
  const contactLine = `CONTACT: Name=${name} | Phone=${phone} | Email=${email} | TZ=${tz}`;

  return `${prefix} ${contactLine}`;
}

/**
 * Build a compact rolling window of recent turns for context.
 * We only include the last `k` messages, label them as U:/A:,
 * collapse whitespace, and trim total length.
 */
export function buildRecentWindow(
  turns: Array<{ role: "user" | "agent"; message: string }>,
  k = 8,
  maxChars = 1600
): string {
  const lastK = (turns ?? []).slice(-k);

  const lines = lastK.map((t) => {
    const roleTag = t.role === "user" ? "U" : "A";
    const cleaned = String(t.message ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return `${roleTag}: ${cleaned}`;
  });

  let joined = lines.join("\n");
  if (joined.length > maxChars) {
    // keep the tail (most recent context is more relevant)
    joined = joined.slice(-maxChars);
  }

  return joined;
}
