import {
  DynamoDBClient,
  UpdateItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const ddb = new DynamoDBClient({});
const sqs = new SQSClient({});

export const handler = async (event: any) => {
  console.log("📥 Incoming event:", JSON.stringify(event, null, 2));

  for (const [index, record] of event.Records.entries()) {
    console.log(`🧾 Processing record [${index}] →`, record.messageId || "no-id");

    try {
      // Parse and log the incoming message
      const body = JSON.parse(record.body);
      console.log("🧩 Parsed body:", JSON.stringify(body, null, 2));

      // 🔄 Map fields from the webhook payload to expected aggregator fields
      const tenantId = body.tenantId || body.phoneNumberId; // fallback mapping
      const userId = body.userId || body.from; // fallback mapping
      const message = body.message || body.text; // fallback mapping

      console.log("🧭 Normalized fields:", {
        tenantId,
        userId,
        message,
      });

      if (!tenantId || !userId || !message) {
        console.warn("⚠️ Missing fields in record body:", body);
        continue;
      }

      const userKey = `${tenantId}#${userId}`;
      const tableName = process.env.CHAT_BUFFER_TABLE_NAME!;
      const serviceQueueUrl = process.env.CHAT_SERVICE_QUEUE_URL!;
      console.log(`🔑 userKey=${userKey}, table=${tableName}`);

      // 🧠 1️⃣ Append message to user buffer in DynamoDB
      const updateParams = {
        TableName: tableName,
        Key: { UserKey: { S: userKey } },
        UpdateExpression:
          "SET messages = list_append(if_not_exists(messages, :empty), :msg), updatedAt = :now",
        ExpressionAttributeValues: {
          ":msg": { L: [{ S: message }] },
          ":empty": { L: [] },
          ":now": { S: new Date().toISOString() },
        },
      };
      console.log("🪣 Dynamo UpdateItem params:", JSON.stringify(updateParams, null, 2));

      const updateResult = await ddb.send(new UpdateItemCommand(updateParams));
      console.log("✅ Dynamo UpdateItem result:", JSON.stringify(updateResult, null, 2));

      // 🕒 2️⃣ Check if a flush is already scheduled
      const getParams = {
        TableName: tableName,
        Key: { UserKey: { S: userKey } },
        ProjectionExpression: "flushScheduledAt",
      };
      console.log("🔍 Checking flushScheduledAt:", JSON.stringify(getParams, null, 2));

      const ddbResult = await ddb.send(new GetItemCommand(getParams));
      console.log("📦 GetItem result:", JSON.stringify(ddbResult, null, 2));

      const flushScheduledAt = ddbResult.Item?.flushScheduledAt?.S;
      const now = Date.now();

      if (flushScheduledAt) {
        const diff = now - new Date(flushScheduledAt).getTime();
        console.log(`🕰 flushScheduledAt=${flushScheduledAt}, diff=${diff}ms`);
      }

      if (flushScheduledAt && now - new Date(flushScheduledAt).getTime() < 10000) {
        console.log(`⏳ Skip scheduling — flush already pending for ${userKey}`);
        continue;
      }

      // 🕒 3️⃣ Schedule flush after 10 seconds
      const sqsParams = {
        QueueUrl: serviceQueueUrl,
        MessageBody: JSON.stringify({ tenantId, userId }),
        DelaySeconds: 10,
      };
      console.log("📨 Sending flush message to SQS:", JSON.stringify(sqsParams, null, 2));

      const sqsResult = await sqs.send(new SendMessageCommand(sqsParams));
      console.log("✅ SQS send result:", JSON.stringify(sqsResult, null, 2));

      // 🧾 4️⃣ Mark flush scheduled time in Dynamo
      const markParams = {
        TableName: tableName,
        Key: { UserKey: { S: userKey } },
        UpdateExpression: "SET flushScheduledAt = :ts",
        ExpressionAttributeValues: {
          ":ts": { S: new Date().toISOString() },
        },
      };
      console.log("🧾 Marking flushScheduledAt:", JSON.stringify(markParams, null, 2));

      const markResult = await ddb.send(new UpdateItemCommand(markParams));
      console.log("✅ FlushScheduledAt updated:", JSON.stringify(markResult, null, 2));

      console.log(`🕒 Flush scheduled for ${userKey} in 10s ✅`);
    } catch (err: any) {
      console.error("❌ Aggregator error (record failed):", err);
    }
  }

  console.log("🏁 Aggregator finished processing all records");
};
