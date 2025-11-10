// NOTE: Legacy flush handler. Left for reference but disabled in FIFO mode.
import {
  DynamoDBClient,
  GetItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";


const ddb = new DynamoDBClient({});
const sqs = new SQSClient({});

export const handler = async (event: any) => {
  console.log("🚀 [Flush Lambda] Triggered with event:", JSON.stringify(event, null, 2));

  const tableName = process.env.CHAT_BUFFER_TABLE_NAME!;
  const flushOutputQueueUrl = process.env.FLUSH_OUTPUT_QUEUE_URL!;

  const records = event?.Records || [];
  if (records.length === 0) {
    console.log("⚠️ [Flush Lambda] No SQS records, exiting.");
    return;
  }

  for (const [idx, record] of records.entries()) {
    console.log(`🧾 [Flush Lambda] Processing SQS record #${idx}`);

    try {
      const body = JSON.parse(record.body || "{}");
      const tenantId = body.tenantId || body.phoneNumberId;
      const userId = body.userId || body.from;
      const userKey: string = body.userKey || (tenantId && userId ? `${tenantId}#${userId}` : "");
      const ticketVersion: number | undefined = body.version;

      if (!userKey || typeof ticketVersion !== "number") {
        console.warn("⚠️ Missing userKey/version in ticket body:", body);
        continue;
      }

      console.log(`🔑 userKey=${userKey} · ticketVersion=${ticketVersion}`);

      // 1) Lee item actual (mensajes + control)
      const getRes = await ddb.send(
        new GetItemCommand({
          TableName: tableName,
          Key: { UserKey: { S: userKey } },
          ProjectionExpression: "messages, version, flushAt",
        })
      );

      if (!getRes.Item) {
        console.log(`ℹ️ No item in buffer for ${userKey} (already flushed or never created). Skip.`);
        continue;
      }

      const itemVersion = parseInt((getRes.Item.version as any)?.N ?? "0", 10);
      const flushAtMs = parseInt((getRes.Item.flushAt as any)?.N ?? "0", 10);
      const messagesAttr = getRes.Item.messages as any;
      const messages: string[] =
        messagesAttr && messagesAttr.L ? messagesAttr.L.map((m: any) => m.S as string) : [];

      // 2) Validaciones de debounce deslizante
      if (itemVersion !== ticketVersion) {
        console.log(
          `⏭️ Stale ticket: ticketVersion=${ticketVersion} != itemVersion=${itemVersion}. Ignoring.`
        );
        continue;
      }

      const nowMs = Date.now();
      if (nowMs < flushAtMs) {
        console.log(
          `⏳ Early ticket: now=${nowMs} < flushAt=${flushAtMs}. Window extended by newer message. Ignoring.`
        );
        continue;
      }

      if (!messages.length) {
        console.log(`🪣 No messages to flush for ${userKey}. Skipping.`);
        continue;
      }

      console.log(`💬 Retrieved ${messages.length} buffered messages for ${userKey}`);
      console.log("🔍 Preview:", messages.slice(0, 5));

      // 3) Emit a Output Queue
      const [tenantFromKey, userFromKey] = userKey.split("#");
      const payload = {
        tenantId: tenantId ?? tenantFromKey,
        userId: userId ?? userFromKey,
        combinedText: messages.join("\n"),
        messageCount: messages.length,
        version: itemVersion,
        flushedAt: new Date(nowMs).toISOString(),
      };

      console.log("📤 Sending combined payload to FlushOutputQueue...");
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: flushOutputQueueUrl,
          MessageBody: JSON.stringify(payload),
        })
      );
      console.log("✅ Downstream emit OK");

      // 4) Limpia el buffer (no dependemos de TTL)
      await ddb.send(
        new DeleteItemCommand({
          TableName: tableName,
          Key: { UserKey: { S: userKey } },
        })
      );
      console.log(`🧼 Buffer item deleted for ${userKey}`);
    } catch (err: any) {
      console.error("❌ [Flush Lambda] Unhandled error:", {
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
      });
      // Deja que el retry de SQS/Lambda maneje transitorios
    }
  }

  console.log("🏁 [Flush Lambda] Finished processing all SQS tickets.");
};
