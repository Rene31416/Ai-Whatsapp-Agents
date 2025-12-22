from langchain.tools import tool, ToolRuntime
from pydantic import BaseModel, Field
from agentLambda.clients.api_clients import (
    fetch_clinic_context,
    fetch_doctors_info,
    fetch_get_appointments_by_user_id_api,
    fetch_post_appointments_api,
    fetch_get_appointments_by_doctor_id_api,
    fetch_patch_appointments_by_appointment_id,
    fetch_delete_appointments_api,
)
from agentLambda.utils.types import Context

#############################################


class schedule_apointment_input(BaseModel):
    """Inputs fot schedule appointment."""

    doctor_id: str = Field(description="doctorId of the doctor to schedule with")
    apointment_date: str = Field(
        description="Date when the appointment will be schedule"
    )
    patient_name: str = Field(
        description="Name of the patient to schedule the appointment"
    )


@tool(
    description="Use this when the user wants to create calendar appointments.",
    args_schema=schedule_apointment_input,
)
def schudule_appointments_tool(
    runtime: ToolRuntime[Context],
    doctor_id: str,
    apointment_date: str,
    patient_name: str,
    duration_minutes: int = 30,
) -> dict:
    """
    Use this when the user wants to create calendar appointments.
    """
    tenant_id = runtime.context.tenant_id
    user_id = runtime.context.user_id

    res = fetch_post_appointments_api(
        tenant_id, user_id, doctor_id, apointment_date, duration_minutes, patient_name
    )
    print(
        f"This will schedule a metting with -> {user_id} and {tenant_id} pass it though the context it will last {duration_minutes}"
    )
    # Returns the appointment payload coming from the scheduling API request.
    return res


#############################################


class re_schedule_apointment_input(BaseModel):
    """Inputs fot re schedule appointment."""

    new_start: str = Field(
        description="New start date re schedule the appointment in ISO format"
    )
    new_end: str = Field(
        description="New end date to re schedule the appointment in ISO format"
    )
    appointment_id: str = Field(
        description="Unique identifier that was deliver once the appointment was scheduled"
    )


@tool(
    description="Use this tool when you need to re schedule an event",
    args_schema=re_schedule_apointment_input,
)
def re_schudule_appointments_tool(
    runtime: ToolRuntime[Context],
    new_start: str,
    new_end: str,
    appointment_id: str,
) -> dict:
    """
    Use this tool when you need to re schedule an event
    """
    tenant_id = runtime.context.tenant_id
    print(f"re_schedule appointment tool ")

    res = fetch_patch_appointments_by_appointment_id(
        appointment_id, new_start, new_end, tenant_id
    )
    # Signals the updated time window for an existing appointment inside the tenant calendar.
    return {"sucess": res}


#############################################


class delete_apointment_input(BaseModel):
    """Inputs fot delete appointment."""

    appointment_id: str = Field(description="Id of the appointment to delete")


@tool(
    description="Use this tool when you are sure you need to delete an appointment",
    args_schema=delete_apointment_input,
)
def delete_appointments_tool(
    runtime: ToolRuntime[Context], appointment_id: str
) -> dict:
    """
    Use this tool when you are sure you need to delete an appointment
    """
    tenant_id = runtime.context.tenant_id

    res = fetch_delete_appointments_api(tenant_id, appointment_id)
    print(f"Appointment with {appointment_id} deleted {res}")
    # Confirms deletion of the provided appointment_id for the tenant.
    return {"sucess": res}


#######################################


class consult_availability_by_doctor_id_input(BaseModel):
    """Inputs for consults the appointments for a user"""

    doctor_id: str = Field(description="doctor_id of the doctor to consult with")
    from_iso: str = Field(description="Start range to consult with in ISO format")
    to_iso: str = Field(description="End range to consult in ISO format")


@tool(
    description="Use this tool when you need to consult the availability of a doctor in a specific range of time in the calendar",
    args_schema=consult_availability_by_doctor_id_input,
)
def consult_availability_by_doctor_id_tool(
    runtime: ToolRuntime[Context], doctor_id: str, from_iso: str, to_iso: str
) -> dict:
    """
    Use this tool when you need to consult the availability of a doctor in a specific range of time in the calendar
    """
    print(
        f"Cheching Availability for doctor_id {doctor_id} from {from_iso} to {to_iso}\n"
    )
    tenant_id = runtime.context.tenant_id
    res = fetch_get_appointments_by_doctor_id_api(
        tenant_id, doctor_id, from_iso, to_iso
    )
    print(res)
    # Surfaces the doctor's availability within the requested date range.
    return res


#############################################


class consult_availability_by_user_id_input(BaseModel):
    """Inputs for consults the appointments for a user"""

    from_iso: str = Field(description="Start range to consult with in ISO format")
    to_iso: str = Field(description="End range to consult in ISO format")


@tool(
    description="Use this tool to consult the appointments for a user in a specific range of time",
    args_schema=consult_availability_by_user_id_input,
)
def consult_availability_by_user_id_tool(
    runtime: ToolRuntime[Context], from_iso: str, to_iso: str
) -> dict:
    """
    Use this tool when you need to consult the appoinments of a user in a specific range of time
    """

    user_id = runtime.context.user_id
    tenant_id = runtime.context.tenant_id
    print(f"Cheching Availability for user {user_id} from {from_iso} to {to_iso}\n")
    res = fetch_get_appointments_by_user_id_api(tenant_id, user_id, from_iso, to_iso)
    print(res)
    # Provides the current user's appointments between the requested timestamps.
    return res


#########################################

 
@tool(description="Use this tool to get the information about the clinic")
def get_clinic_info_tool(runtime: ToolRuntime[Context]) -> dict:
    """
    Use this when the user wants to create calendar appointments.
    """
    tenant_phone_number_id= runtime.context.phone_number_id

    res = fetch_clinic_context(tenant_phone_number_id)
    # Gives back the static clinic context (hours, address, etc.) for grounding other answers.
    return res


@tool(
    description="Use this tool when you need information about the doctors for schedule appointments"
)
def get_doctors_info():
    res = fetch_doctors_info()
    # Lists all doctors along with their metadata for downstream selection.
    return res
