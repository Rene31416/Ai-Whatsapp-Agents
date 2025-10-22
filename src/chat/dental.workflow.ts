import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { injectable } from "inversify";
import { decideAndAnswerLite, DecisionLite } from "../prompts/dental-prompts";

type GraphState = {
  message: string;
  facts_header: string;
  recent_window: string;
  decision?: DecisionLite;
  final_answer: string;
};

@injectable()
export class DentalWorkflow {
  private app: any;

  constructor() {
    const Graph = Annotation.Root({
      message: Annotation<string>({
        value: String,
        default: () => "",
        reducer: (_p, n) => n,
      }),
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
      decision: Annotation<DecisionLite | undefined>({
        value: Object,
        default: () => undefined,
        reducer: (_p, n) => n,
      }),
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

  private async decideNode(state: GraphState): Promise<GraphState> {
    console.info(
      `[wf.decide][in] msg_len=${(state.message || "").length} facts_len=${
        (state.facts_header || "").length
      } recent_len=${(state.recent_window || "").length}`
    );

    const tz = "America/El_Salvador";
    const now = new Date();

    const decision = await decideAndAnswerLite({
      message: state.message ?? "",
      facts_header: state.facts_header ?? "",
      recent_window: state.recent_window ?? "",
      now_iso: now.toISOString(),
      now_human: now.toLocaleString("es-SV", { timeZone: tz, hour12: false }),
      tz,
    });

    if (!decision.final_answer || !decision.final_answer.trim()) {
      // Sin fallback: error explícito
      throw new Error(
        "EMPTY_FINAL_ANSWER(wf.decide): El modelo devolvió final_answer vacío tras validación."
      );
    }

    console.info(
      `[wf.decide][out] fa_len=${decision.final_answer.length} intent=${
        decision.identify_intent
      } conf=${decision.confidence.toFixed(2)}`
    );
    return { ...state, decision, final_answer: decision.final_answer };
  }

  // 3-block fast path
  async run(
    message: string,
    facts_header: string,
    recent_window: string
  ): Promise<GraphState> {
    return this.app.invoke({
      message,
      facts_header,
      recent_window,
      final_answer: "",
    });
  }
}
