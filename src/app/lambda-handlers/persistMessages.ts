import "reflect-metadata";
import { SQSEvent, SQSRecord } from "aws-lambda";
import { persistMessagesContainer } from "../containers/persist-messages.container";
import { Logger } from "@aws-lambda-powertools/logger";

import { ChatRepository } from "../../chat/chat.repository";
import {
  PersistMessageEnvelope,
  PersistMessageRole,
} from "../../types/persist-message";

const chatRepository = persistMessagesContainer.get(ChatRepository);
const logger = persistMessagesContainer.get(Logger);

export const handler = async (event: SQSEvent): Promise<void> => {
  logger.info("persistMessages.batch.start", {
    recordCount: event.Records.length,
  });

  for (const [index, record] of event.Records.entries()) {
    try {
      const payload = parseRecord(record);
      const normalizedRole =
        payload.role === PersistMessageRole.AGENT ? "agent" : "user";

      await chatRepository.saveMessage(
        payload.tenantId,
        payload.userId,
        normalizedRole,
        payload.messageBody
      );

      logger.info("persistMessages.record.saved", {
        index,
        tenantId: payload.tenantId,
        userId: payload.userId,
        role: payload.role,
      });
    } catch (err) {
      logger.error("persistMessages.record.error", {
        index,
        messageId: record.messageId,
        err: (err as Error).message,
      });
      throw err; // bubble up so SQS/DLQ handle retries
    }
  }

  logger.info("persistMessages.batch.complete");
};

function parseRecord(record: SQSRecord): PersistMessageEnvelope {
  let raw: Record<string, any> = {};
  try {
    raw = JSON.parse(record.body || "{}");
  } catch (err) {
    throw new Error(`Invalid JSON body: ${(err as Error).message}`);
  }

  const role = normalizeRole(raw.role);
  const messageBody = resolveMessageBody(raw);
  const tenantId = raw.tenantId as string;
  const userId = raw.userId as string;

  if (!tenantId || !userId || !messageBody || !role) {
    throw new Error(
      `Missing required fields (tenantId, userId, messageBody, role). RecordId=${record.messageId}`
    );
  }

  return {
    tenantId,
    userId,
    role,
    messageBody,
    messageId: raw.messageId,
    source: raw.source,
    whatsappMeta: raw.whatsappMeta,
  };
}

function normalizeRole(value?: string): PersistMessageRole | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  if (upper === PersistMessageRole.USER) return PersistMessageRole.USER;
  if (upper === PersistMessageRole.AGENT) return PersistMessageRole.AGENT;
  return null;
}

function resolveMessageBody(raw: Record<string, any>): string | null {
  if (
    typeof raw.messageBody === "string" &&
    raw.messageBody.trim().length > 0
  ) {
    return raw.messageBody.trim();
  }
  if (
    typeof raw.combinedText === "string" &&
    raw.combinedText.trim().length > 0
  ) {
    return raw.combinedText.trim();
  }
  if (typeof raw.reply === "string" && raw.reply.trim().length > 0) {
    return raw.reply.trim();
  }
  return null;
}
