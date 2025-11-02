import { PromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { getLLM, CLINIC_CONTEXT } from "../services/llm.services";
import { JsonOutputParser } from "@langchain/core/output_parsers";

// ===== 1. What we return to the rest of the system =====
// We keep final_answer / identify_intent / confidence for backwards compat
// AND we surface the scheduling metadata so we can branch later.
export const DecisionLiteSchema = z.object({
  final_answer: z
    .string()
    .max(400, "final_answer excede 400 chars"),

  identify_intent: z.boolean(), // <- maps from ii (did user give contact info?)
  confidence: z.number().min(0).max(1), // <- maps from c

  isCalendar: z.boolean()
  // readyToSchedule: z.boolean(),

  // appt: z.object({
  //   procedure: z.string().min(1).max(100).nullable(),
  //   needsDoctorReview: z.boolean().nullable(),
  //   patientName: z.string().min(1).max(120).nullable(),
  //   phone: z.string().min(1).max(40).nullable(),
  //   apptAt: z.string().min(1).max(80).nullable(), // ISO8601 UTC like "2025-11-03T21:00:00Z" or null
  //   notes: z.string().min(1).max(200).nullable(),
  // }),
});
export type DecisionLite = z.infer<typeof DecisionLiteSchema>;

// ===== 2. Raw shape we expect FROM the LLM =====
// This is EXACTLY what the model must output each turn.
const CompactSchema = z.object({
  a: z.string().max(400), // WhatsApp answer
  ii: z.boolean(), // did user give/update THEIR contact info this turn?
  c: z.number().min(0).max(1), // confidence in ii
  isCalendar: z.boolean()

  // appt: z.object({
  //   procedure: z.string().min(1).max(100).nullable(),
  //   needsDoctorReview: z.boolean().nullable(),
  //   patientName: z.string().min(1).max(120).nullable(),
  //   phone: z.string().min(1).max(40).nullable(),
  //   apptAt: z.string().min(1).max(80).nullable(), // UTC timestamp string if user gave a clear date+hora
  //   notes: z.string().min(1).max(200).nullable(),
  // }),

  // readyToSchedule: z.boolean(), // true ONLY if:
  // intent === "schedule",
  // appt.needsDoctorReview === false,
  // appt.patientName, appt.phone, appt.apptAt are all non-null
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

  // model tuning
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

  // =========================================
  // PROMPT TEMPLATE (SYSTEM INSTRUCTIONS)
  // =========================================


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
Responde SIEMPRE en español, estilo WhatsApp, con máximo 1–2 emojis. Soná natural, cero callcenter.

SALUDO / PRESENTACIÓN (controlado por FACTS):
- FACTS puede traer [GREET_OK=true|false].
- Si GREET_OK=true: podés saludar brevemente y presentarte UNA sola vez como asistente de la CLÍNICA.
- Si GREET_OK=false: no saludes ni te presentes otra vez; andá directo al punto.

ROL DE ESTE NODO (Router ligero):
- Aclarar/resumir lo que el usuario pide en MSG.
- Dar info básica de la CLÍNICA **solo si el usuario la pide explícitamente en MSG** (dirección, horarios, teléfono).
- Detectar si el MENSAJE ACTUAL implica interacción con calendario (schedule/check/reschedule/cancel) → isCalendar.
- Detectar si el MENSAJE ACTUAL entrega/corrige datos personales (ii).
- NO recolectar datos (ni de cita ni de identidad) ni confirmar/agendar aquí.

LÍMITES (GUARD RAILS):
- No confirmes citas ni prometas reservas ni “te llamarán”.
- No inventes procesos internos ni acceso a agenda en vivo.
- No pidas nombre/teléfono/hora aquí (si el usuario los DA espontáneamente, marcá ii=true pero NO pidas más).
- **No incluyas dirección/horarios/teléfono si MSG no lo solicitó.**
- Si MSG pide algo que no está en CLÍNICA y no se puede responder sin inventar:
  - Decí brevemente que no tenés ese dato por acá y ofrecé algo útil (teléfono de la clínica) o derivar a agenda si aplica.

MICROCOPY (CALIDEZ SIN SER PEGAJOSO):
- Agradecimientos del usuario (ej. “gracias”, “¡gracias!”):
  - Respuesta breve + oferta suave: “¡Con gusto! 😊 ¿Algo más en que te ayudo?”
- Cuando el usuario **solo** comparte identidad (ii=true) y **no** pide calendario:
  - Agradecé + confirma que lo tomaste + puerta abierta:
    - “¡Gracias, {{nombre}}! Lo tengo anotado 😊 ¿En qué te ayudo?”
    - Si no hay nombre claro: “¡Gracias! Tomo tus datos 😊 ¿En qué te ayudo?”
  - Evitá respuestas cortantes tipo “Dale, {{nombre}}.” sin oferta de ayuda.
- Evitá monosílabos secos (“ok”, “listo”) salvo que el usuario cierre explícitamente.

CRITERIOS DE RUTEO (isCalendar):
- isCalendar=true SOLO si en ESTE mensaje el usuario pide explícitamente:
  - agendar nueva cita / propone día-hora (“puedo ir el sábado 10am?”, “quiero cita”),
  - verificar si tiene/queda una cita,
  - mover una cita existente,
  - cancelar una cita existente.
- Si el usuario (incluso en contexto de agenda) AHORA pregunta info general (dirección/horarios/precios), isCalendar=false.
- Si es ambiguo (“quiero saber de ortodoncia” sin pedir cita), isCalendar=false.

DETECCIÓN DE IDENTIDAD (ii):
- ii=true SOLO si en ESTE turno entrega o corrige SUS datos personales:
  - nombre propio (“me llamo…”, “soy …”), teléfono, email; o pide actualizarlos.
- Si solo da preferencias de horario, síntomas, o datos de otra persona, ii=false.
- Si en VENTANA (1–2 turnos) ya los entregó y AHORA solo confirma (“sí, correcto”), mantené ii=true en este turno.

PRIORIDAD CUANDO COINCIDEN:
- Un mismo mensaje puede activar ambas detecciones (p. ej., “Soy Carla y quiero cita el sábado 10am”):
  - isCalendar=true y ii=true. Este nodo igual NO pedirá datos. La orquestación externa decide el siguiente agente.

VENTANA (orden y alcance):
- VENTANA contiene **los últimos 10 mensajes ANTERIORES al actual**, ordenados **del más viejo al más reciente** (oldest → newest).
- **VENTANA NO incluye MSG.** Usá principalmente MSG y, como apoyo, los turnos más recientes de VENTANA para decidir isCalendar e ii.

MENSAJE "a" (política de salida):
- Si isCalendar=true: poné "a" como **cadena vacía** (""), porque la respuesta al usuario la proveerá el agente de calendario.
- Si isCalendar=false: "a" debe ser la respuesta breve (máx 2 frases / 400 caracteres), respetando GREET_OK y usando CLÍNICA **solo si MSG lo pidió**.
- Recordá aplicar las reglas de **MICROCOPY** para respuestas de “gracias” e identidad.

SALIDA ESTRICTA (solo UN objeto JSON válido, sin texto extra ni backticks):
{{ 
  "a": string,                 // si isCalendar=true, usar ""
  "c": number,                 // confianza 0..1
  "isCalendar": boolean,       // ¿este turno requiere flujo de calendario?
  "ii": boolean                // ¿este turno trae/actualiza datos personales?
}}

CONTEXTO DISPONIBLE:
CLÍNICA: {clinic_compact}
FACTS: {facts_header}
VENTANA: {recent_window}
MSG: {message}
TIEMPO: {now_iso} | {now_human} ({tz})
`.trim(),
});



  console.info(
    `[decide][in] msg_len=${(input.message || "").length} facts_len=${
      (input.facts_header || "").length
    } recent_len=${(input.recent_window || "").length}`
  );

  // Expandimos la "ventana" para que el modelo recuerde la cita en curso.
  // (antes ~600 chars, ahora ~1200 aprox, p/ ~15 msgs recientes)
  const t0 = process.hrtime.bigint();
  const rendered = await prompt.format({
    message: (input.message ?? "").slice(0, 400),
    facts_header: (input.facts_header ?? "").slice(0, 200),
    recent_window: (input.recent_window ?? "").slice(0, 1200),
    clinic_compact: clinic_compact.slice(0, 240),
    now_iso: input.now_iso,
    now_human: input.now_human,
    tz: input.tz,
  });

  // debug: FACTS line
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

  // Logs de entrada
  const vis = (s: string, n = 240) => s.replace(/\s+/g, " ").trim().slice(0, n);
  const countLines = (s: string) => (s ? s.split(/\r?\n/).length : 0);

  console.info(
    `[llm.input] chars=${rendered.length} preview="${rendered
      .slice(0, 300)
      .replace(/\n/g, "\\n")}${rendered.length > 300 ? "…" : ""}"`
  );
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
  console.log('//////////////////////// VENATABA ////////////////')
    console.info(
    `[llm.input/VENTANA] ${input.recent_window}`
    )

  // Invoke LLM
  const tInvokeStart = process.hrtime.bigint();
  const llmOut: any = await tuned.invoke(rendered);
  const tInvokeEnd = process.hrtime.bigint();

  // Timings / usage
  console.info(
    `[llm.timing] render_ms=${ms(t0, tRender).toFixed(1)} invoke_ms=${ms(
      tInvokeStart,
      tInvokeEnd
    ).toFixed(1)} total_ms=${ms(t0, tInvokeEnd).toFixed(1)}`
  );
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

  // Raw output
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

  // Parse + validate
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

  // Map to DecisionLite
  const mapped: DecisionLite = {
    final_answer: ok.data.a,
    identify_intent: ok.data.ii,
    confidence: ok.data.c,
    isCalendar: ok.data.isCalendar
    // readyToSchedule: ok.data.readyToSchedule,
    // appt: {
    //   procedure: ok.data.appt.procedure,
    //   needsDoctorReview: ok.data.appt.needsDoctorReview,
    //   patientName: ok.data.appt.patientName,
    //   phone: ok.data.appt.phone,
    //   apptAt: ok.data.appt.apptAt,
    //   notes: ok.data.appt.notes,
    // },
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
    } c=${out.confidence.toFixed(2)} isCalendar=${out.isCalendar}`
  );

  return out;
}
