// src/chat/postops.service.ts

import { injectable, inject } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";

import { ChatRepository } from "../chat/chat.repository";
import { MemoryRepository } from "../chat/memory.repository";

import {
  ContactFactsExtractorService,
  ContactProfilePatch,
} from "../prompts/facts.prompt";

export type RunArgs = {
  tenantId: string;
  userId: string;
  lastUserMessage: string;
  identify_intent: boolean;        // main workflow says: "user is giving personal/contact info"
  confidence: number;              // workflow confidence in [0..1]
  confidenceThreshold?: number;    // default 0.75
};

/**
 * PostOpsService
 *
 * After we've replied to the user, we may want to update long-term memory
 * with new/updated contact info (name, phone, email, timezoneHint).
 *
 * - We ONLY call the LLM extractor if identify_intent === true AND
 *   confidence >= confidenceThreshold.
 * - We only use the most recent user message (not full chat history).
 * - We never throw; ChatService should not fail because of this.
 */
@injectable()
export class PostOpsService {
  constructor(
    @inject(MemoryRepository)
    private readonly memRepo: MemoryRepository,

    @inject(ChatRepository)
    private readonly chatRepo: ChatRepository,

    @inject(ContactFactsExtractorService)
    private readonly factsExtractor: ContactFactsExtractorService,

    @inject(Logger)
    private readonly log: Logger
  ) {}

  /**
   * Attempt to extract user contact/profile info from the last message
   * and persist it to memory.
   */
  async run(args: RunArgs): Promise<void> {
    const {
      tenantId,
      userId,
      lastUserMessage,
      identify_intent,
      confidence,
      confidenceThreshold = 0.75,
    } = args;

    try {
      const shouldRunLLM =
        identify_intent && confidence >= confidenceThreshold;

      this.log.info("postops.start", {
        tenantId,
        userId,
        identify_intent,
        confidence,
        confidenceThreshold,
        shouldRunLLM,
      });

      if (!shouldRunLLM) {
        this.log.info("postops.skip", {
          reason: "gate_not_passed",
        });
        return;
      }

      // Ask the LLM to extract contact info (name/phone/email/timezoneHint)
      // from ONLY this last user message.
      const patch: ContactProfilePatch =
        await this.factsExtractor.extractFromMessage(lastUserMessage);

      if (!patch || Object.keys(patch).length === 0) {
        this.log.info("postops.no_patch", {
          reason: "extractor_empty",
        });
        return;
      }

      // Merge patch into long-term memory in DynamoDB.
      // mergeMemoryDelta() deep-merges only mentioned fields,
      // so we won't overwrite other data accidentally.
      await this.memRepo.mergeMemoryDelta(tenantId, userId, patch);

      this.log.info("postops.merged", {
        mergedPreview: safePreview(patch),
      });
    } catch (err) {
      // Swallow errors so the main ChatService flow isn't affected.
      this.log.warn("postops.error", {
        msg: (err as Error)?.message,
        stackTop: (err as Error)?.stack?.split("\n")[0],
      });
    }
  }
}

/**
 * safePreview
 * Produces a short JSON preview string for logs without throwing.
 */
function safePreview(obj: unknown): string {
  try {
    const s = JSON.stringify(obj);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  } catch {
    return "[unserializable]";
  }
}
