import { inject, injectable } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";
import { TenantRepository } from "./tenant.repository";

export type ClinicProfile = {
  tenantName?: string;
  address?: string;
  availability?: string;
  whatsappPhones: string[];
};

@injectable()
export class ClinicService {
  constructor(
    @inject(TenantRepository) private readonly tenantRepository: TenantRepository,
    @inject(Logger) private readonly log: Logger
  ) {}

  async getClinicByPhoneNumberIndexId(phoneNumberIndexId: string): Promise<ClinicProfile> {
    const clinic = await this.tenantRepository.getByPhoneNumberId(phoneNumberIndexId);
    if (!clinic) {
      this.log.warn("clinic.service.notFound", { reason: "unknown_phone" });
      throw new Error("Clinic not found");
    }

    return {
      tenantName: clinic.tenantName,
      address: clinic.address,
      availability: clinic.availability,
      whatsappPhones: clinic.whatsappPhones ?? [],
    };
  }
}

