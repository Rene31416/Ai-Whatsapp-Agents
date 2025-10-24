import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { injectable } from "inversify";

@injectable()
export class ChatRepository {
  private client = new DynamoDBClient({});
  private tableName = process.env.CHAT_SESSIONS_TABLE_NAME!; // ✅ use env var injected by CDK

  async saveMessage(
    tenantId: string,
    userId: string,
    role: "user" | "agent",
    message: string
  ) {
    const timestamp = new Date().toISOString();
    const PK = `TENANT#${tenantId}#USER#${userId}`;
    const SK = `TS#${timestamp}`;

    const item = {
      PK: { S: PK },
      SK: { S: SK },
      role: { S: role },
      message: { S: message },
      timestamp: { S: timestamp },
    };
    console.log("💬 Saving", { role, PK, SK });

    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  async getRecentHistory(
    tenantId: string,
    userId: string,
    limit = 10
  ): Promise<any[]> {
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

    return (
      res.Items?.map((item) => ({
        role: item.role.S,
        message: item.message.S,
        timestamp: item.timestamp?.S,
      })).reverse() ?? []
    );
  }

  /**
   * Returns true if 8 hours have passed from `sinceIso` to now.
   * @param sinceIso ISO-8601 timestamp (e.g. "2025-10-23T08:15:00.000Z")
   * @param now Optional override for "current" time (useful in tests)
   */
  public hasEightHoursElapsed(
    sinceIso: string,
    now: Date = new Date()
  ): boolean {
    const since = new Date(sinceIso);
    if (Number.isNaN(since.getTime())) return false; // invalid input → false
    const diffMs = now.getTime() - since.getTime(); // negative if since is in the future
    return diffMs >= 8 * 60 * 60 * 1000; // 8 hours in ms
  }
}
