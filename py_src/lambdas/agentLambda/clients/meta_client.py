import os
import json
import requests
from typing import Any, Dict, Optional
from agentLambda.clients.secret_manager_client import get_secret_json

class WhatsAppSendError(Exception):
    pass


def send_whatsapp_message(
    assistant_message: str,
    phone_number_id: str,
    user_id: str,
    *,
    secret_suffix: Optional[str] = None,
    timeout_seconds: float = 10.0,
) -> Dict[str, Any]:
    """
    Sends a WhatsApp text message using Meta WhatsApp Cloud API.

    Requirements:
      - env var WHATSAPP_SECRET_ARN (or secret prefix/id)
      - get_secret_json(secret_id) must exist and return a dict with WHATSAPP_ACCESS_TOKEN

    Returns:
      Response JSON (dict)
    Raises:
      WhatsAppSendError on non-2xx responses or missing config.
    """
    if not assistant_message.strip():
        raise ValueError("assistant_message is empty")
    if not phone_number_id.strip():
        raise ValueError("phone_number_id is empty")
    if not user_id.strip():
        raise ValueError("user_id is empty")

    secret_prefix = os.environ.get("WHATSAPP_SECRET_ARN")
    if not secret_prefix:
        raise WhatsAppSendError("Missing env var WHATSAPP_SECRET_ARN")

    secret_id = f"{secret_prefix}{phone_number_id}"

    secret = get_secret_json(secret_id)
    token = secret.get("WHATSAPP_ACCESS_TOKEN")
    if not token:
        raise WhatsAppSendError(f"Secret {secret_id} missing WHATSAPP_ACCESS_TOKEN")

    url = f"https://graph.facebook.com/v20.0/{phone_number_id}/messages"

    payload = {
        "messaging_product": "whatsapp",
        "to": user_id,
        "type": "text",
        "text": {"body": assistant_message},
    }

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=timeout_seconds)
    except requests.RequestException as e:
        raise WhatsAppSendError(f"HTTP request failed: {e}") from e

    # WhatsApp errors come back as JSON with "error"
    if not resp.ok:
        try:
            err_json = resp.json()
        except Exception:
            err_json = {"raw": resp.text}

        raise WhatsAppSendError(
            f"WhatsApp API error {resp.status_code}: {json.dumps(err_json)[:2000]}"
        )

    return resp.json()
