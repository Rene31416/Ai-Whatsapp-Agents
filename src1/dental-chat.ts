import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import {
  categorize,
  summarizeMemory,
  formulateFinalAnswerSchedule,
  formulateFinalAnswerInfo,
  formulateFinalAnswerSmallTalk,
  formulateFinalAnswerLowConfidence,
} from "./prompts/dental-prompts";
import { routeFromCategory, routingNode, run } from "./util/index";

// --- Define the LangGraph State Schema ---
 const GraphAnnotation = Annotation.Root({
  message: Annotation<string>({
    value: String,
    default: () => "",
    reducer: (_prev, next) => next,
  }),
  memory: Annotation<string>({
    value: String,
    default: () => "",
    reducer: (_prev, next) => next,
  }),
  history: Annotation<{ role: string; message: string }[]>({
    value: Array,
    default: () => [],
    reducer: (_prev, next) =>
      Array.isArray(next) ? next : _prev,    
  }),
  category: Annotation<string>({
    value: String,
    default: () => "",
    reducer: (_prev, next) => next,
  }),
  final_answer: Annotation<string>({
    value: String,
    default: () => "",
    reducer: (_prev, next) => next,
  }),
});


// --- Create the workflow graph ---
const workflow = new StateGraph(GraphAnnotation);

// --- Define nodes ---
workflow.addNode("summarize_memory", summarizeMemory);
workflow.addNode("categorize", categorize);
workflow.addNode(
  "formulate_final_answer_schedule",
  formulateFinalAnswerSchedule
);
workflow.addNode("formulate_final_answer_info", formulateFinalAnswerInfo);
workflow.addNode(
  "formulate_final_answer_smalltalk",
  formulateFinalAnswerSmallTalk
);
workflow.addNode(
  "formulate_final_answer_low_confidence",
  formulateFinalAnswerLowConfidence
);
workflow.addNode("routing", routingNode);

// --- Conditional routing edges ---
workflow.addConditionalEdges(
  "routing" as any,
  routeFromCategory, // returns: "schedule" | "info" | "smalltalk" | "low"
  {
    schedule: "formulate_final_answer_schedule",
    info: "formulate_final_answer_info",
    smalltalk: "formulate_final_answer_smalltalk",
    low: "formulate_final_answer_low_confidence",
  } as any
);

// --- Entry and edges setup ---
workflow.addEdge(START as any, "summarize_memory" as any);
workflow.addEdge("summarize_memory" as any, "categorize" as any);
workflow.addEdge("categorize" as any, "routing" as any);
workflow.addEdge("formulate_final_answer_schedule" as any, END as any);
workflow.addEdge("formulate_final_answer_info" as any, END as any);
workflow.addEdge("formulate_final_answer_smalltalk" as any, END as any);
workflow.addEdge("formulate_final_answer_low_confidence" as any, END as any);

// --- Compile the graph ---
export const app = workflow.compile();

//console.log(app.getGraph().drawMermaid());


// --- Optional CLI Testing ---
if (require.main === module) {
  const history: any[] = [];

  async function main() {
    while (true) {
      const messageText = await new Promise<string>((resolve) => {
        process.stdout.write("WhatsApp (enter q for exit) user entry: ");
        process.stdin.once("data", (data) => resolve(data.toString().trim()));
      });

      if (messageText.toLowerCase() === "q") break;

      history.push({ role: "human", message: messageText });

      const results = await run(app, messageText, history);

      history.push({ role: "agent", message: results.final_answer });
      /*
      console.log("\n--- STATE DUMP ---");
      console.log("message:", results.message);
      console.log("memory:", results.memory);
      console.log("category:", results.category);
      console.log("AI Agent (final_answer):", results.final_answer);
      console.log("--- END STATE DUMP ---\n");
      */
    }

    process.exit(0);
  }

  main();
}
