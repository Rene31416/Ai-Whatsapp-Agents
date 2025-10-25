// src/chat/postops.service.ts
import { MemoryRepository, MemoryObject } from "./memory.repository";
import { ChatRepository } from "./chat.repository";
import { extractFactsDeterministic, seemsLikeIdentityIntent } from "./facts.extractor";
import { extractClientFacts } from "../prompts/facts.prompt";

type RunArgs = {
  tenantId: string;
  userId: string;
  lastUserMessage: string;
  last10: Array<{ role: "user" | "agent"; message: string }>;
  identify_intent: boolean;   // flag del workflow (ii)
  confidence: number;         // 0..1
  confidenceThreshold?: number; // default 0.75
};

export class PostOpsService {
  constructor(
    private memRepo: MemoryRepository,
    private chatRepo: ChatRepository
  ) {}

  async run(args: RunArgs): Promise<void> {
    const {
      tenantId,
      userId,
      lastUserMessage,
      last10,
      identify_intent,
      confidence,
      confidenceThreshold = 0.75,
    } = args;

    try {
      // 0) Log de entrada para depuración fina
      const byRegexSmell = seemsLikeIdentityIntent(lastUserMessage);
      const byLLMFlag = identify_intent && confidence >= confidenceThreshold;
      console.info(
        "[postops][in] ii=%s conf=%s thr=%s byLLM=%s byRegex=%s",
        identify_intent,
        confidence.toFixed(2),
        confidenceThreshold.toFixed(2),
        byLLMFlag,
        byRegexSmell
      );

      // 1) Intento determinista (regex) SOLO para extraer valores inmediatos del último mensaje
      const det = extractFactsDeterministic(lastUserMessage);
      if (Object.keys(det).length) {
        await this.memRepo.mergeMemoryDelta(
          tenantId,
          userId,
          det as Partial<MemoryObject>
        );
        console.info("[postops][facts][regex] merged", det);
      } else {
        // 2) Si el workflow marcó intención con buena confianza O el regex "huele" intención,
        //    disparamos el extractor LLM sobre la ventana reciente.
        if (byLLMFlag || byRegexSmell) {
          const llmFacts = await extractClientFacts({ last10 });
          if (llmFacts && Object.keys(llmFacts).length) {
            await this.memRepo.mergeMemoryDelta(
              tenantId,
              userId,
              llmFacts as Partial<MemoryObject>
            );
            console.info("[postops][facts][llm] merged", llmFacts);
          } else {
            console.info("[postops][facts] none (LLM returned empty)");
          }
        } else {
          console.info(
            "[postops][facts] skip (reasons): byLLM=%s byRegex=%s",
            byLLMFlag,
            byRegexSmell
          );
        }
      }

      // 3) (REMOVIDO) Short-term summary: No se usa, no se invoca ni se escribe.
      //    — Eliminado para ahorrar latencia y tokens.

    } catch (e) {
      console.warn("⚠️ postops.run error:", (e as Error)?.message);
    }
  }
}
