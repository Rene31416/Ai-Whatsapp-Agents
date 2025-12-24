import json
import os
from typing import Any, Dict, Optional

import boto3


class QueueDispatchError(Exception):
    pass


class QueueDispatcher:
    def __init__(self) -> None:
        self._sqs = boto3.client("sqs")
        self._persist_queue_url = os.environ.get("CHAT_PERSIS_MESSAGE_QUEUE")
        self._deliver_queue_url = os.environ.get("CHAT_DELIVER_MESSAGE_QUEUE")

        if not self._persist_queue_url:
            raise QueueDispatchError("CHAT_PERSIS_MESSAGE_QUEUE env var is required")
        if not self._deliver_queue_url:
            raise QueueDispatchError(
                "CHAT_DELIVER_MESSAGE_QUEUE env var is required"
            )

    def send_persist_message(
        self,
        *,
        tenant_id: str,
        user_id: str,
        message_body: str,
        message_id: Optional[str],
    ) -> None:
        payload: Dict[str, Any] = {
            "tenantId": tenant_id,
            "userId": user_id,
            "role": "AGENT",
            "messageBody": message_body,
            "source": "chat-service",
        }
        if message_id:
            payload["messageId"] = message_id

        self._send(self._persist_queue_url, payload)

    def send_delivery_message(
        self,
        *,
        tenant_id: str,
        user_id: str,
        phone_number_id: str,
        message_body: str,
        message_id: Optional[str],
    ) -> None:
        payload: Dict[str, Any] = {
            "tenantId": tenant_id,
            "userId": user_id,
            "phoneNumberId": phone_number_id,
            "messageBody": message_body,
            "source": "chat-service",
            "metadata": {"producer": "agent-lambda"},
        }
        if message_id:
            payload["messageId"] = message_id

        self._send(self._deliver_queue_url, payload)

    def _send(self, queue_url: str, payload: Dict[str, Any]) -> None:
        try:
            self._sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(payload))
        except Exception as err:  # pragma: no cover - bubble up for Lambda retry
            raise QueueDispatchError(
                f"Failed to publish message to {queue_url}: {err}"
            ) from err
