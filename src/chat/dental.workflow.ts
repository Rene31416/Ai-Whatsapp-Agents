import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import {
  summarizeMemory,
  categorize,
  formulateFinalAnswerSchedule,
  formulateFinalAnswerInfo,
  formulateFinalAnswerSmallTalk,
  formulateFinalAnswerLowConfidence,
} from "./dental-prompts";
import { State } from "./models";
import { injectable } from "inversify";

@injectable()
export class DentalWorkflow {
  private app: any;

  constructor() {
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
        reducer: (_prev, next) => (Array.isArray(next) ? next : _prev),
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

    const workflow = new StateGraph(GraphAnnotation);

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
    workflow.addNode("routing", this.routingNode);

    workflow.addConditionalEdges("routing" as any, this.routeFromCategory, {
      schedule: "formulate_final_answer_schedule",
      info: "formulate_final_answer_info",
      smalltalk: "formulate_final_answer_smalltalk",
      low: "formulate_final_answer_low_confidence",
    } as any);

    workflow.addEdge(START as any, "summarize_memory" as any);
    workflow.addEdge("summarize_memory" as any, "categorize" as any);
    workflow.addEdge("categorize" as any, "routing" as any);
    workflow.addEdge("formulate_final_answer_schedule" as any, END as any);
    workflow.addEdge("formulate_final_answer_info" as any, END as any);
    workflow.addEdge("formulate_final_answer_smalltalk" as any, END as any);
    workflow.addEdge(
      "formulate_final_answer_low_confidence" as any,
      END as any
    );

    this.app = workflow.compile();
  }

  private routeFromCategory(state: State) {
    const cat = (state.category ?? "").trim().toLowerCase();
    if (["servicefaqs", "logistics"].includes(cat)) return "info";
    if (cat === "schedule") return "schedule";
    if (cat === "smalltalk") return "smalltalk";
    if (cat === "lowconfidence") return "low";
    return "low";
  }

  private async routingNode(state: State): Promise<State> {
    return { ...state };
  }

  async run(message: string, history: any[]) {
    const initialState = {
      message,
      history,
      memory: "",
      category: "",
      final_answer: "",
    };
    return await this.app.invoke(initialState);
  }
}
