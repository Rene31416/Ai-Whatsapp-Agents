import {
  Controller,
  POST,
  GET,
  apiController,
  body,
  queryParam,
} from "ts-lambda-api";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({});

@apiController("/webhook")
export class WhatsappController extends Controller {
  // 🔐 GET /webhook — Meta verification using Secrets Manager
  @GET("/")
  async verifyWebhook(
    @queryParam("hub.mode") mode: string,
    @queryParam("hub.verify_token") token: string,
    @queryParam("hub.challenge") challenge: string
  ) {
    console.log("🔍 Incoming webhook query:", { mode, token, challenge });

    // 🧩 Temporary hardcoded token for testing
    const VERIFY_TOKEN = "test-handshake-token";

    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      console.log("✅ Webhook verified successfully");
      return parseInt(challenge, 10); // Meta expects the raw number
    }

    console.warn("❌ Invalid token or bad request", { mode, token, challenge });
    return { statusCode: 403, body: { detail: "Forbidden" } };
  }

  // 📬 POST /webhook — minimal validation + enqueue to SQS
  @POST("/")
  async receiveWebhook(@body body: any) {
    console.log("📩 Incoming webhook body:", JSON.stringify(body, null, 2));

    try {
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // Ignore non-message callbacks (e.g., delivery/status updates)
      if (value?.statuses) return { status: "ok", ignored: "status_event" };

      const phoneNumberId: string | undefined =
        value?.metadata?.phone_number_id;
      if (!phoneNumberId)
        return { status: "ok", ignored: "missing_phone_number_id" };

      const msg = value?.messages?.[0];
      if (!msg) return { status: "ok", ignored: "no_messages" };
      if (msg.type !== "text")
        return { status: "ok", ignored: `non_text:${msg.type}` };

      const from: string | undefined = msg.from;
      const messageId: string | undefined = msg.id;
      const text: string | undefined = msg.text?.body?.trim();

      if (!from) return { status: "ok", ignored: "missing_from" };
      if (!messageId) return { status: "ok", ignored: "missing_message_id" };
      if (!text) return { status: "ok", ignored: "empty_text" };

      const payload = {
        phoneNumberId,
        from, // WhatsApp user ID (phone)
        text, // message text
        messageId, // used for deduplication
        timestamp: Date.now(),
      };

      await sqs.send(
        new SendMessageCommand({
          QueueUrl: process.env.CHAT_BUFFER_QUEUE_URL!,
          MessageBody: JSON.stringify(payload),
        })
      );

      console.log(`✅ Enqueued message ${messageId} for ${from}`);
      return { status: "ok", enqueued: true };
    } catch (err: any) {
      console.error("❌ Webhook error:", err);
      return { statusCode: 500, body: { detail: "Internal server error" } };
    }
  }
}
