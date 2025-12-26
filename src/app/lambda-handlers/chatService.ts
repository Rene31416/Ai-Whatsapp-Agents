// src/lambda/handlers/chat.handler.ts
import "reflect-metadata";
import { SQSEvent } from "aws-lambda";
import { chatServiceContainer } from "../containers/chat-service.container";
import { Logger } from "@aws-lambda-powertools/logger";
import { ChatService } from "../../services/chat.service";

// 🧩 Resolve dependencies
const chatService = chatServiceContainer.get(ChatService);
const logger = chatServiceContainer.get(Logger);

// ✅ AWS Lambda entrypoint
export const handler = async (event: SQSEvent): Promise<void> => {
  console.log("[ChatService Lambda] Batch received", {
    recordCount: event.Records.length,
    firstMessageId: event.Records[0]?.messageId,
  });
  logger.info("📥 ChatService Lambda triggered", { recordCount: event.Records.length });

  for (const [index, record] of event.Records.entries()) {
    logger.info("💡 Processing SQS record", { index, messageId: record.messageId });

    try {
      // ✅ Call service as before
      await chatService.handleRecord(record);
    } catch (err) {
      logger.error("❌ Error handling SQS record", { index, err });
      throw err; // Let SQS retry automatically
    }
  }

  logger.info("🏁 ChatService Lambda completed all records");
};
