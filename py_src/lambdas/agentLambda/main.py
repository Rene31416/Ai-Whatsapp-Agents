from agentLambda.agents.master_agent import master_agent
from aws_lambda_powertools.utilities.data_classes import (
    SQSEvent,
    SQSRecord,
    event_source,
)
from agentLambda.utils.types import Context
from agentLambda.clients.secret_manager_client import get_secret_json
import json
from agentLambda.clients.meta_client import send_whatsapp_message
import os

# os.environ["OPENAI_API_KEY"]
# os.environ["AWS_REGION"]
# os.environ["AWS_ACCESS_KEY_ID"]
# os.environ["AWS_SECRET_ACCESS_KEY"]
# os.environ["AWS_SESSION_TOKEN"]
# os.environ["AWS_DEFAULT_REGION"]

ended = True


@event_source(data_class=SQSEvent)
def handler(event: SQSEvent, context):
    print(f"SQSevent: {event}")
    for record in event.records:
        message, message_id = process_record(record)
        print(f"Received message ID: {message_id}")
        print(f"Received message message: ")
        sqs_message= json.loads(message)

        tenant_id= sqs_message['tenantId']
        user_id= sqs_message['userId']
        user_message= sqs_message['combinedText']                                          #############################
        phone_number_id =sqs_message["whatsappMeta"]["phoneNumberId"]                      # Tech debth fix this parse #
        print(tenant_id, user_id, user_message, phone_number_id, phone_number_id)          #############################
        invoke_handler(tenant_id, user_message, user_id, phone_number_id)


    return {"statusCode": 200, "body": "Messages processed with Powertools"}


def process_record(record: SQSRecord) -> tuple[str, str]:
    message = record.body
    message_id = record.message_id
    return message, message_id


def invoke_handler(tenant_id, user_message, user_id, phone_numberId):
    context = Context(tenant_id=tenant_id, user_id=user_id, phone_number_id=phone_numberId)
    response = master_agent.invoke(
        {"messages": [{"role": "user", "content": user_message}]},
        context=context,
        config={"configurable": {"thread_id": user_id}},
    )
    assitant_message = response["messages"][-1].content
    print(f'>Assitant: {assitant_message}')
    send_whatsapp_message(assistant_message=assitant_message, phone_number_id=phone_numberId, user_id=user_id)
    print('>All good')

