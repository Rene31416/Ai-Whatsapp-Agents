from app.state import State
from pathlib import Path
import json
import re
from typing import Any, Dict
import os

def run(app, message: str, history: list):
    return app.invoke({"message": message, "history": history})

def parse_category(raw: Any) -> Dict[str, Any]:
    # If upstream already gave you a dict, just use it.
    if isinstance(raw, dict):
        return raw

    if not isinstance(raw, str):
        raise TypeError(f"category must be str or dict, got {type(raw)}")

    s = raw.strip()

    # If it's a fenced block like ```json\n{...}\n```, strip the fences.
    if s.startswith("```"):
        # Extract the first {...} block inside
        m = re.search(r"\{.*\}\s*$", s, flags=re.S)
        if not m:
            raise ValueError("Could not find JSON object inside fenced block")
        s = m.group(0)

    # Now parse JSON
    return json.loads(s)

def route_from_category(state: State) -> str:
    print('routing')
    cat = (state.get("category") or "").strip().lower()

    # collapse variants you want to send to the same node
    if cat in {"servicefaqs", "logistics"}:
        return "info"
    if cat == "schedule":
        return "schedule"
    if cat == "smalltalk":
        return "smalltalk"
    if cat == "lowconfidence":
        return "low"

    # fallback
    return "low"

def routing_node(state: State) -> State:
    return {}

def load_clinic_context() -> dict:
    """
    Loads clinic context from a local JSON file or from an environment variable.
    """
    # If running in Lambda with the JSON as an environment variable
    env_context = os.getenv("CLINIC_CONTEXT_JSON")
    if env_context:
        return json.loads(env_context)

    # Local path: src/clinic_context.json
    json_path = Path(__file__).parent / "clinic_context.json"
    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)

CLINIC_CONTEXT = load_clinic_context()