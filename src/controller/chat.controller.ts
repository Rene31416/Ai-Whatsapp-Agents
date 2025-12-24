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
import { Logger } from "@aws-lambda-powertools/logger";
import { TenantRepository } from "../services/tenant.repository";
import {
  PersistMessageEnvelope,
  PersistMessageRole,
} from "../types/persist-message";

const sqs = new SQSClient({});

@apiController("/webhook")
export class WhatsappController extends Controller {
  constructor(
    @inject(TenantRepository) private readonly tenantRepo: TenantRepository,
    @inject(Logger) private readonly log: Logger
  ) {
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
    this.log.info("webhook.verify.received", {
      mode,
      hasChallenge: !!challenge,
    });

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
    this.log.info("webhook.receive.incoming", {
      hasEntry: !!body?.entry?.length,
      changeTypes: body?.entry?.[0]?.changes?.map((c: any) => c?.field) ?? [],
    });

    try {
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      if (value?.statuses) {
        this.log.info("webhook.receive.status_event", {
          statusCount: value.statuses.length,
        });
        return { status: "ok", ignored: "status_event" };
      }

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
        return {
          statusCode: 403,
          body: { detail: "Phone number not registered" },
        };
      }

      const nowIso = new Date().toISOString();
      const whatsappMeta = {
        timestamp: msg.timestamp ?? value?.timestamp,
        type: msg.type,
        profileName: value?.contacts?.[0]?.profile?.name,
        phoneNumberId,
      };

      const payload = {
        tenantId: tenant.tenantId,
        userId: from,
        combinedText: text,
        messageCount: 1,
        version: 1,
        flushedAt: nowIso,
        messageId,
        whatsappMeta,
      };

      console.log("📦 FIFO payload preview:", {
        tenantId: payload.tenantId,
        userId: payload.userId,
        messageId: payload.messageId,
        whatsappMeta: payload.whatsappMeta,
      });

      // ✅ Send to FIFO SQS (ChatIngressQueue.fifo)
      const queueUrl = process.env.CHAT_INGRESS_QUEUE_URL!;
      const persistQueueUrl = process.env.CHAT_PERSIST_QUEUE_URL!;
      const serializedPayload = JSON.stringify(payload);
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: serializedPayload,
          MessageGroupId: `${payload.tenantId}#${payload.userId}`,
          MessageDeduplicationId: messageId,
        })
      );

      // 📚 Mirror raw inbound message to the persistence queue (standard SQS)
      const persistPayload: PersistMessageEnvelope = {
        tenantId: tenant.tenantId,
        userId: from,
        role: PersistMessageRole.USER,
        messageBody: text,
        messageId,
        source: "webhook",
        whatsappMeta,
      };

      await sqs.send(
        new SendMessageCommand({
          QueueUrl: persistQueueUrl,
          MessageBody: JSON.stringify(persistPayload),
        })
      );

      console.log(`✅ Sent message ${messageId} for ${from} to SQS`);
      this.log.info("webhook.sqs.sent", {
        tenantId: payload.tenantId,
        userId: payload.userId,
        messageId: payload.messageId,
      });
      return { status: "ok", queued: true };
    } catch (err: any) {
      console.error("❌ Webhook error:", err);
      return { statusCode: 500, body: { detail: "Internal server error" } };
    }
  }
}
