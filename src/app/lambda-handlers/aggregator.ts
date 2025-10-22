import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const ddb = new DynamoDBClient({});
const sqs = new SQSClient({});

export const handler = async (event: any) => {
  console.log("📥 Incoming event:", JSON.stringify(event, null, 2));

  const tableName = process.env.CHAT_BUFFER_TABLE_NAME!;
  const flushTicketQueueUrl = process.env.FLUSH_TICKET_QUEUE_URL!;
  const debounceSeconds = parseInt(process.env.DEBOUNCE_SECONDS ?? "8", 10);

  for (const [index, record] of event.Records.entries()) {
    console.log(`🧾 Processing record [${index}] →`, record.messageId || "no-id");

    try {
      const body = JSON.parse(record.body);
      const tenantId = body.tenantId || body.phoneNumberId;
      const userId = body.userId || body.from;
      const message = body.message || body.text;

      if (!tenantId || !userId || !message) {
        console.warn("⚠️ Missing fields:", body);
        continue;
      }

      const userKey = `${tenantId}#${userId}`;

      // Ventana deslizante: nueva fecha objetivo
      const nowMs = Date.now();
      const flushAtMs = nowMs + debounceSeconds * 1000;

      // TTL opcional como red de seguridad (no dependemos de él)
      const ttlSeconds = Math.floor(flushAtMs / 1000) + 120;

      // 1) Append + reinicia ventana + incrementa versión (atomically)
      const res = await ddb.send(
        new UpdateItemCommand({
          TableName: tableName,
          Key: { UserKey: { S: userKey } },
          UpdateExpression:
            "SET messages = list_append(if_not_exists(messages, :empty), :msg), " +
            "updatedAt = :now, " +
            "#ttl = :ttl, " +
            "flushAt = :flushAt, " +
            "version = if_not_exists(version, :zero) + :one",
          ExpressionAttributeNames: {
            "#ttl": "ttl",
          },
          ExpressionAttributeValues: {
            ":msg": { L: [{ S: message }] },
            ":empty": { L: [] },
            ":now": { S: new Date(nowMs).toISOString() },
            ":ttl": { N: ttlSeconds.toString() },
            ":flushAt": { N: flushAtMs.toString() },
            ":zero": { N: "0" },
            ":one": { N: "1" },
          },
          ReturnValues: "ALL_NEW",
        })
      );

      const newVersion = parseInt((res.Attributes?.version as any)?.N ?? "0", 10);
      const storedFlushAt = parseInt((res.Attributes?.flushAt as any)?.N ?? flushAtMs.toString(), 10);

      console.log(
        `🧺 Buffered message for ${userKey} · version=${newVersion} · flushAt=${storedFlushAt} · window=${debounceSeconds}s`
      );

      // 2) Publica ticket con versión actual (invalidará tickets viejos)
      const ticket = { tenantId, userId, userKey, version: newVersion };
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: flushTicketQueueUrl,
          DelaySeconds: debounceSeconds, // ventana
          MessageBody: JSON.stringify(ticket),
        })
      );

      console.log(`🎟️ Posted flush ticket for ${userKey} (v${newVersion}) visible in ~${debounceSeconds}s`);
    } catch (err: any) {
      console.error("❌ Aggregator error:", err);
    }
  }

  console.log("🏁 Aggregator finished processing all records");
};
