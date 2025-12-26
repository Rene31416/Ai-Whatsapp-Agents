import { Container } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";

import { ChatService } from "../../services/chat.service";
import { ChatRepository } from "../../chat/chat.repository";
import { MemoryRepository } from "../../chat/memory.repository";
import { WhatsappService } from "../../services/whatsapp.service";
import { PostOpsService } from "../../services/post.ops.service";
import { ContactFactsExtractorService } from "../../prompts/facts.prompt";
import { CalendarPromptService } from "../../prompts/calendar.prompt";
import { DentalWorkflow } from "../../workflow/main.workflow";
import { DoctorsRepository } from "../../services/doctors.repository";

const chatServiceContainer: Container = new Container();

chatServiceContainer.bind(ChatService).toSelf();
chatServiceContainer.bind(ChatRepository).toSelf();
chatServiceContainer.bind(MemoryRepository).toSelf();
chatServiceContainer.bind(WhatsappService).toSelf();
chatServiceContainer.bind(PostOpsService).toSelf();
chatServiceContainer.bind(ContactFactsExtractorService).toSelf();
chatServiceContainer.bind(CalendarPromptService).toSelf();
chatServiceContainer.bind(DentalWorkflow).toSelf();
chatServiceContainer.bind(DoctorsRepository).toSelf();
chatServiceContainer
  .bind(Logger)
  .toConstantValue(
    new Logger({ serviceName: process.env.SERVICE_NAME ?? "chat-service" })
  );

export { chatServiceContainer };
