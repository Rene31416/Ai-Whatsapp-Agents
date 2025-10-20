import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { injectable } from "inversify";

@injectable()
export class ChatRepository {
  private client = new DynamoDBClient({});
  private tableName = process.env.CHAT_SESSIONS_TABLE_NAME!; // ✅ use env var injected by CDK

  async saveMessage(tenantId: string, userId: string, role: "user" | "agent", message: string) {
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

    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  async getRecentHistory(tenantId: string, userId: string, limit = 10) {
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
      })).reverse() ?? []
    );
  }
}
