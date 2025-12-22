import json
import os
import boto3
from langchain.chat_models import init_chat_model

SECRET_ID = os.environ["OPENAI_SECRET_ID"]  
REGION = os.environ.get("AWS_REGION", "us-east-1")

_sm = boto3.client("secretsmanager", region_name=REGION)
_cached_key: str | None = None

def get_openai_api_key() -> str:
    global _cached_key
    if _cached_key:
        return _cached_key

    resp = _sm.get_secret_value(SecretId=SECRET_ID)
    secret_str = resp["SecretString"] 

    # If your secret is JSON like {"OPENAI_API_KEY":"sk-..."}
    try:
        data = json.loads(secret_str)
        key = data.get("OPENAI_API_KEY") or data.get("api_key")
        if not key:
            raise ValueError("Secret JSON didn't include OPENAI_API_KEY/api_key")
    except json.JSONDecodeError:
        key = secret_str.strip()

    _cached_key = key
    return key

os.environ["OPENAI_API_KEY"] = get_openai_api_key()

llm = init_chat_model("gpt-4.1")

