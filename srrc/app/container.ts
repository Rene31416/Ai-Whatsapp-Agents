// import "reflect-metadata";
import { Container } from "inversify";
import { ChatService } from "../services/chat.service";
// import { DentalWorkflow } from "../chat/dental.workflow";
import { WhatsappController } from "../controller/chat.controller";
import { ConsoleLogger } from "../observability/logger";
import { ChatRepository } from "../chat/chat.repository";
import { MemoryRepository } from "../chat/memory.repository";
import { Logger } from "@aws-lambda-powertools/logger";
import { WhatsappService } from "../services/whatsapp.service";

const container = new Container({ defaultScope: "Singleton" });

// container.bind(ChatService).toSelf();
// container.bind(DentalWorkflow).toSelf();
container.bind(WhatsappController).toSelf();
container.bind(ConsoleLogger).toSelf();
container.bind(ChatRepository).toSelf();
container.bind(MemoryRepository).toSelf();
container.bind(ChatService).toSelf();
container.bind(WhatsappService).toSelf()
// container.bind(ChatRepository).toSelf()
// container.bind(MemoryRepository).toSelf()

// Create a single logger instance
const logger = new Logger({
  serviceName: process.env.SERVICE_NAME ?? "chat-lambda",
  logLevel: "INFO",
});

// Bind the logger directly — no wrapper class needed
container.bind(Logger).toConstantValue(logger);

export { container };
