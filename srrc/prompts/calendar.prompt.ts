// srrc/calendar/calendar.prompt.service.ts
import { injectable } from "inversify";
import { PromptTemplate } from "@langchain/core/prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";
import { getLLM } from "../services/llm.services";

/**
 * Mantiene el mismo “shape” conceptual que decideAndAnswerLite:
 * - función pública: calendarAndAnswerLite(input) -> { a, c }
 * - usa getLLM (mismo factory), respeta “tone”, validaciones y logs.
 */

export type CalendarLiteInput = {
  message: string;        // mensaje actual del usuario
  recent_window: string;  // últimos 10 mensajes (oldest → newest)
  now_iso: string;        // ISO timestamp
  tz: string;             // IANA TZ (ej. "America/El_Salvador")
  // campos opcionales para logging/telemetría si querés forwardear:
  tenantId?: string;
  userId?: string;
};

export type CalendarLiteOutput = {
  a: string; // respuesta breve para WhatsApp
  c: number; // confianza 0..1
};

const CalendarLiteSchema = z.object({
  a: z.string().default(""),
  c: z.number().min(0).max(1).default(0.7),
});

const parser = new JsonOutputParser<CalendarLiteOutput>();

// -------------------- helpers (idéntico patrón robusto) --------------------
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
    const t = parts.map((p: any) => p?.text || "").filter(Boolean).join("\n");
    if (t.trim()) return t;
  }
  try {
    return JSON.stringify(msg);
  } catch {
    return String(msg ?? "");
  }
}
function ms(from: bigint, to: bigint) {
  return Number(to - from) / 1e6;
}

// -------------------- Prompt (sin fences, JSON estricto) --------------------
const template = `
Eres un agente de CALENDARIO. Respondé en español, estilo WhatsApp, breve y natural (máx 2 frases, 1–2 emojis).
No menciones herramientas ni procesos internos.

OBJETIVO:
- Guiar al usuario para agendar/gestionar citas y RECOLECTAR los datos mínimos cuando falten.
- Usá EXCLUSIVAMENTE VENTANA y el MSG ACTUAL para detectar si ya dio datos (no repitas).
- Por ahora NO confirmes disponibilidad real ni prometas cupos; orientá y reuní datos.

REQUISITOS MÍNIMOS PARA AGENDAR (por ahora):
- Nombre completo
- Número de contacto
- Correo electrónico
- Doctor preferido: "Gerardo" o "Amada" (¡ojo: es Amada, no Amanda!)

POLÍTICA DE RECOLECCIÓN:
- Si el usuario pregunta “¿qué se necesita?”, respondé con la lista anterior y ofrecé continuar.
- Si faltan datos, pedí SOLO uno por vez, amable y concreto (ej.: “¿Cuál sería tu número de contacto?”).
- Usá VENTANA para evitar pedir algo que ya dio.
- Si pide verificar/mover/cancelar, explicá brevemente que aún no está disponible aquí y ofrecé continuar con la recolección de datos.

CUANDO YA ESTÁN TODOS LOS DATOS (a partir de VENTANA + MSG):
- Confirmá los datos en una sola respuesta breve (nombre, contacto, correo y doctor elegido).
- Y por ahora (mientras no hay herramienta), **decí que la cita fue agendada** de forma simple.
- Ejemplo (máx 2 frases): “Perfecto: Oscar, +503 7777-7777, oscar@mail.com, con la Dra. Amada. ¡Listo, tu cita queda agendada! 😊”

TONO / MICROCOPY:
- Breve, claro, útil. 1–2 frases, 1–2 emojis máximo.
- Agradecé cuando aporte datos (“¡Gracias! 😊 Lo anoto.”) y pedí el siguiente dato que falte.
- Para elegir doctor, ofrecé explícitamente: “Gerardo” o “Amada”.

Salida estricta (UN JSON válido, sin texto extra):
{{
  "a": string,  // respuesta breve (pregunta por un dato faltante o confirmación final con “cita agendada”)
  "c": number   // confianza 0..1
}}

VENTANA:
{recent_window}

MSG (actual):
{message}

TIEMPO:
{now_iso} ({tz})
`.trim();


@injectable()
export class CalendarPromptService {
  // Precompilado para performance; mismo patrón que dental (render + invoke)
  private readonly prompt = new PromptTemplate({
    inputVariables: ["message", "recent_window", "now_iso", "tz"],
    template,
  });

  /**
   * Estructura espejo de decideAndAnswerLite: recibe input compacto,
   * loggea entrada/salida y normaliza con zod + JsonOutputParser.
   */
  async calendarAndAnswerLite(input: CalendarLiteInput): Promise<CalendarLiteOutput> {
    const { message, recent_window, now_iso, tz, tenantId, userId } = input;

    // LOG: entrada
    console.log(
      "[calendar.decide][in]",
      JSON.stringify({
        tenantId,
        userId,
        msg_len: (message || "").length,
        win_len: (recent_window || "").length,
        tz,
      })
    );

    // LLM factory (await para evitar pipe de Promises) + tuning (JSON mime)
    const base = await getLLM();
    const tuned =
      (base as any).bind?.({
        temperature: 0.25,
        top_p: 0.9,
        maxOutputTokens: 300,
        responseMimeType: "application/json",
      }) ?? base;

    // Render explícito (mismo patrón que Dental)
    const t0 = process.hrtime.bigint();
    const rendered = await this.prompt.format({
      message: message ?? "",
      recent_window: recent_window ?? "",
      now_iso: now_iso ?? new Date().toISOString(),
      tz: tz ?? "America/El_Salvador",
    });
    const tRender = process.hrtime.bigint();

    // Invoke directo con el string renderizado
    const tInvokeStart = process.hrtime.bigint();
    const llmOut: any = await tuned.invoke(rendered);
    const tInvokeEnd = process.hrtime.bigint();

    // Timings
    console.log(
      "[llm.timing]",
      JSON.stringify({
        render_ms: ms(t0, tRender).toFixed(1),
        invoke_ms: ms(tInvokeStart, tInvokeEnd).toFixed(1),
        total_ms: ms(t0, tInvokeEnd).toFixed(1),
      })
    );

    // Extraer texto, limpiar fences si el proveedor los agrega
    const raw0 = extractAnyText(llmOut) ?? "";
    const raw = stripJsonFences(raw0);
    console.log("[llm.output] preview", raw.slice(0, 200));

    // Parse + validación (con rescate si viene ruido)
    let out: CalendarLiteOutput;
    try {
      const parsed = await parser.parse(raw);
      const safe = CalendarLiteSchema.safeParse(parsed);
      out = safe.success
        ? safe.data
        : {
            a: (parsed as any)?.a || "",
            c: typeof (parsed as any)?.c === "number" ? (parsed as any).c : 0.7,
          };
    } catch (err: any) {
      const rescued = rescueJsonSlice(raw0);
      if (rescued) {
        try {
          const parsed = await parser.parse(rescued);
          const safe = CalendarLiteSchema.parse(parsed);
          console.log("[calendar.decide][rescued]", {
            a_len: safe.a.length,
            c: safe.c,
          });
          out = safe;
        } catch {
          out = { a: "Listo. ¿Te ayudo con algo más? 🙂", c: 0.5 };
        }
      } else {
        out = { a: "Listo. ¿Te ayudo con algo más? 🙂", c: 0.5 };
      }
    }

    // LOG: salida
    console.log(
      "[calendar.decide][out]",
      JSON.stringify({
        a_len: (out.a || "").length,
        c: out.c,
      })
    );

    return out;
  }
}
