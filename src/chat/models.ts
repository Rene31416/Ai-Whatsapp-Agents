import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import axios from "axios";

let cachedKey: string | null = null;
let llmInstance: ChatGoogleGenerativeAI | null = null;

async function getApiKey(): Promise<string> {
  // ✅ Return cached key if available
  if (cachedKey !== null) return cachedKey;

  // ✅ Fallback for local development
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

  // ✅ Running in AWS — use Secrets Manager
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

let cachedTenantSecrets: Record<
  string,
  {
    WHATSAPP_ACCESS_TOKEN: string;
    WHATSAPP_PHONE_NUMBER_ID: string;
    VERIFY_TOKEN: string;
  }
> = {};

export async function getWhatsappSecrets(phoneNumberId?: string) {
  if (phoneNumberId && cachedTenantSecrets[phoneNumberId]) return cachedTenantSecrets[phoneNumberId];

  // Use default secret for verification handshake (no tenant context)
  const baseArn = process.env.WHATSAPP_SECRET_ARN!;
  const secretArn = phoneNumberId ? `${baseArn}${phoneNumberId}` : `${baseArn}default`; // fallback

  console.log("🔑 Fetching secret:", secretArn);

  const client = new SecretsManagerClient({});
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));

  if (!response.SecretString)
    throw new Error(`Empty secret value from Secrets Manager for ${phoneNumberId || "default"}`);

  const secret = JSON.parse(response.SecretString);
  const secrets = {
    WHATSAPP_ACCESS_TOKEN: secret.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: secret.WHATSAPP_PHONE_NUMBER_ID,
    VERIFY_TOKEN: secret.VERIFY_TOKEN,
  };

  if (phoneNumberId) cachedTenantSecrets[phoneNumberId] = secrets;
  console.log(`🔒 Retrieved WhatsApp secrets for ${phoneNumberId || "default"}`);
  return secrets;
}


export async function getLLM(): Promise<ChatGoogleGenerativeAI> {
  if (llmInstance) return llmInstance; // ✅ cached between Lambda invocations

  const apiKey = await getApiKey();

  llmInstance = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    temperature: 0.4,
    maxOutputTokens: 2048,
    apiKey,
  });

  console.log("✨ Gemini LLM initialized");
  return llmInstance;
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
