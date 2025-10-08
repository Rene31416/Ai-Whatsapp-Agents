from langgraph.graph import StateGraph, START, END
from app.util import run, route_from_category, routing_node
from app.prompts import categorize, memory,formulate_final_answer_schedule, formulate_final_answer_smalltalk, formulate_final_answer_low_confidence, formulate_final_answer_info
from app.state import State

workflow = StateGraph(State)

workflow.add_node("categorize", categorize)
workflow.add_node("memory", memory)
workflow.add_node("formulate_final_answer_schedule", formulate_final_answer_schedule)  
workflow.add_node("formulate_final_answer_info", formulate_final_answer_info)
workflow.add_node("formulate_final_answer_smalltalk", formulate_final_answer_smalltalk) 
workflow.add_node("formulate_final_answer_low_confidence", formulate_final_answer_low_confidence) 
workflow.add_node("routing", routing_node)

workflow.add_conditional_edges(
    "routing",
    route_from_category,  # returns one of: "schedule" | "info" | "smalltalk" | "low"
    {
        "schedule": "formulate_final_answer_schedule",
        "info": "formulate_final_answer_info",
        "smalltalk": "formulate_final_answer_smalltalk",
        "low": "formulate_final_answer_low_confidence",
    },
)
workflow.set_entry_point("memory") # it can also be use: workflow.add_edge(START, "memory")
workflow.add_edge("memory", "categorize")
workflow.add_edge("categorize", "routing")
workflow.add_edge("formulate_final_answer_schedule", END)
workflow.add_edge("formulate_final_answer_info", END)
workflow.add_edge("formulate_final_answer_smalltalk", END)
workflow.add_edge("formulate_final_answer_low_confidence", END)
app = workflow.compile()

history = []

while True:
    message_text = input("WhatsApp, (enter q for exit) user entry: ")
    if message_text == "q":
        break

    # add user msg
    history.append({"role": "human", "message": message_text})

    # run workflow
    results = run(app, message_text, history)

    # add agent reply to history
    history.append({"role": "agent", "message": results.get("final_answer")})

    # debug state dump
    print("\n--- STATE DUMP ---")
    print("message:", results.get("message"))
    print("memory:", results.get("memory"))
    print("category:", results.get("category"))
    print("AI Agent (final_answer):", results.get("final_answer"))
    print("routes:", results.get("routes"))
    print("--- END STATE DUMP ---\n")

import json
import os

def lambda_handler(event, context):
    """
    Basic Lambda entrypoint for testing.
    Replace this later with your LangGraph workflow.
    """
    # Read environment variables (for debugging)
    tenant_table = os.getenv("TENANT_TABLE")
    chat_table = os.getenv("CHAT_TABLE")
    python_path = os.getenv("PYTHONPATH")

    # Return a simple JSON response
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({
            "message": "✅ Lambda is alive!",
            "tenant_table": tenant_table,
            "chat_table": chat_table,
            "python_path": python_path
        }),
    }
