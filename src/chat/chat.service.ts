// src/chat/chat.service.ts
import { inject, injectable } from "inversify";
import { SQSRecord } from "aws-lambda";
import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { ChatRepository } from "./chat.repository";
import { getWhatsappSecrets, sendWhatsappText } from "./models";
import { DentalWorkflow } from "./dental.workflow";
import { MemoryRepository } from "./memory.repository";
import { buildFactsHeader, buildRecentWindow } from "../prompts/propmts.helper";
import { PostOpsService } from "./postops.service";

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
      // ---- Parse body (preserve combinedText newlines) ----
      const bodyRaw = record.body;
      console.info("📦 SQS body (raw, len):", bodyRaw?.length ?? 0);

      const body = JSON.parse(bodyRaw);
      const tenantId: string = body.tenantId;
      const userId: string = body.userId;
      const combinedText: string = String(body.combinedText ?? "");

      console.info("👤 tenant/user:", { tenantId, userId });

      if (!tenantId || !userId || !combinedText) {
        console.warn("⚠️ Missing required fields; exiting early.");
        return;
      }

      const userKey = `${tenantId}#${userId}`;

      // ------------------------------------------------------------------
      // 0) Persist user turn FIRST (single message with \n intact)
      // ------------------------------------------------------------------
      try {
        await this.chatRepository.saveMessage(tenantId, userId, "user", combinedText);
        console.info("💾 user turn persisted (pre-LLM):", {
          len: combinedText.length,
          lines: combinedText.split(/\r?\n/).length,
        });
      } catch (e) {
        console.warn("⚠️ user persist failed:", (e as Error)?.message);
      }

      // ---- Last user message drives the turn (keep \n) ----
      const lastMessage = combinedText;
      console.info("💬 lastMessage:", trunc(lastMessage));
      console.info("💬 lastMessage:", lastMessage);

      // ---- WhatsApp secrets in parallel ----
      const waSecretsPromise = getWhatsappSecrets(tenantId);

      // ------------------------------------------------------------------
      // 1) Read memory object + recent history (after persisting user turn)
      // ------------------------------------------------------------------
      const [{ memory: memObj }, history] = await Promise.all([
        this.memoryRepository.getMemory(tenantId, userId), // object for facts header
        this.chatRepository.getRecentHistory(tenantId, userId, 10), // recent window (includes just-saved user turn)
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
      const identify_intent = !!state?.decision?.identify_intent;
      const confidence = Number(state?.decision?.confidence ?? 0);

      console.info("🧭 LLM decision:", {
        identify_intent,
        confidence,
        finalLen: reply.length,
        finalSample: trunc(reply, 160),
      });

      if (!reply) {
        // Fail-fast: do not send WA; let SQS retry
        throw new Error("EMPTY_REPLY(service): final_answer vacío tras workflow.");
      }

      // ------------------------------------------------------------------
      // 4) Send WhatsApp
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
      // 5) Persist agent reply
      // ------------------------------------------------------------------
      try {
        await this.chatRepository.saveMessage(tenantId, userId, "agent", reply);
        console.info("💾 agent turn persisted:", { len: reply.length });
      } catch (e) {
        console.warn("⚠️ agent persist failed:", (e as Error)?.message);
      }

      // ------------------------------------------------------------------
      // 6) PostOps NO bloqueante (regex/LLM facts + short summary)
      //     — exactamente como en el index local
      // ------------------------------------------------------------------
      try {
        const postOps = new PostOpsService(this.memoryRepository, this.chatRepository);
        const last10After = await this.chatRepository.getRecentHistory(tenantId, userId, 10);

        // Dispara en background; no bloquea latencia de usuario.
        void postOps.run({
          tenantId,
          userId,
          lastUserMessage: lastMessage,
          last10: last10After,
          identify_intent,
          confidence,
          confidenceThreshold: 0.75, // igual que en index  
        });
      } catch (e) {
        console.warn("⚠️ PostOps launch failed (non-blocking):", (e as Error)?.message);
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
