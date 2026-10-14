import os
import tempfile
import unittest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
import app

class ClaudeTests(unittest.TestCase):
    def test_tool_loop_and_memory(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'ANTHROPIC_API_KEY':'test', 'CLAUDE_MODEL':'test'}):
            old_db, old_mode = app.DB, app.MODE
            app.DB, app.MODE = tmp+'/db', 'mock'
            try:
                c=TestClient(app.app)
                tid=c.post('/tasks',json={'goal':'Research venues','context_summary':'Berkeley'}).json()['task_id']
                responses=[{'content':[{'type':'tool_use','id':'call1','name':'start_agent','input':{'agent_id':'a','capability_id':'c'}}]},
                           {'content':[{'type':'tool_use','id':'call2','name':'check_progress','input':{}}]}]
                with patch('claude_loop.claude_request',new=AsyncMock(side_effect=responses)) as mocked:
                    r=c.post(f'/tasks/{tid}/run',json={'darwin_response':{'response':{'agents':[{'agentId':'a','capabilityId':'c','canStartThread':True}]}}})
                self.assertEqual(r.status_code,200)
                self.assertEqual(r.json()['status'],'completed')
                self.assertTrue(r.json()['result']['simulated'])
                self.assertEqual(mocked.await_count,2)
                self.assertEqual(r.json()['claude_messages'][-1]['content'][0]['tool_use_id'],'call2')
            finally:
                app.DB, app.MODE=old_db,old_mode
