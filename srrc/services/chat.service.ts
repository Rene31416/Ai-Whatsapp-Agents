// src/chat/chat.service.ts
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
    @inject(PostOpsService) private readonly postOps: PostOpsService,
    @inject(DentalWorkflow) private readonly wf: DentalWorkflow, // 👈 añade esto
 
  ) {}

  async handleRecord(record: SQSRecord): Promise<void> {
    const job = this.parseAndValidate(record);
    if (!job) {
      this.log.warn("chat.validation.skip", { messageId: record.messageId });
      return;
    }

    this.log.appendKeys({
      tenantId: job.tenantId,
      userId: job.userId,
      messageId: job.messageId,
    });

    this.log.info("chat.handle.start");

    try {
      // 1) Windows
      const windows = await this.buildWindows(job);

      // 2) Persist user
      await this.persistUser(job);

      // 3) Run workflow
      const { reply, identify_intent, confidence, isCalendar } = await this.runWorkflow(
        job,
        windows
      );

      // 3.1) Política de envío:
      // - Si reply vacío y isCalendar=true → NO enviar, NO persistir (downstream agent se encargará).
      // - Si reply vacío y isCalendar=false → usar fallback seguro (evita EMPTY_REPLY).
      let finalReply = reply?.trim() ?? "";
      if (!finalReply) {
        if (isCalendar) {
          this.log.info("chat.workflow.result", {
            reply_len: 0,
            identify_intent,
            confidence,
            isCalendar,
            note: "no local reply; routed to calendar agent",
          });

          // Logs legibles para consola local
          console.log("\n==========================================");
          console.log("USUARIO  >", job.combinedText);
          console.log("BOT      >", "(no local reply; routed to calendar agent)");
          console.log("INTENT?  >", identify_intent, "conf:", confidence.toFixed(2));
          console.log("==========================================\n");

          // 6) Post-ops best effort
          await this.enqueuePostOps(job, { identify_intent, confidence });

          // 7) Clear buffer best effort
          await this.clearBuffer(job);

          this.log.info("chat.handle.done");
          return; // ← No enviamos ni persistimos agent
        } else {
          finalReply = "Ahora mismo no tengo esa info. ¿Te ayudo con algo más? 🙂";
        }
      }

      // 4) Enviar WhatsApp
      const sent = await this.sendWhatsApp(job, finalReply);

      // 5) Persist agent si se envió
      if (sent) {
        await this.persistAgent(job, finalReply);
      }

      // Logs legibles consola local
      console.log("\n==========================================");
      console.log("USUARIO  >", job.combinedText);
      console.log("BOT      >", finalReply);
      console.log("INTENT?  >", identify_intent, "conf:", confidence.toFixed(2));
      console.log("==========================================\n");

      // 6) Post-ops
      await this.enqueuePostOps(job, { identify_intent, confidence });

      // 7) Clear buffer
      await this.clearBuffer(job);

      this.log.info("chat.handle.done");
    } catch (e) {
      this.log.error("chat.handle.error", { msg: (e as Error).message });
      throw e; // retry SQS
    }
  }

  private parseAndValidate(record: SQSRecord): ChatJob | null {
    const body = JSON.parse(record.body || "{}");
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

  private async persistUser(job: ChatJob): Promise<void> {
    await this.chatRepository.saveMessage(
      job.tenantId,
      job.userId,
      "user",
      job.combinedText
    );
    this.log.info("chat.persist.user", { len: job.combinedText.length });
  }

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

  private async runWorkflow(
    job: ChatJob,
    w: Windows
  ): Promise<{
    reply: string;
    identify_intent: boolean;
    confidence: number;
    isCalendar: boolean;
  }> {
    const state = await this.wf.run(job.combinedText, w.factsHeader, w.recentWindow);

    const reply = (state?.final_answer ?? "").trim();
    const identify_intent = !!state?.decision?.identify_intent;
    const confidence = Number(state?.decision?.confidence ?? 0);
    const isCalendar = !!(state?.decision as any)?.isCalendar;

    this.log.info("chat.workflow.result", {
      reply_len: reply.length,
      identify_intent,
      confidence,
      isCalendar,
    });

    return { reply, identify_intent, confidence, isCalendar };
  }

  private async sendWhatsApp(job: ChatJob, reply: string): Promise<boolean> {
    try {
      const secrets = await this.whatsapp.getSecrets(job.tenantId);
      await this.whatsapp.sendText(job.userId, reply, secrets);
      this.log.info("chat.whatsapp.sent", { to: job.userId, len: reply.length });
      return true;
    } catch (e) {
      this.log.error("chat.whatsapp.fail", { msg: (e as Error).message });
      return false;
    }
  }

  private async persistAgent(job: ChatJob, reply: string): Promise<void> {
    await this.chatRepository.saveMessage(job.tenantId, job.userId, "agent", reply);
    this.log.info("chat.persist.agent", { len: reply.length });
  }

  private async enqueuePostOps(
    job: ChatJob,
    ctx: { identify_intent: boolean; confidence: number }
  ): Promise<void> {
    try {
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
      this.log.warn("chat.postops.skip", { msg: (e as Error).message });
    }
  }

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
