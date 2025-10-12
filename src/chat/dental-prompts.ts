import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { getLLM, CLINIC_CONTEXT } from "./models";

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

// --- summarize memory ---
export async function summarizeMemory(state: any) {
  const llm = await getLLM();
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

  console.log(`🧠 summarizeMemory: ${memory}`);
  return { ...state, memory };
}

// --- categorize message ---
export async function categorize(state: any) {
  const llm = await getLLM();
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

Answer with **only** the category name.

Message: {message}
Memory: {memory}`,
  });

  const chain = RunnableSequence.from([prompt, llm]);
  const result = await chain.invoke({
    message: state.message ?? "",
    memory: state.memory ?? "",
  });

  const raw = extractContent(result)?.trim() ?? "";
  const clean = raw.replace(/["'.]/g, "").trim();
  const valid = ["ServiceFAQs", "Logistics", "SmallTalk", "Schedule", "LowConfidence"];
  const category =
    valid.find((c) => clean.toLowerCase() === c.toLowerCase()) || "LowConfidence";

  console.log(`🧩 category: ${category}`);
  return { ...state, category };
}

// --- formulate final answers ---
export async function formulateFinalAnswerSchedule(state: any) {
  const llm = await getLLM();
  const prompt = new PromptTemplate({
    inputVariables: ["message", "memory"],
    template: `
You are the scheduling assistant for a dental clinic.
Reply in 1–2 sentences to move scheduling forward (ask for day/time, name/phone if needed).
No markdown, no bullets.

User: {message}
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

export async function formulateFinalAnswerInfo(state: any) {
  const llm = await getLLM();
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
Answer clearly in 1–2 sentences.
No markdown, no bullets.

User: {message}
Memory: {memory}`,
  });

  const chain = RunnableSequence.from([prompt, llm]);
  const result = await chain.invoke({
    message: state.message ?? "",
    memory: state.memory ?? "",
    clinic_name: clinic.name,
    clinic_address: clinic.address,
    clinic_hours: clinic.hours,
    clinic_phone: clinic.phone,
    clinic_website: clinic.website,
  });

  const final_answer = extractContent(result) ?? "";
  console.log(`ℹ️ info answer: ${final_answer}`);
  return { ...state, final_answer };
}

export async function formulateFinalAnswerSmallTalk(state: any) {
  const llm = await getLLM();
  const clinic = CLINIC_CONTEXT;

  const prompt = new PromptTemplate({
    inputVariables: ["clinic_name", "message", "memory"],
    template: `
You are a friendly assistant for {clinic_name}.
Respond naturally to small talk in a warm tone.
Keep it ONE sentence. No markdown.

User: {message}
Memory: {memory}`,
  });

  const chain = RunnableSequence.from([prompt, llm]);
  const result = await chain.invoke({
    message: state.message ?? "",
    memory: state.memory ?? "",
    clinic_name: clinic.name,
  });

  const final_answer = extractContent(result) ?? "";
  console.log(`💬 smalltalk: ${final_answer}`);
  return { ...state, final_answer };
}

export async function formulateFinalAnswerLowConfidence(state: any) {
  const llm = await getLLM();
  const prompt = new PromptTemplate({
    inputVariables: ["message", "memory"],
    template: `
You are a dental assistant. The user's intent is unclear.
Ask politely for clarification in 1 short sentence.

User: {message}
Memory: {memory}`,
  });

  const chain = RunnableSequence.from([prompt, llm]);
  const result = await chain.invoke({
    message: state.message ?? "",
    memory: state.memory ?? "",
  });

  const final_answer = extractContent(result) ?? "";
  console.log(`❓ lowconfidence: ${final_answer}`);
  return { ...state, final_answer };
}
