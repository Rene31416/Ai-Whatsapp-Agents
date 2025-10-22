// src/chat/dental.workflow.ts
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { injectable } from "inversify";
import { State } from "./models";
import { decideAndAnswerLite, DecisionLite } from "../prompts/dental-prompts";

@injectable()
export class DentalWorkflow {
  private app: any;

  constructor() {
    const Graph = Annotation.Root({
      // User message
      message: Annotation<string>({
        value: String,
        default: () => "",
        reducer: (_p, n) => n,
      }),

      // 3-block fast path pieces
      facts_header: Annotation<string>({
        value: String,
        default: () => "",
        reducer: (_p, n) => n,
      }),
      recent_window: Annotation<string>({
        value: String,
        default: () => "",
        reducer: (_p, n) => n,
      }),

      // LLM decision: { final_answer }
      decision: Annotation<DecisionLite | undefined>({
        value: Object,
        default: () => undefined,
        reducer: (_p, n) => n,
      }),

      // Convenience: plain final answer string
      final_answer: Annotation<string>({
        value: String,
        default: () => "",
        reducer: (_p, n) => n,
      }),
    });

    const wf = new StateGraph(Graph);

    wf.addNode("decide", this.decideNode);
    wf.addEdge(START as any, "decide" as any);
    wf.addEdge("decide" as any, END as any);

    this.app = wf.compile();
  }

  private async decideNode(
    state: State & {
      message: string;
      facts_header: string;
      recent_window: string;
      decision?: DecisionLite;
    }
  ): Promise<State & { decision: DecisionLite }> {
    // Minimal, traceable log points (kept tiny)
    console.info(
      `[wf.decide][in] msg_len=${(state.message || "").length} facts_len=${(state.facts_header || "").length} recent_len=${(state.recent_window || "").length}`
    );

    const decision = await decideAndAnswerLite({
      message: state.message ?? "",
      facts_header: state.facts_header ?? "",
      recent_window: state.recent_window ?? "",
    });

    console.info(`[wf.decide][out] fa_len=${(decision.final_answer || "").length}`);

    return { ...state, decision, final_answer: decision.final_answer };
  }

  // Run with the 3-block fast path
  async run(message: string, facts_header: string, recent_window: string) {
    return this.app.invoke({
      message,
      facts_header,
      recent_window,
      final_answer: "",
    });
  }
}
