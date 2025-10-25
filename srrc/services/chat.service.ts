// src/chat/chat.service.ts
//
// Main orchestrator for a chat turn consumed from SQS.
// - Parses and validates the record
// - Persists user turn
// - Builds prompt windows (facts + recent history)
// - Runs workflow (LLM)
// - Sends WhatsApp reply
// - Persists agent reply (only if WA send OK)
// - Kicks off post-ops (best effort)
// - Clears buffer entry (best effort)

import { inject, injectable } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";
import { SQSRecord } from "aws-lambda";

import { ChatRepository } from "../chat/chat.repository";
import { MemoryRepository } from "../chat/memory.repository";
import { WhatsappService } from "../services/whatsapp.service";

import { buildFactsHeader, buildRecentWindow } from "../helper/helper";
import { PostOpsService } from "../chat/postops.service";
import { DentalWorkflow } from "../chat/dental.workflow";

import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";

// keep these simple module-scoped singletons (DI later if you want)
const ddb = new DynamoDBClient({});
const wf = new DentalWorkflow();

type ChatJob = {
  tenantId: string;
  userId: string;
  combinedText: string;
  messageCount?: number;
  version?: number;
  flushedAt?: string;
  messageId: string;
  userKey: string;
};

type Windows = {
  factsHeader: string;
  recentWindow: string;
  greetOk: boolean;
};

@injectable()
export class ChatService {
  constructor(
    @inject(Logger) private readonly log: Logger,
    @inject(ChatRepository) private readonly chatRepository: ChatRepository,
    @inject(MemoryRepository) private readonly memoryRepository: MemoryRepository,
    @inject(WhatsappService) private readonly whatsapp: WhatsappService
  ) {}

  async handleRecord(record: SQSRecord): Promise<void> {
    // 1) Parse & validate
    const job = this.parseAndValidate(record);
    if (!job) {
      this.log.warn("chat.validation.skip", { messageId: record.messageId });
      return; // non-retryable skip
    }

    // attach common keys for the rest of this turn
    this.log.appendKeys({
      tenantId: job.tenantId,
      userId: job.userId,
      messageId: job.messageId,
    });
    this.log.info("chat.handle.start");

    try {
      // 2) Persist user
      await this.persistUser(job);

      // 3) Build windows (facts + recent)
      const windows = await this.buildWindows(job);

      // 4) Run workflow (LLM)
      const { reply, identify_intent, confidence } = await this.runWorkflow(job, windows);
      if (!reply) throw new Error("EMPTY_REPLY(service)");

      // 5) Send WhatsApp
      const sent = await this.sendWhatsApp(job, reply);

      // 6) Persist agent (only if sent)
      if (sent) await this.persistAgent(job, reply);

      // 7) Post-ops (best effort, non-blocking is okay for now)
      await this.enqueuePostOps(job, { reply, identify_intent, confidence });

      // 8) Clear buffer (best effort)
      await this.clearBuffer(job);

      this.log.info("chat.handle.done");
    } catch (e) {
      this.log.error("chat.handle.error", { msg: (e as Error).message });
      throw e; // keep the same retry behavior
    }
  }

  /** Parse SQS record and validate required fields; returns ChatJob or null to skip. */
  private parseAndValidate(record: SQSRecord): ChatJob | null {
    const bodyRaw = record.body;
    const body = JSON.parse(bodyRaw || "{}");
    const tenantId = body.tenantId as string;
    const userId = body.userId as string;
    const combinedText = String(body.combinedText ?? "");

    if (!tenantId || !userId || !combinedText) return null;

    return {
      tenantId,
      userId,
      combinedText,
      messageCount: body.messageCount,
      version: body.version,
      flushedAt: body.flushedAt,
      messageId: record.messageId,
      userKey: `${tenantId}#${userId}`,
    };
  }

  /** Persist the user's turn before any LLM work (audit/recovery). */
  private async persistUser(job: ChatJob): Promise<void> {
    await this.chatRepository.saveMessage(job.tenantId, job.userId, "user", job.combinedText);
    this.log.info("chat.persist.user", { len: job.combinedText.length });
  }

  /** Build prompt windows: facts header + recent compact history + greet flag. */
  private async buildWindows(job: ChatJob): Promise<Windows> {
    const [{ memory }, history] = await Promise.all([
      this.memoryRepository.getMemory(job.tenantId, job.userId),
      this.chatRepository.getRecentHistory(job.tenantId, job.userId, 10),
    ]);

    const lastAgent = [...history].reverse().find((h) => h.role === "agent");
    const greetOk = lastAgent
      ? this.chatRepository.hasEightHoursElapsed(lastAgent.timestamp ?? "")
      : true;

    const factsHeader = buildFactsHeader(memory, greetOk);
    const recentWindow = buildRecentWindow(history, 8, 1600);

    this.log.info("chat.windows.ready", {
      facts_len: factsHeader.length,
      recent_len: recentWindow.length,
      greetOk,
    });

    return { factsHeader, recentWindow, greetOk };
  }

  /** Run workflow (LLM) and return reply + intent/confidence. */
  private async runWorkflow(
    job: ChatJob,
    w: Windows
  ): Promise<{ reply: string; identify_intent: boolean; confidence: number }> {
    const state = await wf.run(job.combinedText, w.factsHeader, w.recentWindow);
    const reply = (state?.final_answer ?? "").trim();
    const identify_intent = !!state?.decision?.identify_intent;
    const confidence = Number(state?.decision?.confidence ?? 0);

    this.log.info("chat.workflow.result", {
      reply_len: reply.length,
      identify_intent,
      confidence,
    });

    return { reply, identify_intent, confidence };
  }

  /** Send WhatsApp message; returns true if successfully sent. */
  private async sendWhatsApp(job: ChatJob, reply: string): Promise<boolean> {
    try {
      const secrets = await this.whatsapp.getSecrets(job.tenantId); // you’re using tenantId as phoneNumberId
      await this.whatsapp.sendText(job.userId, reply, secrets);
      this.log.info("chat.whatsapp.sent", { to: job.userId, len: reply.length });
      return true;
    } catch (e) {
      this.log.error("chat.whatsapp.fail", { msg: (e as Error).message });
      return false;
    }
  }

  /** Persist agent’s reply only after successful WA send. */
  private async persistAgent(job: ChatJob, reply: string): Promise<void> {
    await this.chatRepository.saveMessage(job.tenantId, job.userId, "agent", reply);
    this.log.info("chat.persist.agent", { len: reply.length });
  }

  /** Best-effort post-ops (facts extraction/summary), non-blocking semantics. */
  private async enqueuePostOps(
    job: ChatJob,
    ctx: { reply: string; identify_intent: boolean; confidence: number }
  ): Promise<void> {
    try {
      const postOps = new PostOpsService(this.memoryRepository, this.chatRepository);
      const last10After = await this.chatRepository.getRecentHistory(job.tenantId, job.userId, 10);

      void postOps.run({
        tenantId: job.tenantId,
        userId: job.userId,
        lastUserMessage: job.combinedText,
        last10: last10After,
        identify_intent: ctx.identify_intent,
        confidence: ctx.confidence,
        confidenceThreshold: 0.75,
      });

      this.log.info("chat.postops.enqueued");
    } catch (e) {
      this.log.warn("chat.postops.skip", { msg: (e as Error).message });
    }
  }

  /** Best-effort buffer cleanup in DDB. */
  private async clearBuffer(job: ChatJob): Promise<void> {
    try {
      await ddb.send(
        new DeleteItemCommand({
          TableName: process.env.CHAT_BUFFER_TABLE_NAME!,
          Key: { UserKey: { S: job.userKey } },
        })
      );
      this.log.info("chat.buffer.cleared", { userKey: job.userKey });
    } catch (e) {
      this.log.warn("chat.buffer.clear.fail", { msg: (e as Error).message });
    }
  }
}
