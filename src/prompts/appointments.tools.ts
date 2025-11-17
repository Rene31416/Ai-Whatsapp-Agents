import { z } from "zod";
import { DynamicStructuredTool } from "langchain/tools";

export type AppointmentsToolConfig = {
  baseUrl: string;
};

type DoctorRef = { doctorId: string; displayName: string; availabilityHours?: string };

const KNOWN_DOCTORS: Record<string, string> = {
  gerardo: "gerardo",
  amada: "amada",
};

export class AppointmentsToolError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "AppointmentsToolError";
  }
}

export function createAppointmentsTools(config: AppointmentsToolConfig, doctors: DoctorRef[] = []) {
  if (!config?.baseUrl) {
    throw new Error("Appointments base URL is required to initialize tools");
  }

  const baseUrl = config.baseUrl.replace(/\/$/, "");

  const normalizeDoctorId = (raw?: string) => {
    if (!raw) return "";
    const slug = raw.toLowerCase().trim();
    const known = KNOWN_DOCTORS[slug];
    if (known) return known;
    const fromCatalog =
      doctors.find(
        (d) =>
          d.doctorId?.toLowerCase() === slug ||
          d.displayName?.toLowerCase() === slug
      );
    return fromCatalog?.doctorId ?? "";
  };

  const requestJson = async (method: string, url: string, body?: unknown) => {
    const init: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (method === "GET") {
      delete (init.headers as Record<string, string>)["Content-Type"];
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    console.log("[appointments.tool.http]", { method, url, hasBody: body !== undefined });

    const response = await fetch(url, init);
    const text = await response.text();

    if (!response.ok) {
      throw new AppointmentsToolError(response.status, text || `Appointments API ${response.status}`);
    }

    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  };

  const addMinutes = (startIso: string, minutes: number) => {
    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) return startIso;
    const end = new Date(start.getTime() + minutes * 60 * 1000);
    return end.toISOString();
  };

  const stripDate = (iso: string) => {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
    return date.toISOString().slice(0, 10);
  };

  const overlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) => {
    const startA = new Date(aStart).getTime();
    const endA = new Date(aEnd).getTime();
    const startB = new Date(bStart).getTime();
    const endB = new Date(bEnd).getTime();
    if ([startA, endA, startB, endB].some((v) => Number.isNaN(v))) return false;
    return Math.max(startA, startB) < Math.min(endA, endB);
  };

  const checkAvailability = new DynamicStructuredTool({
    name: "appointments_check_availability",
    description:
      "Verifica si el horario deseado está libre según los registros de la clínica (DynamoDB).",
    schema: z.object({
      tenantId: z.string(),
      doctorId: z.string().optional(),
      doctor: z.string().optional(),
      startIso: z.string(),
      endIso: z.string().optional(),
    }),
    func: async (input) => {
      const { tenantId, startIso } = input as {
        tenantId: string;
        doctorId?: string;
        doctor?: string;
        startIso: string;
        endIso?: string;
      };

      const doctorId =
        normalizeDoctorId((input as any)?.doctorId ?? (input as any)?.doctor) || "";
      if (!doctorId) {
        throw new AppointmentsToolError(400, "doctorId is required for availability");
      }

      const start = typeof startIso === "string" ? startIso : new Date().toISOString();
      const endIso = (input as any)?.endIso ?? addMinutes(start, 30);
      const url = new URL(`${baseUrl}/availability`);
      url.searchParams.set("tenantId", tenantId);
      url.searchParams.set("doctorId", doctorId);
      url.searchParams.set("date", stripDate(start));

      const data = (await requestJson("GET", url.toString())) as any;
      const busy = Array.isArray(data?.busy) ? data.busy : [];
      const isFree = !busy.some((slot: any) =>
        overlap(start, endIso, slot?.startIso ?? slot?.start, slot?.endIso ?? slot?.end)
      );

      return JSON.stringify({ isFree, busy });
    },
  });

  const createAppointment = new DynamicStructuredTool({
    name: "appointments_create",
    description:
      "Crea una cita en el sistema interno de la clínica. Úsalo solo después de que el paciente confirmó doctor/horario y ya entregó sus datos.",
    schema: z.object({
      tenantId: z.string(),
      userId: z.string(),
      patientName: z.string(),
      patientPhone: z.string().optional(),
      patientEmail: z.string().optional(),
      doctorId: z.string(),
      doctorName: z.string().optional(),
      startIso: z.string(),
      endIso: z.string(),
      durationMinutes: z.number().optional(),
      source: z.string().optional(),
      notes: z.string().optional(),
    }),
    func: async (input) => {
      const payload = input as Record<string, unknown>;
      const data = await requestJson("POST", baseUrl, payload);
      return JSON.stringify(data);
    },
  });

  const rescheduleAppointment = new DynamicStructuredTool({
    name: "appointments_reschedule",
    description:
      "Reagenda una cita existente moviéndola al nuevo horario confirmado.",
    schema: z.object({
      tenantId: z.string(),
      appointmentId: z.string().optional(),
      userId: z.string().optional(),
      doctorId: z.string().optional(),
      startIso: z.string().optional(),
      newStartIso: z.string(),
      newEndIso: z.string().optional(),
      durationMinutes: z.number().optional(),
      newDoctorId: z.string().optional(),
      newDoctorName: z.string().optional(),
      notes: z.string().optional(),
    }),
    func: async (input) => {
      const payload = input as Record<string, unknown>;
      const target = payload.appointmentId
        ? `${baseUrl}/${encodeURIComponent(String(payload.appointmentId))}`
        : baseUrl;
      const data = await requestJson("PATCH", target, payload);
      return JSON.stringify(data);
    },
  });

  const cancelAppointment = new DynamicStructuredTool({
    name: "appointments_cancel",
    description:
      "Cancela una cita en el sistema interno. Úsalo solo si el paciente lo pidió explícitamente.",
    schema: z.object({
      tenantId: z.string(),
      appointmentId: z.string().optional(),
      userId: z.string().optional(),
      doctorId: z.string().optional(),
      startIso: z.string().optional(),
    }),
    func: async (input) => {
      const payload = input as Record<string, unknown>;
      const target = payload.appointmentId
        ? `${baseUrl}/${encodeURIComponent(String(payload.appointmentId))}`
        : baseUrl;
      const data = await requestJson("DELETE", target, payload);
      return JSON.stringify(data);
    },
  });

  return [checkAvailability, createAppointment, rescheduleAppointment, cancelAppointment];
}
