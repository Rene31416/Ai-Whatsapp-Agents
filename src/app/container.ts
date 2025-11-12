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
import { CalendarPromptService } from "../prompts/calendar.prompt";
import { DentalWorkflow } from "../workflow/main.workflow";
import { CalendarService } from "../services/calendar.service";
import { TenantRepository } from "../services/tenant.repository";
import { AppointmentsRepository } from "../services/appointments.repository";
import { AppointmentsService } from "../services/appointments.service";
import { AppointmentsController } from "../controller/appointments.controller";
// import { DentalWorkflow } from "../chat/dental.workflow";

const container = new Container({ defaultScope: "Singleton" });

// Core services / repos
container.bind(ChatRepository).toSelf();
container.bind(MemoryRepository).toSelf();
container.bind(WhatsappService).toSelf();
container.bind(PostOpsService).toSelf();
container.bind(CalendarService).toSelf();
container.bind(TenantRepository).toSelf();
container.bind(AppointmentsRepository).toSelf();
container.bind(AppointmentsService).toSelf();
container.bind(ChatService).toSelf();

// Controllers / misc
container.bind(WhatsappController).toSelf();
container.bind(AppointmentsController).toSelf();
container.bind(ConsoleLogger).toSelf();
container.bind(ContactFactsExtractorService).toSelf();
container.bind(CalendarPromptService).toSelf();
container.bind(DentalWorkflow).toSelf()

// container.bind(DentalWorkflow).toSelf(); // still constructed manually in ChatService

// Shared Logger instance
const logger = new Logger({
  serviceName: process.env.SERVICE_NAME ?? "chat-lambda",
  logLevel: "INFO",
});

container.bind(Logger).toConstantValue(logger);

export { container };
