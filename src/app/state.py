from typing import Dict, TypedDict, List, Literal, Optional

class Msg(TypedDict):
    role: Literal["human", "agent"]
    message: str

class State(TypedDict, total=False):
    history: List[Msg]                  # [{"role": "human", "message": "..."}, ...]
    message: str                        # current user msg
    memory: str                         # running summary/context
    category:str   # e.g. "schedule", "servicefaqs", or None
    final_answer: str                   # last generated response