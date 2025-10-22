// chat.service.ts
import { inject, injectable } from "inversify";
import { SQSRecord } from "aws-lambda";
import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { ChatRepository } from "./chat.repository";
import { getWhatsappSecrets, sendWhatsappText } from "./models";
import { DentalWorkflow } from "./dental.workflow";
import { MemoryRepository } from "./memory.repository";
import { buildFactsHeader, buildRecentWindow } from "../prompts/propmts.helper";

const ddb = new DynamoDBClient({});
const wf = new DentalWorkflow();

function trunc(s: string, n = 140) {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

@injectable()
export class ChatService {
  constructor(
    @inject(ChatRepository)
    private readonly chatRepository: ChatRepository,
    @inject(MemoryRepository)
    private readonly memoryRepository: MemoryRepository
  ) {}

  async handleRecord(record: SQSRecord): Promise<void> {
    const reqId =
      (record as any)?.awsRequestId ||
      (global as any).crypto?.randomUUID?.() ||
      "req";

    console.info("▶️ ChatService.handleRecord:start", {
      reqId,
      region: process.env.AWS_REGION,
      memoryTable: process.env.MEMORY_TABLE_NAME || "(unset)",
      bufferTable: process.env.CHAT_BUFFER_TABLE_NAME || "(unset)",
      chatTable: process.env.CHAT_SESSIONS_TABLE_NAME || "(unset)",
    });

    try {
      // ---- Parse body and normalize messages ----
      const bodyRaw = record.body;
      console.info("📦 SQS body (raw, len):", bodyRaw?.length ?? 0);

      const body = JSON.parse(bodyRaw);
      const tenantId: string = body.tenantId;
      const userId: string = body.userId;

      console.info("👤 tenant/user:", { tenantId, userId });

      let incoming: unknown =
        body.messages ?? body.combinedText ?? body.message ?? null;

      let messages: string[] = [];
      if (Array.isArray(incoming)) {
        messages = incoming
          .map((m) => (m == null ? "" : String(m)))
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (typeof incoming === "string") {
        const cameAsCombined =
          body.combinedText !== undefined && body.messages === undefined;
        messages = (cameAsCombined ? incoming.split(/\r?\n/) : [incoming])
          .map((s) => s.trim())
          .filter(Boolean);
      }

      console.info("🧾 parsed messages:", {
        count: messages.length,
        sample: trunc(messages.join(" | ")),
      });

      if (!messages.length) {
        console.warn("⚠️ No messages to process; exiting early.");
        return;
      }

      const userKey = `${tenantId}#${userId}`;

      // ------------------------------------------------------------------
      // 0) Persist user turns FIRST (match local index behavior)
      // ------------------------------------------------------------------
      const userSaves = await Promise.allSettled(
        messages.map((m) => this.chatRepository.saveMessage(tenantId, userId, "user", m))
      );
      const userSaved = userSaves.filter((r) => r.status === "fulfilled").length;
      const userFailed = userSaves.length - userSaved;
      console.info("💾 user turns persisted (pre-LLM):", {
        total: userSaves.length,
        persisted: userSaved,
        failed: userFailed,
      });

      // ---- Last user message drives the turn ----
      const lastMessage = messages[messages.length - 1];
      console.info("💬 lastMessage:", trunc(lastMessage));

      // ---- WhatsApp secrets in parallel (doesn't block prompt prep) ----
      const waSecretsPromise = getWhatsappSecrets(tenantId);

      // ------------------------------------------------------------------
      // 1) Read memory object + recent history (like index)
      // ------------------------------------------------------------------
      const [{ memory: memObj }, history] = await Promise.all([
        this.memoryRepository.getMemory(tenantId, userId), // object for facts header
        this.chatRepository.getRecentHistory(tenantId, userId, 10), // for recent window
      ]);

      // ------------------------------------------------------------------
      // 2) Build 3-block inputs
      // ------------------------------------------------------------------
      const factsHeader = buildFactsHeader(memObj);              // PERFIL: Nombre=… | Tel=… | Email=…
      const recentWindow = buildRecentWindow(history, 8, 1600);  // U:/A: compact lines
      console.info("[flow][mem]", {
        facts_len: factsHeader.length,
        recent_len: recentWindow.length,
      });

      // ------------------------------------------------------------------
      // 3) LLM (fail-fast) — same workflow signature as index
      // ------------------------------------------------------------------
      const state = await wf.run(lastMessage, factsHeader, recentWindow);
      const reply = (state?.final_answer ?? "").trim();

      console.info("🧭 LLM decision:", {
        identify_intent: !!state?.decision?.identify_intent,
        confidence: Number(state?.decision?.confidence ?? 0),
        finalLen: reply.length,
        finalSample: trunc(reply, 160),
      });

      if (!reply) {
        // Fail-fast: do not send WA; let SQS retry
        throw new Error("EMPTY_REPLY(service): final_answer vacío tras workflow.");
      }

      // ------------------------------------------------------------------
      // 4) Send WhatsApp (index prints; here we send)
      // ------------------------------------------------------------------
      try {
        const waSecrets = await waSecretsPromise;
        const { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = waSecrets;
        console.info("🔑 WA secrets loaded:", {
          hasToken: !!WHATSAPP_ACCESS_TOKEN,
          phoneIdSuffix: (WHATSAPP_PHONE_NUMBER_ID || "").slice(-6),
        });

        await sendWhatsappText(
          userId,
          reply,
          WHATSAPP_ACCESS_TOKEN,
          WHATSAPP_PHONE_NUMBER_ID
        );
        console.info("📤 WhatsApp sent:", { to: userId, len: reply.length });
      } catch (e) {
        console.error("❌ WhatsApp send failed:", (e as Error)?.message);
        // Still persist chat; do not early return.
      }

      // ------------------------------------------------------------------
      // 5) Persist agent reply (match index timing — after successful LLM)
      // ------------------------------------------------------------------
      try {
        await this.chatRepository.saveMessage(tenantId, userId, "agent", reply);
        console.info("💾 agent turn persisted:", { len: reply.length });
      } catch (e) {
        console.warn("⚠️ agent persist failed:", (e as Error)?.message);
      }

      // ---- Clear buffer item ----
      try {
        await ddb.send(
          new DeleteItemCommand({
            TableName: process.env.CHAT_BUFFER_TABLE_NAME!,
            Key: { UserKey: { S: userKey } },
          })
        );
        console.info("🧹 buffer cleared:", { userKey });
      } catch (e) {
        console.warn(
          "⚠️ buffer clear failed (non-blocking):",
          (e as Error)?.message
        );
      }

      console.info("✅ ChatService.handleRecord:done", { reqId });
    } catch (err) {
      console.error("❌ ChatService.handleRecord:error", {
        msg: (err as Error)?.message,
        stack: (err as Error)?.stack?.split("\n").slice(0, 3).join(" | "),
      });
      throw err; // SQS retry
    }
  }
}
