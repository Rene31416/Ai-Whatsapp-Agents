import { PromptTemplate } from "@langchain/core/prompts";
import { getLLM } from "../chat/models";

function extractAnyText(msg: any): string {
  if (!msg) return "";
  const gen =
    msg?.generations?.[0]?.[0]?.text ??
    msg?.generations?.[0]?.[0]?.message?.content;
  if (typeof gen === "string" && gen.trim()) return gen;
  if (typeof msg?.content === "string") return msg.content;
  if (typeof msg?.text === "string") return msg.text;
  const parts =
    msg?.response?.candidates?.[0]?.content?.parts ??
    msg?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const texts = parts
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .filter(Boolean);
    if (texts.length) return texts.join("\n");
  }
  try { return JSON.stringify(msg); } catch { return String(msg ?? ""); }
}


function startTimer(label: string) {
  const t0 = process.hrtime.bigint();
  return () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.info(`⏱ ${label}: ${ms.toFixed(1)} ms`);
    return ms;
  };
}

/**
 * Summarize last turns into 1–3 plain-text sentences (<= limitChars).
 */
export async function summarizeRecentDialog(input: {
  last10: Array<{ role: "user" | "agent"; message: string }>;
  limitChars?: number;
}): Promise<string> {
  const base = await getLLM();
  const tuned =
    (base as any).bind?.({
      temperature: 0.2,
      top_p: 0.9,
      responseMimeType: "text/plain",
      maxOutputTokens: 256,
    }) ?? base;

  const LIMIT = input.limitChars ?? 350;
  const recent_dialog = (input.last10 ?? [])
    .map(
      (t) =>
        `${t.role === "user" ? "U" : "A"}: ${String(t.message ?? "")
          .replace(/\s+/g, " ")
          .trim()}`
    )
    .join("\n")
    .slice(0, 3000);

  console.info(
    `[summary][in] turns=${(input.last10 ?? []).length} chars=${recent_dialog.length} limit=${LIMIT}`
  );

  const prompt = new PromptTemplate({
    inputVariables: ["recent_dialog", "limit"],
    template: `
Eres el módulo de memoria a corto plazo de una clínica dental.

Tarea:
- Resume el diálogo reciente (hasta 10 mensajes) en 1–3 frases, en español.
- Máximo {limit} caracteres.
- Devuelve solo TEXTO PLANO: sin listas, sin emojis, sin JSON y sin markdown.

Diálogo (cronológico):
{recent_dialog}
`.trim(),
  });

  const rendered = await prompt.format({ recent_dialog, limit: String(LIMIT) });

  const stop = startTimer("LLM(summarizeRecentDialog)");
  const msg: any = await tuned.invoke(rendered);
  stop();

  const text =
    extractAnyText(msg) ||
    "";

  const out = String(text).replace(/\s+/g, " ").trim().slice(0, LIMIT);
  console.info(`[summary][out] len=${out.length}`);
  return out;
}
