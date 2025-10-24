// src/devtools/dash-log-call/index.ts
/* Local REPL runner for the chat workflow:
 * - Logs only (no WhatsApp send).
 * - Persists chat messages in Dynamo (ChatRepository).
 * - Lee long-term memory (object) desde Dynamo.
 * - LLM #1: respuesta final (DentalWorkflow) con fast-path de 3 bloques.
 * - PostOps (no bloqueante):
 *      • determinista (regex) sobre el último mensaje
 *      • si hay intención de identidad/contacto con buena confianza → LLM extractClientFacts
 *      • short summary cada N turnos
 */

import "reflect-metadata";
import { createInterface } from "node:readline";
import { ChatRepository } from "../../chat/chat.repository";
import { MemoryRepository } from "../../chat/memory.repository";
import { DentalWorkflow } from "../../chat/dental.workflow";

// 3-block helpers
import { buildFactsHeader, buildRecentWindow } from "../../prompts/propmts.helper";

// Post-ops no bloqueantes
import { PostOpsService } from "../../chat/postops.service";

// ---------- util ----------
function parseArg(name: string, fallback = ""): string {
  const ix = process.argv.findIndex((a) => a === `--${name}`);
  return ix >= 0 ? String(process.argv[ix + 1] ?? fallback) : fallback;
}

// ---------- env checks ----------
process.env.AWS_REGION ||= "us-east-1";
const TENANT_ID = parseArg("tenant");
const USER_ID = parseArg("user");

if (!TENANT_ID || !USER_ID) {
  console.error("❌ Missing args. Example:");
  console.error(
    "   pnpm ts-node src/devtools/dash-log-call/index.ts --tenant 762... --user 503..."
  );
  process.exit(1);
}
if (!process.env.MEMORY_TABLE_NAME) {
  console.error("❌ MEMORY_TABLE_NAME env is required.");
  process.exit(1);
}
if (!process.env.CHAT_SESSIONS_TABLE_NAME) {
  console.error("❌ CHAT_SESSIONS_TABLE_NAME env is required.");
  process.exit(1);
}

// ---------- wiring ----------
const chatRepository = new ChatRepository();
const memoryRepository = new MemoryRepository();
const wf = new DentalWorkflow();
const postOps = new PostOpsService(memoryRepository, chatRepository);

async function runOnce(input: string): Promise<void> {
  const text = (input ?? "").trim();
  if (!text) return;

  console.info("[flow][in]", JSON.stringify(text));

  // 0) Persist user turn (siempre guardamos la entrada del usuario)
  await chatRepository.saveMessage(TENANT_ID, USER_ID, "user", text);

  try {
    // 1) Read memory (object)
    const { memory: memObj } = await memoryRepository.getMemory(TENANT_ID, USER_ID);

    // 2) Last 10 turns
    const last10: Array<{ role: "user" | "agent"; message: string }> =
      await chatRepository.getRecentHistory(TENANT_ID, USER_ID, 10);

    // 3) Build the **3-block fast path** inputs (NO short summary aquí)
    const factsHeader = buildFactsHeader(memObj);            // PERFIL: Nombre=... | Tel=... | Email=...
    const recentWindow = buildRecentWindow(last10, 8, 1600); // U:/A: compact lines

    console.info(
      "[flow][mem]",
      "facts_len=" + factsHeader.length,
      "recent_len=" + recentWindow.length
    );

    // 4) LLM #1: final answer (fast path) — si falla, lanzará error
    const state = await wf.run(text, factsHeader, recentWindow);
    const reply = state?.final_answer ?? "";
    const identify_intent = !!state?.decision?.identify_intent;
    const confidence = Number(state?.decision?.confidence ?? 0);

    if (!reply.trim()) {
      // Sin fallback: no persistimos respuesta del bot y erroreamos
      throw new Error("EMPTY_REPLY(runOnce): final_answer vacío tras workflow.");
    }

    console.info(
      "[flow][decide]",
      "out_len=" + reply.length,
      "intent=" + identify_intent,
      "conf=" + confidence.toFixed(2)
    );

    // 5) Send + persist agent turn (solo si todo salió bien)
    console.log("\n\n──────────────────────────────────────");
    console.log("👤 Usuario:", text);
    console.log("🤖 Bot   :", reply);
    console.log("──────────────────────────────────────\n");
    await chatRepository.saveMessage(TENANT_ID, USER_ID, "agent", reply);

    // 6) PostOps NO bloqueante (regex/LLM facts + summary)
    const last10After = await chatRepository.getRecentHistory(TENANT_ID, USER_ID, 10);
    void postOps.run({
      tenantId: TENANT_ID,
      userId: USER_ID,
      lastUserMessage: text,
      last10: last10After,
      identify_intent,
      confidence,
      confidenceThreshold: 0.75,
    });
  } catch (e: any) {
    // Reporte claro del sitio del fallo; NO guardamos respuesta del bot
    const msg = e?.message || String(e);
    console.error(`❌ WORKFLOW_ERROR: ${msg}`);
    // También imprimimos un separador como en el flujo normal para lectura rápida
    console.log("\n\n──────────────────────────────────────");
    console.log("👤 Usuario:", text);
    console.log("🤖 Bot   : (error; no se envió respuesta)");
    console.log("──────────────────────────────────────\n");
    // Rethrow para que el REPL superior también lo vea si quieres
    throw e;
  }
}

// ---------- REPL ----------
const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(): void {
  rl.question("› Tú: ", async (line: string) => {
    const text = (line || "").trim();
    if (!text || text.toLowerCase() === "exit") {
      rl.close();
      return;
    }
    try {
      await runOnce(text);
    } catch (e) {
      console.error("❌ runOnce error:", (e as Error)?.message);
    }
    ask();
  });
}

console.log("Escribe tu mensaje (o 'exit' para salir)...");
ask();
