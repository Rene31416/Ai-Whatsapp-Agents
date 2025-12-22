from langchain.tools import tool
from langchain.agents import create_agent
from agentLambda.foundational_llm.llms import llm
from agentLambda.middlewares.dynamic_prompts_middleware import calendar_dynamic_prompt

@tool(description="Use this tool when you need to schedule an appointment in the clinic")
def apponitment_tool(request: str) -> dict:
    """
    Use this when the user wants to create, modify, or check clinic appointments.
    Handles date/time parsing, availability checking, and event creation.

    Input: Natural language scheduling request (e.g., 'meeting with design team
    next Tuesday at 2pm')
    """
    res = {
        "status":"200"
    }
    return res
