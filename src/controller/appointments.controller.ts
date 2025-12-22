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
import { Logger } from "@aws-lambda-powertools/logger";
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
  .refine((data) => Boolean(data.endIso || data.durationMinutes), {
    message: "Provide endIso or durationMinutes",
    path: ["endIso"],
  });

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
    (data) =>
      Boolean(
        data.appointmentId || (data.userId && data.doctorId && data.startIso)
      ),
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
    (data) =>
      Boolean(
        data.appointmentId || (data.userId && data.doctorId && data.startIso)
      ),
    {
      message: "Provide appointmentId or (userId, doctorId, startIso)",
      path: ["appointmentId"],
    }
  );

const availabilitySchema = z
  .object({
    tenantId: z.string().min(1),
    doctorId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    fromIso: z.string().min(1),
    toIso: z.string().min(1),
  })
  .refine(
    (data) => {
      if (!data.doctorId && !data.userId) {
        return false;
      }
      const from = new Date(data.fromIso).getTime();
      const to = new Date(data.toIso).getTime();
      return !Number.isNaN(from) && !Number.isNaN(to) && from < to;
    },
    {
      message: "Provide doctorId or userId plus valid from/to ISO timestamps where from < to",
      path: ["doctorId"],
    }
  );

@apiController("/appointments")
export class AppointmentsController extends Controller {
  constructor(
    @inject(AppointmentsService) private readonly service: AppointmentsService,
    @inject(Logger) private readonly log: Logger
  ) {
    super();
  }

  @POST("/")
  async create(@body requestBody: any) {
    console.log("[AppointmentsController] POST /appointments", {
      bodyKeys: Object.keys(requestBody ?? {}),
    });

    try {
      const payload = createSchema.parse(requestBody);
      this.log.info("appointments.api.create.received", {
        tenantId: payload.tenantId,
        doctorId: payload.doctorId,
        userId: payload.userId,
      });
      const result = await this.service.createAppointment(payload);
      return this.created(result);
    } catch (error) {
      return this.handleError(error, "create");
    }
  }

  @PATCH("/")
  async rescheduleWithoutId(@body requestBody: any) {
    console.log("[AppointmentsController] PATCH /appointments (no id)", {
      bodyKeys: Object.keys(requestBody ?? {}),
    });

    return this.handleReschedule(undefined, requestBody);
  }

  @PATCH("/:appointmentId")
  async rescheduleWithId(
    @pathParam("appointmentId") appointmentId: string,
    @body requestBody: any
  ) {
    console.log(
      "[AppointmentsController] PATCH /appointments/{appointmentId}",
      {
        appointmentId,
        bodyKeys: Object.keys(requestBody ?? {}),
      }
    );

    return this.handleReschedule(appointmentId, requestBody);
  }

  @DELETE("/")
  async cancelWithoutId(@body requestBody: any) {
    console.log("[AppointmentsController] DELETE /appointments (no id)", {
      bodyKeys: Object.keys(requestBody ?? {}),
    });

    return this.handleCancel(undefined, requestBody);
  }

  @DELETE("/:appointmentId")
  async cancelWithId(
    @pathParam("appointmentId") appointmentId: string,
    @body requestBody: any
  ) {
    console.log(
      "[AppointmentsController] DELETE /appointments/{appointmentId}",
      {
        appointmentId,
        bodyKeys: Object.keys(requestBody ?? {}),
      }
    );

    return this.handleCancel(appointmentId, requestBody);
  }

  @GET("/availability")
  async availability(
    @queryParam("tenantId") tenantId: string,
    @queryParam("doctorId") doctorId: string,
    @queryParam("userId") userId: string,
    @queryParam("from") from: string,
    @queryParam("to") to: string
  ) {
    console.log("[AppointmentsController] GET /appointments/availability", {
      tenantId,
      doctorId,
      userId,
      from,
      to,
    });

    try {
      const payload = availabilitySchema.parse({
        tenantId,
        doctorId,
        userId,
        fromIso: from,
        toIso: to,
      });
      const result = await this.service.getAvailability(payload);
      return { statusCode: 200, body: result };
    } catch (error) {
      return this.handleError(error, "availability");
    }
  }

  private created(body: unknown) {
    return {
      statusCode: 201,
      body,
    };
  }

  private async handleReschedule(
    appointmentId: string | undefined,
    requestBody: any
  ) {
    try {
      const payload = rescheduleSchema.parse({
        ...requestBody,
        appointmentId: requestBody?.appointmentId ?? appointmentId,
      });
      this.log.info("appointments.api.reschedule.received", {
        tenantId: payload.tenantId,
        appointmentId: payload.appointmentId,
        doctorId: payload.doctorId ?? payload.newDoctorId,
        userId: payload.userId,
      });
      const result = await this.service.rescheduleAppointment(payload);
      return { statusCode: 200, body: result };
    } catch (error) {
      return this.handleError(
        error,
        appointmentId ? "reschedule.withId" : "reschedule.noId"
      );
    }
  }

  private async handleCancel(
    appointmentId: string | undefined,
    requestBody: any
  ) {
    try {
      const payload = cancelSchema.parse({
        ...requestBody,
        appointmentId: requestBody?.appointmentId ?? appointmentId,
      });
      this.log.info("appointments.api.cancel.received", {
        tenantId: payload.tenantId,
        appointmentId: payload.appointmentId,
        doctorId: payload.doctorId,
        userId: payload.userId,
      });
      const result = await this.service.cancelAppointment(payload);
      return { statusCode: 200, body: result };
    } catch (error) {
      return this.handleError(
        error,
        appointmentId ? "cancel.withId" : "cancel.noId"
      );
    }
  }

  private handleError(error: unknown, route?: string) {
    if (error instanceof z.ZodError) {
      return {
        statusCode: 400,
        body: { message: "Invalid request", details: error.issues },
      };
    }

    const message = (error as Error)?.message ?? "Unexpected error";
    const statusCode = message.includes("not found") ? 404 : 400;
    this.log.warn("appointments.api.error", {
      route: route ?? "unknown",
      message,
    });

    return {
      statusCode,
      body: { message },
    };
  }
}
