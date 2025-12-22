import { Controller, GET, apiController, queryParam } from "ts-lambda-api";
import { inject } from "inversify";
import { z } from "zod";
import { Logger } from "@aws-lambda-powertools/logger";
import { ClinicService } from "../services/clinic.service";

const querySchema = z
  .object({
    phoneNumberIndexId: z.string().min(1).optional(),
    phoneNumberId: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.phoneNumberIndexId || data.phoneNumberId), {
    message: "Provide phoneNumberIndexId query param",
    path: ["phoneNumberIndexId"],
  });

const doctorsQuerySchema = z.object({
  tenantId: z.string().min(1, "Provide tenantId query param"),
});

@apiController("/clinic")
export class ClinicController extends Controller {
  constructor(
    @inject(ClinicService) private readonly clinicService: ClinicService,
    @inject(Logger) private readonly log: Logger
  ) {
    super();
  }

  @GET("/")
  async getClinic(
    @queryParam("phoneNumberIndexId") phoneNumberIndexId?: string,
    @queryParam("phoneNumberId") phoneNumberId?: string
  ) {
    try {
      const payload = querySchema.parse({ phoneNumberIndexId, phoneNumberId });
      const lookupId = payload.phoneNumberIndexId ?? payload.phoneNumberId!;
      const clinic = await this.clinicService.getClinicByPhoneNumberIndexId(lookupId);

      return { statusCode: 200, body: clinic };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { statusCode: 400, body: { message: "Invalid request", details: error.issues } };
      }

      const message = (error as Error)?.message ?? "Unexpected error";
      const statusCode = message === "Clinic not found" ? 404 : 500;
      this.log.warn("clinic.controller.error", {
        message,
        route: "/clinic",
      });

      return { statusCode, body: { message } };
    }
  }

  @GET("/doctors")
  async getDoctors(@queryParam("tenantId") tenantId?: string) {
    try {
      const { tenantId: parsedTenantId } = doctorsQuerySchema.parse({ tenantId });
      const doctors = await this.clinicService.getDoctorsByTenant(parsedTenantId);

      return { statusCode: 200, body: doctors };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { statusCode: 400, body: { message: "Invalid request", details: error.issues } };
      }

      const message = (error as Error)?.message ?? "Unexpected error";
      this.log.warn("clinic.controller.error", {
        message,
        route: "/clinic/doctors",
      });

      return { statusCode: 500, body: { message } };
    }
  }
}
