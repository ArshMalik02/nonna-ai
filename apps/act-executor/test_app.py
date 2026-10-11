import os
import tempfile
import unittest
from fastapi.testclient import TestClient
import app as module

class FlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        module.DB = self.tmp.name + '/tasks.sqlite3'
        module.MODE = 'mock'
        self.client = TestClient(module.app)
        self.old_key = os.environ.pop('LLM_API_KEY', None)
        self.old_anthropic = os.environ.pop('ANTHROPIC_API_KEY', None)
        self.tid = self.client.post('/tasks', json={'goal': 'Research venues', 'context_summary': 'Berkeley'}).json()['task_id']
        self.agents = {'response': {'agents': [{'agentId': 'a', 'capabilityId': 'c', 'canStartThread': True}]}}
    def tearDown(self):
        self.tmp.cleanup()
        if self.old_anthropic:
            os.environ['ANTHROPIC_API_KEY'] = self.old_anthropic
        if self.old_key:
            os.environ['LLM_API_KEY'] = self.old_key
    def start(self, scenario='success'):
        return self.client.post(f'/tasks/{self.tid}/execute', json={'darwin_response': self.agents, 'mock_scenario': scenario})
    def test_success_and_duplicate_start(self):
        first = self.start().json()
        self.assertEqual(first['status'], 'running')
        self.assertEqual(self.start().json()['start_key'], first['start_key'])
        self.assertEqual(self.client.post(f'/tasks/{self.tid}/refresh').json()['status'], 'completed')
    def test_question_resume(self):
        self.start('question')
        self.assertEqual(self.client.post(f'/tasks/{self.tid}/refresh').json()['status'], 'needs_input')
        payload = {'text': 'One hour', 'operation_id': 'reply-1'}
        self.client.post(f'/tasks/{self.tid}/resume', json=payload)
        self.client.post(f'/tasks/{self.tid}/resume', json=payload)
        self.assertEqual(len(self.client.get(f'/tasks/{self.tid}').json()['answers']), 1)
        self.assertEqual(self.client.post(f'/tasks/{self.tid}/refresh').json()['status'], 'completed')
    def test_failure(self):
        self.start('failure')
        self.assertEqual(self.client.post(f'/tasks/{self.tid}/refresh').json()['status'], 'failed')
    def test_invalid_selection(self):
        r = self.client.post(f'/tasks/{self.tid}/execute', json={'darwin_response': self.agents, 'selected_agent_id': 'invented'})
        self.assertEqual(r.status_code, 422)
    def test_handoff_completed_is_not_task_completed(self):
        self.start()
        t = module.load(self.tid)
        t['pending_requests'] = [{'type': 'payment_request', 'request': 'pay-1'}]
        module.save(t)
        r = self.client.post(f'/tasks/{self.tid}/resume', json={'text': 'yes', 'operation_id': 'x'})
        self.assertEqual(r.status_code, 409)

if __name__ == '__main__':
    unittest.main()
