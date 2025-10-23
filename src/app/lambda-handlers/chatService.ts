// src/lambda/handlers/chat.handler.ts
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
      const { tenantId, userId, combinedText, messageCount } = parsedBody;

      if (!tenantId || !userId || typeof combinedText !== "string" || !combinedText.length) {
        console.warn("⚠️ Missing required fields in record:", parsedBody);
        continue;
      }

      // (Opcional) sanity log del conteo de líneas vs messageCount
      const splitCount = combinedText.split(/\r?\n/).filter(Boolean).length;
      if (typeof messageCount === "number" && messageCount !== splitCount) {
        console.warn("⚠️ messageCount mismatch", { messageCount, splitCount });
      }

      // ✅ Pasar el payload **tal cual**, conservando combinedText con saltos de línea
      const passThrough: SQSRecord = {
        ...record,
        body: JSON.stringify({
          tenantId,
          userId,
          combinedText,      // ← mantenerlo intacto; NO enviar "messages"
          messageCount,      // ← opcional, útil para auditoría
        }),
      } as SQSRecord;

      await chatService.handleRecord(passThrough);
    } catch (err) {
      console.error("❌ Error handling SQS record:", err);
      throw err; // Let SQS retry automatically
    }
  }

  console.log("🏁 ChatService Lambda completed all records");
};
