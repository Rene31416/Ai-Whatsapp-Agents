// srrc/workflow/main.workflow.ts
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { inject, injectable } from "inversify";
import { decideAndAnswerLite, DecisionLite } from "../prompts/dental-prompts";
import { CalendarPromptService } from "../prompts/calendar.prompt";

type GraphState = {
  message: string;
  facts_header: string;
  recent_window: string;
  decision?: DecisionLite & { isCalendar?: boolean };
  final_answer: string;
};

@injectable()
export class DentalWorkflow {
  private app: any;

  constructor(
    @inject(CalendarPromptService)
    private readonly calendarPrompt: CalendarPromptService
  ) {
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

    // Nodos
    wf.addNode("decide", this.decideNode.bind(this));
    wf.addNode("respond", this.respondNode.bind(this));
    wf.addNode("calendar", this.calendarNode.bind(this));

    // Entradas / Condicional
    wf.addEdge(START as any, "decide" as any);
    wf.addConditionalEdges(
      "decide" as any,
      (state: GraphState) => {
        const route = state.decision?.isCalendar ? "calendar" : "respond";
        console.info(
          `[wf.route] isCalendar=${!!state.decision?.isCalendar} → ${route}`
        );
        return route;
      },
      {
        respond: "respond",
        calendar: "calendar",
      } as any
    );

    // Salidas
    wf.addEdge("respond" as any, END as any);
    wf.addEdge("calendar" as any, END as any);

    this.app = wf.compile();
  }

  private async decideNode(state: GraphState): Promise<GraphState> {
    console.info(
      `[wf.decide][in] msg_len=${(state.message || "").length} facts_len=${(
        state.facts_header || ""
      ).length} recent_len=${(state.recent_window || "").length}`
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

    console.info(
      `[wf.decide][out] fa_len=${(decision.final_answer || "").length} isCalendar=${
        !!(decision as any).isCalendar
      } intent=${decision.identify_intent} conf=${decision.confidence.toFixed(
        2
      )}`
    );

    return {
      ...state,
      decision: decision as GraphState["decision"],
      // No cerramos aquí; el nodo `respond`/`calendar` define `final_answer`
    };
  }

  private async respondNode(state: GraphState): Promise<GraphState> {
    const a =
      (state.decision?.final_answer ||
        "No response, my friend will take care about it").trim();
    console.info(`[wf.respond] len=${a.length}`);
    return { ...state, final_answer: a };
  }

  private async calendarNode(state: GraphState): Promise<GraphState> {
    // Aquí ya sabemos que isCalendar=true. Llamamos al agente de calendario.
    console.info("[wf.calendar][in] invoking CalendarPromptService …");

    const tz = "America/El_Salvador";
    const now = new Date();

    const { a, c } = await this.calendarPrompt.calendarAndAnswerLite({
      message: state.message ?? "",
      recent_window: state.recent_window ?? "",
      now_iso: now.toISOString(),
      tz,
      // opcionalmente podrías pasar tenantId/userId si los añades al GraphState
      // tenantId, userId
    });

    const answer = (a ?? "").trim();
    console.info(
      `[wf.calendar][out] a_len=${answer.length} confidence=${c.toFixed(2)}`
    );

    // Si por alguna razón el prompt devolviera vacío, aplicamos un fallback corto.
    const final = answer || "Te ayudo a coordinar tu cita 😊 ¿Qué día/hora te conviene?";
    return { ...state, final_answer: final };
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
