// src/chat/chat.repository.ts
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { injectable, inject } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";

export type HistoryItem = {
  role: "user" | "agent";
  message: string;
  timestamp?: string;
};

@injectable()
export class ChatRepository {
  private client = new DynamoDBClient({});
  private tableName = process.env.CHAT_SESSIONS_TABLE_NAME!; // ✅ env by CDK

  constructor(@inject(Logger) private readonly log: Logger) {}

  /**
   * Insert a single chat turn (user/agent).
   * Logs PK/SK and message length; avoids body/PII.
   */
  async saveMessage(
    tenantId: string,
    userId: string,
    role: "user" | "agent",
    message: string
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const PK = `TENANT#${tenantId}#USER#${userId}`;
    const SK = `TS#${timestamp}`;

    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: {
          PK: { S: PK },
          SK: { S: SK },
          role: { S: role },
          message: { S: message },
          timestamp: { S: timestamp },
        },
      })
    );

    this.log.info("repo.chat.save.ok", { role, PK, SK, len: message.length });
  }

  /**
   * Read recent history, oldest → newest, with a limit.
   */
  async getRecentHistory(
    tenantId: string,
    userId: string,
    limit = 10
  ): Promise<HistoryItem[]> {
    const PK = `TENANT#${tenantId}#USER#${userId}`;

    const res = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": { S: PK } },
        ScanIndexForward: false, // newest first
        Limit: limit,
      })
    );

    const out =
      res.Items?.map((item) => ({
        role: (item.role?.S as "user" | "agent") ?? "user",
        message: item.message?.S ?? "",
        timestamp: item.timestamp?.S,
      })).reverse() ?? [];

    this.log.info("repo.chat.history.ok", { PK, count: out.length });
    return out;
  }

  /**
   * True if 4 hours elapsed since `sinceIso` (invalid → false).
   */
  public hasEightHoursElapsed(sinceIso: string, now: Date = new Date()): boolean {
    const since = new Date(sinceIso);
    if (Number.isNaN(since.getTime())) return false;
    return now.getTime() - since.getTime() >= 4 * 60 * 60 * 1000;
  }
}
