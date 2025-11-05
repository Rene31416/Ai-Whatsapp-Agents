// src/chat/memory.repository.ts
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { injectable, inject } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";

/**
 * Contact info we store for a given user.
 * Each field is optional.
 * null means "explicitly cleared".
 */
export interface ContactProfile {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  timezoneHint?: string | null;
}

/**
 * Full memory blob we persist in Dynamo under the "memory" attribute.
 * We can extend this later with more sections (preferences, etc.).
 */
export interface MemoryObject {
  contactProfile?: ContactProfile;
  // future: preferences?: { ... }
  // future: notes?: string;
}

/**
 * Optional short-term summary (you were already storing this).
 * We keep it because getMemory() was already returning it, even
 * if we're not actively updating it right now.
 */
export interface ShortTermMemory {
  summary?: string;
  windowSize?: number;
  lastTurnAt?: string;
}
@injectable()
export class MemoryRepository {
  private client = new DynamoDBClient({});
  private tableName = process.env.MEMORY_TABLE_NAME!; // injected by CDK

  constructor(@inject(Logger) private readonly log: Logger) {}

  /** Compose the DDB key from tenant & user */
  private key(tenantId: string, userId: string) {
    return { UserKey: { S: `${tenantId}#${userId}` } };
  }

  /**
   * Read structured long-term memory + short-term summary blob.
   * - Returns `{ memory: {}, stMemory?: {}, version?: number }`.
   * - Never throws on "not found"; returns empty shapes instead.
   */
  async getMemory(
    tenantId: string,
    userId: string
  ): Promise<{ memory: MemoryObject; stMemory?: ShortTermMemory; version?: number }> {
    const Key = this.key(tenantId, userId);
    this.log.info("repo.memory.get.start", { table: this.tableName });

    const res = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key,
        ConsistentRead: true,
      })
    );

    const item = res.Item ?? {};
    const memory = (fromAttr(item.memory) as MemoryObject) ?? {};
    const stMemory = (fromAttr(item.stMemory) as ShortTermMemory | undefined) ?? undefined;
    const version = item.version?.N ? Number(item.version.N) : undefined;

    this.log.info("repo.memory.get.done", {
      hasMemory: !!item.memory,
      hasST: !!item.stMemory,
      version: version ?? 0,
    });

    return { memory, stMemory, version };
  }


  /**
   * mergeMemoryDelta
   *
   * Deep-merges a partial patch into the user's existing memory and writes it back.
   *
   * Rules:
   * - `delta` is a partial object shaped like { contactProfile?: { ... } }.
   * - Any field set to `null` means "clear that field".
   * - Fields that are not present in `delta` remain untouched.
   *
   * This method:
   *   1. Reads current memory
   *   2. Applies a deep merge (respecting null to clear)
   *   3. Writes the new full memory map to DynamoDB
   *   4. Bumps `version` and `updatedAt`
   */
  async mergeMemoryDelta(
    tenantId: string,
    userId: string,
    delta: Partial<MemoryObject>
  ): Promise<void> {
    if (!delta || Object.keys(delta).length === 0) {
      this.log.info("repo.memory.merge.skip", { reason: "empty-delta" });
      return;
    }

    // 1. Read current memory
    const { memory: current } = await this.getMemory(tenantId, userId);

    // 2. Merge in-memory
    const merged = deepMerge(current ?? {}, delta);

    const Key = this.key(tenantId, userId);
    const now = new Date().toISOString();

    this.log.info("repo.memory.merge.write", {
      table: this.tableName,
      preview: safePreview(merged),
    });

    // 3. Persist full merged memory back to Dynamo
    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key,
        UpdateExpression: "SET #m = :m, updatedAt = :now ADD #v :one",
        ExpressionAttributeNames: {
          "#m": "memory",
          "#v": "version",
        },
        ExpressionAttributeValues: {
          ":m": toAttr(merged),
          ":now": { S: now },
          ":one": { N: "1" },
        },
      })
    );

    this.log.info("repo.memory.merge.ok");
  }

  /**
   * Upsert short-term summary (rolling digest of last N turns).
   * - Stores `{ summary, windowSize, lastTurnAt }` as `stMemory`.
   * - Trims summary to ~600 chars and normalizes whitespace.
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

    this.log.info("repo.memory.st.write", { len: clean.length, windowSize });

    await this.client.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key,
        UpdateExpression: "SET stMemory = :st, updatedAt = :now ADD #v :one",
        ExpressionAttributeNames: { "#v": "version" },
        ExpressionAttributeValues: {
          ":st": toAttr({ summary: clean, windowSize, lastTurnAt: now }),
          ":now": { S: now },
          ":one": { N: "1" },
        },
      })
    );

    this.log.info("repo.memory.st.ok");
  }
}

/* ----------------- helpers ----------------- */

function isPlainObject(x: any) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function deepMerge<T>(base: T, delta: Partial<T>): T {
  if (!delta) return base as T;
  const out: any = isPlainObject(base) ? { ...(base as any) } : {};
  for (const [k, v] of Object.entries(delta as any)) {
    if (v === undefined) continue;
    if (v === null) { out[k] = null; continue; }
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v as any);
    else out[k] = v;
  }
  return out as T;
}

function safePreview(obj: unknown) {
  try {
    const s = JSON.stringify(obj);
    return s.length > 280 ? s.slice(0, 280) + "…" : s;
  } catch { return "[unserializable]"; }
}

/** Convert JS value -> DynamoDB AttributeValue */
function toAttr(value: any): AttributeValue {
  if (value === null || value === undefined) return { NULL: true };
  const t = typeof value;
  if (t === "string") return { S: value };
  if (t === "number") return { N: String(value) };
  if (t === "boolean") return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(toAttr) };
  if (isPlainObject(value)) {
    const M: Record<string, AttributeValue> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) M[k] = toAttr(v);
    return { M };
  }
  return { S: String(value) };
}

/** Convert DynamoDB AttributeValue -> JS value */
function fromAttr(attr?: AttributeValue): any {
  if (!attr) return undefined;
  if ("NULL" in attr && attr.NULL) return null;
  if ("S" in attr && attr.S !== undefined) return attr.S;
  if ("N" in attr && attr.N !== undefined) return Number(attr.N);
  if ("BOOL" in attr && attr.BOOL !== undefined) return attr.BOOL;
  if ("L" in attr && attr.L) return attr.L.map(fromAttr);
  if ("M" in attr && attr.M) {
    const out: any = {};
    for (const [k, v] of Object.entries(attr.M)) out[k] = fromAttr(v);
    return out;
  }
  return undefined;
}
