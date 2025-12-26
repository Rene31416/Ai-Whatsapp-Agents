import "reflect-metadata";
import { SQSEvent, SQSRecord } from "aws-lambda";
import { deliverMessagesContainer } from "../containers/deliver-messages.container";
import { Logger } from "@aws-lambda-powertools/logger";

import { WhatsappService } from "../../services/whatsapp.service";
import { DeliverMessageEnvelope } from "../../types/deliver-message";

const whatsappService = deliverMessagesContainer.get(WhatsappService);
const logger = deliverMessagesContainer.get(Logger);

export const handler = async (event: SQSEvent): Promise<void> => {
  logger.info("deliverMessages.batch.start", {
    recordCount: event.Records.length,
  });

  for (const [index, record] of event.Records.entries()) {
    try {
      const payload = parseRecord(record);

      const secrets = await whatsappService.getSecretsByPhoneNumberId(
        payload.phoneNumberId
      );
      await whatsappService.sendText(
        payload.userId,
        payload.messageBody,
        secrets
      );

      logger.info("deliverMessages.record.sent", {
        index,
        tenantId: payload.tenantId,
        userId: payload.userId,
        phoneNumberId: payload.phoneNumberId,
        traceId: payload.traceId,
      });
    } catch (err) {
      logger.error("deliverMessages.record.error", {
        index,
        messageId: record.messageId,
        err: (err as Error).message,
      });
      throw err;
    }
  }

  logger.info("deliverMessages.batch.complete");
};

function parseRecord(record: SQSRecord): DeliverMessageEnvelope {
  let raw: Record<string, any> = {};
  try {
    raw = JSON.parse(record.body || "{}");
  } catch (err) {
    throw new Error(`Invalid JSON body: ${(err as Error).message}`);
  }

  const tenantId =
    typeof raw.tenantId === "string" ? raw.tenantId.trim() : undefined;
  const userId = typeof raw.userId === "string" ? raw.userId.trim() : undefined;
  const phoneNumberId =
    typeof raw.phoneNumberId === "string" ? raw.phoneNumberId.trim() : undefined;
  const messageBody =
    typeof raw.messageBody === "string" ? raw.messageBody.trim() : undefined;

  if (!tenantId || !userId || !phoneNumberId || !messageBody) {
    throw new Error(
      `Missing tenantId/userId/phoneNumberId/messageBody fields for recordId=${record.messageId}`
    );
  }

  return {
    tenantId,
    userId,
    phoneNumberId,
    messageBody,
    messageId: typeof raw.messageId === "string" ? raw.messageId : undefined,
    traceId: typeof raw.traceId === "string" ? raw.traceId : undefined,
    source: typeof raw.source === "string" ? raw.source : undefined,
    metadata: raw.metadata,
  };
}
