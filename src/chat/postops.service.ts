import { MemoryRepository, MemoryObject } from "./memory.repository";
import { ChatRepository } from "./chat.repository";
import { extractFactsDeterministic, seemsLikeIdentityIntent } from "./facts.extractor";
import { extractClientFacts } from "../prompts/facts.prompt";
import { summarizeRecentDialog } from "../prompts/summary.prompt";

type RunArgs = {
  tenantId: string;
  userId: string;
  lastUserMessage: string;
  last10: Array<{ role: "user" | "agent"; message: string }>;
  identify_intent: boolean;
  confidence: number; // 0..1
  confidenceThreshold?: number; // default 0.75
  summaryEvery?: number; // default 3 (user turns)
};

export class PostOpsService {
  constructor(
    private memRepo: MemoryRepository,
    private chatRepo: ChatRepository
  ) {}

  async run(args: RunArgs): Promise<void> {
    const {
      tenantId, userId, lastUserMessage, last10,
      identify_intent, confidence,
      confidenceThreshold = 0.75,
      summaryEvery = 3,
    } = args;

    try {
      // 1) Regex determinista sobre el último mensaje
      const det = extractFactsDeterministic(lastUserMessage);
      if (Object.keys(det).length) {
        await this.memRepo.mergeMemoryDelta(tenantId, userId, det as Partial<MemoryObject>);
        console.info("[postops][facts][regex] merged", det);
      } else {
        // 2) Si el LLM #1 detectó intento de identidad con buena confianza, usa LLM #2
        if (identify_intent && confidence >= confidenceThreshold && seemsLikeIdentityIntent(lastUserMessage)) {
          const llmFacts = await extractClientFacts({ last10 });
          if (llmFacts && Object.keys(llmFacts).length) {
            await this.memRepo.mergeMemoryDelta(tenantId, userId, llmFacts as Partial<MemoryObject>);
            console.info("[postops][facts][llm] merged", llmFacts);
          } else {
            console.info("[postops][facts] none");
          }
        } else {
          console.info("[postops][facts] skip (no intent/conf)");
        }
      }

      // 3) Short summary cada N turnos de usuario
      const last10After = await this.chatRepo.getRecentHistory(tenantId, userId, 10);
      const userTurns = last10After.filter(t => t.role === "user").length;
      if (userTurns % summaryEvery === 0) {
        const summary = await summarizeRecentDialog({ last10: last10After, limitChars: 350 });
        if (summary) {
          await this.memRepo.setShortTermSummary(tenantId, userId, summary.trim(), 10);
          console.info("[postops][summary] updated len=" + summary.length);
        } else {
          console.info("[postops][summary] empty (skip)");
        }
      } else {
        console.info("[postops][summary] skip (freq)");
      }
    } catch (e) {
      console.warn("⚠️ postops.run error:", (e as Error)?.message);
    }
  }
}
