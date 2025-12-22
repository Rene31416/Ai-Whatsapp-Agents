from urllib.parse import urlencode
import requests


def fetch_clinic_context(phone_number_id: str):
    base = "https://ts0g4u3nu2.execute-api.us-east-1.amazonaws.com/prod/clinic"
    params = {"phoneNumberId": phone_number_id}
    url = f"{base}?{urlencode(params)}"
    res = requests.get(url).json()

    print(res)
    return res["body"]


def fetch_doctors_info():
    res = requests.get(
        "https://ts0g4u3nu2.execute-api.us-east-1.amazonaws.com/prod/clinic/doctors?tenantId=opal-clinic"
    ).json()
    print(res)
    return res["body"]


def fetch_post_appointments_api(
    tenant_id: str,
    user_id: str,
    doctor_id: str,
    start_iso,
    duration_minutes: int,
    patient_name: str,
):
    payload = {
        "tenantId": tenant_id,
        "userId": user_id,
        "doctorId": doctor_id,
        "startIso": start_iso,
        "durationMinutes": duration_minutes,
        "patientName": patient_name,
    }
    print(payload)
    res = requests.post(
        "https://ts0g4u3nu2.execute-api.us-east-1.amazonaws.com/prod/appointments",
        data=payload,
    ).json()
    print(res)
    return res["body"]


def fetch_get_appointments_by_doctor_id_api(
    tenant_id: str, doctor_id: str, from_iso: str, to_iso: str
):
    res = requests.get(
        f"https://ts0g4u3nu2.execute-api.us-east-1.amazonaws.com/prod/appointments/availability?tenantId={tenant_id}&doctorId={doctor_id}&from={from_iso}&to={to_iso}"
    ).json()
    print(res)
    return res


def fetch_get_appointments_by_user_id_api(
    tenant_id: str, user_id: str, from_iso: str, to_iso: str
):
    base = "https://ts0g4u3nu2.execute-api.us-east-1.amazonaws.com/prod/appointments/availability"
    params = {
        "tenantId": tenant_id,
        "userId": user_id,
        "from": from_iso,
        "to": to_iso,
    }
    url = f"{base}?{urlencode(params)}"
    res = requests.get(url).json()
    print(res)
    return res


def fetch_patch_appointments_by_appointment_id(
    appointment_id: str, new_start_date: str, new_end_date: str, tenant_id: str
):
    payload = {
        "tenantId": tenant_id,
        "newStartIso": new_start_date,
        "newEndIso": new_end_date,
    }
    print(payload)
    res = requests.patch(
        f"https://ts0g4u3nu2.execute-api.us-east-1.amazonaws.com/prod/appointments/{appointment_id}",
        data=payload,
    ).json()
    print(res)
    return res["body"]


def fetch_delete_appointments_api(tenant_id: str, appointment_id: str):
    payload = {
        "tenantId": tenant_id,
    }
    print(payload)
    res = requests.delete(
        f"https://ts0g4u3nu2.execute-api.us-east-1.amazonaws.com/prod/appointments/{appointment_id}",
        data=payload,
    ).json()
    print(res)
    return res


# `tenantId`, `userId`, `doctorId`, `startIso` + `endIso | durationMinutes`
