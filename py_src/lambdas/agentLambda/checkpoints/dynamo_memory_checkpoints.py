from langgraph_dynamodb_checkpoint import DynamoDBSaver
import os

dynamo_checkpointer = DynamoDBSaver(
    table_name =os.environ["MEMORY_TABLE_NAME"]
)