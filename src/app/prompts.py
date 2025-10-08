from langchain_core.prompts import ChatPromptTemplate
from app.model import llm
from app.state import State
from app.util import CLINIC_CONTEXT
import json



from langchain_core.prompts import ChatPromptTemplate
import json

# --- categorize ---
def categorize(state: State) -> State:
    prompt = ChatPromptTemplate.from_template(
        """
You are a classifier for a dental clinic chat.

Decide the user's INTENT as one of exactly these labels:
- ServiceFAQs  (questions about treatments/services, duration, pain/risks, prep/aftercare, general price ranges)
- Logistics    (hours, address, directions, parking, map link, payments/insurance, how to contact)
- SmallTalk    (greetings, farewells, thanks/apologies, emojis, small pleasantries; no actionable request)
- LowConfidence (ambiguous/mixed/out-of-scope; or you are not confident)
- Schedule     (book appointment in the clinic)

Rules:
- If message is only social niceties -> SmallTalk.
- If it's about service information -> ServiceFAQs.
- If it's about how/when/where to reach/visit/pay -> Logistics.
- If unsure or mixed -> LowConfidence.

Return exactly one of: ServiceFAQs | Logistics | SmallTalk | LowConfidence | Schedule
No extra words.

Message: {message}
Memory: {memory}
        """
    )
    chain = prompt | llm
    response = chain.invoke(
        {"message": state.get("message", ""), "memory": state.get("memory", "")}
    ).content

    category = response.strip()
    return {"category": category}

# --- memory (summarize last 10 msgs) ---
def memory(state: State) -> State:
    messages = state.get("history", []) or []
    recent = messages[-10:]
    # Compact JSON line per message for the LLM
    history_blob = "\n".join(json.dumps(item, ensure_ascii=False) for item in recent)

    prompt = ChatPromptTemplate.from_template(
        """
You are a memory module.
Create a concise summary (2–3 sentences) of the following recent conversation so the assistant can keep context.

Messages:
{messages}
        """
    )
    chain = prompt | llm
    memory_text = chain.invoke({"messages": history_blob}).content.strip()
    return {"memory": memory_text}

# --- formulate: Schedule ---
def formulate_final_answer_schedule(state: State) -> State:
    prompt = ChatPromptTemplate.from_template(
        """
You are the scheduling assistant for a dental clinic.

Task:
- Reply in 1–2 sentences to move scheduling forward (ask for preferred day/time and name/phone if needed).
- **Always take the conversation memory into account**
- No markdown, no bullets.

User message: {message}
Memory: {memory}
        """
    )
    chain = prompt | llm
    text = chain.invoke(
        {"message": state.get("message", ""), "memory": state.get("memory", "")}
    ).content
    return {"final_answer": text}

# --- formulate: Info (ServiceFAQs / Logistics) ---
def formulate_final_answer_info(state: State) -> State:
    prompt = ChatPromptTemplate.from_template(
        """
You are an assistant for {clinic_name}.

Context:
- Address: {clinic_address}
- Hours: {clinic_hours}
- Phone: {clinic_phone}
- Website: {clinic_website}

Task:
- Provide a clear, concise info answer in 1–2 sentences.
- No markdown, no bullets.

User message: {message}
Memory: {memory}
        """
    )

    clinic = CLINIC_CONTEXT or {}
    chain = prompt | llm
    text = chain.invoke({
        "message": state.get("message", ""),
        "memory": state.get("memory", ""),
        "clinic_name": clinic.get("name", ""),
        "clinic_address": clinic.get("address", ""),
        "clinic_hours": clinic.get("hours", ""),
        "clinic_phone": clinic.get("phone", ""),
        "clinic_website": clinic.get("website", ""),
    }).content
    return {"final_answer": text}

# --- formulate: SmallTalk ---
def formulate_final_answer_smalltalk(state: State) -> State:
    clinic = (CLINIC_CONTEXT or {}).get("name", "").strip()

    prompt = ChatPromptTemplate.from_template(
        """
You are a friendly assistant for {clinic_name}.

Task:
- Respond naturally to small talk (greetings, thanks, emojis, brief acknowledgements) in a warm tone.
- Always take conversation memory into account: if there is an ongoing topic or unresolved request in memory, add ONE short follow-up to move it forward; otherwise just reply to the small talk.
- If an organization name is provided, you may include it naturally in greetings; if not provided, do not invent one.
- Keep it to ONE sentence. No markdown, no bullets.

User message: {message}
Memory (summary): {memory}
        """
    )
    clinic = CLINIC_CONTEXT or {}
    chain = prompt | llm
    text = chain.invoke({
        "message": state.get("message", ""),
        "memory": state.get("memory", ""),
        "clinic_name": clinic.get("name", ""),
    }).content

    return {"final_answer": text}

# --- formulate: LowConfidence ---
def formulate_final_answer_low_confidence(state: State) -> State:
    prompt = ChatPromptTemplate.from_template(
        """
You are an assistant for a dental clinic. The user’s intent is unclear.

Task:
- Ask politely for clarification in 1 short sentence.
- **Always take the conversation memory into account**
- Keep it friendly and simple.
- No markdown, no bullets.

User message: {message}
Memory: {memory}
        """
    )
    chain = prompt | llm
    text = chain.invoke(
        {"message": state.get("message", ""), "memory": state.get("memory", "")}
    ).content
    return {"final_answer": text}



## Final Response


# def formulate_final_answer(state: State) -> State:
#     prompt = ChatPromptTemplate.from_template(
#         """
#             You are the assistant of a dental clinic.
#             Combine the primary response and the optional background response into one final answer for the user.

#             Rules:
#             - Always include the primary response.
#             - If a background response exists and is not empty, smoothly append it as a gentle follow-up (avoid sounding robotic).
#             - Use memory only to stay consistent with previous answers, not to repeat.
#             - Keep it polite, concise, and natural.
#             - No markdown, no bullets.

#             Primary response: {primary_response}
#             Background response: {background_response}
#             User message: {message}
#             Memory: {memory}
#         """
#     )
#     chain = prompt | llm
#     text = chain.invoke(
#         {
#             "primary_response": state.get("primary_response", ""),
#             "background_response": state.get("background_response", ""),
#             "message": state["message"],
#             "memory": state.get("memory", ""),
#         }
#     ).content

#     return {"final_answer": text}


# def assess_skillset(state: State) -> State:
#     print("\nAssesing the skillset of candidate")
#     prompt = ChatPromptTemplate.from_template(
#         "Based on the following job application for a pythoin Developer, assets the candidate's skillset"
#         "Respond only with either 'Match' or 'No Match'"
#         "Application : {application}"
#     )
#     chain = prompt | llm
#     skill_match = chain.invoke({"application": state["application"]}).content
#     print(f"skill_match:{skill_match}")
#     return {"skill_match": skill_match}
