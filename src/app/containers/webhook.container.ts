import { Container } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";

import { WhatsappController } from "../../controller/chat.controller";
import { TenantRepository } from "../../services/tenant.repository";

const webhookContainer: Container = new Container();

webhookContainer.bind(WhatsappController).toSelf();
webhookContainer.bind(TenantRepository).toSelf();
webhookContainer
  .bind(Logger)
  .toConstantValue(
    new Logger({ serviceName: process.env.SERVICE_NAME ?? "webhook-lambda" })
  );

export { webhookContainer };
