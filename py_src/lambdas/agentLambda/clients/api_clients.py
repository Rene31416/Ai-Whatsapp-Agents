import json
import os
from typing import Any, Dict, Optional
from urllib.parse import urlencode

import boto3
import requests


lambda_client = boto3.client("lambda")
CLINIC_LAMBDA_NAME = os.environ.get("CLINIC_LAMBDA_NAME")


def _invoke_clinic_lambda(
    path: str,
    http_method: str,
    query: Optional[Dict[str, str]] = None,
    body: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not CLINIC_LAMBDA_NAME:
        raise RuntimeError("CLINIC_LAMBDA_NAME env var is not set")

    api_gateway_event = {
        "resource": path,
        "path": path,
        "httpMethod": http_method,
        "headers": {
            "content-type": "application/json",
            "accept": "application/json",
        },
        "multiValueHeaders": None,
        "queryStringParameters": query or {},
        "multiValueQueryStringParameters": None,
        "pathParameters": None,
        "stageVariables": None,
        "body": json.dumps(body) if body is not None else None,
        "isBase64Encoded": False,
    }

    print(
        "[clinic_lambda.invoke.request]",
        {
            "method": http_method,
            "path": path,
            "query": query,
            "hasBody": body is not None,
        },
    )

    invoke_response = lambda_client.invoke(
        FunctionName=CLINIC_LAMBDA_NAME,
        InvocationType="RequestResponse",
        Payload=json.dumps(api_gateway_event).encode("utf-8"),
    )

    payload_stream = invoke_response["Payload"]
    raw_payload = payload_stream.read()
    print(
        "[clinic_lambda.invoke.response]",
        {
            "statusCode": invoke_response.get("StatusCode"),
            "payloadBytes": len(raw_payload),
        },
    )

    lambda_result = json.loads(raw_payload or b"{}")
    status_code = lambda_result.get("statusCode", 500)
    response_body = lambda_result.get("body")

    if isinstance(response_body, str):
        try:
            parsed_body: Any = json.loads(response_body)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"Clinic lambda returned non-JSON string body: {response_body}"
            ) from exc
    elif response_body is None:
        parsed_body = {}
    else:
        parsed_body = response_body

    if status_code >= 400:
        raise RuntimeError(
            f"Clinic lambda returned error {status_code}: {parsed_body}"
        )

    if not isinstance(parsed_body, dict):
        raise RuntimeError(
            f"Clinic lambda returned unexpected body type: {type(parsed_body).__name__}"
        )

    return parsed_body


def fetch_clinic_context(phone_number_id: str):
    params = {"phoneNumberId": phone_number_id}
    return _invoke_clinic_lambda("/clinic", "GET", query=params)


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
    return _invoke_clinic_lambda("/appointments", "POST", body=payload)


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
