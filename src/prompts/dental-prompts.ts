import { PromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { getLLM, CLINIC_CONTEXT } from "../chat/models";
import { JsonOutputParser } from "@langchain/core/output_parsers";

export const DecisionLiteSchema = z.object({
  final_answer: z
    .string()
    .min(1, "final_answer vacío")
    .max(400, "final_answer excede 400 chars"),
  identify_intent: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type DecisionLite = z.infer<typeof DecisionLiteSchema>;

const CompactSchema = z.object({
  a: z.string().min(1).max(400),
  ii: z.boolean(),
  c: z.number().min(0).max(1),
});
type Compact = z.infer<typeof CompactSchema>;

function extractAnyText(msg: any): string {
  if (!msg) return "";
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) {
    const t = msg.content
      .map((p: any) => p?.text || p?.content || "")
      .filter(Boolean)
      .join("\n");
    if (t.trim()) return t;
  }
  const gen = msg?.generations?.[0]?.[0];
  const gText = gen?.text ?? gen?.message?.content;
  if (typeof gText === "string" && gText.trim()) return gText;
  const parts =
    msg?.response?.candidates?.[0]?.content?.parts ??
    msg?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const t = parts
      .map((p: any) => p?.text || "")
      .filter(Boolean)
      .join("\n");
    if (t.trim()) return t;
  }
  try {
    return JSON.stringify(msg);
  } catch {
    return String(msg ?? "");
  }
}

function startTimer(label: string) {
  const t0 = process.hrtime.bigint();
  return () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.info(`⏱ ${label}: ${ms.toFixed(1)} ms`);
    return ms;
  };
}

function getFinishReason(msg: any): string | undefined {
  return (
    msg?.additional_kwargs?.finishReason ??
    msg?.response_metadata?.finishReason ??
    msg?.kwargs?.additional_kwargs?.finishReason
  );
}

function ms(from: bigint, to: bigint) {
  return Number(to - from) / 1e6;
}

export async function decideAndAnswerLite(input: {
  message: string;
  facts_header: string;
  recent_window: string;
  now_iso: string;
  now_human: string;
  tz: string;
}): Promise<DecisionLite> {
  const base = await getLLM();
  const clinic = CLINIC_CONTEXT;

  const clinic_compact = [
    clinic.name,
    clinic.address,
    clinic.hours,
    clinic.phone,
    clinic.website,
  ]
    .filter(Boolean)
    .join(" | ");

  const parser = new JsonOutputParser<Compact>();
  const tuned =
    (base as any).bind?.({
      temperature: 0.25,
      top_p: 0.9,
      maxOutputTokens: 400,
      responseMimeType: "application/json",
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE",
        },
      ],
    }) ?? base;

const prompt = new PromptTemplate({
  inputVariables: [
    "message",
    "facts_header",
    "recent_window",
    "clinic_compact",
    "now_iso",
    "now_human",
    "tz",
  ],
  template: `
Actúa como asistente de una clínica dental. Responde SIEMPRE en español, tono WhatsApp, 1–2 emojis.

REGLAS DE ESTILO (OBLIGATORIAS):
- Saluda de vuelta SOLO si el MSG es un saludo simple.
- Asume que si VENTANA viene vacio debes saludar porque es la primera vez que interactuas con el cliente y debes presentarte
- Si el MSG NO es saludo simple: NO empieces con “hola”, “buenos días/tardes/noches”, “qué tal”, “hey” (ni variantes) y NO te autopresentes; ve directo a responder.
- Mantén 2–3 frases, cálidas y concretas.

COMPORTAMIENTO COMO ASISTENTE:
- Usa solo CLINICA, TIEMPO y FACTS (sin hardcode). Si falta un dato clave, pide la mínima precisión.
- Si el usuario comparte o pide actualizar nombre/email/teléfono, marca ii=true y confirma con cautela.
- Fallback breve si la intención no es clara (pide una aclaración mínima para avanzar).

NOTA SOBRE VENTANA:
- VENTANA contiene hasta N turnos recientes en orden cronológico, con líneas tipo "U:" (usuario) y "A:" (agente).
- Úsala solo para mantener continuidad (nombres, datos ya dados, evitar repetir preguntas).
- No cites toda la VENTANA ni repitas saludos previos; responde al MSG actual.

SALIDA ESTRICTA:
Devuelve SOLO un objeto JSON con estas claves cortas:
- a: string (1..400 chars, 2–3 frases, cálido)
- ii: boolean (¿intenta identificar/actualizar nombre/email/teléfono?)
- c: number (0..1, confianza sobre ii)

CLINICA: {clinic_compact}
TIEMPO: {now_iso} | {now_human} ({tz})
FACTS: {facts_header}
VENTANA: {recent_window}
MSG: {message}

`.trim(),
});


  console.info(
    `[decide][in] msg_len=${(input.message || "").length} facts_len=${
      (input.facts_header || "").length
    } recent_len=${(input.recent_window || "").length}`
  );

  // ========= Render prompt (input al LLM) =========
  const t0 = process.hrtime.bigint();
  const rendered = await prompt.format({
    message: (input.message ?? "").slice(0, 400),
    facts_header: (input.facts_header ?? "").slice(0, 140),
    recent_window: (input.recent_window ?? "").slice(0, 600),
    clinic_compact: clinic_compact.slice(0, 240),
    now_iso: input.now_iso,
    now_human: input.now_human,
    tz: input.tz,
  });

  // después de `const rendered = await prompt.format(...)`:
  const factsLineMatch = rendered.match(/FACTS:\s*([\s\S]*?)\nVENTANA:/);
  const factsRendered = factsLineMatch?.[1] ?? "(facts not found)";
  console.info(
    `[llm.input/FACTS.line]: "${factsRendered
      .slice(0, 160)
      .replace(/\n/g, "\\n")}"`
  );

  const flagMatch = factsRendered.match(/\[GREET_OK=(true|false)\]/i);
  console.info("[llm.input/GREET_OK.detected]:", flagMatch?.[1] ?? "(missing)");

  const tRender = process.hrtime.bigint();

  // Log de entrada al LLM (snippet y longitudes)
  console.info(
    `[llm.input] chars=${rendered.length} preview="${rendered
      .slice(0, 300)
      .replace(/\n/g, "\\n")}${rendered.length > 300 ? "…" : ""}"`
  );

  // ========= Invoke LLM =========
  const tInvokeStart = process.hrtime.bigint();

  // ===== métricas rápidas del input =====
  const vis = (s: string, n = 240) => s.replace(/\s+/g, " ").trim().slice(0, n);
  const countLines = (s: string) => (s ? s.split(/\r?\n/).length : 0);

  // LOGS de cada bloque
  console.info(
    `[llm.input/MSG] len=${(input.message ?? "").length} lines=${countLines(
      input.message
    )} vis="${vis(input.message)}"`
  );
  console.info(
    `[llm.input/FACTS] len=${(input.facts_header ?? "").length} vis="${vis(
      input.facts_header
    )}"`
  );
  console.info(
    `[llm.input/VENTANA] len=${
      (input.recent_window ?? "").length
    } lines=${countLines(input.recent_window)} vis="${vis(
      input.recent_window,
      320
    )}"`
  );

  // el render ya lo estás logueando con chars y preview
  console.info(
    `[llm.input] chars=${rendered.length} preview="${rendered
      .slice(0, 300)
      .replace(/\n/g, "\\n")}${rendered.length > 300 ? "…" : ""}"`
  );

  const llmOut: any = await tuned.invoke(rendered);
  const tInvokeEnd = process.hrtime.bigint();

  // Timings
  console.info(
    `[llm.timing] render_ms=${ms(t0, tRender).toFixed(1)} invoke_ms=${ms(
      tInvokeStart,
      tInvokeEnd
    ).toFixed(1)} total_ms=${ms(t0, tInvokeEnd).toFixed(1)}`
  );

  // Uso de tokens si está disponible
  const usage =
    llmOut?.usage_metadata ?? llmOut?.response_metadata?.tokenUsage ?? {};
  const promptTok =
    usage.promptTokens ?? usage.input_tokens ?? usage.inputTokens;
  const completionTok =
    usage.completionTokens ?? usage.output_tokens ?? usage.completionTokens;
  const totalTok =
    usage.totalTokens ??
    usage.total_tokens ??
    (promptTok ?? 0) + (completionTok ?? 0);
  if (promptTok || completionTok || totalTok) {
    console.info(
      `[llm.usage] prompt=${promptTok ?? "?"} completion=${
        completionTok ?? "?"
      } total=${totalTok ?? "?"}`
    );
  }

  // ========= Output bruto del LLM =========
  const fin = getFinishReason(llmOut);
  const rawText = extractAnyText(llmOut) ?? "";
  console.info(
    `[llm.output] finish=${fin ?? "?"} chars=${
      rawText.length
    } preview="${rawText.slice(0, 300).replace(/\n/g, "\\n")}${
      rawText.length > 300 ? "…" : ""
    }"`
  );

  if ((!rawText || !rawText.trim()) && fin && fin !== "STOP") {
    throw new Error(
      `MODEL_FINISH(${fin}): Sin contenido. Usage=${JSON.stringify(usage)}`
    );
  }

  // ========= Parseo y validación =========
  const tParseStart = process.hrtime.bigint();
  let compact: Compact;
  try {
    compact = await parser.parse(rawText);
  } catch (err: any) {
    const msg = (err?.message || String(err)).slice(0, 500);
    throw new Error(
      `PARSE_ERROR(decideAndAnswerLite): JSON inválido. Detalle: ${msg}. Raw="${rawText.slice(
        0,
        400
      )}"`
    );
  }
  const tParseEnd = process.hrtime.bigint();

  const ok = CompactSchema.safeParse(compact);
  if (!ok.success) {
    const issues = ok.error.issues
      ?.map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `VALIDATION_ERROR(decideAndAnswerLite): Claves/Tipos inválidos. Issues: ${issues}. Raw="${rawText.slice(
        0,
        400
      )}"`
    );
  }
  const tValidateEnd = process.hrtime.bigint();

  console.info(
    `[llm.breakdown] render=${ms(t0, tRender).toFixed(1)}ms invoke=${ms(
      tInvokeStart,
      tInvokeEnd
    ).toFixed(1)}ms parse=${ms(tParseStart, tParseEnd).toFixed(
      1
    )}ms validate=${ms(tParseEnd, tValidateEnd).toFixed(1)}ms total=${ms(
      t0,
      tValidateEnd
    ).toFixed(1)}ms`
  );

  // ========= Mapeo y validación final =========
  const mapped: DecisionLite = {
    final_answer: ok.data.a,
    identify_intent: ok.data.ii,
    confidence: ok.data.c,
  };

  const finOk = DecisionLiteSchema.safeParse(mapped);
  if (!finOk.success) {
    const issues = finOk.error.issues
      ?.map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`VALIDATION_ERROR(decideAndAnswerLite.mapped): ${issues}.`);
  }

  const out = finOk.data;
  console.info(
    `[decide][out] a_len=${out.final_answer.length} ii=${
      out.identify_intent
    } c=${out.confidence.toFixed(2)}`
  );
  return out;
}
