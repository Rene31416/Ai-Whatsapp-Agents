import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import axios from "axios";
import { injectable, inject } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";

/** Minimal shape for WhatsApp credentials loaded from Secrets Manager */
export type WhatsappSecrets = {
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  VERIFY_TOKEN: string;
};

/** Interface kept tiny for easy mocking in tests */
export interface IWhatsappService {
  /**
   * Load and cache WA credentials for a tenant (phoneNumberId in your current design).
   * Throws if any required field is missing.
   */
  getSecrets(phoneNumberId?: string): Promise<WhatsappSecrets>;

  /**
   * Send a WhatsApp text message via WA Cloud API.
   * Throws on non-2xx responses.
   */
  sendText(toWaId: string, text: string, secrets: WhatsappSecrets): Promise<void>;
}

@injectable()
export class WhatsappService implements IWhatsappService {
  // In-memory cache by tenant key ("default" or specific phoneNumberId)
  private cache: Record<string, WhatsappSecrets> = {};

  // AWS clients are lightweight; keeping one instance per class is fine
  private sm = new SecretsManagerClient({});

  // Base ARN/prefix to construct secret ARNs (e.g., `${baseArn}${phoneNumberId}`)
  private baseArn = process.env.WHATSAPP_SECRET_ARN!;

  constructor(@inject(Logger) private readonly log: Logger) {}

  /**
   * Get WhatsApp secrets for a given tenant/phoneNumberId.
   * - Uses local in-memory cache first.
   * - If `phoneNumberId` is omitted, uses `${baseArn}default` (useful for handshakes).
   * - Logs only meta (no secret values).
   */
  async getSecrets(phoneNumberId?: string): Promise<WhatsappSecrets> {
    if (!this.baseArn) {
      // Fail fast if env is not configured; this is a deployment/config issue
      throw new Error("WHATSAPP_SECRET_ARN env is required");
    }

    const cacheKey = phoneNumberId || "default";
    const cached = this.cache[cacheKey];
    if (cached) {
      // Cache hit: avoid Secrets Manager latency/cost
      this.log.info("wa.secrets.cache.hit", { cacheKey });
      return cached;
    }

    // Build the concrete secret ARN from the base plus tenant suffix
    const secretArn = phoneNumberId ? `${this.baseArn}${phoneNumberId}` : `${this.baseArn}default`;

    this.log.info("wa.secrets.fetch.start", { cacheKey });

    // Read from Secrets Manager (single Get is enough)
    const res = await this.sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
    if (!res.SecretString) {
      // Rare but explicit: secret exists but has no payload
      throw new Error(`Empty secret for ${cacheKey}`);
    }

    // Parse JSON and validate the expected keys
    const raw = JSON.parse(res.SecretString);
    const secrets: WhatsappSecrets = {
      WHATSAPP_ACCESS_TOKEN: raw.WHATSAPP_ACCESS_TOKEN,
      WHATSAPP_PHONE_NUMBER_ID: raw.WHATSAPP_PHONE_NUMBER_ID,
      VERIFY_TOKEN: raw.VERIFY_TOKEN,
    };

    if (!secrets.WHATSAPP_ACCESS_TOKEN || !secrets.WHATSAPP_PHONE_NUMBER_ID) {
      // Fail fast: misconfigured secret should be fixed in infra, not retried forever
      throw new Error(`Missing WA fields in secret for ${cacheKey}`);
    }

    // Cache and log minimal meta (never log token values)
    this.cache[cacheKey] = secrets;
    this.log.info("wa.secrets.fetch.ok", {
      cacheKey,
      phoneIdSuffix: secrets.WHATSAPP_PHONE_NUMBER_ID.slice(-6),
    });

    return secrets;
  }

  /**
   * Send a plain text message through WhatsApp Cloud API.
   * - Uses axios for timeout control (15s).
   * - Truncates body to 4096 chars (API safety).
   * - Logs success/failure without exposing PII or token contents.
   */
  async sendText(toWaId: string, text: string, secrets: WhatsappSecrets): Promise<void> {
    // Endpoint for the tenant’s phone number id
    const url = `https://graph.facebook.com/v20.0/${secrets.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    // WhatsApp payload for a simple text message
    const body = {
      messaging_product: "whatsapp",
      to: toWaId,
      type: "text",
      text: { body: (text ?? "").slice(0, 4096) }, // defensive limit
    };

    try {
      await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${secrets.WHATSAPP_ACCESS_TOKEN}`, // secure header; never log
          "Content-Type": "application/json",
        },
        timeout: 15000, // keep user latency reasonable and fail fast on networking issues
      });

      // Minimal, useful logging; avoid logging the full message content
      this.log.info("wa.send.ok", {
        to: toWaId,
        len: body.text.body.length,
      });
    } catch (e: any) {
      // Extract a readable message while avoiding large response dumps
      const errMsg = e?.response?.data || e?.message || "unknown-error";
      this.log.error("wa.send.fail", { to: toWaId, err: errMsg });
      throw e;
    }
  }
}
