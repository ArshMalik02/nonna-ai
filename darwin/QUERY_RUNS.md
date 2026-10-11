# Darwin Search: query runs and questions for Darwin staff

Run date: 2026-10-11 (UTC), around 20:30–20:46.
Endpoint: `POST https://api.darwin.so/api/v3/search`, **anonymous** (no key, no headers beyond `Content-Type`).
Body shape: `{"query": "<text>", "maxResults": 5}`. Raw JSON for successful runs is in `darwin/results/`.
Nothing here contacted a provider. All context was fake.

The same bodies reproduce with:

```bash
curl -sS -i https://api.darwin.so/api/v3/search -H 'Content-Type: application/json' \
  --data '{"query":"Grocery delivery for a senior","maxResults":5}'
```

## 1. Results at a glance

| # | Query | HTTP | status / assessment | Top agent | readiness | canStartThread | Verified connection? |
|---|---|---|---|---|---|---|---|
| 1 | Ride to a doctor appointment on Thursday | **500** | n/a | n/a | n/a | n/a | n/a |
| 2 | Prescription refill for a regular medication | **500** | n/a | n/a | n/a | n/a | n/a |
| 3 | Book a primary care appointment | **500** | n/a | n/a | n/a | n/a | n/a |
| 4 | Grocery delivery for a senior | **500** | n/a | n/a | n/a | n/a | n/a |
| 5 | Help setting up or fixing a smartphone | 200 | completed / partial | How to install and start using the eSIM | unavailable | false | No (`connectionMethods` empty) |
| 6 | Daily medication reminder calls | **500** | n/a | n/a | n/a | n/a | n/a |
| 7 | Find a home care aide | **500** | n/a | n/a | n/a | n/a | n/a |
| 8 | Questions about Medicare benefits | 200 | needs_input / clarify | none (0 agents) | n/a | n/a | n/a |
| 9 | Dispute an unexpected utility bill | 200 | completed / partial | trade_dispute_invoice | unavailable | false | No |
| 10 | Senior-friendly meal delivery | 200 (see note) | completed / partial | Hand off to a care advisor | unavailable | false | No |

Summary: 7 of 10 failed with HTTP 500 at least on the first attempt. Of the 4 queries that returned results, **0 agents are `ready`, 0 have `canStartThread: true`, and 0 have a verified connection method.**

Note on #10: it returned 500 on the first runs (including three retries) and returned 200 on a later attempt (20:46 UTC). The other 500s were still failing at that time, so the failures may not be fully deterministic.

## 2. HTTP 500 evidence

The response body is always `{"statusCode":500,"message":"Internal server error"}`.

Repro at 2026-10-11 20:45–20:46 UTC, anonymous, body `{"query": ..., "maxResults": 5}`. These `X-Request-Id` values come from the response headers:

| Query | X-Request-Id |
|---|---|
| Ride to a doctor appointment on Thursday | `75e6fffa-f002-48f1-a629-eda2e279d565` |
| Prescription refill for a regular medication | `022ae4e8-4614-4979-9d28-2e69ebbf70ce` |
| Book a primary care appointment | `6697714f-bb1f-4710-836c-89a8a85fcf00` |
| Grocery delivery for a senior | `d0f4e2fe-9d5c-4135-8259-2b3921f1816e` |
| Daily medication reminder calls | `3704be0b-b1a5-47cb-83ee-b1e1150fb019` |
| Find a home care aide | `45e23e7c-4d7c-4bfe-b5ce-da10e2d59e1d` |
| Grocery delivery API or MCP tool for ordering groceries (reworded) | `d13a34c8-f7e9-438a-b749-08352eedc592` |

What I tried and what I saw:
- The 500s came with minimal bodies (`query` only, no `maxResults`, no `context`), with `maxResults` set, and with my typed `context` items (text, custom, budget, deadline).
- Rewording to "API or MCP tool" phrasing didn't help (grocery, ride).
- A bogus `x-api-key` returned a clean `401` ("x-api-key must contain a Darwin API key."), so the API itself is up. The status page showed Search and API as Operational.
- The docs' quickstart query returned 200 (`MCP tool to audit a website for WCAG accessibility issues`): `completed`, 5 agents, all `unavailable`.
- These queries returned 200: smartphone help, Medicare benefits, utility bill dispute, meal delivery (later attempt).
- Pattern: queries about booking, ordering or hiring real-world services (rides, groceries, prescriptions, appointments, care aides, reminder calls) fail. Informational and document-style queries succeed. I can't tell why from outside.
- Retries with backoff (1 s, 2 s, 4 s) didn't recover them.

## 3. Successful runs

### #5 Help setting up or fixing a smartphone
- searchId `srch_994c2dc8-e271-4ebb-9dfb-2f111199ca13`, responseId `sresp_bda89647-d4bb-43a7-b77e-1c2a34ea0ae9`
- assessment: `partial`. "I found one tool that can help with setting up an eSIM on a smartphone… I don't have tools that offer general smartphone troubleshooting or repair services."
- Agent: **How to install and start using the eSIM**
  - readiness `unavailable`, `canStartThread` false, `canAttemptThread` false, `providerCheck` `not_attempted`
  - uncertainty: "Execution requires a fresh readiness check."
  - `executionGuidance`: `NO_CREDENTIAL_REQUIRED`, `REMOTE_RUNTIME_REQUIRED`
  - `connectionMethods`: `[]`
- Fit for elders: weak. It covers eSIM setup only, not general phone help.

### #8 Questions about Medicare benefits
- searchId `srch_2b9f0b3a-d5eb-42ed-acae-101fa9e1350e`, responseId `sresp_fafdd873-e7e7-4f52-9193-cdee4e25d193`
- status `needs_input`, assessment `clarify`, 0 agents.
- question: "Would you like to check eligibility for senior benefit programs, or do you have a specific program ID for which you'd like details?"
- Not tried yet: answering the question with `previousResponseId` (needs a clearer answer from us first).

### #9 Dispute an unexpected utility bill
- searchId `srch_9376bdf1-7c3c-4317-91df-f4ef4120fbb1`, responseId `sresp_715ec8d1-8f1d-45bf-8912-a86914a7f6ed`
- assessment: `partial`. Two tools found.
- **trade_dispute_invoice**: "Open a dispute on an invoice. Routes to HiveLaw arbitration if buyer and supplier cannot resolve. Settlement is held in escrow until resolution." This is a business-to-business flow and a poor fit for a household utility bill. `unavailable`, `canStartThread` false, no connection methods, `executionGuidance` null.
- **Prepare a certified letter for review**: drafts a certified-mail demand or dispute letter. The best fit for a caregiver-reviewed workflow. `unavailable`, `canStartThread` false, no connection methods, `executionGuidance` null.
- Both: `providerCheck` `not_attempted`, uncertainty "Execution requires a fresh readiness check."

### #10 Senior-friendly meal delivery
- searchId `srch_22aff652-b98f-4c11-a842-210fe55f6901`, responseId `sresp_675b8c43-7271-47e1-897f-cde0be2428f6`, X-Request-Id `f06b7576-825e-4be2-9d02-460f1f1d99e2`
- assessment: `partial`. "A tool that can help connect families with an Elderly Care Match care advisor… public URL where a family can request a free callback… may include senior-friendly meal delivery."
- Agent: **Hand off to a care advisor**. `unavailable`, `canStartThread` false, `providerCheck` `not_attempted`, no connection methods.
- Fit: partial. It's a lead-generation callback, not a meal-delivery service.

## 4. Questions for Darwin staff

**Search reliability**
1. Why do anonymous Search requests for service-type queries (rides, groceries, prescriptions, appointments, care aides, reminder calls) return HTTP 500? Request IDs are in section 2. Is it a known issue, and does a keyed call avoid it?
2. #10 flipped from 500 to 200 between attempts. Is there caching, a warm-up path or a flaky dependency behind this?
3. Are there per-query or per-topic filters on anonymous Search that cause a 500 and not a 4xx?

**Auth and docs**
4. The speedhacks page says `Authorization: Bearer $DARWIN_API_KEY`, but the Search reference says `x-api-key`. Which one is correct? (A bogus `x-api-key` returns a clear 401, so that one works as an auth header.)
5. What is the anonymous rate limit? Is `Retry-After` honored on 429?
6. Should `darwin-sdk` (0.4.0, defaults to `/api/v2`) be used with v3, or is plain HTTP the intended path?

**Coverage and readiness**
7. Every agent we saw is `readiness: unavailable`, `canStartThread: false` and `providerCheck: not_attempted`, with no `connectionMethods`. Is there a way to trigger a readiness recheck, or `filters.requiresExecutableRoute=true`, to see only agents that can run?
8. Which agents in the index are actually `ready` for elder-care tasks (rides, groceries, prescriptions, appointments, meal delivery, home care, reminder calls)? Can you point us at a few for the demo?
9. For "Dispute a utility bill," is there a consumer-oriented agent? `trade_dispute_invoice` looks like a B2B flow. Is the certified-letter agent runnable?

**Act access**
10. Please allowlist our credential for Act (pilot). We need an account-owner key with `agent:write`. We'd prefer an OAuth grant with `human:actions` if the caregiver-approves-for-elder model is supported. Which credential ID should we send?
11. Is `includeThreadState=true` on `GET /api/v3/act/requests/{id}` deployed? The docs say "pending deployment."
12. Where can we find the `agentIds` field's behavior in Act (it's listed in the schema but not explained), and the exact approval and payment request lifecycle for a test agent?
13. Is there a sandbox or test agent we can use for Act that has no real-world side effects?

## 5. What's not done yet
- Keyed Search runs (no API key added yet). Then rerun all 10, including refinement with `previousResponseId`.
- FINDINGS.md (blocked on the keyed runs).

---

## 6. Update: re-run after Darwin's fix (2026-10-11, anonymous, same bodies; the 500s are gone)

All requests now return HTTP 200. Re-run with my typed context (fake location, budget and deadline) and one refinement per query (`previousResponseId`; the refinement asks for caregiver-usable options with a verified endpoint). Raw JSON is in `results/`, and the pre-fix files are in `results/before-fix/`.

| # | Query | status / assessment | Agents | Notes |
|---|---|---|---|---|
| 1 | Ride to a doctor appointment on Thursday | no_match / unverified | 0 | "I did not find an indexed capability for this request." |
| 2 | Prescription refill | no_match | 0 | |
| 3 | Book a primary care appointment | no_match | 0 | |
| 4 | Grocery delivery for a senior | no_match | 0 | |
| 5 | Smartphone help | needs_input / clarify | 1 (eSIM setup, `unavailable`) | asks "eSIM setup, or a different aspect?" |
| 6 | Daily medication reminder calls | no_match | 0 | |
| 7 | Find a home care aide | no_match | 0 | refinement returned 2 agents (see below) |
| 8 | Medicare benefits | completed / partial | 2 (benefits eligibility check, benefit program details), both `unavailable` | |
| 9 | Dispute a utility bill | completed / partial | 2 (`trade_dispute_invoice`, certified-letter agent), both `unavailable` | |
| 10 | Senior-friendly meal delivery | no_match | 0 | |

Ride-related queries without context, anonymous, all 200: `book a taxi`, `ride-hailing`, `Lyft ride request MCP` and `Non-emergency medical transportation for seniors` all return `no_match`.

Across all 10: **0 agents are `ready`, 0 have `canStartThread: true`, 0 have a verified connection method.** All agents returned are `unavailable`.

Refinement results (does `previousResponseId` help?):
- #7 home care aide: `no_match` became `completed` / `partial` with 2 agents, "Draft a job post for someone to confirm" and "Endpoint Monitor". Both are `unavailable`. The job-post draft is loosely relevant, and Endpoint Monitor doesn't fit.
- #9 utility bill: narrowed from 2 agents to 1 (the certified-letter agent). It kept the better fit.
- #5 and #8 got worse: they went from agents to `no_match`.
- Others stayed `no_match`.
- My refinement text was generic, so this tests refinement mechanics more than it tests better wording.

Follow-up questions for Darwin:
14. Is the ride/appointment/grocery/prescription/care-aide `no_match` a real coverage gap, or are those agents indexed but filtered out? (The queries returned 500 before the fix.)
15. Which topics have `ready` agents today? Even one for each of rides, groceries and appointments would let us demo end to end.
