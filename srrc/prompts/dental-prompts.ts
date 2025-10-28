import { PromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { getLLM, CLINIC_CONTEXT } from "../services/llm.services";
import { JsonOutputParser } from "@langchain/core/output_parsers";

export const DecisionLiteSchema = z.object({
  final_answer: z
    .string()
    .min(1, "final_answer vacío")
    .max(400, "final_answer excede 400 chars"),
  identify_intent: z.boolean(), // <- antes: ii ; ahora mapeamos ii -> identify_intent
  confidence: z.number().min(0).max(1),
  wants_appointment: z.boolean(), // <- NUEVO flag de intención de cita
});
export type DecisionLite = z.infer<typeof DecisionLiteSchema>;

// Este es el shape crudo que esperamos del modelo
const CompactSchema = z.object({
  a: z.string().min(1).max(400),
  ii: z.boolean(),
  c: z.number().min(0).max(1),
  wa: z.boolean(), // wants appointment
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
Soná natural / cercano / cero callcenter.

ESTILO:
- Si VENTANA está vacía (conversación nueva / primer mensaje real del usuario):
  - Podés saludar brevemente.
  - Debes presentarte UNA SOLA VEZ como el asistente virtual de la clínica (usa CLINICA).
  - En una frase, explica qué sí podés hacer (ver Capacidades).
- Si MSG es solo un saludo corto ("hola", "buenos días", etc.) Y VENTANA está vacía, aplica lo anterior.
- En cualquier otro caso (ya hubo charla antes):
  - NO inicies con “hola”, “buenos días/tardes/noches”, “qué tal”, “hey”.
  - NO te vuelvas a presentar (“soy el asistente…”).
  - Ve directo al punto.
- Respuesta corta: 1–2 frases, máx 400 chars.

CAPACIDADES (LO QUE SÍ PODÉS HACER HOY):
1. Dar info básica de la clínica usando CLINICA (dirección, horarios, teléfono).
2. Pedir o confirmar datos de contacto DEL USUARIO (su nombre, su teléfono, su email) para poder ayudarlo luego.
3. Aclarar/resumir lo que el usuario acaba de pedir (por ejemplo, si quiere una cita el sábado a las 10 am).
4. Decir que podés “dejarlo anotado como preferencia” cuando el usuario pide una cita u horario, pero SIN prometer que ya quedó confirmada.

LIMITES / COSAS QUE NO HACES DIRECTO:
- No confirmes citas, no digas que están “agendadas”, “reservadas” o “listas”.
- No prometas que la clínica llamará o que “te van a contactar”.
- No inventes procesos internos ni calendario en vivo.
- No confirmes disponibilidad de parqueo / aire / promos si no está en CLINICA.
- Si el usuario pide explícitamente agendar una cita (“quiero sacar cita”, “agendame”, “puedo ir el sábado 10am”, etc.),
  tu tono debe ser:
  “Te puedo tomar los datos y dejar esa hora como preferencia, pero todavía no puedo confirmar la cita por acá 🙏”.
  Eso SÍ cuenta como que el usuario quiere cita.

SI EL USUARIO PIDE CITA O HORARIO:
- Podés pedirle nombre, teléfono y horario preferido.
- Decí claramente que es una preferencia y que aún no se confirma por WhatsApp.
- NO digas que llamarán, ni que quedó confirmada.
- Internamente, esto activa wa=true (wants appointment).

SI EL USUARIO RECHAZA DAR DATOS:
- Lo aceptás sin presión (“todo bien 👍”).
- Ofrecés otra ayuda útil (ej: dirección, horario de atención).

USO DE CONTEXTO:
- CLINICA: quién es la clínica / ubicación / horarios / teléfono.
- FACTS: datos que CREEMOS tener del dueño de este número (nombre, teléfono, email, zona horaria).
- VENTANA: historial reciente ("U:" usuario, "A:" asistente). Puede tener datos que el usuario ACABA de dar (por ej. “mi nombre es Carla”).
- MSG: mensaje actual del usuario.
- TIEMPO: {now_iso} | {now_human} ({tz})

REGLAS DURAS:
- Usa SOLO CLINICA, TIEMPO, FACTS y VENTANA. No inventes nada más.
- Cuando hables de la clínica, usa solo lo que está en CLINICA. No inventes personal ni pasos internos.
- Nunca digas que ya confirmaste una cita, ni que alguien lo va a llamar, ni que la hora ya quedó.
- Podés decir “puedo dejarlo anotado como preferencia” o “te puedo tomar los datos”, pero NO confirmar.
- No menciones herramientas, calendarios ni sistemas.

SALIDA ESTRICTA:
Devuelve SOLO un objeto JSON válido con estas claves, sin texto extra, sin backticks:
- "a"  : string (1..400 chars). Tu respuesta final al usuario (máx 2 frases). Cálido, claro, suena humano.
- "ii" : boolean. true si en este turno el usuario DIO o CAMBIÓ su propio nombre, teléfono o email, o pidió actualizarlos.
- "c"  : number (0..1). Qué tan seguro estás de "ii".
- "wa" : boolean. true si el usuario pidió agendar / reservar / sacar cita / dio un horario preferido para verse en clínica (aunque no se confirme). En todos los demás casos es false.

IDENTIDAD ("ii"):
Activa ii=true SOLO cuando el usuario entrega o corrige SUS datos de contacto personales:
  - Su nombre (“me llamo Oscar”, “soy Carla”).
  - Su teléfono (“mi número es 503-000-111”, “cámbialo, ahora es 7777...”).
  - Su email.
O si pide explícitamente actualizar esos datos.
NO actives ii:
  - Si da un horario preferido (“sábado a las 10 am”).
  - Si describe dolor/síntomas.
  - Si habla de otra persona (“el número de mi esposa es…”).
  - Si solo hace una pregunta normal.
Importante: si en VENTANA (1-2 mensajes atrás) acaban de darnos nombre/teléfono/email, y el MSG actual es solo “sí gracias”, ii sigue siendo true en este turno.
"c" es tu confianza (0 a 1). "ii" debe ser true/false literal, nunca 1/0.

INTENCIÓN DE CITA ("wa"):
Pon wa=true si el usuario está tratando de sacar cita, reservar hora, pedir turno, o te da explícitamente un día/hora para ir (“quiero este sábado 10am”).
También wa=true si tú estás pidiéndole datos de contacto para poder “anotar la hora como preferencia”.
En TODO lo demás, wa=false.

FORMATO DE CONTEXTO:
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

  // Render prompt con ventana más larga (tú arriba decides recorte a ~1200 chars / ~15 msgs)
  const t0 = process.hrtime.bigint();
  const rendered = await prompt.format({
    message: (input.message ?? "").slice(0, 400),
    facts_header: (input.facts_header ?? "").slice(0, 200),
    // ⬇ antes cortábamos a 600. Ahora le damos más contexto (~1200 chars aprox).
    recent_window: (input.recent_window ?? "").slice(0, 1200),
    clinic_compact: clinic_compact.slice(0, 240),
    now_iso: input.now_iso,
    now_human: input.now_human,
    tz: input.tz,
  });

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

  // Logs de entrada al LLM
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

  // Invoke
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

  // Output bruto
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

  // Parseo y validación
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

  // Mapeo final
  const mapped: DecisionLite = {
    final_answer: ok.data.a,
    identify_intent: ok.data.ii,
    confidence: ok.data.c,
    wants_appointment: ok.data.wa,
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
    } c=${out.confidence.toFixed(2)} wa=${out.wants_appointment}`
  );
  return out;
}
