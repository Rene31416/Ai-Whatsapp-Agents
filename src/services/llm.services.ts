// src/services/llm.ts
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

let cachedGeminiKey: string | null = null;
let cachedOpenAIKey: string | null = null;
let llmInstance: any = null;

/** Resolve Google API key either from ENV (GOOGLE_API_KEY) or Secrets Manager (GEMINI_SECRET_ARN). */
async function getGeminiApiKey(): Promise<string> {
  if (cachedGeminiKey !== null) return cachedGeminiKey;

  if (!process.env.GEMINI_SECRET_ARN) {
    const localKey = process.env.GOOGLE_API_KEY;
    if (!localKey) {
      throw new Error("Missing both GEMINI_SECRET_ARN and GOOGLE_API_KEY. Set one of them.");
    }
    cachedGeminiKey = localKey;
    return cachedGeminiKey;
  }

  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: process.env.GEMINI_SECRET_ARN! })
  );
  if (!response.SecretString) throw new Error("Empty secret value from Secrets Manager");

  const secret = JSON.parse(response.SecretString);
  cachedGeminiKey = secret.GOOGLE_API_KEY;
  if (!cachedGeminiKey) throw new Error("GOOGLE_API_KEY missing in secret JSON");
  return cachedGeminiKey;
}

/** Resolve OpenAI key from Secret if present, else fallback to env var. */
async function getOpenAIApiKey(): Promise<string> {
  if (cachedOpenAIKey) return cachedOpenAIKey;
  const secretArn = process.env.OPENAI_SECRET_ARN;
  if (secretArn) {
    const client = new SecretsManagerClient({});
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretArn })
    );
    if (!response.SecretString)
      throw new Error("Empty OpenAI secret value from Secrets Manager");
    const secret = JSON.parse(response.SecretString);
    cachedOpenAIKey = secret.OPENAI_API_KEY;
    if (!cachedOpenAIKey)
      throw new Error("OPENAI_API_KEY missing in OpenAI secret JSON");
    return cachedOpenAIKey;
  }
  const envKey = process.env.OPENAI_API_KEY;
  if (!envKey) {
    throw new Error(
      "OPENAI_API_KEY or OPENAI_SECRET_ARN is required when LLM_PROVIDER=openai"
    );
  }
  cachedOpenAIKey = envKey;
  return cachedOpenAIKey;
}

/**
 * Get a singleton LLM instance.
 * - Default: Gemini (MODEL = GEMINI_MODEL || gemini-2.5-flash-lite) using GOOGLE_API_KEY or GEMINI_SECRET_ARN.
 * - If LLM_PROVIDER=openai: uses ChatOpenAI with OPENAI_API_KEY and OPENAI_MODEL (default gpt-4.1-mini).
 */
export async function getLLM(): Promise<any> {
  if (llmInstance) return llmInstance;
  const provider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  if (provider === "openai") {
    let ChatOpenAICtor: any;
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore -- optional dependency
      ChatOpenAICtor = (await import("@langchain/openai")).ChatOpenAI;
    } catch (err) {
      throw new Error(
        "LLM_PROVIDER=openai pero no se pudo cargar '@langchain/openai'. Añade la dependencia o ajusta la configuración."
      );
    }
    const apiKey = await getOpenAIApiKey();
    llmInstance = new ChatOpenAICtor({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      apiKey,
      temperature: 0.3,
    }) as any;
    (llmInstance as any).__provider = "openai";
    return llmInstance as any;
  }
  const apiKey = await getGeminiApiKey();
  llmInstance = new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite",
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
  if ((base as any).__provider === "openai") {
    return (base as any).bind?.(
      {
        ...(opts ?? {}),
        temperature: opts?.temperature ?? 0.3,
        response_format: { type: "json_object" },
      }
    ) ?? base;
  }
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
