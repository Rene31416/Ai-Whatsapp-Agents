from agentLambda.agents.master_agent import master_agent
from agentLambda.utils.types import Context


ended = True

while ended:
    user_message= input('> (q for exit): ')
    if user_message =='q':
        break
    context = Context(tenant_id='opal-clinic', user_id='22484592', phone_number_id='121212121212')
    response = master_agent.invoke(
        {"messages": [{"role": "user", "content": user_message}]},
        context=context,
        config={"configurable": {"thread_id": '22484538'}},
    )
    assitant_message = response["messages"][-1].content
    print(f'>Assitant: {assitant_message}')