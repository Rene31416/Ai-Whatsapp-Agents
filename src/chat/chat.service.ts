// chat.service.ts
import { inject, injectable } from "inversify";
import { SQSRecord } from "aws-lambda";
import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { ChatRepository } from "./chat.repository";
import { getWhatsappSecrets, sendWhatsappText } from "./models";
import { DentalWorkflow } from "./dental.workflow";
import { MemoryRepository } from "./memory.repository";
import { summarizeMemoryTurn } from "../prompts/dental-prompts";

const ddb = new DynamoDBClient({});
const wf = new DentalWorkflow();

function trunc(s: string, n = 140) {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function timeout(ms: number, label = "timeout"): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(label)), ms);
  });
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

      // ---- History (optional; for auditing/analytics) ----
      const history = await this.chatRepository.getRecentHistory(
        tenantId,
        userId,
        10
      );
      console.info("🗂️ recent history:", { count: history.length });

      // ---- Last user message drives the turn ----
      const lastMessage = messages[messages.length - 1];
      console.info("💬 lastMessage:", trunc(lastMessage));

      // ---- WhatsApp secrets in parallel ----
      const waSecretsPromise = getWhatsappSecrets(tenantId);

      // ---- Read memory summary ('' on first time) ----
      const memorySummary = await this.memoryRepository.getSummary(
        tenantId,
        userId
      );
      console.info("🧠 memory.getSummary:", {
        found: !!memorySummary,
        len: memorySummary?.length ?? 0,
        sample: trunc(memorySummary, 120),
      });

      // ---- Run one-shot workflow (LLM) ----
      const state = await wf.run(lastMessage, memorySummary || "");
      console.info("🧭 LLM decision:", {
        action: state?.decision?.action,
        category: state?.decision?.category,
        confidence: state?.decision?.confidence,
        finalLen: state?.final_answer?.length ?? 0,
        finalSample: trunc(state?.final_answer || "", 160),
      });

      // ---- WhatsApp secrets resolve ----
      const waSecrets = await waSecretsPromise;
      const { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = waSecrets;
      console.info("🔑 WA secrets loaded:", {
        hasToken: !!WHATSAPP_ACCESS_TOKEN,
        phoneIdSuffix: (WHATSAPP_PHONE_NUMBER_ID || "").slice(-6),
      });

      const reply = state.final_answer || "¿Podrías aclararme tu consulta? 😊";

      // ---- Send reply (user-facing latency ends here) ----
      try {
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

      // ---- Persist messages ----
      const ops = [
        ...messages.map((m) =>
          this.chatRepository.saveMessage(tenantId, userId, "user", m)
        ),
        this.chatRepository.saveMessage(tenantId, userId, "agent", reply),
      ];

      const results = await Promise.allSettled(ops);
      const persisted = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - persisted;
      console.info("💾 chat persisted:", {
        total: results.length,
        persisted,
        failed,
      });

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

      // -----------------------------------------------------------------------------
      // Memory update (LLM summary) — awaited, but STRICTLY TIMEBOXED
      // -----------------------------------------------------------------------------
      const MEM_TIMEOUT_MS = 2500;

      try {
        console.info("🧠 summarizeMemoryTurn:begin", {
          prevLen: memorySummary?.length ?? 0,
          first: !memorySummary,
          timeoutMs: MEM_TIMEOUT_MS,
        });

        // Timebox the summarizer; on timeout we throw and go to fallback path
        const newSummary = await Promise.race([
          summarizeMemoryTurn({
            prevSummary: memorySummary || "",
            lastUserMsg: lastMessage
          }),
          timeout(MEM_TIMEOUT_MS, "memory-summarizer-timeout"),
        ]);

        console.info("🧠 summarizeMemoryTurn:done", {
          newLen: newSummary.length,
          sample: trunc(newSummary, 160),
        });

        await this.memoryRepository.setSummary(tenantId, userId, newSummary);
        console.info("💾 memory.setSummary:ok", {
          userKey,
          len: newSummary.length,
        });
      } catch (e) {
        console.warn(
          "⚠️ memory summarizer failed or timed out; using deterministic fallback:",
          (e as Error)?.message
        );
        try {
          await this.memoryRepository.mergeAndUpdateDeterministic(
            tenantId,
            userId,
            lastMessage,
            reply,
            memorySummary || ""
          );
          console.info("💾 memory.mergeAndUpdateDeterministic:ok", { userKey });
        } catch (e2) {
          console.warn(
            "⚠️ memory deterministic fallback failed:",
            (e2 as Error)?.message
          );
        }
      }

      // -----------------------------------------------------------------------------

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
