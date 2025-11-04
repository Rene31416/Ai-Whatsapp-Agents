import { PromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { getLLM, CLINIC_CONTEXT } from "../services/llm.services";
import { JsonOutputParser } from "@langchain/core/output_parsers";

// ===== 1. What we return to the rest of the system =====
// We keep final_answer / identify_intent / confidence for backwards compat
// AND we surface the scheduling metadata so we can branch later.
export const DecisionLiteSchema = z.object({
  final_answer: z.string().max(400, "final_answer excede 400 chars"),

  identify_intent: z.boolean(), // <- maps from ii (did user give contact info?)
  confidence: z.number().min(0).max(1), // <- maps from c

  isCalendar: z.boolean(),
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
  isCalendar: z.boolean(),

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

function stripJsonFences(s: string): string {
  const fenced = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  return s.trim();
}

function rescueJsonSlice(s: string): string | null {
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) return s.slice(first, last + 1);
  return null;
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

  // ---------- MAIN (ROUTER) PROMPT ----------
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

⚠️ INSTRUCCIÓN CRÍTICA:
- Tu respuesta DEBE ser un único objeto JSON con las claves indicadas más abajo. Si agregás texto fuera del JSON, la respuesta se descarta.

SALUDO / PRESENTACIÓN:
- GREET_OK=true indica que esta es la primera interacción real (o pasaron >8h).
- GREET_OK=false significa que ya te presentaste antes; no repitas saludo aunque VENTANA muestre saludos previos.
- Solo saluda y preséntate si GREET_OK=true Y el MENSAJE ACTUAL contiene un saludo (“hola”, “buenos días”, “qué tal”, etc.).
- Si GREET_OK=false, tu respuesta NO debe contener frases como “Hola”, “Buenas”, “Soy el asistente…”, ni ninguna presentación nueva; empieza directo con el contenido útil.
- Respuestas que violen lo anterior (ej. “¡Hola! Soy…”) se consideran INCORRECTAS.
- Ejemplo GREET_OK=true: usa un saludo breve y natural variando el fraseo (p.ej. “¡Hola! Soy el asistente de Opal Dental 😊 ¿Cómo te ayudo hoy?”, “¡Buenas! Te escribe el asistente virtual de Opal Dental 😊 ¿En qué te apoyo?”, “Hey, soy tu asistente en Opal Dental 😊 ¿Cómo puedo ayudarte?”).
- Ejemplo GREET_OK=false (consulta directa): Usuario: “Quiero saber la ubicación exacta de la clínica por favor” → Respuesta: “Estamos en 123 Main St, San Salvador. ¿Necesitás algo más?”
  - Ejemplo INCORRECTO con GREET_OK=false: Usuario: “Otra cosa, ¿sabés agendar citas?” → 🚫 “¡Hola! Soy el asistente…” (no lo repitas).
  - Ejemplo CORRECTO con GREET_OK=false: Usuario: “Otra cosa, ¿sabés agendar citas?” → “Claro, te ayudo a coordinar tu cita. Déjame verificar qué necesitás.”

COMPORTAMIENTO GENERAL:
- Si el primer mensaje trae saludo + intención, priorizá la intención. Si es agenda, ruteá (ver abajo) y no respondas localmente.
- Si el usuario se está despidiendo (p. ej., “gracias, eso sería todo”, “no por ahora”, “adiós”, “hasta luego”), cerrá amable SIN “¿algo más?”.
- Despedidas: confirma que no falta nada y usa una sola frase amable sin ofrecer ayuda adicional. Variá el fraseo (ej.: “Todo listo, cualquier cosa me avisás 😊”, “Perfecto, quedo atento 😊”) para evitar respuestas calcadas consecutivas.
- “Gracias” aislado NO es despedida: podés ofrecer ayuda suave.

ROL DE ESTE NODO (Customer Service – información general):
- Aclarar/resumir lo que el usuario pide en MSG.
- Responder SOLO información general de la CLÍNICA si el MSG lo pide explícitamente (dirección, horarios, teléfono).
- Detectar si el MENSAJE ACTUAL trae/actualiza datos personales del usuario (ii).
- Este nodo NO maneja reglas de agenda ni recolecta datos para citas.

RUTEO A AGENDA (criterio por contexto):
- Seteá "isCalendar": true y dejá "a": "" (cadena vacía) cuando ocurra CUALQUIERA de estas condiciones:
  1) El MSG sugiere/insinúa acciones de citas (agendar, reagendar, cancelar, confirmar, consultar disponibilidad).
  2) El MSG APORTA o CORRIGE alguno de los datos mínimos de cita: nombre completo, número de contacto, correo electrónico o doctor preferido.
  3) Considerando VENTANA + MSG, se continúa claramente un flujo de agenda (p. ej., el turno previo pidió esos datos).
- Ejemplo de ruteo obligatorio: Usuario: “Otra cosa, ¿sabés agendar citas?” → isCalendar=true y a="".


LÍMITES (generales, sin lógica de agenda):
- No inventes procesos internos ni acceso a sistemas.
- No des información que no figure en CLÍNICA.
- No pidas datos personales salvo que el usuario los ofrezca espontáneamente (si los da, marcá ii=true).

MICROCOPY (tono breve y útil):
- Agradecimientos del usuario: respuesta corta + oferta suave (“¡Con gusto! 😊 ¿Algo más en que te ayudo?”).
- Si el usuario solo comparte identidad (ii=true) sin pedir agenda: agradecé y dejá puerta abierta (“¡Gracias! Lo tengo anotado 😊 ¿En qué te ayudo?”).
- Evitá monosílabos secos (“ok”, “listo”) salvo cierre explícito.

PRIORIDAD ENTRE MARCAS:
- Si en el mismo turno detectás ii=true (datos personales) y también se cumple ruteo de agenda, entonces:
  - isCalendar=true
  - a=""
  - (ii puede quedar en true o false; la orquestación prioriza el ruteo)

VENTANA (orden y alcance):
- VENTANA contiene los últimos 10 mensajes ANTERIORES al MSG, del más viejo al más reciente (oldest → newest).
- VENTANA NO incluye MSG. Usá principalmente MSG, y VENTANA solo como apoyo.

MENSAJE "a" (política de salida):
- Si "isCalendar" = true → "a" debe ser "" (vacío), porque la respuesta la dará el agente de calendario.
- Si "isCalendar" = false → "a" debe ser una respuesta breve (máx 2 frases / 400 caracteres), respetando GREET_OK y usando CLÍNICA solo si el MSG lo pidió.

SALIDA ESTRICTA (solo UN JSON válido, sin texto extra ni backticks):
- Devuelve EXACTAMENTE un objeto JSON con estas claves (sustituí los valores según corresponda):
  {{"a":"...","c":0.7,"isCalendar":false,"ii":false}}
- No incluyas texto fuera del JSON ni múltiples objetos.

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
  console.log("//////////////////////// VENATABA ////////////////");
  console.info(`[llm.input/VENTANA] ${input.recent_window}`);

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
  const cleanedText = stripJsonFences(rawText);
  console.info(
    `[llm.output] finish=${fin ?? "?"} chars=${
      cleanedText.length
    } preview="${cleanedText.slice(0, 300).replace(/\n/g, "\\n")}${
      cleanedText.length > 300 ? "…" : ""
    }"`
  );

  if ((!cleanedText || !cleanedText.trim()) && fin && fin !== "STOP") {
    throw new Error(
      `MODEL_FINISH(${fin}): Sin contenido. Usage=${JSON.stringify(usage)}`
    );
  }

  // Parse + validate
  const tParseStart = process.hrtime.bigint();
  let compact: Compact;
  try {
    compact = await parser.parse(cleanedText);
  } catch (err: any) {
    const rescued = rescueJsonSlice(cleanedText);
    if (rescued) {
      try {
        compact = await parser.parse(rescued);
        console.warn("[decide][rescue] Gemini devolvió texto + JSON; se extrajo el objeto válido.");
      } catch (rescErr: any) {
        const msg = (rescErr?.message || String(rescErr)).slice(0, 500);
        throw new Error(
          `PARSE_ERROR(decideAndAnswerLite): JSON inválido tras rescue. Detalle: ${msg}. Raw="${cleanedText.slice(
            0,
            400
          )}"`
        );
      }
    } else {
      const fallbackText = cleanedText.trim();
      if (fallbackText) {
        console.warn(
          "[decide][fallback.trigger] Gemini no devolvió JSON puro; se pedirá aclaración al usuario."
        );
        compact = {
          a: "Disculpá, no entendí bien. ¿Podés repetir o clarificar tu mensaje? 😊",
          c: 0.5,
          isCalendar: false,
          ii: false,
        };
      } else {
        const msg = (err?.message || String(err)).slice(0, 500);
        throw new Error(
          `PARSE_ERROR(decideAndAnswerLite): JSON inválido. Detalle: ${msg}. Raw="${cleanedText.slice(
            0,
            400
          )}"`
        );
      }
    }
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
    isCalendar: ok.data.isCalendar,
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
