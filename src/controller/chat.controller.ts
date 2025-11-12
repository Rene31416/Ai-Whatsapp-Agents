import {
  Controller,
  POST,
  GET,
  apiController,
  body,
  queryParam,
} from "ts-lambda-api";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { inject } from "inversify";
import { TenantRepository } from "../services/tenant.repository";

const sqs = new SQSClient({});

@apiController("/webhook")
export class WhatsappController extends Controller {
  constructor(@inject(TenantRepository) private readonly tenantRepo: TenantRepository) {
    super();
  }

  // 🔐 GET /webhook — Meta verification using Secrets Manager
  @GET("/")
  async verifyWebhook(
    @queryParam("hub.mode") mode: string,
    @queryParam("hub.verify_token") token: string,
    @queryParam("hub.challenge") challenge: string
  ) {
    console.log("🔍 Incoming webhook query:", { mode, token, challenge });

    const VERIFY_TOKEN = "test-handshake-token";

    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      console.log("✅ Webhook verified successfully");
      return parseInt(challenge, 10);
    }

    console.warn("❌ Invalid token or bad request", { mode, token, challenge });
    return { statusCode: 403, body: { detail: "Forbidden" } };
  }

  // 📬 POST /webhook — minimal validation + send message to SQS buffer
  @POST("/")
  async receiveWebhook(@body body: any) {
    console.log("📩 Incoming webhook body:", JSON.stringify(body, null, 2));

    try {
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      if (value?.statuses) return { status: "ok", ignored: "status_event" };

      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId)
        return { status: "ok", ignored: "missing_phone_number_id" };

      const msg = value?.messages?.[0];
      if (!msg) return { status: "ok", ignored: "no_messages" };
      if (msg.type !== "text")
        return { status: "ok", ignored: `non_text:${msg.type}` };

      const from = msg.from;
      const messageId = msg.id;
      const text = msg.text?.body?.trim();

      if (!from) return { status: "ok", ignored: "missing_from" };
      if (!messageId) return { status: "ok", ignored: "missing_message_id" };
      if (!text) return { status: "ok", ignored: "empty_text" };

      const tenant = await this.tenantRepo.getByPhoneNumberId(phoneNumberId);
      if (!tenant) {
        console.warn("❌ Unknown phone number", { phoneNumberId });
        return { statusCode: 403, body: { detail: "Phone number not registered" } };
      }

      const nowIso = new Date().toISOString();
      const payload = {
        tenantId: tenant.tenantId,
        userId: from,
        combinedText: text,
        messageCount: 1,
        version: 1,
        flushedAt: nowIso,
        messageId,
        whatsappMeta: {
          timestamp: msg.timestamp ?? value?.timestamp,
          type: msg.type,
          profileName: value?.contacts?.[0]?.profile?.name,
          phoneNumberId,
        },
      };

      // Log payload preview for future metadata tweaks
      console.log("📦 FIFO payload preview:", {
        tenantId: payload.tenantId,
        userId: payload.userId,
        messageId: payload.messageId,
        whatsappMeta: payload.whatsappMeta,
      });

      // ✅ Send to FIFO SQS (ChatIngressQueue.fifo)
      const queueUrl = process.env.CHAT_INGRESS_QUEUE_URL!;
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(payload),
          MessageGroupId: `${payload.tenantId}#${payload.userId}`,
          MessageDeduplicationId: messageId,
        })
      );

      console.log(`✅ Sent message ${messageId} for ${from} to SQS`);
      return { status: "ok", queued: true };
    } catch (err: any) {
      console.error("❌ Webhook error:", err);
      return { statusCode: 500, body: { detail: "Internal server error" } };
    }
  }
}
