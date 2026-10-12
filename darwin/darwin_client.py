"""Thin Darwin Search client (plain HTTP, API v3).

Sources: darwin.so/docs/reference/search, /reference/act, /search/using-results.
Nothing here contacts a provider agent; Search is discovery only.
"""
from __future__ import annotations

import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

BASE_URL = os.environ.get("DARWIN_BASE_URL", "https://api.darwin.so")
UNKNOWN = "unknown"  # docs: null/missing setup metadata means unknown, not "none needed"


class DarwinError(Exception):
    def __init__(self, status: int, body: Any):
        super().__init__(f"Darwin HTTP {status}: {body}")
        self.status = status
        self.body = body


@dataclass
class Agent:
    name: str
    agentId: str
    capabilityId: str
    capabilityRevision: int | None
    rank: int | None
    reasons: list[str]
    uncertainties: list[str]
    readiness: str  # ready | authentication_required | recheck_required | unavailable | unknown
    requiredSetup: Any  # dict or "unknown"
    connectionMethods: list[dict]
    connectionPrompt: str | None
    canStartThread: bool | None
    providerCheck: str

    @property
    def has_confirmed_connection(self) -> bool:
        """True only if a method has a verified endpoint. Never guess a URL."""
        return any(
            m.get("endpointStatus") == "verified" and m.get("endpointUrl")
            for m in self.connectionMethods
        )


@dataclass
class SearchResult:
    status: str  # completed | needs_input | no_match
    agents: list[Agent] = field(default_factory=list)
    question: str | None = None
    noMatchReason: str | None = None
    assessment: dict | None = None
    overview: str | None = None
    searchId: str | None = None
    responseId: str | None = None
    searchToken: str | None = None  # private; never log or display
    raw: dict = field(default_factory=dict)

    @property
    def is_match(self) -> bool:
        # An empty list is NOT a successful match.
        return self.status == "completed" and len(self.agents) > 0


def _headers(api_key: str | None, search_token: str | None) -> dict:
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    if api_key:
        h["x-api-key"] = api_key
    if search_token:
        h["X-Search-Token"] = search_token
    return h


def _parse_agent(a: dict) -> Agent:
    setup = a.get("requiredSetup")
    return Agent(
        name=a.get("name") or UNKNOWN,
        agentId=a["agentId"],
        capabilityId=a["capabilityId"],
        capabilityRevision=a.get("capabilityRevision"),
        rank=a.get("rank"),
        reasons=a.get("reasons") or [],
        uncertainties=a.get("uncertainties") or [],
        readiness=a.get("readiness") or UNKNOWN,
        requiredSetup=setup if setup else UNKNOWN,
        connectionMethods=a.get("connectionMethods") or [],
        connectionPrompt=a.get("connectionPrompt"),
        canStartThread=a.get("canStartThread"),
        providerCheck=a.get("providerCheck") or UNKNOWN,
    )


# responseId/searchId -> searchToken for anonymous follow-ups and Act (in-memory only)
_tokens: dict[str, str] = {}


def search(
    query: str,
    context: list[dict] | None = None,
    max_results: int = 5,
    previous_response_id: str | None = None,
    *,
    api_key: str | None = None,
    search_token: str | None = None,
    anonymous: bool = False,
    retries: int = 3,
) -> SearchResult:
    """POST /api/v3/search. Keeps Darwin's order. Raises DarwinError on non-2xx
    (a 503 is an outage, not an empty result)."""
    key = None if anonymous else (api_key or os.environ.get("DARWIN_API_KEY"))
    if key and key.startswith("your-"):
        key = None  # placeholder from .env.example
    body: dict[str, Any] = {"query": query, "maxResults": max_results}
    if context:
        body["context"] = context
    if previous_response_id:
        body["previousResponseId"] = previous_response_id
    token = search_token or _tokens.get(previous_response_id or "")

    for attempt in range(retries):
        r = requests.post(
            f"{BASE_URL}/api/v3/search",
            json=body,
            headers=_headers(key, token),
            timeout=60,
        )
        if r.status_code == 429:
            time.sleep(float(r.headers.get("Retry-After", 2 ** attempt)))
            continue
        if r.status_code >= 500 and attempt < retries - 1:
            time.sleep(2 ** attempt)
            continue
        break
    try:
        data = r.json()
    except ValueError:
        data = {"text": r.text}
    if not r.ok:
        raise DarwinError(r.status_code, data)

    resp = data.get("response") or {}
    result = SearchResult(
        status=data.get("status", UNKNOWN),
        agents=[_parse_agent(a) for a in resp.get("agents") or []],  # Darwin's order
        question=resp.get("question"),
        noMatchReason=resp.get("noMatchReason"),
        assessment=resp.get("assessment"),
        overview=resp.get("overview"),
        searchId=data.get("searchId"),
        responseId=data.get("responseId"),
        searchToken=data.get("searchToken"),
        raw=data,
    )
    if result.searchToken:
        for k in (result.responseId, result.searchId):
            if k:
                _tokens[k] = result.searchToken  # reused on refinement / Act handoff
    return result


# ---------------------------------------------------------------------------
# Act (beta). Disabled unless DARWIN_ACT_ENABLED=true.
#
# Access: darwin.so/docs/act/quickstart says Act is open to authenticated users
#   (account key with agent:read + agent:write, or OAuth grant with human:actions;
#   "Search + Act" keys also carry connections:write). darwin.so/docs/reference/act
#   says new starts need a pilot-allowlisted credential, else 403
#   ACT_PREVIEW_ACCESS_REQUIRED. The docs disagree; a 403 surfaces as DarwinError.
#   An application-only Search key CANNOT act. Same owner as the Search is required.
# Start: POST /api/v3/act {"searchId", "agentIds": [...], "arguments": {<agentId>: {...}},
#   "message"} + Idempotency-Key header (+ X-Search-Token for anonymous Searches).
# Continue: POST /api/v3/act {"threadId", "message": {"type": "text"|"approval_confirmation"|
#   "authentication_response"|"payment_response"|..., ...}}. Answer only exact pending IDs.
# Read: GET /api/v3/act/requests/{actRequestId}?includeThreadState=true
#   -> threads[].state.messages (replies) and threads[].state.requests (pending
#   approval / authentication / payment). Acceptance != task done.
# Product rule: admin must approve money / personal-info steps; enforced in api.py.
# ---------------------------------------------------------------------------
def act_enabled() -> bool:
    return os.environ.get("DARWIN_ACT_ENABLED", "false").lower() == "true"


def _act_key() -> str:
    if not act_enabled():
        raise RuntimeError("Act is disabled (set DARWIN_ACT_ENABLED=true once you have an Act-capable key).")
    key = os.environ.get("DARWIN_ACT_API_KEY") or os.environ.get("DARWIN_API_KEY")
    if not key or key.startswith("your-"):
        raise RuntimeError("No Act key: set DARWIN_ACT_API_KEY (a Search + Act key, agent:write).")
    return key


def _act_post(body: dict, idempotency_key: str | None, search_token: str | None) -> dict:
    headers = _headers(_act_key(), search_token)
    headers["Idempotency-Key"] = idempotency_key or str(uuid.uuid4())
    r = requests.post(f"{BASE_URL}/api/v3/act", json=body, headers=headers, timeout=60)
    try:
        data = r.json()
    except ValueError:
        data = {"text": r.text}
    if not r.ok:
        raise DarwinError(r.status_code, data)
    return data


def act(
    search_id: str,
    agent_ids: list[str],
    message: str,
    *,
    arguments: dict[str, dict] | None = None,
    idempotency_key: str | None = None,
    search_token: str | None = None,
) -> dict:
    """Start threads with agents picked from a Search. Returns the Act receipt."""
    body: dict[str, Any] = {"searchId": search_id, "agentIds": agent_ids, "message": message}
    if arguments:
        body["arguments"] = arguments  # keyed by agentId, not capabilityId
    return _act_post(body, idempotency_key, search_token or _tokens.get(search_id))


def continue_thread(
    thread_id: str, message: dict, *, idempotency_key: str | None = None
) -> dict:
    """Send a typed follow-up, e.g. {"type": "text", "text": "..."} or
    {"type": "payment_response", "requestId": "..."}."""
    return _act_post({"threadId": thread_id, "message": message}, idempotency_key, None)


def get_act_request(act_request_id: str, *, include_thread_state: bool = True) -> dict:
    r = requests.get(
        f"{BASE_URL}/api/v3/act/requests/{act_request_id}",
        params={"includeThreadState": str(include_thread_state).lower()},
        headers=_headers(_act_key(), None),
        timeout=60,
    )
    try:
        data = r.json()
    except ValueError:
        data = {"text": r.text}
    if not r.ok:
        raise DarwinError(r.status_code, data)
    return data
