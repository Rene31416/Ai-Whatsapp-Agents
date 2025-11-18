// src/prompts/facts.extractor.llm.ts

import { injectable } from "inversify";
import { PromptTemplate } from "@langchain/core/prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

import { getLLM } from "../services/llm.services";

/**
 * Shape we persist in memory under something like `memory.contactProfile`.
 * All fields are optional or null because the user can clear them.
 */
export interface ContactProfile {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  timezoneHint?: string | null;
}


/**
 * Patch object we merge into MemoryRepository.mergeMemoryDelta().
 * Only fields that appear here will be merged.
 */
export interface ContactProfilePatch {
  contactProfile?: ContactProfile;
}

/**
 * Raw schema we accept from the LLM.
 * Matches ContactProfile but every field is optional and can be null.
 */
const LlmContactProfileSchema = z
  .object({
    contactProfile: z
      .object({
        name: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        timezoneHint: z.string().nullable().optional(),
      })
      .partial()
      .optional(),
  })
  .partial();

export type LlmContactProfile = z.infer<typeof LlmContactProfileSchema>;

/**
 * Normalizes different LangChain/Gemini response container shapes to a plain string.
 */
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

  try {
    return JSON.stringify(msg);
  } catch {
    return String(msg ?? "");
  }
}

/**
 * Builds a safe patch object out of the validated LLM output.
 *
 * Rules:
 * - If a field is missing entirely, we do not include it in the patch.
 *   (We don't want to overwrite existing memory accidentally.)
 * - If a field is present with a value, we include it.
 * - If a field is present with null, we include null (meaning "clear this").
 */
function buildPatchFromLlm(validFacts: LlmContactProfile): ContactProfilePatch {
  const out: ContactProfilePatch = {};

  const src = validFacts.contactProfile;
  if (!src || typeof src !== "object") {
    return out;
  }

  const dest: ContactProfile = {};

  if (Object.prototype.hasOwnProperty.call(src, "name")) {
    dest.name = src.name === null ? null : String(src.name ?? "");
  }

  if (Object.prototype.hasOwnProperty.call(src, "phone")) {
    dest.phone = src.phone === null ? null : String(src.phone ?? "");
  }

  if (Object.prototype.hasOwnProperty.call(src, "email")) {
    dest.email = src.email === null ? null : String(src.email ?? "");
  }

  if (Object.prototype.hasOwnProperty.call(src, "timezoneHint")) {
    dest.timezoneHint =
      src.timezoneHint === null ? null : String(src.timezoneHint ?? "");
  }

  if (
    Object.prototype.hasOwnProperty.call(dest, "name") ||
    Object.prototype.hasOwnProperty.call(dest, "phone") ||
    Object.prototype.hasOwnProperty.call(dest, "email") ||
    Object.prototype.hasOwnProperty.call(dest, "timezoneHint")
  ) {
    out.contactProfile = dest;
  }

  return out;
}

/**
 * ContactFactsExtractorService
 *
 * Responsibility:
 * - Given the most recent user message, ask the LLM to extract
 *   contact/identity info (name, phone, email, timezoneHint).
 * - Return a minimal patch object to merge into memory.
 *
 * Contract:
 * - Only analyzes this single message, not chat history.
 * - The LLM must output JSON with an optional "contactProfile" object.
 * - Fields that are not mentioned in the message must not appear.
 * - Fields can be null if the user explicitly invalidates them.
 */
@injectable()
export class ContactFactsExtractorService {
  /**
   * Run LLM extraction on the provided message.
   * Returns a ContactProfilePatch ready for mergeMemoryDelta().
   */
  public async extractFromMessage(message: string): Promise<ContactProfilePatch> {
    const rawMsg = (message ?? "").toString().slice(0, 3000);

    const base = await getLLM();
    const tuned =
      (base as any).bind?.({
        temperature: 0.1,
        top_p: 0.9,
        responseMimeType: "application/json",
        maxOutputTokens: 200,
      }) ?? base;

    const parser = new JsonOutputParser<LlmContactProfile>();

const prompt = new PromptTemplate({
  inputVariables: ["user_message", "format_instructions"],
  template: `
Eres un extractor de datos de contacto del cliente.

Objetivo:
Devuelve UN SOLO objeto JSON. Ese objeto puede tener la clave "contactProfile".
Dentro de "contactProfile" puedes incluir cualquiera de estas claves:
- "name"
- "phone"
- "email"
- "timezoneHint"

Reglas:
- Usa SOLO la información personal que el usuario da de sí mismo en ESTE mensaje.
- Si el usuario dice que un dato ya no aplica ("cambié de número", "ese correo ya no"), devuelve ese campo con null.
- Si el usuario da un valor claro (por ejemplo "mi nombre es Carla"), inclúyelo tal cual como string.
- Si el usuario no menciona explícitamente un campo, NO incluyas esa clave.
- No inventes nada.
- No uses datos de mensajes anteriores.
- La salida DEBE ser SOLO el JSON, sin texto extra.

Mensaje del usuario:
{user_message}

Instrucciones de salida:
{format_instructions}
  `.trim(),
});


    const rendered = await prompt.format({
      user_message: rawMsg,
      format_instructions: parser.getFormatInstructions(),
    });

    const llmOut: any = await tuned.invoke(rendered);
    const rawResp = extractAnyText(llmOut);

    // Parse to JS
    let parsed: LlmContactProfile = {};
    try {
      parsed = await parser.parse(rawResp);
    } catch {
      parsed = {};
    }

    // Validate shape
    const validation = LlmContactProfileSchema.safeParse(parsed);
    if (!validation.success) {
      // Invalid model output: return empty patch
      return {};
    }

    // Build minimal patch from model output
    const patch = buildPatchFromLlm(validation.data);

    return patch;
  }
}
