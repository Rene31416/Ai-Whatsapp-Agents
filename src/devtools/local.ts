// src/devtools/local-repl.ts
//
// Minimal local runner that simulates "one SQS message triggers the Lambda".
// For each line you type:
//   - Build a fake SQSEvent with tenantId/userId/combinedText
//   - Call the real Lambda handler(event)
//   - ChatService does everything (persist, workflow, post-ops, etc.)
// WhatsApp send is skipped if LOCAL_DRY_RUN=true.

import "reflect-metadata";
import { createInterface } from "node:readline";
import { handler } from "../app/lambda-handlers/chatService";
import { SQSEvent, SQSRecord } from "aws-lambda";
import { container } from "../app/container";
import { TenantRepository } from "../services/tenant.repository";

// Tenant/user to simulate in this session
let TENANT_ID = "";
const USER_ID = process.env.LOCAL_USER_ID || "local-user";

// Region for AWS SDK v3
process.env.AWS_REGION ||= "us-east-1";

// Prevent real WhatsApp sends in local mode
process.env.LOCAL_DRY_RUN ||= "true";

// Basic sanity checks: these env v ars must exist or the repos will fail
if (!process.env.MEMORY_TABLE_NAME) {
  console.error("MEMORY_TABLE_NAME env is required for local test");
}
if (!process.env.CHAT_SESSIONS_TABLE_NAME) {
  console.error("CHAT_SESSIONS_TABLE_NAME env is required for local test");
}
if (!process.env.TENANT_TABLE_NAME) {
  console.error("TENANT_TABLE_NAME env is required for local test");
}
// For LLM: locally we usually just set GOOGLE_API_KEY.
if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_SECRET_ARN && !process.env.OPENAI_API_KEY && !process.env.OPENAI_SECRET_ARN ) {
  console.warn("⚠️ No llm api key or secret arn. LLM may fail.");
}

// Build a single-record SQSEvent like SQS → Lambda would send
function makeFakeSqsEvent(
  tenantId: string,
  userId: string,
  text: string
): SQSEvent {
  const bodyPayload = {
    tenantId,
    userId,
    combinedText: text,
    messageCount: 1,
    version: 1,
    flushedAt: new Date().toISOString(),
  };

  const record: SQSRecord = {
    messageId: crypto.randomUUID(),
    receiptHandle: "local",
    body: JSON.stringify(bodyPayload),
    attributes: {
      ApproximateReceiveCount: "1",
      SentTimestamp: Date.now().toString(),
      SenderId: "local",
      ApproximateFirstReceiveTimestamp: Date.now().toString(),
      AWSTraceHeader: "",
    },
    messageAttributes: {},
    md5OfBody: "local",
    eventSource: "aws:sqs",
    eventSourceARN: "arn:aws:sqs:local:000000000000:devQueue",
    awsRegion: process.env.AWS_REGION || "us-east-1",
  };

  return { Records: [record] };
}

// One turn: user text → fake SQSEvent → call handler
async function runTurn(inputText: string): Promise<void> {
  const trimmed = (inputText ?? "").trim();
  if (!trimmed) return;


  console.log("👤 You :", trimmed);

  const event = makeFakeSqsEvent(TENANT_ID, USER_ID, trimmed);

  try {
    await handler(event as any);
    console.log("🤖 Bot : (see ChatService logs above)");
  } catch (err) {
    console.error("❌ Handler error:", (err as Error)?.message);
    console.log("🤖 Bot : (error; reply may not have been sent)");
  }

  console.log("──────────────────────────────────────\n");
}

// Simple readline loop
const rl = createInterface({ input: process.stdin, output: process.stdout });

function askNext() {
  rl.question("› You: ", async (line: string) => {
    const text = (line || "").trim();
    if (!text || text.toLowerCase() === "exit") {
      rl.close();
      return;
    }

    try {
      await runTurn(text);
    } catch (err) {
      console.error("runTurn exploded:", (err as Error)?.message);
    }

    askNext();
  });
}

async function resolveTenantId(): Promise<string> {
  const explicitTenant = process.env.LOCAL_TENANT_ID;
  if (explicitTenant) {
    return explicitTenant;
  }

  const phoneId = process.env.LOCAL_TENANT_PHONE_NUMBER_ID;
  if (!phoneId) {
    throw new Error(
      "Set LOCAL_TENANT_PHONE_NUMBER_ID or LOCAL_TENANT_ID before running the local REPL"
    );
  }

  try {
    const repo = container.get(TenantRepository);
    const tenant = await repo.getByPhoneNumberId(phoneId);
    if (!tenant) {
      throw new Error(`No tenant found for phoneNumberId=${phoneId}`);
    }
    return tenant.tenantId;
  } catch (err) {
    console.error("Failed to resolve tenant by phone:", err);
    throw err;
  }
}

async function main() {
  try {
    TENANT_ID = await resolveTenantId();
  } catch {
    process.exit(1);
  }

  console.log("Local Chat REPL ready.");
  console.log(`tenantId=${TENANT_ID} userId=${USER_ID}`);
  console.log("Type a message, or 'exit' to quit.\n");

  askNext();
}

main().catch((err) => {
  console.error("Fatal error starting local REPL:", err);
  process.exit(1);
});
