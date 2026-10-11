"""Offline tests for the Darwin API (Darwin is mocked; no network, no keys)."""
import os

os.environ["DARWIN_ACT_ENABLED"] = "true"
os.environ["DARWIN_ACT_API_KEY"] = "test-key"
os.environ.pop("NONNA_API_TOKEN", None)

from fastapi.testclient import TestClient  # noqa: E402

import api  # noqa: E402
import darwin_client as dc  # noqa: E402

client = TestClient(api.app)
APPROVAL = {"admin_approved": True, "approved_by": "admin", "summary": "ride quote, no personal data"}


def _agent(**kw):
    base = dict(name="A", agentId="a1", capabilityId="c1", capabilityRevision=1, rank=1, reasons=[],
                uncertainties=[], readiness="unavailable", requiredSetup="unknown",
                connectionMethods=[], connectionPrompt="PROMPT", canStartThread=False, providerCheck="not_attempted")
    return dc.Agent(**{**base, **kw})


def test_health_has_no_secrets():
    body = client.get("/health").json()
    assert "test-key" not in str(body) and body["actEnabled"] is True


def test_search_normalizes_and_hides_prompt(monkeypatch):
    res = dc.SearchResult(status="completed", agents=[_agent()], searchId="srch_1", responseId="sresp_1",
                          searchToken="SECRET")
    monkeypatch.setattr(dc, "search", lambda *a, **k: res)
    out = client.post("/search", json={"query": "ride"}).json()
    assert out["isMatch"] and "SECRET" not in str(out)
    assert "connectionPrompt" not in out["agents"][0] and out["agents"][0]["usableViaAct"] is False


def test_empty_list_is_not_a_match(monkeypatch):
    monkeypatch.setattr(dc, "search", lambda *a, **k: dc.SearchResult(status="no_match", noMatchReason="none"))
    out = client.post("/search", json={"query": "x"}).json()
    assert out["isMatch"] is False and out["noMatchReason"] == "none"


def test_act_requires_admin_approval(monkeypatch):
    called = []
    monkeypatch.setattr(dc, "act", lambda *a, **k: called.append(1) or {})
    body = {"search_id": "srch_1", "agent_ids": ["a1"], "message": "hi",
            "approval": {**APPROVAL, "admin_approved": False}}
    assert client.post("/act", json=body).status_code == 403 and not called


def test_act_digest_surfaces_pending_request(monkeypatch):
    receipt = {"actRequestId": "ar_1", "status": "completed", "threads": [{
        "agentId": "a1", "threadId": "t1",
        "state": {"messages": [{"from": "agent", "type": "message", "content": [{"type": "text", "text": "Need pickup time"}]}],
                  "requests": [{"type": "payment_request", "requestId": "r1", "status": "pending", "amountMinor": "16000"}]}}]}
    monkeypatch.setattr(dc, "act", lambda *a, **k: receipt)
    out = client.post("/act", json={"search_id": "srch_1", "agent_ids": ["a1"], "message": "hi", "approval": APPROVAL}).json()
    t = out["digest"]["threads"][0]
    assert t["needsAdmin"] and t["pendingRequests"][0]["type"] == "payment_request"
    assert t["agentReplies"][0]["text"] == "Need pickup time"


def test_darwin_403_is_passed_through(monkeypatch):
    def boom(*a, **k):
        raise dc.DarwinError(403, {"code": "ACT_PREVIEW_ACCESS_REQUIRED"})
    monkeypatch.setattr(dc, "act", boom)
    r = client.post("/act", json={"search_id": "srch_1", "agent_ids": ["a1"], "message": "hi", "approval": APPROVAL})
    assert r.status_code == 403 and "ACT_PREVIEW_ACCESS_REQUIRED" in r.text


def test_api_token_enforced(monkeypatch):
    monkeypatch.setenv("NONNA_API_TOKEN", "s3cret")
    assert client.post("/search", json={"query": "x"}).status_code == 401
