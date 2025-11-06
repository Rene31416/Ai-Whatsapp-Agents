import { z } from "zod";
import { DynamicStructuredTool } from "langchain/tools";
import type {
  CalendarService,
  AvailabilityParams,
  CreateAppointmentParams,
  CancelAppointmentParams,
  RescheduleAppointmentParams,
} from "../services/calendar.service";

export function createCalendarTools(calendarService: CalendarService) {
  const checkAvailability = new DynamicStructuredTool({
    name: "calendar_check_availability",
    description:
      "Verifica si un horario específico está libre en Google Calendar para el tenant dado.",
    schema: z.object({
      tenantId: z.string().describe("Identificador del tenant"),
      startIso: z.string().describe("Inicio del bloque en ISO 8601"),
      endIso: z.string().describe("Fin del bloque en ISO 8601"),
      calendarId: z
        .string()
        .optional()
        .describe("ID opcional del calendario; por defecto se usa 'primary'"),
    }),
    func: async (input) => {
      const { tenantId, startIso, endIso, calendarId } = input as AvailabilityParams;
      const { isFree, busy } = await calendarService.checkAvailability({
        tenantId,
        startIso,
        endIso,
        calendarId,
      });
      return JSON.stringify({ isFree, busy });
    },
  });

  const createAppointment = new DynamicStructuredTool({
    name: "calendar_create_appointment",
    description:
      "Crea un evento en Google Calendar para el tenant especificado. Debe usarse cuando el usuario confirmó hora y doctor.",
    schema: z.object({
      tenantId: z.string(),
      summary: z.string().describe("Título del evento"),
      description: z.string().optional().describe("Descripción opcional"),
      startIso: z.string(),
      endIso: z.string(),
      attendees: z
        .array(
          z.object({
            email: z.string(),
            displayName: z.string().optional(),
          })
        )
        .optional(),
      calendarId: z.string().optional(),
      doctor: z
        .string()
        .describe("Nombre del doctor con quien se agenda la cita (ej. Gerardo o Amada)"),
    }),
    func: async (input) => {
      const { tenantId, summary, description, startIso, endIso, attendees, calendarId, doctor } =
        input as CreateAppointmentParams;
      const event = await calendarService.createAppointment({
        tenantId,
        summary,
        description,
        startIso,
        endIso,
        attendees,
        calendarId,
        doctor,
      });
      return JSON.stringify({ eventId: event.id, status: event.status, htmlLink: event.htmlLink });
    },
  });

  const cancelAppointment = new DynamicStructuredTool({
    name: "calendar_cancel_appointment",
    description: "Cancela un evento existente en Google Calendar usando su ID.",
    schema: z.object({
      tenantId: z.string(),
      eventId: z.string(),
      calendarId: z.string().optional(),
    }),
    func: async (input) => {
      const { tenantId, eventId, calendarId } = input as CancelAppointmentParams;
      await calendarService.cancelAppointment({ tenantId, eventId, calendarId });
      return JSON.stringify({ cancelled: true });
    },
  });

  const rescheduleAppointment = new DynamicStructuredTool({
    name: "calendar_reschedule_appointment",
    description:
      "Reagenda un evento existente moviéndolo a un nuevo horario. Se debe llamar cuando el usuario pide cambiar fecha u hora.",
    schema: z.object({
      tenantId: z.string(),
      eventId: z.string(),
      startIso: z.string(),
      endIso: z.string(),
      calendarId: z.string().optional(),
    }),
    func: async (input) => {
      const { tenantId, eventId, startIso, endIso, calendarId } =
        input as RescheduleAppointmentParams;
      const event = await calendarService.rescheduleAppointment({
        tenantId,
        eventId,
        startIso,
        endIso,
        calendarId,
      });
      return JSON.stringify({ eventId: event.id, status: event.status });
    },
  });

  return [checkAvailability, createAppointment, cancelAppointment, rescheduleAppointment];
}
