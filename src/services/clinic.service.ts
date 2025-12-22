import { inject, injectable } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";
import { TenantRepository } from "./tenant.repository";
import { DoctorsRepository } from "./doctors.repository";

export type ClinicProfile = {
  tenantName?: string;
  address?: string;
  availability?: string;
  whatsappPhones: string[];
};

export type DoctorSummary = {
  doctorId: string;
  name: string;
  availabilityHours?: string;
};

@injectable()
export class ClinicService {
  constructor(
    @inject(TenantRepository) private readonly tenantRepository: TenantRepository,
    @inject(DoctorsRepository) private readonly doctorsRepository: DoctorsRepository,
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

  async getDoctorsByTenant(tenantId: string): Promise<DoctorSummary[]> {
    const doctors = await this.doctorsRepository.listByTenant(tenantId);
    this.log.info("clinic.service.doctors.list", { tenantId, count: doctors.length });

    return doctors.map((doctor) => ({
      doctorId: doctor.doctorId,
      name: doctor.displayName,
      availabilityHours: doctor.availabilityHours,
    }));
  }
}
