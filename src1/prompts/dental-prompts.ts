import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { llm } from "../models";
import { CLINIC_CONTEXT } from "../util/clinic-context";

export async function summarizeMemory(state: any): Promise<any> {

  const recent = (state.history ?? []).slice(-10);
  const historyBlob = recent.map((msg: any) => JSON.stringify(msg)).join("\n");

  const prompt = new PromptTemplate({
    inputVariables: ["history"],
    template: `
        You are a memory module.
        Create a concise summary (2–3 sentences) of the following recent conversation so the assistant can keep context.

        history:
        {history}`,
  });

  const chain = RunnableSequence.from([prompt, llm]);
  const result = await chain.invoke({ history: historyBlob });

  const memory = extractContent(result)?.trim() ?? "";
  console.log(`🧠 summarizeMemory result: ${memory}`);
  return { ...state, memory };
}


export async function categorize(state: any): Promise<any> {
  const prompt = new PromptTemplate({
    inputVariables: ["message", "memory"],
    template: `
You are a classifier for a dental clinic chat.

Choose **only one** of these categories:
- ServiceFAQs
- Logistics
- SmallTalk
- Schedule
- LowConfidence

Rules:
- If it's greetings, thanks, or emojis → SmallTalk
- If it's about treatments, pain, duration, pricing → ServiceFAQs
- If it's about location, hours, payment, contact → Logistics
- If it's about booking or rescheduling → Schedule
- If unclear → LowConfidence

Answer with **only** the category name (no JSON, no explanations).

Message: {message}
Memory: {memory}
`,
  });

  const chain = RunnableSequence.from([prompt, llm]);
  const result = await chain.invoke({
    message: state.message ?? "",
    memory: state.memory ?? "",
  });

  const raw = extractContent(result)?.trim() ?? "";
  console.log(`🧠 categorize raw output: ${raw}`);

  // Normalize result (remove quotes, punctuation, etc.)
  const clean = raw.replace(/["'.]/g, "").trim();
  const validCategories = [
    "ServiceFAQs",
    "Logistics",
    "SmallTalk",
    "Schedule",
    "LowConfidence",
  ];
  const match = validCategories.find(
    (c) => clean.toLowerCase() === c.toLowerCase()
  );

  const category = match || "LowConfidence";
  console.log(`🧩 Final category: ${category}`);

  return { ...state, category };
}


export async function formulateFinalAnswerSchedule(state: any): Promise<any> {
  console.log("🧩 Running node: formulateFinalAnswerSchedule");

  const prompt = new PromptTemplate({
    inputVariables: ["message", "memory"],
    template: `
You are the scheduling assistant for a dental clinic.

Task:
- Reply in 1–2 sentences to move scheduling forward (ask for preferred day/time and name/phone if needed).
- Always take conversation memory into account.
- No markdown, no bullets.

User message: {message}
Memory: {memory}`,
  });

  const chain = RunnableSequence.from([prompt, llm]);
  const result = await chain.invoke({
    message: state.message ?? "",
    memory: state.memory ?? "",
  });

  const final_answer = extractContent(result) ?? "";
  console.log(`🦷 schedule answer: ${final_answer}`);
  return { ...state, final_answer };
}

export async function formulateFinalAnswerInfo(state: any): Promise<any> {
  console.log("🧩 Running node: formulateFinalAnswerInfo");

  const clinic = CLINIC_CONTEXT;
  const prompt = new PromptTemplate({
    inputVariables: [
      "clinic_name",
      "clinic_address",
      "clinic_hours",
      "clinic_phone",
      "clinic_website",
      "message",
      "memory",
    ],
    template: `
You are an assistant for {clinic_name}.

Context:
- Address: {clinic_address}
- Hours: {clinic_hours}
- Phone: {clinic_phone}
- Website: {clinic_website}

Task:
- Provide a clear, concise info answer in 1–2 sentences.
- No markdown, no bullets.

User message: {message}
Memory: {memory}`,
  });

  const chain = RunnableSequence.from([prompt, llm]);
  const result = await chain.invoke({
    message: state.message ?? "",
    memory: state.memory ?? "",
    clinic_name: clinic.name ?? "",
    clinic_address: clinic.address ?? "",
    clinic_hours: clinic.hours ?? "",
    clinic_phone: clinic.phone ?? "",
    clinic_website: clinic.website ?? "",
  });

  const final_answer = extractContent(result) ?? "";
  console.log(`ℹ️ info answer: ${final_answer}`);
  return { ...state, final_answer };
}

export async function formulateFinalAnswerSmallTalk(state: any): Promise<any> {
  console.log("🧩 Running node: formulateFinalAnswerSmallTalk");

  const clinic = CLINIC_CONTEXT;
  const prompt = new PromptTemplate({
    inputVariables: ["clinic_name", "message", "memory"],
    template: `
You are a friendly assistant for {clinic_name}.

Task:
- Respond naturally to small talk (greetings, thanks, emojis, brief acknowledgements) in a warm tone.
- Always take conversation memory into account: if there is an ongoing topic or unresolved request in memory, add ONE short follow-up to move it forward; otherwise just reply to the small talk.
- If an organization name is provided, you may include it naturally in greetings; if not provided, do not invent one.
- Keep it to ONE sentence. No markdown, no bullets.

User message: {message}
Memory (summary): {memory}`,
  });

  const chain = RunnableSequence.from([prompt, llm]);
  const result = await chain.invoke({
    message: state.message ?? "",
    memory: state.memory ?? "",
    clinic_name: clinic.name ?? "",
  });

  const final_answer = extractContent(result) ?? "";
  console.log(`💬 smalltalk answer: ${final_answer}`);
  return { ...state, final_answer };
}

export async function formulateFinalAnswerLowConfidence(
  state: any
): Promise<any> {
  console.log("🧩 Running node: formulateFinalAnswerLowConfidence");

  const prompt = new PromptTemplate({
    inputVariables: ["message", "memory"],
    template: `
You are an assistant for a dental clinic. The user’s intent is unclear.

Task:
- Ask politely for clarification in 1 short sentence.
- Always take the conversation memory into account.
- Keep it friendly and simple.
- No markdown, no bullets.

User message: {message}
Memory: {memory}`,
  });

  const chain = RunnableSequence.from([prompt, llm]);
  const result = await chain.invoke({
    message: state.message ?? "",
    memory: state.memory ?? "",
  });

  const final_answer = extractContent(result) ?? "";
  console.log(`❓ lowconfidence answer: ${final_answer}`);
  return { ...state, final_answer };
}

export function extractContent(result: any): string {
  if (!result) return "";
  if (typeof result.content === "string") return result.content.trim();
  if (Array.isArray(result.content))
    return result.content
      .map((c: any) => (typeof c === "string" ? c : c.text ?? ""))
      .join(" ")
      .trim();
  return "";
}
