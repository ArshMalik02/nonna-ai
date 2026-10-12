# Using the Darwin layer from the rest of the app

The `darwin/` service finds agents (Darwin Search), sends tasks to them (Darwin Act), and runs ride requests (direct provider route). Your code only needs to call this HTTP API.

## Run it

```bash
cd darwin
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # then edit .env (see "Config")
.venv/bin/uvicorn api:app --port 8100
```

Base URL: `http://localhost:8100`. Interactive docs: `http://localhost:8100/docs`. Check config: `GET /health`.

If `NONNA_API_TOKEN` is set in `.env`, send `X-Api-Token: <value>` on every call.

## Config (`darwin/.env`, never commit)

| Variable | Purpose |
|---|---|
| `DARWIN_API_KEY` | Darwin key. Search works without one (anonymous, lower limit). |
| `DARWIN_ACT_ENABLED` | `true` only once your key can use Act. Default `false`. |
| `DARWIN_ACT_API_KEY` | Search + Act key. Falls back to `DARWIN_API_KEY`. |
| `NONNA_API_TOKEN` | Optional shared secret for this API. |
| `RIDE_LIVE_BOOKING` | `true` allows REAL ride bookings. Default `false`. Keep it off unless a human admin approved a real booking. |

## The rule the app must follow

Anything that spends money, sends personal info, or starts work with an agent needs **admin approval first**. The API enforces it: Act and ride-booking calls fail with `403` unless the body has

```json
"approval": {"admin_approved": true, "approved_by": "admin-name", "summary": "what the admin saw and agreed to"}
```

Show the admin the plain-language text we return (`summaryForAdmin`, pending requests in the Act digest), get their yes, then call. Never set `admin_approved` without a real yes.

---

## 1. Rideshare (the working path)

Darwin Search finds ride agents, but none is runnable through Darwin yet. Rides run through a direct provider connection (RIED.TAXI, Austria: airport and long-distance transfers around Upper Austria, Salzburg and Passau). It is a real provider; the demo data we use is fake. See `RIDE_FINDINGS.md` for coverage.

**Flow:** quote, then propose (shown to admin), then book (after approval).

### 1a. Find ride agents (optional, discovery)

```bash
curl -s localhost:8100/search -H 'Content-Type: application/json' \
  -d '{"query":"book_ride","max_results":5}'
```

Tool-name wording (`book_ride`, `request_ride`, `ride-hailing`) finds the most agents. Plain wording ("ride to a doctor appointment") often returns `needs_input` or `no_match`. Run `python ride_search.py` to see current results.

### 1b. Quote (read-only, no personal data)

```bash
curl -s localhost:8100/ride/quote -H 'Content-Type: application/json' \
  -d '{"pickup":"Hauptplatz, 4910 Ried im Innkreis, Austria","destination":"Salzburg Airport, Austria","passengers":1}'
```

Returns `quote.price_eur` (EUR 160 for the whole car, one way, in our test), `quote.quote_id`, `quote.valid_until`, `quote.vehicle`, `quote.km`. `quote.ok:false` means the provider could not price the trip.

### 1c. Propose (read-only; builds what the admin approves)

```bash
curl -s localhost:8100/ride/propose -H 'Content-Type: application/json' -d '{
  "pickup":"Hauptplatz, 4910 Ried im Innkreis, Austria",
  "destination":"Salzburg Airport, Austria",
  "passengers":1,
  "date":"2026-10-15", "time":"14:00",
  "rider":{"first_name":"Test","last_name":"Rider","phone":"+43 660 0000000"}
}'
```

Response:

```json
{"proposalId":"nonna-...","available":true,"priceEur":160.0,"quoteValidUntil":"2026-10-12T01:50:10+02:00",
 "summaryForAdmin":"Ride for Test: Ried im Innkreis -> Flughafen Salzburg (SZG), 2026-10-15 at 14:00 (Vienna time). Price EUR 160.00 ... Nothing is booked until you approve.",
 "shares":["rider first and last name","rider phone number"],"booked":false}
```

Show `summaryForAdmin` and `shares` to the admin. If `available` is false, tell the elder it cannot be booked then. The quote expires (`quoteValidUntil`), so call propose again if it is old. Date and time are provider local time (Europe/Vienna). `phone` must be international format (`+43 ...`).

### 1d. Book (REAL booking, gated)

```bash
curl -s localhost:8100/ride/book -H 'Content-Type: application/json' -d '{
  "proposal_id":"nonna-...",
  "approval":{"admin_approved":true,"approved_by":"admin","summary":"Ride Ried to Salzburg Airport, EUR 160, shares name and phone"},
  "customer_confirmed":true, "accepted_terms":true
}'
```

- `403 Live booking disabled`: `RIDE_LIVE_BOOKING` is false (the default; a real booking is blocked).
- `403 Admin has not approved`: `admin_approved` is false.
- `404 Unknown or expired proposal_id`: propose again (proposals live in memory and are lost on restart).
- Success returns `{"booked":true,"providerResponse":{...}}`. This is a real booking with a real business, so only enable it deliberately. The provider's response is the source of truth; report its status, not our assumption.

Run the whole read-only flow once from the command line: `.venv/bin/python ride_demo.py`.

---

## 2. Search any task (Darwin Search)

```bash
curl -s localhost:8100/search -H 'Content-Type: application/json' -d '{
  "query":"Check drug interactions between two medications",
  "context":[{"type":"text","text":"Fake demo data only"}],
  "max_results":5
}'
```

Optional fields: `context` (typed items: `text`, `budget {amountMinor,currency}`, `deadline {at}` in RFC 3339 ending in `Z`, `custom {data}`), `previous_response_id` (refine the last search), `anonymous` (skip the key), `include_connection_prompt`.

Response fields: `status`, `isMatch`, `searchId`, `responseId`, `question`, `noMatchReason`, `assessment`, `overview`, `agents[]`.

How to handle `status`:

| status | What to do |
|---|---|
| `completed` and `isMatch: true` | Show agents in the order returned. Do not re-sort. |
| `needs_input` | Ask the user `question`, then search again with `previous_response_id` set to the last `responseId`. |
| `no_match` | Tell the user we cannot do that yet (`noMatchReason`). Never present it as success. |
| `completed` but no agents | Same as no match (`isMatch` is false). |

Each agent has `name`, `agentId`, `capabilityId`, `capabilityRevision`, `reasons`, `uncertainties`, `readiness`, `requiredSetup` (`"unknown"` if missing, which does not mean none needed), `connectionMethods`, `hasConnectionPrompt`, `hasConfirmedConnection`, and `usableViaAct`. Keep the IDs, never identify an agent by name.

`usableViaAct` is true only when `readiness` is `ready` and `canStartThread` is true. In our tests it was false for every agent, so treat results as candidates, not as something that can run. Search is a snapshot; a match is not proof the provider can complete a task.

Status codes: `429` rate limited (retry after a pause), `502` Darwin error, `503` Darwin unavailable (not the same as no results).

## 3. Act (send a task to an agent) — off by default

Needs `DARWIN_ACT_ENABLED=true` and a Search + Act key. Until then, `/act` returns `503 Act is disabled`. Darwin's docs disagree on whether Act needs pilot allowlisting, so a `403 ACT_PREVIEW_ACCESS_REQUIRED` is possible.

Start threads with agents from a search (admin approval required):

```bash
curl -s localhost:8100/act -H 'Content-Type: application/json' -d '{
  "search_id":"srch_...", "agent_ids":["<agentId>"],
  "message":"Can you handle this task? Please confirm the requirements first.",
  "approval":{"admin_approved":true,"approved_by":"admin","summary":"Ask agent for requirements only"}
}'
```

Optional: `arguments` keyed by `agentId` (not `capabilityId`) to call a capability directly; `idempotency_key` (reuse it only when retrying the same request).

Read progress: `GET /act/{actRequestId}`. The `digest` lists per thread `agentReplies`, `pendingRequests` (approval, authentication or payment asks) and `needsAdmin`.

**An accepted request is not a finished task.** `handoffStatus` only means threads were created. Check the replies before telling the elder it is done.

Answer a pending request or send a follow-up (admin approval required), using the exact `requestId` from the digest:

```bash
curl -s localhost:8100/act/continue -H 'Content-Type: application/json' -d '{
  "thread_id":"<threadId>",
  "message":{"type":"payment_response","requestId":"<requestId>"},
  "approval":{"admin_approved":true,"approved_by":"admin","summary":"Admin reviewed the payment terms"}
}'
```

Message types: `text`, `approval_confirmation` (`requestId`, `decision`), `authentication_response`, `payment_response`. Payment and sign-in happen on Darwin-hosted pages the person opens; never pass passwords or card details through us.

## Tests and files

- `.venv/bin/python -m pytest -q test_api.py` — offline tests (no network, no keys).
- `api.py` the HTTP API; `darwin_client.py` Search/Act client; `ride_agent.py` + `mcp_client.py` ride provider connection; `ride_search.py`, `ride_demo.py` CLIs; `RIDE_FINDINGS.md` coverage findings and questions for Darwin.
