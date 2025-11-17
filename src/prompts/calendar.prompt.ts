// srrc/calendar/calendar.prompt.service.ts
import { injectable } from "inversify";
import { PromptTemplate } from "@langchain/core/prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { DynamicStructuredTool } from "langchain/tools";
import { z } from "zod";
import { getLLM } from "../services/llm.services";
import { AppointmentsToolError, createAppointmentsTools } from "./appointments.tools";
import { analyzeCalendarConversation, buildPolicySummary } from "./calendar.policy";


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
  doctors?: Array<{ doctorId: string; displayName: string; availabilityHours?: string }>;
};

export type CalendarLiteOutput = {
  a: string; // respuesta breve para WhatsApp
  c: number; // confianza 0..1
  tool?: ToolName;
  args?: Record<string, unknown>;
};

const TOOL_NAMES = [
  "appointments_check_availability",
  "appointments_create",
  "appointments_reschedule",
  "appointments_cancel",
] as const;
type ToolName = (typeof TOOL_NAMES)[number];

const CalendarLiteSchema = z.object({
  a: z.string().default(""),
  c: z.number().min(0).max(1).default(0.7),
  tool: z.enum(TOOL_NAMES).optional(),
  args: z.record(z.string(), z.any()).optional(),
});

const parser = new JsonOutputParser<CalendarLiteOutput>();

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

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
Eres un agente de CALENDARIO. Respondé en español, estilo WhatsApp, breve y natural (máx 2 frases, 2–3 emojis). No menciones herramientas.

DOCTORES DISPONIBLES:
- Usa solo esta lista para ofrecer/aceptar doctores. Si falta doctor, pedí elegir uno de la lista.
{doctors_list}

ESTILO / SALUDOS:
- Solo saluda si VENTANA está vacía o el mensaje actual es un saludo simple.
- No te autopresentes si ya hubo conversación reciente.
- Variá saludos breves y evita repetirlos.
- Recordá que el horario válido es 09:00–17:00.

POLÍTICAS CALCULADAS (JSON):
{policy_summary}

Lee el JSON y actúa según esos flags:
- Si doctorKnown=false → pedí que elija uno de los DOCTORES DISPONIBLES.
- Si doctorKnown=true pero el mensaje trae un doctor distinto al anterior, asumilo y repetilo de forma clara.
- Si hasDateTimeInfo=false → pedí fecha y hora explícita (24h o am/pm) junto con el doctor (si falta algo, pedilo todo en un solo mensaje) y explica que dura 30 min.
- Si clinicHoursOk=false → indicá que debe ser entre 09:00–17:00 y pedí otra hora.
- Si needsAvailabilityCheck=true → avisá que revisarás disponibilidad y usa la tool appointments_check_availability antes de afirmar resultados.
- Cuando availabilityStatus="free" → indicá que acabás de confirmar el horario y pedí los datos faltantes (sin pedir confirmación todavía).
- Cuando availabilityStatus="busy" → explicá que no hay cupo y pedí que elija otro horario dentro de 09:00–17:00 (no repitas el rango completo más de una vez).
- Si needsContactData=true → pedí en un solo mensaje exactamente los campos listados en missingFields (nombre, telefono, correo) sin repetir otros.
- Si needsConfirmation=true → resume paciente + teléfono + correo + doctor + fecha/hora y pedí el “sí, confirmo” antes de crear la cita.
- Después de appointments_create → confirma que quedó agendada mencionando los datos completos. No prometas moverla automáticamente; sólo indica que quedó registrada.

OBJETIVO:
- Guiar al usuario para agendar/gestionar citas usando la información disponible en VENTANA + MSG.
- Evitá pedir datos que ya figuran en la conversación.

POLÍTICA DE RECOLECCIÓN:
- Si faltan varios datos personales, pedilos juntos (usa missingFields como referencia) y mantené 2–3 emojis máximo.
- Si solo falta un dato, pedilo con una frase breve.
- Convertí referencias relativas (“mañana a las 3”) usando {now_iso}/{tz} y responde con horarios explícitos en formato 24h.
- Si el usuario solicita mover/cancelar y la política no lo cubre, explicá brevemente y seguí con la recolección de datos.

CUANDO YA ESTÁ TODO:
- Si availabilityStatus="free" y missingFields está vacío → resume y pedí confirmación.
- Tras recibir confirmación → ejecutá appointments_create (30 min) y luego responde que quedó agendado, mencionando paciente, contacto, correo, doctor y fecha/hora.
- Si un paciente pide mover una cita ya confirmada y tenés datos suficientes → reuní la nueva fecha/hora y usá appointments_reschedule.
- Si pide cancelarla → confirmá datos y usá appointments_cancel.
- Si alguna tool falla, contalo y pedí otro horario.

Salida estricta (UN JSON válido, sin texto extra):
{{
  "a": string,
  "c": number,
  "tool"?: "appointments_check_availability" | "appointments_create" | "appointments_reschedule" | "appointments_cancel",
  "args"?: object
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
  private readonly prompt = new PromptTemplate({
    inputVariables: ["message", "recent_window", "now_iso", "tz", "policy_summary", "doctors_list"],
    template,
  });
  private readonly baseUrl: string;

  constructor() {
    const baseUrl = process.env.APPOINTMENTS_API_BASE_URL;
    if (!baseUrl) {
      throw new Error("APPOINTMENTS_API_BASE_URL env is required");
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async calendarAndAnswerLite(
    input: CalendarLiteInput
  ): Promise<CalendarLiteOutput> {
    const { message, recent_window, now_iso, tz, tenantId, userId, doctors } = input;

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
    console.info("[calendar.input/MSG]", message ?? "");
    console.info("[calendar.input/VENTANA]", recent_window ?? "");

    const policyState = analyzeCalendarConversation({
      message: message ?? "",
      recentWindow: recent_window ?? "",
    });
    const policySummary = buildPolicySummary(policyState);
    console.log("[calendar.policy]", {
      ...policyState,
      doctors: (doctors ?? []).map((d) => ({ id: d.doctorId, name: d.displayName })),
    });

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
    const doctorsList =
      (doctors ?? [])
        .map((d) => `- ${d.displayName}${d.availabilityHours ? ` · horario ${d.availabilityHours}` : ""}`)
        .join("\n") || "- (sin doctores configurados para este tenant)";

    const rendered = await this.prompt.format({
      message: message ?? "",
      recent_window: recent_window ?? "",
      now_iso: now_iso ?? new Date().toISOString(),
      tz: tz ?? "America/El_Salvador",
      policy_summary: policySummary,
      doctors_list: doctorsList,
    });
    const tRender = process.hrtime.bigint();

    // Prepare tools per request (inject tenant-specific doctors)
    const tools = createAppointmentsTools({ baseUrl: this.baseUrl }, doctors ?? []);
    const createTool = tools.find((tool) => tool.name === "appointments_create");
    const checkTool = tools.find((tool) => tool.name === "appointments_check_availability");
    const rescheduleTool = tools.find((tool) => tool.name === "appointments_reschedule");
    const cancelTool = tools.find((tool) => tool.name === "appointments_cancel");
    if (!createTool || !checkTool || !rescheduleTool || !cancelTool) {
      throw new Error("Appointments tools not initialized");
    }

    // Invoke directo con el string renderizado
    const tInvokeStart = process.hrtime.bigint();
    const llmOut: any = await tuned.invoke(rendered, { tools: [checkTool, createTool, rescheduleTool, cancelTool] as any });
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
    console.log("[llm.output] raw", raw);

    // Parse + validación (con rescate si viene ruido)
    let out: CalendarLiteOutput;
    try {
      const firstJson = extractFirstJsonObject(raw) ?? raw;
      const parsed = await parser.parse(firstJson);
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
          const firstJson = extractFirstJsonObject(rescued) ?? rescued;
          const parsed = await parser.parse(firstJson);
          const safe = CalendarLiteSchema.parse(parsed);
          console.log("[calendar.decide][rescued]", {
            a_len: safe.a.length,
            c: safe.c,
          });
          out = safe;
        } catch {
          console.warn("[calendar.fallback.trigger] El modelo no devolvió JSON válido; se pide repetición.");
          out = {
            a: "Perdón, no entendí lo último. ¿Podés repetirlo, por favor? 😊",
            c: 0.5,
          };
        }
      } else {
        console.warn("[calendar.fallback.trigger] El modelo no devolvió JSON válido; se pide repetición.");
        out = {
          a: "Disculpá, no alcancé a entender. ¿Lo podrías repetir, por favor? 😊",
          c: 0.5,
        };
      }
    }

    let toolMessage: string | null = null;
    let toolError: Error | null = null;
    const missingCount = policyState.missingFields?.length ?? 0;

    if (out.tool) {
      const args = { ...(out.args ?? {}) };
      if (tenantId) {
        args.tenantId = tenantId;
      }
      if (userId && !args.userId) {
        args.userId = userId;
      }
      if (!args.doctor && policyState.doctorName) {
        args.doctor = policyState.doctorName;
      }

      // Siempre fijamos tenantId desde contexto
      args.tenantId = tenantId ?? args.tenantId;

      if (!args.tenantId) {
        console.warn("[calendar.tool.skip] missing tenantId for tool call", {
          requestedTool: out.tool,
        });
      } else {
        try {
          const logArgs: Record<string, unknown> = { ...args };
          if (logArgs.patientPhone) logArgs.patientPhone = "***";
          if (logArgs.patientEmail) logArgs.patientEmail = "***";
          console.log("[calendar.tool.invoke]", {
            tool: out.tool,
            args: logArgs,
          });

          const tzToUse = tz ?? "America/El_Salvador";

          const resolvedDoctorId = this.resolveDoctorId(args, doctors ?? []);
          const needsDoctor =
            out.tool === "appointments_check_availability" ||
            out.tool === "appointments_create" ||
            out.tool === "appointments_reschedule" ||
            out.tool === "appointments_cancel";

          if (needsDoctor) {
            if (!resolvedDoctorId) {
              toolMessage = "Necesito que elijas uno de estos doctores: " + (doctors ?? []).map((d) => d.displayName).join(", ");
              throw new AppointmentsToolError(400, "doctorId is required and must be one of the available doctors");
            }
            // Sobrescribir siempre con el ID del catálogo, ignorando lo que venga del modelo
            args.doctorId = resolvedDoctorId;
            const match = (doctors ?? []).find((d) => d.doctorId === resolvedDoctorId);
            if (match?.displayName) {
              args.doctorName = match.displayName;
            }
          }

          if (out.tool === "appointments_check_availability") {
            const prepared = this.prepareAvailabilityArgs(args, tzToUse);
            const result = await checkTool.invoke(prepared as any);
            toolMessage = typeof result === "string" ? result : JSON.stringify(result);
          } else if (out.tool === "appointments_create") {
            const prepared = this.prepareCreateArgs(args, tzToUse);
            const result = await createTool.invoke(prepared as any);
            toolMessage = typeof result === "string" ? result : JSON.stringify(result);
          } else if (out.tool === "appointments_reschedule") {
            const prepared = this.prepareRescheduleArgs(args, tzToUse);
            const result = await rescheduleTool.invoke(prepared as any);
            toolMessage = typeof result === "string" ? result : JSON.stringify(result);
          } else if (out.tool === "appointments_cancel") {
            const prepared = this.prepareCancelArgs(args, tzToUse);
            const result = await cancelTool.invoke(prepared as any);
            toolMessage = typeof result === "string" ? result : JSON.stringify(result);
          } else {
            console.warn("[calendar.tool.skip] unsupported tool", { tool: out.tool });
          }

          console.log("[calendar.tool.success]", {
            tool: out.tool,
            tenantId: args.tenantId,
          });
          if (toolMessage) {
            console.log("[calendar.tool.result]", {
              tool: out.tool,
              preview: toolMessage.slice(0, 200),
            });
          }
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
      if (toolError instanceof AppointmentsToolError) {
        if (toolError.statusCode === 409) {
          out.a =
            "Ups, alguien tomó ese espacio mientras lo confirmábamos. Decime otro horario dentro de 09:00–17:00 y lo intento de nuevo. ⏳";
        } else if (toolError.statusCode === 404) {
          out.a = "No encontré esa cita con los datos que tenemos. Revisemos juntos y lo intento de nuevo.";
        } else {
          out.a =
            "No pude actualizar la cita por un error interno. Probemos con otro horario o intentá más tarde, ¿te parece?";
        }
      } else {
        out.a =
          "No pude completar la acción por un error interno. Probemos con otro horario o intentá más tarde, ¿te parece?";
      }
      out.tool = undefined;
      out.args = undefined;
    } else if (toolMessage) {
      if (out.tool === "appointments_check_availability") {
        const msg = this.buildAvailabilityMessage(toolMessage, missingCount);
        if (msg) out.a = msg;
      } else if (out.tool === "appointments_create") {
        out.a = this.buildCreateConfirmationMessage(toolMessage, tz ?? "America/El_Salvador");
        console.log("[calendar.tool.create.result]", toolMessage.slice(0, 200));
      } else if (out.tool === "appointments_reschedule") {
        out.a = this.buildRescheduleMessage(toolMessage, tz ?? "America/El_Salvador");
      } else if (out.tool === "appointments_cancel") {
        out.a = this.buildCancelMessage(toolMessage);
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

  private buildAvailabilityMessage(raw: string, missingCount: number): string | null {
    try {
      const parsed = JSON.parse(raw) as { isFree?: boolean; busy?: unknown };
      if (parsed.isFree) {
        if (missingCount > 0) {
          return "Acabo de confirmar que ese horario está libre ✅. Necesito los datos que faltan para agendar (nombre, teléfono, correo).";
        }
        return "Acabo de confirmar que ese horario está libre ✅. Avisame si podemos agendar con esos datos.";
      }
      return "Esa hora ya está ocupada 😕 Elegí otra hora entre 09:00 y 17:00 y reviso nuevamente.";
    } catch {
      return null;
    }
  }

  private buildCreateConfirmationMessage(raw: string, tz: string): string {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const doctor = (data.doctorName as string) ?? this.doctorNameFromId(data.doctorId as string) ?? "el doctor";
      const when = this.formatIsoForUser((data.startIso as string) ?? (data.start as string), tz);
      const appointmentId = data.appointmentId ? " (ID " + data.appointmentId + ")" : "";
      if (when) {
        return "Perfecto, quedó agendada con " + doctor + " el " + when + appointmentId + ". ✅";
      }
      return "Perfecto, la cita quedó agendada" + (appointmentId || "") + " ✅.";
    } catch {
      return "Perfecto, la cita quedó agendada ✅.";
    }
  }

  private buildRescheduleMessage(raw: string, tz: string): string {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const when = this.formatIsoForUser((data.startIso as string) ?? (data.newStartIso as string), tz);
      if (when) {
        return "Listo, moví tu cita a " + when + ". ✅";
      }
      return "Listo, la cita se actualizó ✅.";
    } catch {
      return "Listo, la cita se actualizó ✅.";
    }
  }

  private buildCancelMessage(raw: string): string {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const appointmentId = data.appointmentId ? ` (ID ${data.appointmentId})` : "";
      return `Listo, cancelé la cita${appointmentId}. Cuando quieras volvemos a agendar.`;
    } catch {
      return "Listo, cancelé la cita. Cuando quieras volvemos a agendar.";
    }
  }

  private resolveDoctorId(args: Record<string, unknown>, doctors: Array<{ doctorId: string; displayName: string }>): string | null {
    const candidates = [args.doctorName, args.doctor].filter(Boolean) as string[];
    const slugify = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();

    for (const raw of candidates) {
      const slug = slugify(raw);
      // exact match doctorId or displayName
      const exact = doctors.find(
        (d) =>
          slugify(d.doctorId) === slug ||
          slugify(d.displayName) === slug
      );
      if (exact?.doctorId) return exact.doctorId;

      // fallback: unique partial match on displayName
      const partialMatches = doctors.filter((d) =>
        slugify(d.displayName).includes(slug)
      );
      if (partialMatches.length === 1) {
        return partialMatches[0].doctorId;
      }
    }

    return null;
  }

  private prepareAvailabilityArgs(
    args: Record<string, unknown>,
    tz: string
  ): Record<string, unknown> {
    const prepared: Record<string, unknown> = { ...args };

    if (!prepared.startIso) {
      const isoFromDatetime = this.normalizeDatetimeField(prepared, tz);
      if (isoFromDatetime) {
        prepared.startIso = isoFromDatetime;
        console.log("[calendar.tool.autofill]", {
          field: "startIso",
          value: isoFromDatetime,
        });
      } else {
        const startFromHints = this.buildIsoFromHints(prepared, tz);
        if (startFromHints) {
          prepared.startIso = startFromHints;
          console.log("[calendar.tool.autofill]", {
            field: "startIso",
            value: startFromHints,
          });
        }
      }
    }

    if (!prepared.endIso && typeof prepared.startIso === "string") {
      prepared.endIso = this.addMinutes(prepared.startIso, 30);
    }

    if (typeof prepared.startIso !== "string") {
      throw new Error("startIso is required for appointment creation");
    }
    if (typeof prepared.endIso !== "string") {
      prepared.endIso = this.addMinutes(prepared.startIso, 30);
    }

    if (typeof prepared.startIso !== "string") {
      throw new Error("startIso is required for availability checks");
    }
    if (typeof prepared.endIso !== "string") {
      prepared.endIso = this.addMinutes(prepared.startIso, 30);
    }

    const doctor = this.resolveDoctorInfo(prepared);
    if (!doctor.doctorId) {
      throw new Error("doctorId is required for availability checks");
    }

    return {
      tenantId: prepared.tenantId,
      doctorId: doctor.doctorId,
      startIso: prepared.startIso,
      endIso: prepared.endIso,
    };
  }

  private prepareCreateArgs(
    args: Record<string, unknown>,
    tz: string
  ): Record<string, unknown> {
    const prepared: Record<string, unknown> = { ...args };

    if (!prepared.startIso) {
      const fromDatetime = this.normalizeDatetimeField(prepared, tz);
      if (fromDatetime) {
        prepared.startIso = fromDatetime;
        console.log("[calendar.tool.autofill]", {
          field: "startIso",
          value: fromDatetime,
        });
      } else {
        const fromHints = this.buildIsoFromHints(prepared, tz);
        if (fromHints) {
          prepared.startIso = fromHints;
          console.log("[calendar.tool.autofill]", {
            field: "startIso",
            value: fromHints,
          });
        }
      }
    }

    if (!prepared.endIso && typeof prepared.startIso === "string") {
      prepared.endIso = this.addMinutes(prepared.startIso, 30);
    }

    const userId = this.pickString(prepared, ["userId"]);
    if (!userId) {
      throw new Error("userId is required for appointment creation");
    }

    const doctor = this.resolveDoctorInfo(prepared);
    if (!doctor.doctorId) {
      throw new Error("doctorId is required for appointment creation");
    }

    return {
      tenantId: prepared.tenantId,
      userId,
      patientName: this.pickString(prepared, ["patientName", "nombre", "name"]) ?? "",
      patientPhone: this.pickString(prepared, ["patientPhone", "phone", "telefono", "phoneNumber"]),
      patientEmail: this.pickString(prepared, ["patientEmail", "email", "correo"]),
      doctorId: doctor.doctorId,
      doctorName: doctor.doctorName,
      startIso: prepared.startIso,
      endIso: prepared.endIso,
      durationMinutes:
        typeof prepared.durationMinutes === "number" && prepared.durationMinutes > 0
          ? prepared.durationMinutes
          : 30,
      source: typeof prepared.source === "string" ? prepared.source : "whatsapp",
      notes: typeof prepared.notes === "string" ? prepared.notes : undefined,
    };
  }

  private prepareRescheduleArgs(
    args: Record<string, unknown>,
    tz: string
  ): Record<string, unknown> {
    const prepared: Record<string, unknown> = { ...args };

    const identifierPresent =
      typeof prepared.appointmentId === "string" ||
      (typeof prepared.userId === "string" &&
        (typeof prepared.startIso === "string" || typeof prepared.originalStartIso === "string"));

    if (!identifierPresent) {
      throw new Error("Provide appointmentId or (userId, startIso) to reschedule");
    }

    if (!prepared.newStartIso) {
      const fromDatetime = this.normalizeDatetimeField(
        { datetime: prepared.newDatetime ?? prepared.newStartIso },
        tz
      );
      if (fromDatetime) {
        prepared.newStartIso = fromDatetime;
      } else {
        const fromHints = this.buildIsoFromHints(
          {
            date: prepared.newDate ?? prepared.date,
            time: prepared.newTime ?? prepared.time,
          },
          tz
        );
        if (fromHints) {
          prepared.newStartIso = fromHints;
        }
      }
    }

    if (typeof prepared.newStartIso !== "string") {
      throw new Error("newStartIso is required to reschedule");
    }

    if (!prepared.newEndIso) {
      prepared.newEndIso = this.addMinutes(
        prepared.newStartIso,
        typeof prepared.durationMinutes === "number" ? prepared.durationMinutes : 30
      );
    }

    const doctor = this.resolveDoctorInfo(prepared, {
      idKeys: ["newDoctorId", "doctorId", "doctor"],
      nameKeys: ["newDoctorName", "doctorName", "doctor"],
    });

    return {
      tenantId: prepared.tenantId,
      appointmentId: prepared.appointmentId,
      userId: prepared.userId,
      doctorId: doctor.doctorId,
      startIso: prepared.startIso ?? prepared.originalStartIso,
      newStartIso: prepared.newStartIso,
      newEndIso: prepared.newEndIso,
      durationMinutes:
        typeof prepared.durationMinutes === "number" && prepared.durationMinutes > 0
          ? prepared.durationMinutes
          : 30,
      newDoctorId: doctor.doctorId,
      newDoctorName: doctor.doctorName,
      notes: typeof prepared.notes === "string" ? prepared.notes : undefined,
    };
  }

  private prepareCancelArgs(
    args: Record<string, unknown>,
    tz: string
  ): Record<string, unknown> {
    const prepared: Record<string, unknown> = { ...args };

    if (!prepared.appointmentId) {
      if (!prepared.startIso) {
        const isoFromDatetime = this.normalizeDatetimeField(prepared, tz);
        if (isoFromDatetime) {
          prepared.startIso = isoFromDatetime;
        } else {
          const fromHints = this.buildIsoFromHints(prepared, tz);
          if (fromHints) {
            prepared.startIso = fromHints;
          }
        }
      }

      if (!prepared.userId || !prepared.startIso) {
        throw new Error("Provide appointmentId or (userId, startIso) to cancel");
      }
    }

    const doctor = this.resolveDoctorInfo(prepared);

    return {
      tenantId: prepared.tenantId,
      appointmentId: prepared.appointmentId,
      userId: prepared.userId,
      doctorId: doctor.doctorId,
      startIso: prepared.startIso,
    };
  }

  private buildIsoFromHints(
    args: Record<string, unknown>,
    tz: string
  ): string | null {
    const dateStr = typeof args.date === "string" ? args.date : undefined;
    const timeStr = typeof args.time === "string" ? args.time : undefined;
    if (!dateStr || !timeStr) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;

    const normalizedTime = this.normalizeTimeHint(timeStr);
    if (!normalizedTime) return null;

    const offset = this.getTzOffset(tz);
    return `${dateStr}T${normalizedTime}:00${offset}`;
  }

  private normalizeTimeHint(time: string): string | null {
    const isoMatch = time.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (isoMatch) {
      const h = isoMatch[1].padStart(2, "0");
      const m = isoMatch[2].padStart(2, "0");
      return `${h}:${m}`;
    }

    const ampmMatch = time.match(/^(\d{1,2})(?::(\d{2}))?\s?(am|pm)$/i);
    if (!ampmMatch) return null;
    let hour = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
    const suffix = ampmMatch[3].toLowerCase();
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    const hh = hour.toString().padStart(2, "0");
    const mm = minutes.toString().padStart(2, "0");
    return `${hh}:${mm}`;
  }

  private getTzOffset(tz: string): string {
    if (tz === "America/El_Salvador") return "-06:00";
    return "Z";
  }

  private normalizeDatetimeField(
    args: Record<string, unknown>,
    tz: string
  ): string | null {
    const datetime = typeof args.datetime === "string" ? args.datetime : undefined;
    if (!datetime) return null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/.test(datetime)) {
      return datetime.includes("Z") || /[+-]\d{2}:\d{2}$/.test(datetime)
        ? datetime
        : `${datetime}${this.getTzOffset(tz)}`;
    }
    const parsed = new Date(datetime);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }

  private resolveDoctorInfo(
    args: Record<string, unknown>,
    opts?: { idKeys?: string[]; nameKeys?: string[] }
  ): { doctorId?: string; doctorName?: string } {
    const idKeys = opts?.idKeys ?? ["doctorId", "doctor"];
    const nameKeys = opts?.nameKeys ?? ["doctorName", "doctor"];

    for (const key of idKeys) {
      const value = this.pickString(args, [key]);
      const normalized = this.normalizeDoctorId(value);
      if (normalized) {
        return { doctorId: normalized, doctorName: this.doctorNameFromId(normalized) };
      }
    }

    for (const key of nameKeys) {
      const value = this.pickString(args, [key]);
      const normalized = this.normalizeDoctorId(value);
      if (normalized) {
        return { doctorId: normalized, doctorName: this.doctorNameFromId(normalized) };
      }
      if (value) {
        return { doctorId: value.toLowerCase(), doctorName: value };
      }
    }

    return {};
  }

  private doctorNameFromId(id?: string): string | undefined {
    if (!id) return undefined;
    if (id === "gerardo") return "Gerardo";
    if (id === "amada") return "Amada";
    return id.replace(/-/g, " ");
  }

  private normalizeDoctorId(value?: string | null): string | null {
    if (!value) return null;
    const clean = value.toString().trim().toLowerCase();
    if (!clean) return null;
    if (clean.includes("ama")) return "amada";
    if (clean.includes("ger")) return "gerardo";
    return clean.replace(/\s+/g, "-");
  }

  private pickString(args: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private formatIsoForUser(iso: string | undefined, tz: string): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    try {
      return date.toLocaleString("es-SV", {
        timeZone: tz,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        day: "2-digit",
        month: "2-digit",
      });
    } catch {
      return date.toISOString();
    }
  }
}
