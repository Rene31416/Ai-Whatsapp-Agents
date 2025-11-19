import { injectable, inject } from "inversify";
import { Logger } from "@aws-lambda-powertools/logger";
import axios from "axios";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { TenantRepository } from "./tenant.repository";

export interface WhatsappSecrets {
  WHATSAPP_ACCESS_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  VERIFY_TOKEN?: string;
}

@injectable()
export class WhatsappService {
  constructor(
    @inject(Logger) private readonly log: Logger,
    @inject(TenantRepository) private readonly tenants: TenantRepository
  ) {}

  /**
   * Return WhatsApp API credentials for a given tenant.
   *
   * In Lambda:
   *   - Fetches from Secrets Manager: `${WHATSAPP_SECRET_ARN}${tenantId}`
   *
   * In local dev (LOCAL_DRY_RUN === "true"):
   *   - Does NOT call Secrets Manager
   *   - Returns dummy-but-shaped creds from local env vars
   *     so that the rest of the pipeline keeps running.
   */
  
  async getSecrets(tenantId: string): Promise<WhatsappSecrets> {
    console.log("[WhatsappService] Resolving WhatsApp secrets", {
      tenantId,
      localDryRun: process.env.LOCAL_DRY_RUN === "true",
    });

    // Local dry-run path: don't talk to AWS SM
    if (process.env.LOCAL_DRY_RUN === "true") {
      const localToken =
        process.env.LOCAL_WHATSAPP_ACCESS_TOKEN ?? "DUMMY_TOKEN_LOCAL";
      const localPhoneId =
        process.env.LOCAL_WHATSAPP_PHONE_NUMBER_ID ?? "DUMMY_PHONE_LOCAL";

      this.log.info("whatsapp.secrets.local", {
        tenantId,
        phoneIdSuffix: localPhoneId.slice(-6),
      });

      return {
        WHATSAPP_ACCESS_TOKEN: localToken,
        WHATSAPP_PHONE_NUMBER_ID: localPhoneId,
        VERIFY_TOKEN: process.env.LOCAL_WHATSAPP_VERIFY_TOKEN ?? "DUMMY_VERIFY",
      };
    }

    // Lambda / real path
    const tenant = await this.tenants.getById(tenantId);
    if (!tenant?.whatsappSecretName) {
      throw new Error(`Tenant ${tenantId} missing whatsappSecretName`);
    }

    const secretId = this.resolveSecretId(
      tenant.whatsappSecretName,
      process.env.WHATSAPP_SECRET_ARN
    );

    const client = new SecretsManagerClient({});
    const res = await client.send(
      new GetSecretValueCommand({ SecretId: secretId })
    );

    if (!res.SecretString) {
      throw new Error("Empty secret value from Secrets Manager");
    }

    const parsed = JSON.parse(res.SecretString);

    const secrets: WhatsappSecrets = {
      WHATSAPP_ACCESS_TOKEN: parsed.WHATSAPP_ACCESS_TOKEN,
      WHATSAPP_PHONE_NUMBER_ID: parsed.WHATSAPP_PHONE_NUMBER_ID,
      VERIFY_TOKEN: parsed.VERIFY_TOKEN,
    };

    if (
      !secrets.WHATSAPP_ACCESS_TOKEN ||
      !secrets.WHATSAPP_PHONE_NUMBER_ID
    ) {
      throw new Error(
        `Missing required WhatsApp fields in secret for tenant ${tenantId}`
      );
    }

    console.log("[WhatsappService] Secrets fetched from Secrets Manager", {
      tenantId,
      secretIdTail: secretId.slice(-12),
    });

    this.log.info("whatsapp.secrets.fetched", {
      tenantId,
      phoneIdSuffix: secrets.WHATSAPP_PHONE_NUMBER_ID.slice(-6),
    });

    return secrets;
  }

  /**
   * Send a WhatsApp text message.
   *
   * If LOCAL_DRY_RUN === "true", we DO NOT call the WhatsApp API.
   * We just log what would've been sent.
   */
  async sendText(
    toWaId: string,
    text: string,
    creds: WhatsappSecrets
  ): Promise<void> {
    // Local dry-run: don't hit Meta API
    if (process.env.LOCAL_DRY_RUN === "true") {
      this.log.info("whatsapp.dry_run", {
        to: toWaId,
        len: text.length,
        preview: text.slice(0, 120),
      });
      console.log("[WhatsappService] LOCAL_DRY_RUN active, skipping WhatsApp API call", {
        to: toWaId,
        preview: text.slice(0, 80),
      });
      return;
    }

    // Real send
    const apiUrl = `https://graph.facebook.com/v20.0/${creds.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: toWaId,
      type: "text",
      text: { body: text.slice(0, 4096) },
    };

    const headers = {
      Authorization: `Bearer ${creds.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    };

    const response = await axios.post(apiUrl, payload, {
      headers,
      timeout: 15000,
    });

    console.log("[WhatsappService] WhatsApp API response", {
      to: toWaId,
      phoneIdTail: creds.WHATSAPP_PHONE_NUMBER_ID.slice(-6),
      status: response.status,
    });

    this.log.info("whatsapp.sent.ok", {
      to: toWaId,
      httpStatus: response.status,
    });
  }
 
  private resolveSecretId(secretName: string, prefix?: string): string {
    if (secretName.startsWith("arn:aws:secretsmanager")) {
      return secretName;
    }
    if (!prefix) {
      return secretName;
    }
    const normalizedPrefix = prefix.endsWith(":secret:")
      ? prefix
      : prefix.replace(/[^:]+$/, "");
    return `${normalizedPrefix}${secretName}`;
  }
}
