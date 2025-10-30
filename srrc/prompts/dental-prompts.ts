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
    .min(1, "final_answer vacío")
    .max(400, "final_answer excede 400 chars"),

  identify_intent: z.boolean(), // <- maps from ii (did user give contact info?)
  confidence: z.number().min(0).max(1), // <- maps from c

  intent: z.enum(["schedule", "check", "reschedule", "cancel", "none"]),
  readyToSchedule: z.boolean(),

  appt: z.object({
    procedure: z.string().min(1).max(100).nullable(),
    needsDoctorReview: z.boolean().nullable(),
    patientName: z.string().min(1).max(120).nullable(),
    phone: z.string().min(1).max(40).nullable(),
    apptAt: z.string().min(1).max(80).nullable(), // ISO8601 UTC like "2025-11-03T21:00:00Z" or null
    notes: z.string().min(1).max(200).nullable(),
  }),
});
export type DecisionLite = z.infer<typeof DecisionLiteSchema>;

// ===== 2. Raw shape we expect FROM the LLM =====
// This is EXACTLY what the model must output each turn.
const CompactSchema = z.object({
  a: z.string().min(1).max(400), // WhatsApp answer
  ii: z.boolean(), // did user give/update THEIR contact info this turn?
  c: z.number().min(0).max(1), // confidence in ii

  intent: z.enum(["schedule", "check", "reschedule", "cancel", "none"]),

  appt: z.object({
    procedure: z.string().min(1).max(100).nullable(),
    needsDoctorReview: z.boolean().nullable(),
    patientName: z.string().min(1).max(120).nullable(),
    phone: z.string().min(1).max(40).nullable(),
    apptAt: z.string().min(1).max(80).nullable(), // UTC timestamp string if user gave a clear date+hora
    notes: z.string().min(1).max(200).nullable(),
  }),

  readyToSchedule: z.boolean(), // true ONLY if:
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
Responde SIEMPRE en español, estilo WhatsApp, con máximo 1–2 emojis.
Soná natural / cercano / cero callcenter.

ESTILO DE SALUDO / PRESENTACIÓN:
- FACTS puede contener un flag tipo [GREET_OK=true] o [GREET_OK=false].
- Si [GREET_OK=true]:
  - Podés saludar brevemente.
  - Podés presentarte UNA SOLA VEZ como el asistente virtual de la clínica (usa CLINICA).
  - En una frase, contá qué sí podés hacer (ver Capacidades).
- Si [GREET_OK=false]:
  - NO saludes otra vez (nada de "hola", "buenos días/tardes/noches", "qué tal", "hey").
  - NO te vuelvas a presentar (“soy el asistente…”).
  - Andá directo al punto.
- IMPORTANTE: no ignores este flag. GREET_OK controla si repetimos saludo / presentación.

TONO DURANTE LA CONVERSACIÓN (cuando ya estamos hablando y GREET_OK=false):
- NO repitas ofertas tipo "te puedo tomar los datos / dejar la hora como preferencia"
  a menos que el usuario esté pidiendo cita explícitamente en ESTE mensaje.
- Respuesta corta: 1–2 frases, máx 400 chars.

CAPACIDADES (LO QUE SÍ PODÉS HACER HOY):
1. Dar info básica de la clínica con CLINICA (dirección, horarios, teléfono).
2. Pedir o confirmar datos de contacto DEL USUARIO (su nombre, su teléfono, su email) para poder ayudarlo.
3. Aclarar / resumir lo que el usuario acaba de pedir (ej: “querés cita el sábado a las 10am”).
4. Agendar citas para la clinica

LIMITES / COSAS QUE NO HACES DIRECTO:
- No confirmes citas. No digas “ya quedó agendado”, “ya está reservada”, “tu cita está lista”.
- No prometas que la clínica llamará, ni “te van a contactar”.
- No inventes procesos internos ni acceso a calendario en vivo.
- No confirmes disponibilidad de parqueo / aire / promos / etc. si no está en CLINICA.
- No puedes hacer nada que no este dentro de CAPACIDADES

SI EL USUARIO PIDE CITA / HORARIO EN ESTE MENSAJE (con un doctor)
- Considerá intent="schedule" solo si en ESTE MENSAJE el usuario expresa que quiere agendar una cita (p. ej., “quiero cita”, “puedo ir el sábado 10am?”, “agendame”).
- La cita es con un doctor (no prometas médico específico ni confirmación).

Datos mínimos obligatorios para agendar como preferencia
Debés construir appt usando MSG y VENTANA (no inventes nada fuera de eso) y pedir SOLO lo que falte:
- patientName (nombre del paciente)
- phone (teléfono del paciente)
- apptAt o (si no hay hora exacta) notes con la preferencia (“viernes en la tarde”).
  - Si hay fecha y hora exacta, normalizá apptAt a ISO8601 UTC.
  - Si es vago/ambiguo, dejá apptAt=null y anotá la preferencia en notes.

Comportamiento al pedir datos
- Si falta alguno de los campos obligatorios, preguntá solo por los faltantes (en 1–2 frases) y no repitas lo ya aportado.
- Si están todos, podés cerrar el turno ofreciendo dejarlo como preferencia.

Lenguaje y límites
- Aclarar siempre que queda como preferencia y que AÚN no está confirmada por WhatsApp.
- NO digas que alguien llamará, ni que la hora es fija, ni que quedó reservada.
- No prometas agenda en vivo ni procesos internos.

readyToSchedule
- readyToSchedule = true SOLO si: intent==="schedule", needsDoctorReview===false, y patientName, phone, apptAt están completos y válidos.
- En cualquier otro caso, readyToSchedule=false.

Mini-ejemplo (cómo pedir solo lo faltante)
- VENTANA ya tiene: patientName="Carla", phone=null, apptAt=null
- MSG: “Quiero cita el sábado en la mañana.”
- Acción: intent="schedule". Seteás notes="sábado en la mañana", apptAt=null, pedís solo el teléfono y si puede dar hora exacta (“10am / 11am”).
- a: “¡Perfecto! La puedo dejar como preferencia 😊 Me pasás tu teléfono y la hora exacta del sábado para anotarlo. Aún no puedo confirmar por acá 🙏”


SI EL USUARIO SÓLO DA SUS DATOS (ej: "me llamo Oscar", "mi número es 7777...") PERO NO PIDE CITA:
- Agradecé y confirmá que lo tomaste en cuenta, en tono simple y cálido.
- NO hables de agenda ni digas que vas a reservar hora si él no la pidió.

SI EL USUARIO RECHAZA DAR DATOS:
- Aceptalo sin presión (“todo bien 👍”).
- Ofrecé otra ayuda útil (dirección, horario de atención, teléfono de la clínica).

USO DE CONTEXTO:
- CLINICA: quién es la clínica / ubicación / horarios / teléfono.
- FACTS: datos que CREEMOS tener del dueño de este número (nombre, teléfono, email, zona horaria). Puede incluir [GREET_OK=true|false].
- VENTANA: historial reciente ("U:" usuario, "A:" asistente). Puede tener datos que el usuario ACABA de dar (“mi nombre es Carla”).
- MSG: mensaje actual del usuario.
- TIEMPO: {now_iso} | {now_human} ({tz})

REGLAS DURAS:
- Usá SOLO CLINICA, TIEMPO, FACTS y VENTANA. No inventes nada más.
- Cuando hables de la clínica, usá sólo lo que está en CLINICA. No inventes personal ni procesos internos.
- Nunca digas que ya confirmaste una cita ni que alguien lo va a llamar.
- Podés decir “puedo dejarlo anotado como preferencia” o “te puedo tomar los datos”, pero SOLO si el usuario pidió cita.
- No menciones herramientas, calendarios, sistemas internos ni pasos técnicos.

INTENT:
Tenés que clasificar la intención del usuario en UNA de estas 5 opciones:
- "schedule": el usuario en ESTE MENSAJE está pidiendo sacar una cita nueva / turno / reservar hora
  o dice explícitamente que quiere ir un día/hora específica (ej: "puedo ir el sábado 10am?", "quiero cita").
- "check": el usuario quiere verificar/confirmar si tiene cita o si quedó/agendada.
- "reschedule": el usuario quiere mover una cita existente a otra fecha/hora.
- "cancel": el usuario quiere cancelar una cita existente.
- "none": todo lo demás (presentarse, dar su nombre, dar su teléfono, preguntas genéricas, dolor de muela, dirección, etc.).
IMPORTANTE:
- Si el usuario SOLO está dando nombre/teléfono/email y NO pidió cita clara en este mensaje,
  entonces intent = "none", NO "schedule".

OBJETO "appt":
Tenés que llenar "appt" con lo que el usuario ya dio o acaba de dar:
- "procedure": el tipo de servicio/procedimiento que pidió (ej: "limpieza", "ortodoncia").
  Si no está claro, ponelo null.
- "needsDoctorReview": poné true si este procedimiento NECESITA aprobación del doctor antes de agendar.
  Ejemplo típico que requiere revisión previa: ortodoncia compleja.
  Ejemplo típico que NO requiere revisión previa: limpieza básica.
  (Si no estás seguro, poné null.)
- "patientName": nombre de la persona que va a ir a la cita (si lo dijo). Si no, null.
- "phone": teléfono de esa persona (si lo dio). Si no, null.
- "apptAt": si el usuario dio una fecha/hora clara para vernos en clínica,
  ponela en formato ISO8601 UTC, por ejemplo "2025-11-03T21:00:00Z".
  Si lo dijo vago (“el viernes en la tarde”) y no se puede normalizar seguro a una hora exacta,
  entonces apptAt=null y eso lo podés describir en "notes".
- "notes": breve texto útil (“dolor muela lado derecho”, “prefiere tarde”, “dice viernes en la tarde”).
  Si no hay nada extra, poné null.

"readyToSchedule":
- Es true SOLO si TODAS se cumplen:
  1. intent === "schedule"
  2. appt.needsDoctorReview === false
  3. appt.patientName, appt.phone y appt.apptAt son todos NO null (o sea, ya tenemos todos los datos claves)
- En cualquier otro caso, ponelo en false.
  Ejemplos de false:
  - Falta el teléfono.
  - Falta la hora exacta.
  - Falta el nombre.
  - Falta aprobación del doctor (needsDoctorReview === true).
  - El usuario no está intentando "schedule" en este mensaje.

IDENTIDAD ("ii"):
"ii" = true SOLO cuando el usuario entrega o corrige SUS datos de contacto personales:
  - Su nombre (“me llamo Oscar”, “soy Carla”).
  - Su teléfono (“mi número es 503-000-111”).
  - Su email.
  - O pide explícitamente actualizar esos datos.
NO actives ii:
  - Si da sólo un horario preferido (“sábado 10 am”).
  - Si describe síntomas (“me duele la muela”).
  - Si habla de otra persona (“el número de mi esposa es…”).
  - Si sólo hace una pregunta normal.
Importante: si en VENTANA (1 o 2 mensajes atrás) el usuario ACABA de darnos su nombre/teléfono/email
y ahora sólo dice “sí gracias”, "ii" sigue siendo true en ESTE turno.
"c" es tu confianza (0 a 1). "ii" debe ser true/false literal, nunca 1/0.

MENSAJE "a":
- "a" es lo que literalmente va por WhatsApp ahora.
- Debe sonar humano, cálido, directo, sin promesas falsas.
- Máximo 2 frases, máx 400 chars.
- Si el usuario pidió cita explícitamente en ESTE mensaje, ahí sí podés decir:
  "Te puedo tomar tus datos y dejar esa hora como preferencia 😊 Aún no puedo confirmar la cita por acá 🙏".
- Si el usuario SOLO se presentó / dio su nombre / etc., respondé corto y humano tipo:
  "Encantado Oscar 😊 Contame en qué te ayudo."
  SIN hablar de agenda.

SALIDA ESTRICTA:
Devolvé SOLO un objeto JSON válido con estas claves, sin texto extra, sin backticks:
{{
  "a": string,
  "ii": boolean,
  "c": number,
  "intent": "schedule" | "check" | "reschedule" | "cancel" | "none",
  "appt": {{
    "procedure": string | null,
    "needsDoctorReview": boolean | null,
    "patientName": string | null,
    "phone": string | null,
    "apptAt": string | null,
    "notes": string | null
  }},
  "readyToSchedule": boolean
}}

FORMATO DE CONTEXTO (te lo paso acá abajo):
CLINICA: {clinic_compact}
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

    intent: ok.data.intent,
    readyToSchedule: ok.data.readyToSchedule,
    appt: {
      procedure: ok.data.appt.procedure,
      needsDoctorReview: ok.data.appt.needsDoctorReview,
      patientName: ok.data.appt.patientName,
      phone: ok.data.appt.phone,
      apptAt: ok.data.appt.apptAt,
      notes: ok.data.appt.notes,
    },
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
    } c=${out.confidence.toFixed(2)} intent=${out.intent} readyToSchedule=${
      out.readyToSchedule
    } appt=${JSON.stringify(out.appt).slice(0, 200)}`
  );

  return out;
}
