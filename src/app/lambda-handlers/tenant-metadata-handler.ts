import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const tenantTableName = process.env.TENANT_TABLE_NAME;
const tokenSecretPrefix = process.env.CALENDAR_TOKEN_SECRET_PREFIX ?? "";

interface TenantItem {
  tenantId?: string;
  tenantName?: string;
  calendarTokenSecret?: string;
  users?: string[];
}

export const handler = async (event: any) => {
  if (!tenantTableName) {
    console.error("TENANT_TABLE_NAME env missing");
    return jsonResponse(500, {
      status: "error",
      message: "Server misconfiguration: tenant table not set",
    });
  }

  const email =
    event?.queryStringParameters?.email ||
    event?.queryStringParameters?.user ||
    "";

  if (!email) {
    return jsonResponse(400, {
      status: "error",
      message: "Missing 'email' query parameter",
    });
  }

  try {
    const command = new ScanCommand({
      TableName: tenantTableName,
      FilterExpression: "contains(#users, :email)",
      ExpressionAttributeNames: {
        "#users": "users",
      },
      ExpressionAttributeValues: {
        ":email": email,
      },
      ProjectionExpression: "tenantId, tenantName, calendarTokenSecret, users",
    });

    const result = await docClient.send(command);
    const items = (result.Items ?? []) as TenantItem[];

    if (!items.length) {
      return jsonResponse(404, {
        status: "not_found",
        message: `No tenant metadata for email ${email}`,
      });
    }

    const tenant = items[0];
    const tenantId = tenant.tenantId ?? "unknown";
    const tokenSecret =
      tenant.calendarTokenSecret ?? `${tokenSecretPrefix}${tenantId}`;

    return jsonResponse(200, {
      status: "ok",
      tenantId,
      tenantName: tenant.tenantName ?? tenantId,
      calendarTokenSecret: tokenSecret,
      users: tenant.users ?? [],
    });
  } catch (err: any) {
    console.error("Error querying tenant metadata:", err);
    return jsonResponse(500, {
      status: "error",
      message: err?.message ?? "Failed to read tenant metadata",
    });
  }
};

function jsonResponse(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}
