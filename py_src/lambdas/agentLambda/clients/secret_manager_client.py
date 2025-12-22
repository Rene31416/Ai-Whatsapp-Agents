import json
import boto3

def get_secret_json(secret_name: str) -> dict:
    sm = boto3.client("secretsmanager")
    resp = sm.get_secret_value(SecretId=secret_name)
    return json.loads(resp["SecretString"])
