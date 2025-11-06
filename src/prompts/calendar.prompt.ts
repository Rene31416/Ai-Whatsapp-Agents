// srrc/calendar/calendar.prompt.service.ts
import { inject, injectable } from "inversify";
import { PromptTemplate } from "@langchain/core/prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { DynamicStructuredTool } from "langchain/tools";
import { z } from "zod";
import { getLLM } from "../services/llm.services";
import { CalendarService, CalendarEventConflictError } from "../services/calendar.service";
import { createCalendarTools } from "./calendar.tools";

/**
 * Mantiene el mismo “shape” conceptual que decideAndAnswerLite:
 * - función pública: calendarAndAnswerLite(input) -> { a, c }
 * - usa getLLM (mismo factory), respeta “tone”, validaciones y logs.
 */

export type CalendarLiteInput = {
  message: string; // mensaje actual del usuario
  recent_window: string; // últimos 10 mensajes (oldest → newest)
  now_iso: string; // ISO timestamp
  tz: string; // IANA TZ (ej. "America/El_Salvador")
  // campos opcionales para logging/telemetría si querés forwardear:
  tenantId?: string;
  userId?: string;
};

export type CalendarLiteOutput = {
  a: string; // respuesta breve para WhatsApp
  c: number; // confianza 0..1
  tool?: string;
  args?: Record<string, unknown>;
};

const CalendarLiteSchema = z.object({
  a: z.string().default(""),
  c: z.number().min(0).max(1).default(0.7),
  tool: z.string().optional(),
  args: z.record(z.string(), z.any()).optional(),
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
function ms(from: bigint, to: bigint) {
  return Number(to - from) / 1e6;
}

// -------------------- Prompt (sin fences, JSON estricto) --------------------
// ---------- CALENDAR PROMPT ----------
const template = `
Eres un agente de CALENDARIO. Respondé en español, estilo WhatsApp, breve y natural (máx 2 frases, 2–3 emojis).
No menciones herramientas ni procesos internos.

ESTILO / SALUDOS (como el asistente principal):
- Saluda solo si VENTANA está vacía o el MSG actual es un saludo simple; si no, ve directo al punto.
- No te autopresentes salvo en el primer turno; evitá iniciar con “hola/buenos días/tardes/noches” si ya estás en conversación.
- Variá los saludos breves (ej.: “¡Hola!”, “¡Buenas!”, “¡Qué gusto leerte!”) y no repitas exactamente el mismo si el agente ya lo usó en la VENTANA.
- Mantené 1–2 frases cálidas y concretas, con 2–3 emojis máximo en toda la respuesta.
- Recordá mencionar, cuando corresponda, que los horarios disponibles son de 09:00 a 17:00.

OBJETIVO:
- Guiar al usuario para agendar/gestionar citas y RECOLECTAR los datos mínimos cuando falten.
- Usá EXCLUSIVAMENTE VENTANA y el MSG ACTUAL para detectar si ya dio datos (no repitas).
- Todas las citas duran 30 minutos exactos y deben ocurrir entre 09:00 y 17:00 hora de la clínica.

REQUISITOS MÍNIMOS PARA AGENDAR (por ahora):
- Nombre completo
- Número de contacto
- Correo electrónico
- Doctor preferido: "Gerardo" o "Amada" (¡ojo: es Amada, no Amanda!)
- Fecha y hora preferidas (dentro del horario 09:00–17:00 de la clínica)

ORDEN DEL FLUJO (obligatorio):
1. Apenas detectes que quiere agendar, preguntá primero por doctor (Gerardo/Amada) y fecha/hora preferidas. Explicá que es para revisar disponibilidad.
2. Con esos datos, corré la tool de disponibilidad. Si está libre, avisá “La doctora X está disponible el <fecha> a las <hora>” y en ese mismo mensaje pedí los datos personales faltantes (nombre, teléfono, correo). **NO pidas confirmación todavía; primero recolectá los datos completos.**
3. Una vez tengas todo, resumí paciente + contacto + correo + doctor + fecha/hora y ahí sí pedí el “sí, confirmo”.
4. Con la confirmación, ejecutá la tool de creación (con duración fija 30 min). Si falla por conflicto, contalo y pedí otra hora.

POLÍTICA DE RECOLECCIÓN:
- Si el usuario pregunta “¿qué se necesita?”, respondé con la lista anterior, aclarando que primero confirmaremos doctor/horario para buscar huecos.
- Si faltan varios datos personales tras la disponibilidad, pedilos en UN solo mensaje, enumerando cada campo (“Necesito: 1) Nombre completo, 2) Número de contacto, 3) Correo electrónico”) y manteniendo 2–3 emojis en total. No vuelvas a pedir doctor/horario salvo que cambie.
- Si solo falta un dato, pedilo con una frase breve y amable (ej.: “¿Cuál sería tu número de contacto? 😊”).
- Si el usuario usa referencias relativas (“próximo miércoles”, “mañana a las 3”), convertí la fecha/hora usando {now_iso} y {tz} y respondé con un horario explícito en formato 24h.
- Si la hora sugerida queda fuera de 09:00–17:00, pedí ajustar la cita a un horario dentro de ese rango.
- Indicá que vas a revisar la disponibilidad con el doctor elegido al momento de confirmar.
- Usá VENTANA para evitar pedir algo que ya dio.
- Si pide verificar/mover/cancelar, explicá brevemente que aún no está disponible aquí y ofrecé continuar con la recolección de datos.

CUANDO YA ESTÁN TODOS LOS DATOS (a partir de VENTANA + MSG):
- Asegurate de tener los cinco campos (nombre, número, correo, doctor, fecha/hora dentro de 09:00–17:00). Si falta algo, pedilo.
- Cuando ya tengas todo, responde con una frase que resuma explícitamente paciente, número, correo, doctor y fecha/hora solicitada para que el usuario valide antes de avanzar. **Toda confirmación debe listar esos datos completos; nunca confirmes solo con “ok” o “entendido” sin detallar.**
- Primero ejecutá la tool "calendar_check_availability" pasando startIso y endIso (30 minutos) para validar el horario. Si la respuesta indica que NO está libre, comunicalo y pedí otro horario antes de seguir.
- Si el horario está disponible, decíle al usuario que hay cupo, vuelve a enumerar doctor + fecha/hora y pedile los datos que falten (nombre/teléfono/correo). Cuando ya los tengas, enumerá paciente/número/correo/doctor/fecha-hora y pedí la confirmación final explícita (ej.: “La doctora Amada está libre el sábado 8 nov 13:00 para Oscar (73145544, hola@…). ¿Confirmás que agendemos?”).
- Cuando el usuario confirme (por ejemplo “sí”, “dale”, “agendalo”), ejecutá inmediatamente la tool "calendar_create_appointment" (30 minutos). NO repitas "calendar_check_availability" a menos que el usuario cambie fecha u hora; usá los mismos datos que acabás de validar en la conversación.
- Después de usar la tool, respondé indicando que la cita quedó agendada mencionando nuevamente paciente, número, correo, doctor y horario específicos (misma regla: cada confirmación debe incluir todos los campos). NO digas que agendaste si la tool falló.
- Si la tool devuelve un error, explicalo y pedí ajustar la hora.

TONO / MICROCOPY:
- Breve, claro, útil. 1–2 frases, 2–3 emojis máximo.
- Agradecé cuando aporte datos (“¡Gracias! 😊 Lo anoto.”) y pedí el siguiente dato que falte. Evitá repetir la misma frase literal si el turno anterior del agente ya la dijo; variá con un cierre breve distinto.
- Para elegir doctor, ofrecé explícitamente: “Gerardo” o “Amada”.

Salida estricta (UN JSON válido, sin texto extra):
{{ 
  "a": string,  // respuesta breve (pregunta por un dato faltante o confirmación final con “cita agendada”)
  "c": number,  // confianza 0..1
  "tool"?: "calendar_create_appointment",
  "args"?: object // argumentos para la tool (ej. summary, startIso, endIso, attendees, tenantId…). Para create debes incluir siempre "doctor".
}}

Si devolvés "tool", asegurate de incluir todos los campos necesarios en "args" (el sistema agregará tenantId automáticamente). Ejemplos:
- tool="calendar_check_availability", args con startIso="2025-11-07T14:00:00-06:00" y endIso="2025-11-07T14:30:00-06:00".
- tool="calendar_create_appointment", args con summary="Consulta con Gerardo", startIso="2025-11-07T14:00:00-06:00", endIso="2025-11-07T14:30:00-06:00" y una lista de attendees (correo y nombre del paciente).

EJEMPLO (nunca lo devuelvas literal, es solo guía):
- Usuario: “Quiero cita mañana 2pm con Gerardo”
- Agente: confirma doctor/horario y aclara que revisará disponibilidad.
- Agente: usa calendar_check_availability → responde “Gerardo está libre mañana 14:00 para Ana (5551234, ana@...). Necesito tu confirmación para agendar, ¿sí?”
- Usuario: “Sí, dale”
- Agente: usa calendar_create_appointment con el mismo horario ya verificado → responde “Listo, quedó agendada con Gerardo mañana a las 14:00 para Ana (5551234, ana@...). 📅✅”

VENTANA:
{recent_window}

MSG (actual):
{message}

TIEMPO:
{now_iso} ({tz})
`.trim();



@injectable()
export class CalendarPromptService {
  private readonly prompt = new PromptTemplate({
    inputVariables: ["message", "recent_window", "now_iso", "tz"],
    template,
  });
  private readonly createAppointmentTool: DynamicStructuredTool<any, any>;
  private readonly checkAvailabilityTool: DynamicStructuredTool<any, any>;

  constructor(@inject(CalendarService) private readonly calendarService: CalendarService) {
    const tools = createCalendarTools(calendarService);
    const createTool = tools.find((tool) => tool.name === "calendar_create_appointment");
    const checkTool = tools.find((tool) => tool.name === "calendar_check_availability");
    if (!createTool || !checkTool) {
      throw new Error("Calendar tools not initialized");
    }
    this.createAppointmentTool = createTool;
    this.checkAvailabilityTool = checkTool;
  }

  async calendarAndAnswerLite(
    input: CalendarLiteInput
  ): Promise<CalendarLiteOutput> {
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

    console.log("//////////////////////// CALENDAR WINDOW ////////////////");
    console.info(`[calendar.input/MSG] ${message ?? ""}`);
    console.info(`[calendar.input/VENTANA] ${recent_window ?? ""}`);

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
          console.warn("[calendar.fallback.trigger] Gemini no devolvió JSON puro; se pide repetición.");
          out = {
            a: "Perdón, no entendí lo último. ¿Podés repetirlo, por favor? 😊",
            c: 0.5,
          };
        }
      } else {
        console.warn("[calendar.fallback.trigger] Gemini no devolvió JSON puro; se pide repetición.");
        out = {
          a: "Disculpá, no alcancé a entender. ¿Lo podrías repetir, por favor? 😊",
          c: 0.5,
        };
      }
    }

    let toolMessage: string | null = null;
    let toolError: Error | null = null;
    if (out.tool) {
      const args = { ...(out.args ?? {}) };
      if (tenantId) {
        args.tenantId = tenantId;
      }
      if (!args.tenantId) {
        console.warn("[calendar.tool.skip] missing tenantId for tool call", {
          requestedTool: out.tool,
        });
      } else {
        try {
          if (out.tool === "calendar_check_availability") {
            if (!args.endIso && args.startIso) {
              args.endIso = this.addMinutes(args.startIso as string, 30);
            }
            const result = await this.checkAvailabilityTool.call(args);
            toolMessage = typeof result === "string" ? result : JSON.stringify(result);
          } else if (out.tool === "calendar_create_appointment") {
            if (!args.endIso && args.startIso) {
              args.endIso = this.addMinutes(args.startIso as string, 30);
            }
            const result = await this.createAppointmentTool.call(args);
            toolMessage = typeof result === "string" ? result : JSON.stringify(result);
          } else {
            console.warn("[calendar.tool.skip] unsupported tool", { tool: out.tool });
          }
          console.log("[calendar.tool.success]", {
            tool: out.tool,
            tenantId: args.tenantId,
          });
        } catch (toolErr) {
          console.error("[calendar.tool.error]", toolErr);
          toolError = toolErr as Error;
        }
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

    if (toolError) {
      if (toolError instanceof CalendarEventConflictError) {
        out.a =
          "Ups, mientras confirmábamos alguien ocupó ese espacio. Elegí otra hora dentro de 09:00–17:00 y lo intento de nuevo. ⏳";
        out.tool = undefined;
        out.args = undefined;
      } else {
        out.a =
          "No pude crear la cita por un error del calendario. Probemos con otro horario o intentá más tarde, ¿te parece?";
        out.tool = undefined;
        out.args = undefined;
      }
    } else if (toolMessage) {
      if (out.tool === "calendar_check_availability") {
        const msg = this.buildAvailabilityMessage(toolMessage);
        if (msg && !out.a) {
          out.a = msg;
        }
      } else if (out.tool === "calendar_create_appointment" && !out.a) {
        out.a = "Listo, agendé tu cita y quedó registrada ✅";
      }
    }

    return out;
  }

  private addMinutes(startIso: string, minutes: number): string {
    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) {
      return startIso;
    }
    const end = new Date(start.getTime() + minutes * 60 * 1000);
    return end.toISOString();
  }

  private buildAvailabilityMessage(raw: string): string | null {
    try {
      const parsed = JSON.parse(raw) as { isFree?: boolean; busy?: unknown };
      if (parsed.isFree) {
        return "Ese horario está libre ✅ ¿Confirmás que agendemos?";
      }
      return "Esa hora ya está ocupada 😕 ¿Te sirve otro horario dentro de 09:00–17:00?";
    } catch {
      return null;
    }
  }
}
