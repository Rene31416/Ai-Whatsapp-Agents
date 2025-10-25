import { injectable } from "inversify";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  /** create a logger with sticky fields (e.g., tenantId/userId/reqId) */
  child(ctx: Record<string, string | number | boolean | null | undefined>): Logger;

  debug(event: string, data?: unknown): void;
  info(event: string, data?: unknown): void;
  warn(event: string, data?: unknown): void;
  error(event: string, data?: unknown): void;
}

/** Simple structured logger → CloudWatch Logs (JSON lines) */
@injectable()
export class ConsoleLogger implements Logger {
  private readonly levelOrder: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  private readonly minLevel: LogLevel;
  private readonly redact: boolean;
  private readonly ctx: Record<string, unknown>;

  constructor(baseCtx: Record<string, unknown> = {}) {
    // ENV knobs (optional)
    const envLevel = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
    this.minLevel = ["debug", "info", "warn", "error"].includes(envLevel) ? envLevel : "info";
    this.redact = (process.env.LOG_REDACT || "true").toLowerCase() === "true";
    this.ctx = { service: process.env.SERVICE_NAME || "chat-lambda", ...baseCtx };
  }

  child(ctx: Record<string, unknown>): Logger {
    return new ConsoleLogger({ ...this.ctx, ...ctx });
  }

  debug(event: string, data?: unknown) { this.emit("debug", event, data); }
  info(event: string, data?: unknown)  { this.emit("info",  event, data); }
  warn(event: string, data?: unknown)  { this.emit("warn",  event, data); }
  error(event: string, data?: unknown) { this.emit("error", event, data); }

  private emit(level: LogLevel, event: string, data?: unknown) {
    if (this.levelOrder[level] < this.levelOrder[this.minLevel]) return;

    const base = {
      ts: new Date().toISOString(),
      level,
      event,
      ...this.ctx,
    };

    const payload = this.redact ? this.maybeRedact(data) : data;

    // Single JSON per log line → easy for CloudWatch Logs Insights
    const line = JSON.stringify(payload ? { ...base, data: payload } : base);
    // Use console.* to route to CW logs with proper severity
    switch (level) {
      case "debug": console.debug(line); break;
      case "info":  console.info(line);  break;
      case "warn":  console.warn(line);  break;
      case "error": console.error(line); break;
    }
  }

  private maybeRedact(data: unknown): unknown {
    if (!data || typeof data !== "object") return data;
    const seen = new WeakSet<object>();
    const redactKeys = new Set(["token", "accessToken", "authorization", "password", "secret", "WA_TOKEN"]);
    const truncateKeys = new Set(["combinedText", "reply", "body"]);

    const clone = (obj: any): any => {
      if (obj === null || typeof obj !== "object") return obj;
      if (seen.has(obj)) return "[Circular]";
      seen.add(obj);

      if (Array.isArray(obj)) return obj.map(clone);

      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (redactKeys.has(k)) { out[k] = "[REDACTED]"; continue; }
        if (truncateKeys.has(k) && typeof v === "string") {
          out[k] = v.length > 256 ? v.slice(0, 256) + "…[trunc]" : v;
          continue;
        }
        out[k] = clone(v as any);
      }
      return out;
    };

    return clone(data as any);
  }
}
