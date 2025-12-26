import { Container } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";

import { WhatsappService } from "../../services/whatsapp.service";

const deliverMessagesContainer: Container = new Container();

deliverMessagesContainer.bind(WhatsappService).toSelf();
deliverMessagesContainer
  .bind(Logger)
  .toConstantValue(
    new Logger({ serviceName: process.env.SERVICE_NAME ?? "deliver-messages" })
  );

export { deliverMessagesContainer };
