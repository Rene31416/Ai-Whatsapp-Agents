import { State } from "./state";

export async function run(app: any, message: string, history: any[]) {
  const initialState = {
    message,
    history,
    memory: "",
    category: "",
    final_answer: "",
  };
  console.log(initialState);
  console.log("Type of message:", typeof initialState.message);
  console.log("Value of message:", initialState.message);
  const result = await app.invoke(initialState);
  return result;
}

export function routeFromCategory(
  state: State
): "schedule" | "info" | "smalltalk" | "low" {
  console.log("routing");
  const cat = (state.category ?? "").trim().toLowerCase();

  if (["servicefaqs", "logistics"].includes(cat)) return "info";
  if (cat === "schedule") return "schedule";
  if (cat === "smalltalk") return "smalltalk";
  if (cat === "lowconfidence") return "low";
  return "low"; // fallback
}
export async function routingNode(state: State): Promise<State> {
  return { ...state };
}
