"""HTTP API for the Darwin layer (Search + Act). Run:  uvicorn api:app --port 8100

Endpoints
  GET  /health                 config status (never returns keys)
  POST /search                 Darwin Search -> normalized result
  POST /act                    start Act threads with agents from a Search (admin approval required)
  POST /act/continue           typed follow-up on a thread (admin approval required)
  GET  /act/{act_request_id}   thread state + plain-language digest
  POST /ride/quote             read-only price quote from a ride provider (direct MCP route)
  POST /ride/propose           quote + availability -> plain-language proposal for the admin
  POST /ride/book              REAL booking; needs admin approval + RIDE_LIVE_BOOKING=true

Rules enforced here (from the product + Darwin docs):
  * Search is discovery only; it contacts no provider.
  * Every Act mutation needs an explicit admin approval object.
  * An accepted Act request is NOT a completed task; use the digest to see real state.
  * searchToken (anonymous searches) is kept server-side and never returned.
  * Optional shared secret: set NONNA_API_TOKEN and send it as X-Api-Token.
"""
from __future__ import annotations

import dataclasses
import os
import threading
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

import darwin_client as dc
from ride_agent import Proposal, RideAgent

app = FastAPI(title="Nonna Darwin layer", version="0.1")


def require_token(x_api_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("NONNA_API_TOKEN")
    if expected and x_api_token != expected:
        raise HTTPException(401, "Missing or invalid X-Api-Token")


# ----------------------------- models -----------------------------------
class SearchIn(BaseModel):
    query: str = Field(min_length=1, max_length=20000)
    context: list[dict[str, Any]] | None = Field(default=None, max_length=10)
    max_results: int = Field(default=5, ge=1, le=20)
    previous_response_id: str | None = None
    anonymous: bool = False
    include_connection_prompt: bool = False


class Approval(BaseModel):
    admin_approved: bool
    approved_by: str = Field(min_length=1, description="admin identifier/name")
    summary: str = Field(min_length=1, description="what the admin was shown and agreed to")


class ActIn(BaseModel):
    search_id: str
    agent_ids: list[str] = Field(min_length=1, max_length=8)
    message: str = Field(min_length=1, max_length=32000)
    arguments: dict[str, dict[str, Any]] | None = None  # keyed by agentId
    idempotency_key: str | None = None
    approval: Approval


class ContinueIn(BaseModel):
    thread_id: str
    message: dict[str, Any]  # typed: text | approval_confirmation | payment_response | ...
    idempotency_key: str | None = None
    approval: Approval


# ----------------------------- helpers ----------------------------------
def _map_error(e: Exception) -> HTTPException:
    if isinstance(e, dc.DarwinError):
        code = e.status if e.status in (400, 401, 403, 404, 429) else 502
        return HTTPException(code, {"darwin_status": e.status, "darwin_body": e.body})
    if isinstance(e, RuntimeError):
        return HTTPException(503, str(e))
    return HTTPException(500, "internal error")


def _need_approval(a: Approval) -> None:
    if not a.admin_approved:
        raise HTTPException(403, "Admin has not approved this action")


def _agent_out(a: dc.Agent, include_prompt: bool) -> dict:
    d = dataclasses.asdict(a)
    if not include_prompt:
        d.pop("connectionPrompt", None)
        d["hasConnectionPrompt"] = bool(a.connectionPrompt)
    d["hasConfirmedConnection"] = a.has_confirmed_connection
    # Search snapshot only: not proof the provider can run the task.
    d["usableViaAct"] = a.readiness == "ready" and a.canStartThread is True
    return d


def _digest(receipt: dict) -> dict:
    """Plain-language view of an Act request, from threads[].state."""
    threads_out = []
    for t in receipt.get("threads", []):
        st = t.get("state") or {}
        replies = []
        for m in st.get("messages", []):
            if m.get("from") == "you":
                continue
            text = " ".join(c.get("text", "") for c in m.get("content", []) if c.get("type") == "text")
            replies.append({"from": m.get("from"), "type": m.get("type"), "text": text})
        pending = [
            {"requestId": r.get("requestId") or r.get("id"), "type": r.get("type"),
             "status": r.get("status"), "detail": {k: v for k, v in r.items() if k not in ("type",)}}
            for r in st.get("requests", [])
            if r.get("status") in (None, "pending")
        ]
        threads_out.append({
            "agentId": t.get("agentId"), "threadId": t.get("threadId"),
            "errorCode": t.get("errorCode"),
            "needsAdmin": bool(pending) or bool(st.get("needsAttention")),
            "pendingRequests": pending,
            "agentReplies": replies,
            "errors": st.get("errors", []),
            "stateAvailable": bool(st),
        })
    return {
        "actRequestId": receipt.get("actRequestId"),
        "handoffStatus": receipt.get("status"),
        "note": "handoffStatus only means thread receipts were created; it does not mean the task is done.",
        "threads": threads_out,
    }


# ----------------------------- routes -----------------------------------
@app.get("/health")
def health() -> dict:
    key = os.environ.get("DARWIN_ACT_API_KEY") or os.environ.get("DARWIN_API_KEY")
    return {
        "ok": True,
        "darwinBaseUrl": dc.BASE_URL,
        "searchKeyConfigured": bool(os.environ.get("DARWIN_API_KEY")) and not os.environ["DARWIN_API_KEY"].startswith("your-"),
        "actEnabled": dc.act_enabled(),
        "actKeyConfigured": bool(key) and not str(key).startswith("your-"),
        "apiTokenRequired": bool(os.environ.get("NONNA_API_TOKEN")),
    }


@app.post("/search", dependencies=[Depends(require_token)])
def search(body: SearchIn) -> dict:
    try:
        r = dc.search(body.query, body.context, body.max_results, body.previous_response_id,
                      anonymous=body.anonymous)
    except Exception as e:  # noqa: BLE001
        raise _map_error(e) from e
    return {
        "status": r.status,
        "isMatch": r.is_match,  # False for needs_input / no_match / empty list
        "searchId": r.searchId,
        "responseId": r.responseId,
        "question": r.question,
        "noMatchReason": r.noMatchReason,
        "assessment": r.assessment,
        "overview": r.overview,
        "agents": [_agent_out(a, body.include_connection_prompt) for a in r.agents],  # Darwin's order
    }


@app.post("/act", dependencies=[Depends(require_token)])
def act(body: ActIn) -> dict:
    _need_approval(body.approval)
    try:
        receipt = dc.act(body.search_id, body.agent_ids, body.message,
                         arguments=body.arguments, idempotency_key=body.idempotency_key)
    except Exception as e:  # noqa: BLE001
        raise _map_error(e) from e
    return {"receipt": receipt, "digest": _digest(receipt), "approvedBy": body.approval.approved_by}


@app.post("/act/continue", dependencies=[Depends(require_token)])
def act_continue(body: ContinueIn) -> dict:
    _need_approval(body.approval)
    try:
        result = dc.continue_thread(body.thread_id, body.message, idempotency_key=body.idempotency_key)
    except Exception as e:  # noqa: BLE001
        raise _map_error(e) from e
    return {"result": result, "approvedBy": body.approval.approved_by}


@app.get("/act/{act_request_id}", dependencies=[Depends(require_token)])
def act_status(act_request_id: str, include_thread_state: bool = True) -> dict:
    try:
        receipt = dc.get_act_request(act_request_id, include_thread_state=include_thread_state)
    except Exception as e:  # noqa: BLE001
        raise _map_error(e) from e
    return {"receipt": receipt, "digest": _digest(receipt)}


# ----------------------------- ride (direct MCP route) -------------------
# Darwin's ride agents have no executable route yet, so rides go straight to a
# provider endpoint resolved from the official MCP registry (see ride_agent.py).
_ride: RideAgent | None = None
_ride_lock = threading.Lock()
_proposals: dict[str, Proposal] = {}  # proposal_id -> Proposal (in memory)


def _ride_agent() -> RideAgent:
    global _ride
    with _ride_lock:
        if _ride is None:
            _ride = RideAgent()
        return _ride


class RideQuoteIn(BaseModel):
    pickup: str = Field(min_length=2, max_length=200)
    destination: str = Field(min_length=2, max_length=200)
    passengers: int = Field(default=1, ge=1, le=5)


class Rider(BaseModel):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    phone: str = Field(pattern=r"^\+[1-9][0-9 ()/-]{6,22}$", description="international format")


class RideProposeIn(RideQuoteIn):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$", description="YYYY-MM-DD, provider local time")
    time: str = Field(pattern=r"^([01]?\d|2[0-3]):[0-5]\d$", description="HH:MM 24h")
    rider: Rider


class RideBookIn(BaseModel):
    proposal_id: str
    approval: Approval
    customer_confirmed: bool
    accepted_terms: bool


def _ride_error(e: Exception) -> HTTPException:
    if isinstance(e, PermissionError):
        return HTTPException(403, str(e))
    return HTTPException(502, f"ride provider error: {str(e)[:300]}")


@app.post("/ride/quote", dependencies=[Depends(require_token)])
def ride_quote(body: RideQuoteIn) -> dict:
    try:
        q = _ride_agent().quote(body.pickup, body.destination, body.passengers)
    except Exception as e:  # noqa: BLE001
        raise _ride_error(e) from e
    out = dataclasses.asdict(q)
    out.pop("raw", None)
    return {"provider": "RIED.TAXI", "quote": out}


@app.post("/ride/propose", dependencies=[Depends(require_token)])
def ride_propose(body: RideProposeIn) -> dict:
    """Read-only: quote + availability. Sends no personal data to the provider."""
    try:
        agent = _ride_agent()
        q = agent.quote(body.pickup, body.destination, body.passengers)
        if not q.ok:
            raise HTTPException(422, "Provider could not quote this trip")
        p = agent.prepare_booking(q, body.date, body.time, body.passengers,
                                  body.rider.first_name, body.rider.last_name, body.rider.phone)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise _ride_error(e) from e
    _proposals[p.idempotency_key] = p
    return {
        "proposalId": p.idempotency_key,
        "available": p.available,
        "priceEur": q.price_eur,
        "quoteValidUntil": q.valid_until,
        "summaryForAdmin": p.plain_language(),
        "shares": ["rider first and last name", "rider phone number"],
        "booked": False,
    }


@app.post("/ride/book", dependencies=[Depends(require_token)])
def ride_book(body: RideBookIn) -> dict:
    _need_approval(body.approval)
    p = _proposals.get(body.proposal_id)
    if p is None:
        raise HTTPException(404, "Unknown or expired proposal_id; call /ride/propose again")
    try:
        result = _ride_agent().book(p, admin_approved=True, customer_confirmed=body.customer_confirmed,
                                    accepted_terms=body.accepted_terms)
    except Exception as e:  # noqa: BLE001
        raise _ride_error(e) from e
    return {"booked": True, "providerResponse": result, "approvedBy": body.approval.approved_by}
