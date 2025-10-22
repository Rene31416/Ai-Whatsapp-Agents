import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import axios from "axios";

let cachedKey: string | null = null;
let llmInstance: ChatGoogleGenerativeAI | null = null;

async function getApiKey(): Promise<string> {
  if (cachedKey !== null) return cachedKey;

  if (!process.env.GEMINI_SECRET_ARN) {
    const localKey = process.env.GOOGLE_API_KEY;
    if (!localKey) {
      throw new Error(
        "Missing both GEMINI_SECRET_ARN and GOOGLE_API_KEY. Set one of them."
      );
    }
    cachedKey = localKey;
    console.log("🔑 Using local GOOGLE_API_KEY for Gemini");
    return cachedKey;
  }

  const arn = process.env.GEMINI_SECRET_ARN;
  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: arn })
  );

  if (!response.SecretString)
    throw new Error("Empty secret value from Secrets Manager");

  const secret = JSON.parse(response.SecretString);
  cachedKey = secret.GOOGLE_API_KEY;
  if (!cachedKey) throw new Error("GOOGLE_API_KEY missing in secret JSON");
  console.log("🔒 Retrieved Google API key from Secrets Manager");
  return cachedKey;
}

// ⚠️ Deja el modelo SIN hyperparams aquí.
//    Todo lo que sea temperature/maxOutputTokens/responseMimeType/safetySettings
//    lo seteamos con .bind() por llamada.
export async function getLLM(): Promise<ChatGoogleGenerativeAI> {
  if (llmInstance) return llmInstance;
  const apiKey = await getApiKey();

  llmInstance = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash-lite",
    apiKey,
  });

  console.log("✨ Gemini LLM initialized");
  return llmInstance;
}

// (Opcional) helper si querés un “tuned” ya listo cuando te convenga:
export async function getTunedLLM(opts?: {
  temperature?: number;
  top_p?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  safetySettings?: any; // ver doc de google-genai si querés tiparlo
}) {
  const base = await getLLM();
  return (base as any).bind?.({
    temperature: 0.35,
    top_p: 0.9,
    maxOutputTokens: 192,
    responseMimeType: "application/json",
    // Safety permisivo para evitar cortes por seguridad en frases inofensivas:
    // Ajustalo a tu gusto/riesgo.
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
    ...(opts ?? {}),
  }) ?? base;
}

export async function sendWhatsappText(
  toWaId: string,
  text: string,
  accessToken: string,
  phoneNumberId: string
) {
  const apiUrl = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: toWaId,
    type: "text",
    text: { body: text.slice(0, 4096) },
  };

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  try {
    const response = await axios.post(apiUrl, payload, {
      headers,
      timeout: 15000,
    });
    return response.data;
  } catch (error: any) {
    console.error(
      "❌ WhatsApp send error:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// models.ts (o donde centralices integraciones)

let cachedTenantSecrets: Record<
  string,
  {
    WHATSAPP_ACCESS_TOKEN: string;
    WHATSAPP_PHONE_NUMBER_ID: string;
    VERIFY_TOKEN: string;
  }
> = {};

/**
 * Devuelve credenciales de WhatsApp para un tenant/phoneNumberId.
 * - Si pasas `phoneNumberId` (en tu Lambda lo usas como tenantId), se intenta cargar
 *   el secreto `${process.env.WHATSAPP_SECRET_ARN}${phoneNumberId}` y se cachea.
 * - Si no pasas `phoneNumberId`, usa `${baseArn}default` (útil para handshakes).
 */
export async function getWhatsappSecrets(phoneNumberId?: string) {
  if (phoneNumberId && cachedTenantSecrets[phoneNumberId]) {
    return cachedTenantSecrets[phoneNumberId];
  }

  const baseArn = process.env.WHATSAPP_SECRET_ARN!;
  if (!baseArn) {
    throw new Error("WHATSAPP_SECRET_ARN env is required");
  }

  // Cuando llamas con tenantId, construimos ARN específico por tenant.
  const secretArn = phoneNumberId
    ? `${baseArn}${phoneNumberId}`
    : `${baseArn}default`;

  console.log("🔑 Fetching secret:", secretArn);

  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error(
      `Empty secret value from Secrets Manager for ${phoneNumberId || "default"}`
    );
  }

  const secret = JSON.parse(response.SecretString);
  const secrets = {
    WHATSAPP_ACCESS_TOKEN: secret.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: secret.WHATSAPP_PHONE_NUMBER_ID,
    VERIFY_TOKEN: secret.VERIFY_TOKEN,
  };

  if (!secrets.WHATSAPP_ACCESS_TOKEN || !secrets.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error(
      `Missing required WhatsApp fields in secret for ${phoneNumberId || "default"}`
    );
  }

  if (phoneNumberId) {
    cachedTenantSecrets[phoneNumberId] = secrets;
  }

  console.log(
    `🔒 Retrieved WhatsApp secrets for ${phoneNumberId || "default"}`
  );
  return secrets;
}


export interface State {
  message?: string;
  memory?: string;
  history?: any[];
  category?: string;
  final_answer?: string;
  [key: string]: any;
}

export const CLINIC_CONTEXT = {
  name: "Opal Dental Clinic",
  address: "123 Main St, San Salvador",
  hours: "Mon–Fri 9:00–17:00",
  phone: "+503 2222-3333",
  website: "www.opaldental.com",
};
