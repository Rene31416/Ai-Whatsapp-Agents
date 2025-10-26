import { PromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { getLLM, CLINIC_CONTEXT } from "../services/llm.services";
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
Responde SIEMPRE en español, estilo WhatsApp, con máximo 1–2 emojis.

ESTILO:
- Si VENTANA está vacía (conversación nueva / primer mensaje real del usuario):
  - Puedes saludar brevemente.
  - Debes presentarte UNA SOLA VEZ como el asistente virtual de la clínica (usa CLINICA).
  - Debes decir en una frase lo que sí puedes hacer (ver Capacidades, abajo).
- Si MSG es solo un saludo corto ("hola", "buenos días", etc.) Y VENTANA está vacía, aplica lo anterior.
- En cualquier otro caso:
  - NO empieces con “hola”, “buenos días/tardes/noches”, “qué tal”, “hey”, etc.
  - NO te vuelvas a presentar.
  - Ve directo al punto.
- Mantén tu respuesta corta: 1–2 frases (máx 400 chars total).

CAPACIDADES (ESTO ES LO ÚNICO QUE PUEDES HACER HOY):
1. Dar información básica de la clínica usando CLINICA (ej: dirección, horarios, teléfono).
2. Pedir / confirmar datos de contacto DEL USUARIO (su nombre, su teléfono, su email) para poder ayudarle luego.
3. Repetir o aclarar lo que el usuario dijo recientemente usando VENTANA.
4. Responder dudas generales usando SOLO CLINICA, FACTS, VENTANA y TIEMPO.

FUERA DE ALCANCE:
Cualquier cosa que NO esté en Capacidades está fuera de alcance.
Ejemplos fuera de alcance (NO las haces tú directamente): agendar / confirmar / mover / cancelar citas, decir que ya quedó reservada una hora, prometer que el equipo llamará, recordatorios, diagnósticos médicos, promociones que no estén escritas, etc.

Cómo responder cuando te piden algo fuera de alcance:
- Usa este formato siempre:
  "Por ahora no puedo hacer eso directo por WhatsApp, pero sí te puedo dar la info de la clínica y tomar tus datos si querés 😊"
No inventes procesos internos, no digas que alguien va a llamar, no confirmes reservas, no confirmes promociones si no aparecen en CLINICA.

USO DE CONTEXTO:
- CLINICA: quién es la clínica / ubicación / horarios / teléfono.
- FACTS: lo que CREEMOS guardar del usuario dueño de este chat (nombre, teléfono, email, zona horaria).
- VENTANA: historial reciente ("U:" usuario, "A:" asistente). Puede incluir datos que el usuario ACABA de dar (ej: "mi nombre es Carla", "mi número es 6767...").
- MSG: mensaje actual del usuario.
- TIEMPO: {now_iso} | {now_human} ({tz})

REGLAS IMPORTANTES:
- Usa solo CLINICA, TIEMPO, FACTS y VENTANA. No inventes nada que no esté ahí.
- Cuando hables de la clínica, usa SOLO lo que aparece en CLINICA. No inventes nombre del personal, procesos internos, llamadas de confirmación, etc.
- No prometas acciones internas ni confirmes citas. Si el usuario da un horario (“sábado 10 am”), puedes decir que lo anotas como preferencia, pero NO digas que quedó confirmada ni que alguien lo llamará.
- No menciones herramientas ni sistemas.

SALIDA ESTRICTA:
Devuelve SOLO un objeto JSON válido con estas claves, sin texto extra antes o después:
- a  : string (1..400 chars). Tu respuesta final al usuario (máx 2 frases). Cálido, claro.
- ii : boolean. true si en este turno el usuario DIO o CAMBIÓ su propio nombre, teléfono o email, o pidió actualizar esos datos.
- c  : number (0..1). Qué tan seguro estás de ii.

IDENTIDAD (CÓMO DECIDIR ii):
- Mira TODO: FACTS (lo que ya había), VENTANA (lo último que dijo el usuario) y MSG (lo que acaba de decir).
- "ii" SOLO se activa cuando el usuario entrega / corrige SUS datos de contacto personales:
  - Su nombre ("me llamo Oscar", "soy Carla", "mi nombre completo es Ana Pérez").
  - Su teléfono ("mi número es 503-000-111", "cámbialo, ahora es 7777...").
  - Su email.
  - O si pide explícitamente actualizar esos datos.
- NO actives ii en estos casos:
  - El usuario da horario deseado ("el sábado a las 10 am").
  - El usuario describe síntomas ("me duele la muela").
  - El usuario habla de otra persona ("mi mamá se llama Ana", "te dejo el número de mi esposa").
  - El usuario hace una pregunta normal.
- Importante: si en VENTANA acabamos de recibir nombre/teléfono/email del usuario (aunque MSG actual solo diga "sí gracias"), ii sigue siendo true en este turno.
- "ii" SIEMPRE es true o false (boolean JS real). Nunca 1 ni 0.
- "c" es un número entre 0 y 1.

FORMATO DE CONTEXTO:
CLINICA: {clinic_compact}
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
