from pydantic import BaseModel

class Context(BaseModel):
    user_id: str
    tenant_id: str
    phone_number_id:str
