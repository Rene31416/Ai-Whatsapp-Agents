import { DynamoDBClient, GetItemCommand, QueryCommand, AttributeValue } from "@aws-sdk/client-dynamodb";
import { inject, injectable } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";

export type TenantMetadata = {
  tenantId: string;
  tenantName?: string;
  createdAt?: string;
  phoneNumberIds: string[];
  whatsappPhones: string[];
  whatsappSecretName?: string;
  calendarSecretName?: string;
  users: string[];
};

@injectable()
export class TenantRepository {
  private readonly client = new DynamoDBClient({});
  private readonly tableName = process.env.TENANT_TABLE_NAME;
  private readonly phoneIndexName = process.env.TENANT_GSI_PHONE;

  constructor(@inject(Logger) private readonly log: Logger) {
    if (!this.tableName) {
      throw new Error("TENANT_TABLE_NAME env is required");
    }
  }

  async getById(tenantId: string): Promise<TenantMetadata | null> {
    if (!tenantId) return null;

    const result = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: { tenantId: { S: tenantId } },
      })
    );

    if (!result.Item) {
      this.log.warn("tenant.repo.miss.id", { tenantId });
      return null;
    }

    const mapped = this.mapItem(result.Item);
    console.log("[TenantRepository] Loaded tenant by id", {
      tenantId: mapped.tenantId,
      phoneNumberIds: mapped.phoneNumberIds?.length ?? 0,
      users: mapped.users?.length ?? 0,
    });
    return mapped;
  }

  async getByPhoneNumberId(phoneNumberId: string): Promise<TenantMetadata | null> {
    if (!phoneNumberId) return null;
    if (!this.phoneIndexName) {
      throw new Error("TENANT_GSI_PHONE env is required for phone lookups");
    }

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: this.phoneIndexName,
        KeyConditionExpression: "phoneNumberId = :phone",
        ExpressionAttributeValues: {
          ":phone": { S: phoneNumberId },
        },
        Limit: 1,
      })
    );

    const item = result.Items?.[0];
    if (!item) {
      this.log.warn("tenant.repo.miss.phone", { phoneNumberId });
      return null;
    }

    const mapped = this.mapItem(item);
    console.log("[TenantRepository] Resolved tenant by phone number", {
      phoneNumberId,
      tenantId: mapped.tenantId,
      whatsappPhones: mapped.whatsappPhones?.length ?? 0,
    });
    return mapped;
  }

  private mapItem(item: Record<string, AttributeValue>): TenantMetadata {
    const tenantId = item.tenantId?.S;
    if (!tenantId) {
      throw new Error("tenant metadata missing tenantId");
    }

    return {
      tenantId,
      tenantName: item.tenantName?.S,
      createdAt: item.createdAt?.S,
      phoneNumberIds: this.extractStringList(item.phoneNumberIds) ?? (item.phoneNumberId?.S ? [item.phoneNumberId.S] : []),
      whatsappPhones: this.extractStringList(item.whatsappPhones),
      whatsappSecretName: item.whatsappSecretName?.S,
      calendarSecretName: item.calendarSecretName?.S,
      users: this.extractStringList(item.users),
    };
  }

  private extractStringList(attr?: AttributeValue): string[] {
    if (!attr || !attr.L) return [];
    return (
      attr.L.map((entry) => entry.S).filter((s): s is string => typeof s === "string" && s.length > 0) ?? []
    );
  }
}
