// src/chat/prompt.helpers.ts
import { MemoryObject } from "../chat/memory.repository";

export function buildFactsHeader(mem: MemoryObject | undefined): string {
  const name = mem?.profile?.name ?? "?";
  const phone = mem?.contact?.phone ?? "?";
  const email = mem?.contact?.email ?? "?";
  return `PERFIL: Nombre=${name} | Tel=${phone} | Email=${email}`;
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
