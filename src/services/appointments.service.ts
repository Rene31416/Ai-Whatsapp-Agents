import { inject, injectable } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";
import { randomBytes } from "node:crypto";
import {
  AppointmentsRepository,
  AppointmentRecord,
  AppointmentStatus,
  CreateAppointmentInput,
  UpdateScheduleInput,
} from "./appointments.repository";

export type CreateAppointmentRequest = {
  tenantId: string;
  userId: string;
  patientName: string;
  patientPhone?: string;
  patientEmail?: string;
  doctorId: string;
  doctorName?: string;
  startIso: string;
  endIso?: string;
  durationMinutes?: number;
  source?: string;
  notes?: string;
};

export type RescheduleAppointmentRequest = {
  tenantId: string;
  appointmentId?: string;
  userId?: string;
  doctorId?: string;
  startIso?: string;
  newStartIso: string;
  newEndIso?: string;
  durationMinutes?: number;
  newDoctorId?: string;
  newDoctorName?: string;
  notes?: string;
};

export type CancelAppointmentRequest = {
  tenantId: string;
  appointmentId?: string;
  userId?: string;
  doctorId?: string;
  startIso?: string;
};

export type AvailabilityRequest = {
  tenantId: string;
  doctorId: string;
  dateIso: string;
};

export type AppointmentResponse = {
  appointmentId: string;
  tenantId: string;
  userId: string;
  patientName: string;
  patientPhone?: string;
  patientEmail?: string;
  doctorId: string;
  doctorName?: string;
  startIso: string;
  endIso: string;
  status: AppointmentStatus;
  durationMinutes?: number;
  source?: string;
  notes?: string;
  calendarEventId?: string;
  calendarSyncStatus?: string;
  createdAt: string;
  updatedAt: string;
};

export type AvailabilityResponse = {
  tenantId: string;
  doctorId: string;
  dateIso: string;
  busy: Array<{ startIso: string; endIso: string; appointmentId: string }>; // busy slots only for now
};

@injectable()
export class AppointmentsService {
  constructor(
    @inject(Logger) private readonly log: Logger,
    @inject(AppointmentsRepository) private readonly repo: AppointmentsRepository
  ) {}

  async createAppointment(payload: CreateAppointmentRequest): Promise<AppointmentResponse> {
    const { startIso, endIso, durationMinutes } = this.normalizeTiming(payload.startIso, payload.endIso, payload.durationMinutes);

    await this.ensureAvailability({
      tenantId: payload.tenantId,
      doctorId: payload.doctorId,
      startIso,
      endIso,
    });

    const appointmentId = this.generateAppointmentId();

    const record = await this.repo.createAppointment({
      tenantId: payload.tenantId,
      appointmentId,
      userId: payload.userId,
      patientName: payload.patientName,
      patientPhone: payload.patientPhone,
      patientEmail: payload.patientEmail,
      doctorId: payload.doctorId,
      doctorName: payload.doctorName,
      startIso,
      endIso,
      durationMinutes,
      source: payload.source ?? "whatsapp",
      notes: payload.notes,
    } satisfies CreateAppointmentInput);

    return this.toResponse(record);
  }

  async rescheduleAppointment(payload: RescheduleAppointmentRequest): Promise<AppointmentResponse> {
    const target = await this.resolveAppointment(payload);

    const doctorId = payload.newDoctorId ?? payload.doctorId ?? target.doctorId;
    const doctorName = payload.newDoctorName ?? target.doctorName;
    const { startIso, endIso, durationMinutes } = this.normalizeTiming(
      payload.newStartIso,
      payload.newEndIso,
      payload.durationMinutes ?? target.durationMinutes
    );

    await this.ensureAvailability({
      tenantId: target.tenantId,
      doctorId,
      startIso,
      endIso,
      excludeAppointmentId: target.appointmentId,
    });

    const updated = await this.repo.updateSchedule({
      tenantId: target.tenantId,
      appointmentId: target.appointmentId,
      startIso,
      endIso,
      durationMinutes,
      doctorId,
      doctorName,
      notes: payload.notes ?? target.notes,
    } satisfies UpdateScheduleInput);

    return this.toResponse(updated);
  }

  async cancelAppointment(payload: CancelAppointmentRequest): Promise<AppointmentResponse> {
    const target = await this.resolveAppointment(payload);
    if (target.status === "cancelled") {
      this.log.warn("appointments.cancel.redundant", {
        tenantId: target.tenantId,
        appointmentId: target.appointmentId,
      });
      return this.toResponse(target);
    }

    const updated = await this.repo.updateStatus(target.tenantId, target.appointmentId, "cancelled");
    return this.toResponse(updated);
  }

  async getAvailability(payload: AvailabilityRequest): Promise<AvailabilityResponse> {
    const appointments = await this.repo.listDoctorAppointmentsForDay(
      payload.tenantId,
      payload.doctorId,
      payload.dateIso
    );

    const busy = appointments
      .filter((appt) => appt.status !== "cancelled")
      .map((appt) => ({
        startIso: appt.startIso,
        endIso: appt.endIso,
        appointmentId: appt.appointmentId,
      }));

    return {
      tenantId: payload.tenantId,
      doctorId: payload.doctorId,
      dateIso: payload.dateIso,
      busy,
    };
  }

  private async resolveAppointment(
    payload:
      | RescheduleAppointmentRequest
      | CancelAppointmentRequest
  ): Promise<AppointmentRecord> {
    if (!payload.tenantId) {
      throw new Error("tenantId is required");
    }

    if (payload.appointmentId) {
      const found = await this.repo.getByAppointmentId(payload.tenantId, payload.appointmentId);
      if (!found) {
        throw new Error("Appointment not found");
      }
      return found;
    }

    if (!payload.userId || !payload.doctorId || !payload.startIso) {
      throw new Error("Must provide appointmentId or (userId, doctorId, startIso)");
    }

    const found = await this.repo.getByLookup(
      payload.tenantId,
      payload.userId,
      payload.startIso
    );

    if (!found) {
      throw new Error("Appointment not found with provided lookup");
    }

    return found;
  }

  private async ensureAvailability(params: {
    tenantId: string;
    doctorId: string;
    startIso: string;
    endIso: string;
    excludeAppointmentId?: string;
  }) {
    const appointments = await this.repo.listDoctorAppointmentsForDay(
      params.tenantId,
      params.doctorId,
      params.startIso
    );

    const newStart = new Date(params.startIso).getTime();
    const newEnd = new Date(params.endIso).getTime();

    for (const appt of appointments) {
      if (appt.status === "cancelled") continue;
      if (params.excludeAppointmentId && appt.appointmentId === params.excludeAppointmentId) {
        continue;
      }

      const existingStart = new Date(appt.startIso).getTime();
      const existingEnd = new Date(appt.endIso).getTime();

      const overlap = Math.max(existingStart, newStart) < Math.min(existingEnd, newEnd);
      if (overlap) {
        throw new Error("Selected horario is not available for this doctor");
      }
    }
  }

  private normalizeTiming(startIso: string, endIso?: string, durationMinutes?: number) {
    if (!startIso) {
      throw new Error("startIso is required");
    }

    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) {
      throw new Error("Invalid startIso");
    }

    let resolvedEndIso = endIso;
    let resolvedDuration = durationMinutes;

    if (!resolvedEndIso) {
      if (!resolvedDuration) {
        resolvedDuration = 30;
      }
      const end = new Date(start.getTime() + resolvedDuration * 60 * 1000);
      resolvedEndIso = end.toISOString();
    } else if (!resolvedDuration) {
      const end = new Date(resolvedEndIso);
      if (Number.isNaN(end.getTime())) {
        throw new Error("Invalid endIso");
      }
      resolvedDuration = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    }

    return {
      startIso: start.toISOString(),
      endIso: resolvedEndIso,
      durationMinutes: resolvedDuration,
    };
  }

  private toResponse(record: AppointmentRecord): AppointmentResponse {
    return {
      appointmentId: record.appointmentId,
      tenantId: record.tenantId,
      userId: record.userId,
      patientName: record.patientName,
      patientPhone: record.patientPhone,
      patientEmail: record.patientEmail,
      doctorId: record.doctorId,
      doctorName: record.doctorName,
      startIso: record.startIso,
      endIso: record.endIso,
      status: record.status,
      durationMinutes: record.durationMinutes,
      source: record.source,
      notes: record.notes,
      calendarEventId: record.calendarEventId,
      calendarSyncStatus: record.calendarSyncStatus,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private generateAppointmentId(length = 8): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = randomBytes(length);
    let id = "";
    for (let i = 0; i < length; i++) {
      id += alphabet[bytes[i] % alphabet.length];
    }
    return id;
  }
}
