import { inject, injectable } from "inversify";
import { SQSRecord } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { DentalWorkflow } from "./dental.workflow";
import { ChatRepository } from "./chat.repository";
import { TenantRepository } from "./tenant.repository";
import { getWhatsappSecrets, sendWhatsappText } from "./models";
import { State } from "./models";

const ddb = new DynamoDBClient({});

@injectable()
export class ChatService {
  constructor(
    @inject(DentalWorkflow)
    private readonly dentalWorkflow: DentalWorkflow,
    @inject(ChatRepository)
    private readonly chatRepository: ChatRepository,
    @inject(TenantRepository)
    private readonly tenantRepository: TenantRepository
  ) {}

  /**
   * Handle a complete buffered chat turn
   * Invoked by delayed SQS message from Aggregator Lambda
   */
  async handleRecord(record: SQSRecord): Promise<void> {
    try {
      const { tenantId, userId } = JSON.parse(record.body);
      const userKey = `${tenantId}#${userId}`;

      console.log(`💬 Processing buffered conversation for ${userKey}`);

      // 1️⃣ Fetch all buffered messages
      const ddbResult = await ddb.send(
        new GetItemCommand({
          TableName: process.env.CHAT_BUFFER_TABLE_NAME!,
          Key: { UserKey: { S: userKey } },
        })
      );

      const messages =
        ddbResult.Item?.messages?.L?.map((x) => x.S as string) ?? [];

      if (!messages.length) {
        console.warn(`⚠️ No buffered messages found for ${userKey}`);
        return;
      }

      // 2️⃣ Identify tenant from phone number
      const tenant = await this.tenantRepository.getTenantByPhoneNumberId(
        userId
      );
      const resolvedTenantId = tenant?.tenantId || tenantId;

      // 3️⃣ Get previous chat history
      const history = await this.chatRepository.getRecentHistory(
        resolvedTenantId,
        userId,
        10
      );

      // Append all buffered messages
      for (const msg of messages) {
        history.push({ role: "human", message: msg });
      }

      // 4️⃣ Run the AI workflow
      const start = Date.now();
      const lastMessage = messages[messages.length - 1];
      const workflowResult: State = await this.dentalWorkflow.run(
        lastMessage,
        history
      );
      console.log(`✅ Workflow done in ${Date.now() - start} ms`);

      const reply =
        workflowResult.final_answer || "¿Podrías aclararme tu consulta? 😊";

      // 5️⃣ Send reply back to WhatsApp
      const {
        WHATSAPP_ACCESS_TOKEN,
        WHATSAPP_PHONE_NUMBER_ID,
      } = await getWhatsappSecrets(userId);

      await sendWhatsappText(
        userId,
        reply,
        WHATSAPP_ACCESS_TOKEN,
        WHATSAPP_PHONE_NUMBER_ID
      );

      console.log(`📤 Reply sent to ${userId}: "${reply}"`);

      // 6️⃣ Persist messages
      const saveOps = [
        ...messages.map((m) =>
          this.chatRepository.saveMessage(resolvedTenantId, userId, "user", m)
        ),
        this.chatRepository.saveMessage(resolvedTenantId, userId, "agent", reply),
      ];

      await Promise.allSettled(saveOps);
      console.log("💾 Messages stored successfully");

      // 7️⃣ Clear the buffer
      await ddb.send(
        new DeleteItemCommand({
          TableName: process.env.CHAT_BUFFER_TABLE_NAME!,
          Key: { UserKey: { S: userKey } },
        })
      );

      console.log(`🧹 Cleared message buffer for ${userKey}`);
    } catch (err) {
      console.error("❌ Error processing buffered chat:", err);
      throw err; // Let Lambda retry via SQS
    }
  }
}
