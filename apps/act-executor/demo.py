from fastapi.testclient import TestClient
from app import app

with TestClient(app) as c:
    task = c.post('/tasks', json={'goal': 'Research badminton venues', 'context_summary': 'Four people in Berkeley', 'authorized_actions': ['research']}).json()
    tid = task['task_id']
    response = {'response': {'agents': [
        {'agentId': 'demo-research', 'capabilityId': 'venue-research', 'canStartThread': True},
        {'agentId': 'demo-other', 'capabilityId': 'other', 'canStartThread': True}]}}
    for path, payload in [('execute', {'darwin_response': response}), ('refresh', {})]:
        r = c.post(f'/tasks/{tid}/{path}', json=payload)
        r.raise_for_status()
    print(c.get(f'/tasks/{tid}').json()['result'])
