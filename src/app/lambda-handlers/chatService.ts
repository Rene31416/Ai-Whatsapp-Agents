import "reflect-metadata";
import { SQSEvent } from "aws-lambda";
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
      await chatService.handleRecord(record);
    } catch (err) {
      console.error("❌ Error handling SQS record:", err);
      throw err; // let SQS retry
    }
  }

  console.log("🏁 ChatService Lambda completed all records");
};
