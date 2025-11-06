import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const secretsClient = new SecretsManagerClient({});

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

    let calendarConnected = false;
    let calendarConnectedAt: string | null = null;

    if (tokenSecret && tokenSecret.trim().length > 0) {
      try {
        const secretValue = await secretsClient.send(
          new GetSecretValueCommand({
            SecretId: tokenSecret,
          })
        );

        if (secretValue.SecretString) {
          try {
            const payload = JSON.parse(secretValue.SecretString) as Record<string, unknown>;
            if (payload && typeof payload === "object") {
              calendarConnected = Boolean((payload as { refresh_token?: string }).refresh_token);
              const receivedAt = (payload as { receivedAt?: string }).receivedAt;
              if (typeof receivedAt === "string" && receivedAt.trim().length > 0) {
                calendarConnectedAt = receivedAt;
              }
            }
          } catch (parseErr) {
            console.error("Failed to parse calendar secret payload", parseErr);
          }
        }
      } catch (err: any) {
        if (err?.name === "ResourceNotFoundException") {
          calendarConnected = false;
        } else {
          console.error("Unable to read calendar secret metadata", err);
        }
      }
    }

    return jsonResponse(200, {
      status: "ok",
      tenantId,
      tenantName: tenant.tenantName ?? tenantId,
      calendarTokenSecret: tokenSecret,
      users: tenant.users ?? [],
      calendarConnected,
      calendarConnectedAt,
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
