from langchain_google_genai import ChatGoogleGenerativeAI
import os
from dotenv import load_dotenv

load_dotenv()  
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")


slow_llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    temperature=0.5,
    max_tokens=None,
    timeout=None,
    max_retries=2,
    # other params...
)

llm = slow_llm.bind(max_tokens=60, temperature=0.2)


