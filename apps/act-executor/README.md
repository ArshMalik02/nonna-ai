# Group task orchestrator — hackathon MVP

Python 3.11+. One FastAPI process, SQLite state, Darwin Act adapter, optional LLM task extraction/selection, and clearly simulated mock execution.

## Start now

```bash
cd orchestrator
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export EXECUTION_MODE=mock
uvicorn app:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000/docs for interactive requests. In another terminal, `python demo.py` runs a local in-process mock demonstration. `python -m unittest -v` runs five checks. The demo does not contact Darwin.

## Teammate handoffs

1. Chat teammate POSTs `/tasks/prepare` with `group_id`, `invocation`, and up to 30 `messages`, each containing `sender`, `text`, optional ISO `timestamp`. Requires LLM credentials. Returns a persisted task and `search_query`.
2. Darwin teammate searches using `search_query` and POSTs `/tasks/{task_id}/execute` with `darwin_response` containing the unmodified search JSON. Optional `selected_agent_id` and `selected_capability_id` identify a reviewed selection. Search is intentionally outside this backend.
3. Group integration calls `/tasks/{task_id}/refresh` every 2–5 seconds while running, then GETs `/tasks/{task_id}`. Refresh is explicit; there is no hidden background worker.
4. Text answers use `/tasks/{task_id}/resume`, with `text` and a stable unique `operation_id`. The existing thread is continued. Typed pending requests are surfaced and plain-text bypass is blocked.
5. If extraction needs information before execution, update via PUT `/tasks/{task_id}/brief`, then execute. Context/source messages remain persisted.

You can bypass extraction while teammates work: POST `/tasks` with:

```json
{
  "goal": "Research badminton venues in Berkeley",
  "context_summary": "Four people want to play together.",
  "constraints": {"maximum_total_usd": 80},
  "missing_information": [],
  "authorized_actions": ["research"]
}
```

Then POST `/tasks/TASK_ID/execute`:

```json
{
  "darwin_response": {
    "response": {
      "agents": [
        {"agentId": "demo-research", "capabilityId": "venues", "canStartThread": true},
        {"agentId": "demo-other", "capabilityId": "research", "canStartThread": true}
      ]
    }
  },
  "selected_agent_id": "demo-research",
  "selected_capability_id": "venues",
  "mock_scenario": "question"
}
```

Refresh -> needs_input; resume with `{"text":"One hour","operation_id":"answer-1"}`; refresh -> simulated completion. Mock scenarios: success, question, failure. Mock fixtures are fabricated and must never be sent to real Darwin.

## LLM configuration

Set `LLM_API_KEY`, `LLM_MODEL`, and optionally `LLM_BASE_URL` (default https://api.openai.com/v1). Uses an OpenAI-compatible Chat Completions endpoint with JSON output. The default model is configurable; availability was not live-tested. Extracted JSON is validated with Pydantic. Selected IDs must exist in the supplied eligible candidates. Without an LLM, mock mode chooses the first eligible candidate; live mode requires an explicit selection.

## Live Darwin

```bash
export EXECUTION_MODE=live
export DARWIN_API_KEY='your-key'
uvicorn app:app --host 127.0.0.1 --port 8000
```

Use real returned IDs. Act access must be enabled for your credential. Start uses POST https://api.darwin.so/api/v3/act with targets and task brief. Read uses GET /api/v3/act/requests/{actRequestId}?includeThreadState=true&limit=100. Continue uses the same Act endpoint with threadId and a typed text message.

The credential must represent the intended acting identity; a generic application search key does not grant user action authority. A multi-user group deployment needs per-user authorization instead of this demo's single configured credential.

A durable idempotency key is written before starting. A duplicate execute call returns existing state. Uncertain starts/replies are not automatically retried or rerouted; reconcile with Darwin. This prevents blindly duplicating bookings/payments but recovery is manual in this MVP.

## Honest limits / remaining integration work

- Live Darwin and LLM calls have not been credential-tested. Only local mocked flow is verified.
- Live refresh preserves provider messages and pending requests; it NEVER interprets top-level Act `completed` as task success.
- Automatic provider-specific outcome verification is not implemented. A trusted upstream verifier can call `/tasks/{id}/confirm-result` with actual outcome evidence. It must verify that evidence itself. Mock mode confirms only simulated output.
- Hosted authentication/payment/approval flows are surfaced, not implemented. These require exact typed responses and request IDs from the current thread. Do not place credentials in messages.
- Direct MCP/A2A/WebMCP provider adapters are not implemented. Candidates with canStartThread=false are rejected.
- Refresh reads the first 100 messages; pagination/cursor consumption remains to implement before long conversations.
- No autonomous conversational decision loop: provider replies are returned to the larger group agent; answers are supplied via resume.
- Single process only. In-memory locks are not cross-process locks. No API authentication yet: bind localhost only; add authentication and group ownership checks before exposing it.
- Treat extracted authorized_actions as context, not a complete enforceable permission policy. Real action permissions remain enforced through provider/Darwin approval flows.

## References

- https://darwin.so/docs/search/using-results
- https://darwin.so/docs/reference/act
- https://darwin.so/docs/reference/act-request
- https://darwin.so/docs/get-started/quickstart

## Claude tool calling (new)

Native Anthropic support is included through httpx; no extra SDK installation needed.
Windows Command Prompt (not PowerShell):

```bat
set ANTHROPIC_API_KEY=your-private-api-key
set CLAUDE_MODEL=your-enabled-Claude-model-id
set EXECUTION_MODE=mock
python -m uvicorn app:app --port 8000
```

Use a model ID available in your Anthropic Console. A Claude chat subscription is not an API key. Do not share keys in screenshots or commit them.

1. POST `/tasks/prepare` for native Claude task extraction, or `/tasks` for a supplied structured brief.
2. Your Darwin teammate POSTs `/tasks/{id}/run` instead of `/execute`:

```json
{
  "darwin_response": {
    "response": {
      "agents": [
        {"agentId":"demo-a","capabilityId":"research","canStartThread":true}
      ]
    }
  },
  "max_rounds": 6,
  "mock_scenario": "success"
}
```

Claude chooses the IDs through start_agent; Python validates them and invokes the adapter. Tool results return to Claude; it can check_progress, reply_to_agent or ask_group. State and the Claude tool transcript persist in SQLite. The loop runs at most 6 model rounds by default, 12 maximum per request. A single request can take several minutes; your caller needs a sufficient timeout. This is a bounded request-driven loop, not a durable background service.

To continue later, POST the same candidates to `/run` again. If the group answered a provider question, call `/resume` first, then `/run`. For an ask_group pause before a thread exists, update the brief; if a thread exists, supply the answer through resume. Do not use fabricated candidate IDs in live mode.

For real Darwin, stop the server, set EXECUTION_MODE=live and DARWIN_API_KEY, then restart. Calls require enabled Act access. No live credentials were used during development. Tests simulate Claude tool calls and Darwin, not real model output. Live completion still requires provider outcome verification; Claude cannot mark success through prose.

References: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
