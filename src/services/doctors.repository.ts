import { inject, injectable } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

export type DoctorRecord = {
  PK: string;
  SK: string;
  tenantId: string;
  doctorId: string;
  displayName: string;
  availabilityHours?: string; // simple string for now (e.g., "09:00-17:00")
  createdAt?: string;
  updatedAt?: string;
};

@injectable()
export class DoctorsRepository {
  private readonly tableName = process.env.DOCTORS_TABLE_NAME;
  private readonly client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  constructor(@inject(Logger) private readonly log: Logger) {
    if (!this.tableName) {
      throw new Error("DOCTORS_TABLE_NAME env is required");
    }
  }

  async listByTenant(tenantId: string): Promise<DoctorRecord[]> {
    console.log("[debug][doctors.repository] random listing pulse", Math.random());
    const res = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `TENANT#${tenantId}`,
        },
      })
    );

    const items = (res.Items ?? []) as DoctorRecord[];
    this.log.info("repo.doctors.list", { tenantId, count: items.length });
    return items;
  }
}
