import {
  Controller,
  POST,
  PATCH,
  DELETE,
  GET,
  apiController,
  body,
  pathParam,
  queryParam,
} from "ts-lambda-api";
import { inject } from "inversify";
import { z } from "zod";
import { AppointmentsService } from "../services/appointments.service";

const createSchema = z
  .object({
    tenantId: z.string().min(1),
    userId: z.string().min(1),
    patientName: z.string().min(1),
    patientPhone: z.string().optional(),
    patientEmail: z.string().email().optional(),
    doctorId: z.string().min(1),
    doctorName: z.string().optional(),
    startIso: z.string().min(1),
    endIso: z.string().optional(),
    durationMinutes: z.coerce.number().int().positive().optional(),
    source: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine(
    (data) => Boolean(data.endIso || data.durationMinutes),
    {
      message: "Provide endIso or durationMinutes",
      path: ["endIso"],
    }
  );

const rescheduleSchema = z
  .object({
    tenantId: z.string().min(1),
    appointmentId: z.string().optional(),
    userId: z.string().optional(),
    doctorId: z.string().optional(),
    startIso: z.string().optional(),
    newStartIso: z.string().min(1),
    newEndIso: z.string().optional(),
    durationMinutes: z.coerce.number().int().positive().optional(),
    newDoctorId: z.string().optional(),
    newDoctorName: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine(
    (data) => Boolean(data.appointmentId || (data.userId && data.doctorId && data.startIso)),
    {
      message: "Provide appointmentId or (userId, doctorId, startIso)",
      path: ["appointmentId"],
    }
  );

const cancelSchema = z
  .object({
    tenantId: z.string().min(1),
    appointmentId: z.string().optional(),
    userId: z.string().optional(),
    doctorId: z.string().optional(),
    startIso: z.string().optional(),
  })
  .refine(
    (data) => Boolean(data.appointmentId || (data.userId && data.doctorId && data.startIso)),
    {
      message: "Provide appointmentId or (userId, doctorId, startIso)",
      path: ["appointmentId"],
    }
  );

const availabilitySchema = z.object({
  tenantId: z.string().min(1),
  doctorId: z.string().min(1),
  dateIso: z.string().min(1),
});

@apiController("/appointments")
export class AppointmentsController extends Controller {
  constructor(@inject(AppointmentsService) private readonly service: AppointmentsService) {
    super();
  }

  @POST("/")
  async create(@body requestBody: any) {
    try {
      const payload = createSchema.parse(requestBody);
      const result = await this.service.createAppointment(payload);
      return this.created(result);
    } catch (error) {
      return this.handleError(error);
    }
  }

  @PATCH("/")
  async rescheduleWithoutId(@body requestBody: any) {
    return this.handleReschedule(undefined, requestBody);
  }

  @PATCH("/{appointmentId}")
  async rescheduleWithId(
    @pathParam("appointmentId") appointmentId: string,
    @body requestBody: any
  ) {
    return this.handleReschedule(appointmentId, requestBody);
  }

  @DELETE("/")
  async cancelWithoutId(@body requestBody: any) {
    return this.handleCancel(undefined, requestBody);
  }

  @DELETE("/{appointmentId}")
  async cancelWithId(
    @pathParam("appointmentId") appointmentId: string,
    @body requestBody: any
  ) {
    return this.handleCancel(appointmentId, requestBody);
  }

  @GET("/availability")
  async availability(
    @queryParam("tenantId") tenantId: string,
    @queryParam("doctorId") doctorId: string,
    @queryParam("date") date: string
  ) {
    try {
      const payload = availabilitySchema.parse({ tenantId, doctorId, dateIso: date ?? new Date().toISOString() });
      const result = await this.service.getAvailability(payload);
      return { statusCode: 200, body: result };
    } catch (error) {
      return this.handleError(error);
    }
  }

  private created(body: unknown) {
    return {
      statusCode: 201,
      body,
    };
  }

  private async handleReschedule(appointmentId: string | undefined, requestBody: any) {
    try {
      const payload = rescheduleSchema.parse({ ...requestBody, appointmentId: requestBody?.appointmentId ?? appointmentId });
      const result = await this.service.rescheduleAppointment(payload);
      return { statusCode: 200, body: result };
    } catch (error) {
      return this.handleError(error);
    }
  }

  private async handleCancel(appointmentId: string | undefined, requestBody: any) {
    try {
      const payload = cancelSchema.parse({ ...requestBody, appointmentId: requestBody?.appointmentId ?? appointmentId });
      const result = await this.service.cancelAppointment(payload);
      return { statusCode: 200, body: result };
    } catch (error) {
      return this.handleError(error);
    }
  }

  private handleError(error: unknown) {
    if (error instanceof z.ZodError) {
      return { statusCode: 400, body: { message: "Invalid request", details: error.errors } };
    }

    const message = (error as Error)?.message ?? "Unexpected error";
    const statusCode = message.includes("not found") ? 404 : 400;

    return {
      statusCode,
      body: { message },
    };
  }
}
