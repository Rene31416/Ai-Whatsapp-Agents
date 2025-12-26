import { Container } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";

import { ChatRepository } from "../../chat/chat.repository";

const persistMessagesContainer: Container = new Container();

persistMessagesContainer.bind(ChatRepository).toSelf();
persistMessagesContainer
  .bind(Logger)
  .toConstantValue(
    new Logger({ serviceName: process.env.SERVICE_NAME ?? "persist-messages" })
  );

export { persistMessagesContainer };
