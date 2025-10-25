// src/services/llm.ts
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

let cachedKey: string | null = null;
let llmInstance: ChatGoogleGenerativeAI | null = null;

/** Resolve Google API key either from ENV (GOOGLE_API_KEY) or Secrets Manager (GEMINI_SECRET_ARN). */
async function getApiKey(): Promise<string> {
  if (cachedKey !== null) return cachedKey;

  if (!process.env.GEMINI_SECRET_ARN) {
    const localKey = process.env.GOOGLE_API_KEY;
    if (!localKey) {
      throw new Error("Missing both GEMINI_SECRET_ARN and GOOGLE_API_KEY. Set one of them.");
    }
    cachedKey = localKey;
    return cachedKey;
  }

  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: process.env.GEMINI_SECRET_ARN! })
  );
  if (!response.SecretString) throw new Error("Empty secret value from Secrets Manager");

  const secret = JSON.parse(response.SecretString);
  cachedKey = secret.GOOGLE_API_KEY;
  if (!cachedKey) throw new Error("GOOGLE_API_KEY missing in secret JSON");
  return cachedKey;
}

/** Get a singleton LLM instance. Hyperparams are set per-call using `.bind()` (see getTunedLLM). */
export async function getLLM(): Promise<ChatGoogleGenerativeAI> {
  if (llmInstance) return llmInstance;
  const apiKey = await getApiKey();
  llmInstance = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash-lite",
    apiKey,
  });
  return llmInstance;
}

/** Optional helper that returns a tuned instance bound with defaults; override via opts. */
export async function getTunedLLM(opts?: {
  temperature?: number;
  top_p?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  safetySettings?: any;
}) {
  const base = await getLLM();
  return (base as any).bind?.({
    top_p: 0.9,
    maxOutputTokens: 192,
    responseMimeType: "application/json",
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
    ...(opts ?? {}),
  }) ?? base;
}

/** (Kept from your file) Types + context used elsewhere */
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
