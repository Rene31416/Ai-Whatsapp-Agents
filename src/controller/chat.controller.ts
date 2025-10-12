import {
  Controller,
  POST,
  GET,
  apiController,
  body,
  queryParam,
} from "ts-lambda-api";
import { inject } from "inversify";
import { ChatService } from "../chat/chat.service";
import { getWhatsappSecrets, sendWhatsappText } from "../chat/models";
import { ChatRepository } from "../chat/chat.repository";
import { TenantRepository } from "../chat/tenant.repository";

@apiController("/webhook")
export class WhatsappController extends Controller {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(ChatRepository)
    private readonly chatRepository: ChatRepository,
    @inject(TenantRepository)
    private readonly tenantRepository: TenantRepository
  ) {
    super();
  }

  // ✅ Verify webhook (GET /webhook)
  @GET("/")
  async verifyWebhook(
    @queryParam("hub.mode") mode: string,
    @queryParam("hub.verify_token") token: string,
    @queryParam("hub.challenge") challenge: string
  ) {
    const { VERIFY_TOKEN } = await getWhatsappSecrets();

    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return parseInt(challenge);
    }

    return {
      statusCode: 403,
      body: { detail: "Forbidden" },
    };
  }

  // ✅ Handle incoming WhatsApp messages (POST /webhook)
  @POST("/")
  async receiveWebhook(@body body: any) {
    console.log("📩 Incoming webhook body:", JSON.stringify(body, null, 2));

    try {
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // Ignore status updates
      if (value?.statuses) return { status: "ok", ignored: "status_event" };

      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId)
        return { status: "ok", ignored: "missing_phone_number_id" };

      // 🔍 Get tenant info dynamically
      const tenant = await this.tenantRepository.getTenantByPhoneNumberId(
        phoneNumberId
      );
      const tenantId = tenant.tenantId;

      const messages = value?.messages ?? [];
      if (!messages.length) return { status: "ok", ignored: "no_messages" };

      const msg = messages[0];
      if (msg.type !== "text")
        return { status: "ok", ignored: `non_text:${msg.type}` };

      const waFrom = msg.from;
      const messageText = msg.text?.body?.trim() ?? "";
      if (!messageText) return { status: "ok", ignored: "empty_text" };
      // Fetch previous chat memory (optional for now)
      const history = await this.chatRepository.getRecentHistory(
        tenantId,
        waFrom,
        10
      );
      history.push({ role: "human", message: messageText });
      const result = await this.chatService.run(messageText, history);
      const reply = result.final_answer || "¿Podrías aclararme tu consulta? 😊";

      // Retrieve tenant secrets dynamically (if per-tenant)
      const { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID } =
        await getWhatsappSecrets(phoneNumberId);

      const sendResult = await sendWhatsappText(
        waFrom,
        reply,
        WHATSAPP_ACCESS_TOKEN,
        WHATSAPP_PHONE_NUMBER_ID
      );

      console.log(`💬 [${tenantId}] Reply sent:`, reply);

      // 🔄 Non-blocking persistence
      await Promise.allSettled([
        this.chatRepository.saveMessage(tenantId, waFrom, "user", messageText),
        this.chatRepository.saveMessage(tenantId, waFrom, "agent", reply),
      ]);
      console.log("💾 Messages stored successfully");

      return { status: "ok", reply, sendResult, tenantId };
    } catch (err: any) {
      console.error("Webhook error:", err);
      return { statusCode: 500, body: { detail: "Internal server error" } };
    }
  }
}
