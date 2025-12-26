import { Container } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";

import { AppointmentsController } from "../../controller/appointments.controller";
import { ClinicController } from "../../controller/clinic.controller";
import { AppointmentsService } from "../../services/appointments.service";
import { ClinicService } from "../../services/clinic.service";
import { AppointmentsRepository } from "../../services/appointments.repository";
import { TenantRepository } from "../../services/tenant.repository";
import { DoctorsRepository } from "../../services/doctors.repository";

const clinicContainer: Container = new Container();

clinicContainer.bind(AppointmentsController).toSelf();
clinicContainer.bind(ClinicController).toSelf();
clinicContainer.bind(AppointmentsService).toSelf();
clinicContainer.bind(ClinicService).toSelf();
clinicContainer.bind(AppointmentsRepository).toSelf();
clinicContainer.bind(TenantRepository).toSelf();
clinicContainer.bind(DoctorsRepository).toSelf();
clinicContainer
  .bind(Logger)
  .toConstantValue(
    new Logger({ serviceName: process.env.SERVICE_NAME ?? "clinic-lambda" })
  );

export { clinicContainer };
