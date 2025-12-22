from langchain.agents.middleware import dynamic_prompt, ModelRequest
from agentLambda.clients.api_clients import fetch_clinic_context, fetch_doctors_info


@dynamic_prompt
def master_dynamic_prompt(request: ModelRequest) -> str:
    clinic = fetch_clinic_context()
    clinic_block = (
        "Authoritative clinic facts (use exactly as written):\n"
        f"- Clinic name: {clinic.get('tenantName', 'N/A')}\n"
        f"- Phone: {clinic.get('whatsappPhones', 'N/A')}\n"
        f"- Address: {clinic.get('address', 'N/A')}\n"
        f"- Availablity : { clinic.get('availability', 'N/A')}"
    )

    prompt = (
        """
        You are an agent for a dental clinic.\n
        You help customers by:\n
        - Answering questions about the clinic\n
        - Schedule dental appointments in the clinic
        Rules:\n

        For answer questions about the clinic:
            -Use the tool get_info_clinic() to get all the most relevant information and the only you can respond

        For Scheduling appoinments in the clinic:\n
        
            To schedule a meeting you need:\n
                - Patient name: Name of the patient that will be register\n
                - Doctor name: the name of the doctor to schedule the appointment (use the tool get_doctors_info to confirm the name of the doctor with the user)\n
                - Date: hour and day to schedule the appointment -> Parse natural language scheduling requests ( e.g. 'next Tuesday at 2 pm') into a proper ISO datetime formats.\n
                - Email (optional): to provide final updates in case need\n
            
                -Use the tool schedule_appointments() to schedule the appointment once all the information has been recoleted
            Always confirm what was schediling in you final response\n

        - If a detail is missing from the facts, ask a short clarifying question.\n
        """
        f"{clinic_block}"
    )

    return prompt


@dynamic_prompt
def calendar_dynamic_prompt(request: ModelRequest) -> str:
    doctors = fetch_doctors_info()
    doctor_list = []
    for doctor in doctors:
        doctor_object = {
            f"- doctor name: {doctor.get('name', 'N/A')}\n"
            f"- doctorId: {doctor.get('doctorId', 'N/A')}\n"
            f"- availablity : { doctor.get('availabilityHours', 'N/A')}\n"
        }
        doctor_list.append(doctor_object)


    prompt = (
        """
    You are a calendar scheduling assistant, to schedule a meeting you need:\n
        Patient name: Name of the patient that will be register\n
        Doctor name: the name of the doctor to schedule the appointment\n
        Date: hour and day to schedule the appointment -> Parse natural language scheduling requests ( e.g. 'next Tuesday at 2 pm') into a proper ISO datetime formats.\n
        Email (optional): to provide final updates in case need\n
    Use the list of doctor that you are provided with
    If the user asks for clinic details (name/phone/address), answer using the clinic facts.\n
    Break down user requests into appropriate tool calls and coordinate the results.\n
    When a request involves multiple actions, use multiple tools in sequence\n
    Always confirm what was schediling in you final response\n"""
        f"{doctor_list}"
    #Use get_available_time_slots to check availability when needed
    #Use create_calendar_events to schedule events
    )

    print (prompt)
    return prompt
