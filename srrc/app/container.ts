// src/lambda/container.ts (or wherever this lives)

// import "reflect-metadata";
import { Container } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";

import { ChatService } from "../services/chat.service";
import { WhatsappController } from "../controller/chat.controller";
import { ConsoleLogger } from "../observability/logger";
import { ChatRepository } from "../chat/chat.repository";
import { MemoryRepository } from "../chat/memory.repository";
import { WhatsappService } from "../services/whatsapp.service";
import { PostOpsService } from "../services/post.ops.service";
import { ContactFactsExtractorService } from "../prompts/facts.prompt";
// import { DentalWorkflow } from "../chat/dental.workflow";

const container = new Container({ defaultScope: "Singleton" });

// Core services / repos
container.bind(ChatRepository).toSelf();
container.bind(MemoryRepository).toSelf();
container.bind(WhatsappService).toSelf();
container.bind(PostOpsService).toSelf();
container.bind(ChatService).toSelf();

// Controllers / misc
container.bind(WhatsappController).toSelf();
container.bind(ConsoleLogger).toSelf();
container.bind(ContactFactsExtractorService).toSelf()
// container.bind(DentalWorkflow).toSelf(); // still constructed manually in ChatService

// Shared Logger instance
const logger = new Logger({
  serviceName: process.env.SERVICE_NAME ?? "chat-lambda",
  logLevel: "INFO",
});

container.bind(Logger).toConstantValue(logger);

export { container };
