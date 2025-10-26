// src/chat/chat.service.ts
//
// ChatService
// Orchestrates one SQS chat job end-to-end:
//  - Parse & validate the record
//  - Persist user message
//  - Build context windows (memory + recent chat)
//  - Run workflow (LLM -> reply, intent/confidence)
//  - Send reply via WhatsApp
//  - Persist agent reply (only if WA send succeeded)
//  - Trigger post-ops (facts extraction)
//  - Clear per-user buffer entry

import { inject, injectable } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";
import { SQSRecord } from "aws-lambda";

import { ChatRepository } from "../chat/chat.repository";
import { MemoryRepository } from "../chat/memory.repository";
import { WhatsappService } from "../services/whatsapp.service";
import { PostOpsService } from "../services/post.ops.service";

import { buildFactsHeader, buildRecentWindow } from "../helper/prompts.helper";
import { DentalWorkflow } from "../workflow/main.workflow";

import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";

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
    @inject(WhatsappService) private readonly whatsapp: WhatsappService,
    @inject(PostOpsService) private readonly postOps: PostOpsService
  ) {}

  /**
   * Entry point for each SQS record.
   * Throws on fatal errors so SQS can retry.
   */
  async handleRecord(record: SQSRecord): Promise<void> {
    const job = this.parseAndValidate(record);
    if (!job) {
      this.log.warn("chat.validation.skip", { messageId: record.messageId });
      return;
    }

    // Add common dimensions to all logs for this turn
    this.log.appendKeys({
      tenantId: job.tenantId,
      userId: job.userId,
      messageId: job.messageId,
    });

    this.log.info("chat.handle.start");

    try {
      // 1. Persist the user's message first (audit / history)
      await this.persistUser(job);

      // 2. Build conversation windows for the workflow
      const windows = await this.buildWindows(job);

      // 3. Run workflow -> reply + routing metadata
      const { reply, identify_intent, confidence } = await this.runWorkflow(
        job,
        windows
      );
      if (!reply) throw new Error("EMPTY_REPLY(service)");

      // 4. Send WhatsApp reply
      const sent = await this.sendWhatsApp(job, reply);

      // 5. Persist agent reply only if we actually delivered it
      if (sent) {
        await this.persistAgent(job, reply);
      }

            // 🔎✨ HUMAN-FRIENDLY DEBUG LOGS
      // Esto es SOLO para que leyendo la consola local entiendas rápido
      // qué preguntó el usuario y qué respondió el bot.
      //
      // No depende de Logger, usamos console.log directo.
      console.log("\n==========================================");
      console.log("USUARIO  >", job.combinedText);
      console.log("BOT      >", reply);
      console.log("INTENT?  >", identify_intent, "conf:", confidence.toFixed(2));
      console.log("==========================================\n");

      // 6. Fire post-ops (best effort)
      await this.enqueuePostOps(job, { identify_intent, confidence });

      // 7. Clear the per-user buffer row in DynamoDB (best effort)
      await this.clearBuffer(job);

      this.log.info("chat.handle.done");
    } catch (e) {
      this.log.error("chat.handle.error", { msg: (e as Error).message });
      throw e; // let SQS retry
    }
  }

  /**
   * Parse SQS record body and return the normalized job payload.
   * Returns null if required fields are missing (non-retryable skip).
   */
  private parseAndValidate(record: SQSRecord): ChatJob | null {
    const body = JSON.parse(record.body || "{}");

    const tenantId = body.tenantId as string;
    const userId = body.userId as string;
    const combinedText = String(body.combinedText ?? "");

    if (!tenantId || !userId || !combinedText) {
      return null;
    }

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

  /**
   * Write the user's message into the chat history table.
   */
  private async persistUser(job: ChatJob): Promise<void> {
    await this.chatRepository.saveMessage(
      job.tenantId,
      job.userId,
      "user",
      job.combinedText
    );
    this.log.info("chat.persist.user", { len: job.combinedText.length });
  }

  /**
   * Build context used by the workflow:
   * - factsHeader: snapshot of known contact info + greet flag
   * - recentWindow: compressed last N turns (U:/A:)
   * - greetOk: whether we should greet again (8h gap heuristic)
   */
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

  /**
   * Call the conversational workflow that decides:
   * - final answer text
   * - whether the user is giving identity info
   * - confidence in that routing decision
   */
  private async runWorkflow(
    job: ChatJob,
    w: Windows
  ): Promise<{
    reply: string;
    identify_intent: boolean;
    confidence: number;
  }> {
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

  /**
   * Send the reply via WhatsApp using tenant-scoped credentials.
   * Returns true if delivery didn't throw.
   */
  private async sendWhatsApp(job: ChatJob, reply: string): Promise<boolean> {
    try {

      
      const secrets = await this.whatsapp.getSecrets(job.tenantId); // tenantId maps to WhatsApp secret scope
      await this.whatsapp.sendText(job.userId, reply, secrets);
      this.log.info("chat.whatsapp.sent", {
        to: job.userId,
        len: reply.length,
      });
      return true;
    } catch (e) {
      this.log.error("chat.whatsapp.fail", { msg: (e as Error).message });
      return false;
    }
  }

  /**
   * Persist the agent's reply so history stays consistent.
   */
  private async persistAgent(job: ChatJob, reply: string): Promise<void> {
    await this.chatRepository.saveMessage(
      job.tenantId,
      job.userId,
      "agent",
      reply
    );
    this.log.info("chat.persist.agent", { len: reply.length });
  }

  /**
   * Kick off the "post-ops" enrichment step (facts extraction).
   * This does not block the user path. Errors are handled inside PostOpsService.
   */
  private async enqueuePostOps(
    job: ChatJob,
    ctx: { identify_intent: boolean; confidence: number }
  ): Promise<void> {
    try {
      // We don't await anything beyond .run() itself here,
      // and .run() already swallows its own errors.
      await this.postOps.run({
        tenantId: job.tenantId,
        userId: job.userId,
        lastUserMessage: job.combinedText,
        identify_intent: ctx.identify_intent,
        confidence: ctx.confidence,
        confidenceThreshold: 0.75,
      });

      this.log.info("chat.postops.enqueued");
    } catch (e) {
      // Extremely defensive: this should basically never trip now.
      this.log.warn("chat.postops.skip", { msg: (e as Error).message });
    }
  }

  /**
   * After processing, clear the buffer row for this user in DynamoDB so
   * we don't accidentally reprocess stale buffered content.
   */
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
      this.log.warn("chat.buffer.clear.fail", {
        msg: (e as Error).message,
      });
    }
  }
}
