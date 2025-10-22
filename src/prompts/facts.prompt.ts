// src/prompts/facts.extractor.llm.ts
import { PromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { getLLM } from "../chat/models";
import { JsonOutputParser } from "@langchain/core/output_parsers";

export const ClientFactsSchema = z
  .object({
    profile: z.object({ name: z.string().min(1).optional() }).partial().optional(),
    contact: z
      .object({
        phone: z.string().min(3).nullable().optional(),
        email: z.string().email().nullable().optional(),
      })
      .partial()
      .optional(),
  })
  .partial();

export type ClientFacts = z.infer<typeof ClientFactsSchema>;

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
 * LLM fallback para extraer datos estables del cliente (name/phone/email) del diálogo reciente.
 * Devuelve un objeto parcial anidado listo para "merge" en Dynamo.
 */
export async function extractClientFacts(input: {
  last10: Array<{ role: "user" | "agent"; message: string }>;
}): Promise<ClientFacts> {
  const base = await getLLM();
  const tuned =
    (base as any).bind?.({
      temperature: 0.1,
      top_p: 0.9,
      responseMimeType: "application/json",
      maxOutputTokens: 200,
    }) ?? base;

  const recent_dialog = (input.last10 ?? [])
    .map((t) => `${t.role === "user" ? "U" : "A"}: ${String(t.message ?? "").replace(/\s+/g, " ").trim()}`)
    .join("\n")
    .slice(0, 3000);

  console.info(`[facts][in] turns=${(input.last10 ?? []).length} chars=${recent_dialog.length}`);

  const parser = new JsonOutputParser<ClientFacts>();

  const prompt = new PromptTemplate({
    inputVariables: ["recent_dialog", "format_instructions"],
    template: `
Eres un extractor de datos del cliente para una clínica dental.

Objetivo:
- Devuelve UN ÚNICO objeto JSON válido con **forma ANIDADA** (sin claves con punto).
Ejemplo de forma (no inventes campos):
{{
  "profile": {{ "name": "..." }},
  "contact": {{ "phone": "...", "email": "..." }}
}}
- Incluye solo lo que el usuario afirma de sí mismo (no inventes).
- Si el usuario corrige o anula un dato (p.ej., "mi correo ya no es…"), usa null.
- No devuelvas texto fuera del JSON, ni listas, ni markdown, ni bloques de código.

Diálogo (cronológico):
{recent_dialog}

Instrucciones de salida (OBLIGATORIO):
{format_instructions}
`.trim(),
  });

  const rendered = await prompt.format({
    recent_dialog,
    format_instructions: parser.getFormatInstructions(),
  });

  const stop = startTimer("LLM(extractClientFacts)");
  const llmOut: any = await tuned.invoke(rendered);
  stop();

  const raw = extractAnyText(llmOut);

  // Parse JSON y valida
  let parsed: ClientFacts = {};
  try {
    parsed = await parser.parse(raw);
  } catch {
    parsed = {};
  }

  const ok = ClientFactsSchema.safeParse(parsed);
  if (!ok.success) {
    console.info("[facts][out] invalid schema → {}");
    return {};
  }

  // Sanitiza longitudes
  const out: ClientFacts = {};
  if (ok.data.profile?.name) {
    out.profile = {
      ...(out.profile ?? {}),
      name: String(ok.data.profile.name).slice(0, 120),
    };
  }
  if (ok.data.contact) {
    const c = ok.data.contact;
    if ("phone" in c) {
      out.contact = {
        ...(out.contact ?? {}),
        phone: c.phone === null ? null : String(c.phone ?? "").slice(0, 64),
      };
    }
    if ("email" in c) {
      out.contact = {
        ...(out.contact ?? {}),
        email: c.email === null ? null : String(c.email ?? "").slice(0, 120),
      };
    }
  }

  console.info(`[facts][out] profile_name=${out.profile?.name ?? "-"} phone=${out.contact?.phone ?? "-"} email=${out.contact?.email ?? "-"}`);
  return out;
}
