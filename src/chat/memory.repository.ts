// src/chat/memory.repository.ts
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { injectable } from "inversify";

export interface MemoryObject {
  profile?: { name?: string };
  contact?: {
    phone?: string | null;
    email?: string | null;
  };
}

@injectable()
export class MemoryRepository {
  private client = new DynamoDBClient({});
  private tableName = process.env.MEMORY_TABLE_NAME!; // injected by CDK

  private key(tenantId: string, userId: string) {
    return { UserKey: { S: `${tenantId}#${userId}` } };
  }

  /**
   * Read structured long-term memory + short-term summary blob.
   * Returns empty objects if not found (no throws).
   */
  async getMemory(
    tenantId: string,
    userId: string
  ): Promise<{
    memory: MemoryObject;
    stMemory?: { summary?: string; windowSize?: number; lastTurnAt?: string };
    version?: number;
  }> {
    const Key = this.key(tenantId, userId);
    console.info("🧠 getMemory:read", { table: this.tableName, Key });

    const res = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key,
        ConsistentRead: true,
      })
    );

    const item = res.Item || {};
    const memory = (fromAttr(item.memory) as MemoryObject) || {};
    const stMemory = (fromAttr(item.stMemory) as any) || undefined;
    const versionStr = item.version?.N;
    const version = versionStr ? Number(versionStr) : undefined;

    console.info("🧠 getMemory:done", {
      hasMemory: !!item.memory,
      hasST: !!item.stMemory,
      version: version ?? 0,
    });

    return { memory, stMemory, version };
  }

  /**
   * Merge field-level delta into the structured memory object.
   * Accepts nulls to clear fields (e.g., contact.email = null).
   */
  async mergeMemoryDelta(
    tenantId: string,
    userId: string,
    delta: Partial<MemoryObject>
  ): Promise<void> {
    if (!delta || Object.keys(delta).length === 0) {
      console.info("💾 mergeMemoryDelta: no-op (empty delta)");
      return;
    }

    // Read current, merge client-side, then write full "memory" map.
    const { memory: current } = await this.getMemory(tenantId, userId);
    const merged = deepMerge(current ?? {}, delta);

    const Key = this.key(tenantId, userId);
    const now = new Date().toISOString();

    console.info("💾 mergeMemoryDelta:write", {
      table: this.tableName,
      Key,
      mergedPreview: safePreview(merged),
    });

    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key,
        UpdateExpression: "SET #m = :m, updatedAt = :now ADD #v :one",
        ExpressionAttributeNames: { "#m": "memory", "#v": "version" },
        ExpressionAttributeValues: {
          ":m": toAttr(merged),
          ":now": { S: now },
          ":one": { N: "1" },
        },
      })
    );

    console.info("💾 mergeMemoryDelta:ok", { Key });
  }

  /**
   * Upsert short-term summary (rolling last-10 digest).
   * Keeps a small blob with { summary, windowSize, lastTurnAt }.
   */
  async setShortTermSummary(
    tenantId: string,
    userId: string,
    summary: string,
    windowSize = 10
  ): Promise<void> {
    const Key = this.key(tenantId, userId);
    const now = new Date().toISOString();
    const clean = (summary ?? "").replace(/\s+/g, " ").trim().slice(0, 600);

    const st = {
      summary: clean,
      windowSize,
      lastTurnAt: now,
    };

    console.info("📝 setShortTermSummary:write", {
      table: this.tableName,
      Key,
      len: clean.length,
      windowSize,
    });

    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key,
        UpdateExpression: "SET stMemory = :st, updatedAt = :now ADD #v :one",
        ExpressionAttributeNames: { "#v": "version" },
        ExpressionAttributeValues: {
          ":st": toAttr(st),
          ":now": { S: now },
          ":one": { N: "1" },
        },
      })
    );

    console.info("📝 setShortTermSummary:ok", { Key });
  }
}

/* ----------------- helpers ----------------- */

function isPlainObject(x: any) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function deepMerge<T>(base: T, delta: Partial<T>): T {
  if (!delta) return base;
  const out: any = isPlainObject(base) ? { ...(base as any) } : {};
  for (const [k, v] of Object.entries(delta as any)) {
    if (v === undefined) continue;
    if (v === null) {
      out[k] = null; // explicit clearing
      continue;
    }
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function safePreview(obj: unknown) {
  try {
    const s = JSON.stringify(obj);
    return s.length > 280 ? s.slice(0, 280) + "…" : s;
  } catch {
    return "[unserializable]";
  }
}

/**
 * Convert JS value -> DynamoDB AttributeValue
 * Supports: null, string, number, boolean, arrays, plain objects.
 * (We mainly use strings, numbers, nulls, and maps here.)
 */
function toAttr(value: any): AttributeValue {
  if (value === null || value === undefined) return { NULL: true };
  const t = typeof value;

  if (t === "string") return { S: value };
  if (t === "number") return { N: String(value) };
  if (t === "boolean") return { BOOL: value };

  if (Array.isArray(value)) {
    // Mixed arrays -> L (list)
    return { L: value.map((v) => toAttr(v)) };
  }

  if (isPlainObject(value)) {
    const M: Record<string, AttributeValue> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      M[k] = toAttr(v);
    }
    return { M };
  }

  // Fallback to string
  return { S: String(value) };
}

/**
 * Convert DynamoDB AttributeValue -> JS value
 */
function fromAttr(attr?: AttributeValue): any {
  if (!attr) return undefined;
  if ("NULL" in attr && attr.NULL) return null;
  if ("S" in attr && attr.S !== undefined) return attr.S;
  if ("N" in attr && attr.N !== undefined) return Number(attr.N);
  if ("BOOL" in attr && attr.BOOL !== undefined) return attr.BOOL;
  if ("L" in attr && attr.L) return attr.L.map((v) => fromAttr(v));
  if ("M" in attr && attr.M) {
    const out: any = {};
    for (const [k, v] of Object.entries(attr.M)) out[k] = fromAttr(v);
    return out;
  }
  return undefined;
}
