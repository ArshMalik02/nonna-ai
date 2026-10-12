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


# ---- ride endpoints (provider mocked) ----
from ride_agent import Proposal, Quote  # noqa: E402


class FakeRide:
    def quote(self, *a, **k):
        return Quote(ok=True, price_eur=160.0, quote_id="Q1", valid_until="2099-01-01", pickup="A", destination="B", vehicle="Car")

    def prepare_booking(self, q, date, time, pax, f, l, phone):
        return Proposal(q, date, time, pax, f, l, phone, "nonna-123", True)

    def book(self, p, **k):
        import ride_agent
        return ride_agent.RideAgent.book(self, p, **k)


RIDE_BODY = {"pickup": "Hauptplatz Ried", "destination": "Salzburg Airport", "passengers": 1, "date": "2026-10-15",
             "time": "14:00", "rider": {"first_name": "Test", "last_name": "Rider", "phone": "+43 660 0000000"}}


def test_ride_propose_then_book_is_gated(monkeypatch):
    monkeypatch.setattr(api, "_ride", FakeRide())
    prop = client.post("/ride/propose", json=RIDE_BODY).json()
    assert prop["booked"] is False and prop["priceEur"] == 160.0
    book = {"proposal_id": prop["proposalId"], "approval": APPROVAL, "customer_confirmed": True, "accepted_terms": True}
    monkeypatch.delenv("RIDE_LIVE_BOOKING", raising=False)
    r = client.post("/ride/book", json=book)
    assert r.status_code == 403 and "disabled" in r.text
    r = client.post("/ride/book", json={**book, "approval": {**APPROVAL, "admin_approved": False}})
    assert r.status_code == 403


def test_ride_book_unknown_proposal():
    r = client.post("/ride/book", json={"proposal_id": "nope", "approval": APPROVAL, "customer_confirmed": True, "accepted_terms": True})
    assert r.status_code == 404
