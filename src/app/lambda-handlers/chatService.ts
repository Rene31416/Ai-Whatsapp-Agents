import "reflect-metadata";
import { SQSEvent, SQSRecord } from "aws-lambda";
import { container } from "../container";
import { ChatService } from "../../chat/chat.service";

// 🧩 Resolve ChatService instance from Inversify container
const chatService = container.get(ChatService);

// ✅ AWS Lambda entrypoint
export const handler = async (event: SQSEvent): Promise<void> => {
  console.log("📥 ChatService Lambda triggered:", JSON.stringify(event, null, 2));

  for (const [index, record] of event.Records.entries()) {
    console.log(`💡 Processing SQS record [${index}]`);

    try {
      // 🔍 Debug: log raw message body for clarity
      console.log("📦 Raw SQS record body:", record.body);

      // ✅ Parse the SQS message body
      const parsedBody = JSON.parse(record.body);
      const { tenantId, userId, combinedText } = parsedBody;

      if (!tenantId || !userId || !combinedText) {
        console.warn("⚠️ Missing required fields in record:", parsedBody);
        continue;
      }


      // ✅ Pass reconstructed messages to ChatService for workflow processing
      await chatService.handleRecord({
        ...record,
        body: JSON.stringify({
          tenantId,
          userId,
          messages:combinedText,
        }),
      } as SQSRecord);
    } catch (err) {
      console.error("❌ Error handling SQS record:", err);
      throw err; // Let SQS retry automatically
    }
  }

  console.log("🏁 ChatService Lambda completed all records");
};
