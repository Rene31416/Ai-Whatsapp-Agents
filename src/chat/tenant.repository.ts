import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { injectable } from "inversify";

@injectable()
export class TenantRepository {
  private client = new DynamoDBClient({});
  private tableName = "TenantClinicMetadata";

  /**
   * Look up tenant by WhatsApp phone_number_id
   */
  async getTenantByPhoneNumberId(phoneNumberId: string) {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "PhoneNumberIdIndex", // optional secondary index (see note below)
        KeyConditionExpression: "phoneNumberId = :p",
        ExpressionAttributeValues: { ":p": { S: phoneNumberId } },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      throw new Error(`Tenant not found for phone_number_id ${phoneNumberId}`);
    }

    const item = result.Items[0];
    return {
      tenantId: item.tenantId.S!,
      clinicName: item.clinicName?.S,
      phoneNumberId: item.phoneNumberId?.S,
    };
  }
}
