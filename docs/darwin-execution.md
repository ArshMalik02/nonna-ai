# Darwin execution

How Nonna finds and uses outside agents through Darwin, and the safety rules around it. The
design folds in the group-task orchestrator prototype (FastAPI, Python) into the gateway, so
there is one service and one Claude loop (the Nonna bot).

```
family agrees in iMessage ─► Nonna bot ─ darwin_search ─► Darwin Search (or proxy)
                                 │                          └─ saved: searchId + response.agents
                                 ├─ asks the family "Reply YES or NO"
                                 ├─ darwin_act ───────────► executor ─► Darwin Act (or proxy)
                                 │                            run saved BEFORE the call
                                 ◄── updates in the channel ── watcher (every 10 s)
                                 ├─ darwin_reply (text questions only)
                                 └─ tells the family the outcome
```

## Rules the code enforces (`apps/gateway/src/darwin/executor.ts`)

- **Real candidates only.** `darwin_act` needs a `searchId` from a search the gateway saved; the
  agent and capability must match exactly one candidate and have `canStartThread: true`.
- **Saved before sent.** The run and its idempotency key are written to `darwin_runs` before the
  Act call.
- **One agent per task.** A second `darwin_act` returns the existing run. A start that may or
  may not have happened (network error, no thread in the receipt) is `unknown` and is never
  retried or rerouted, so nothing gets booked or paid twice. Only a definite refusal (HTTP 4xx)
  allows a new run.
- **Text answers text.** `darwin_reply` only answers `question` requests, once per
  `operationId`. Approval, authentication and payment requests go to a person via Darwin's
  hosted flow.
- **Completion comes from the thread.** A run is `completed` only when the thread state has a
  `completion_confirmation`. The act request's own `completed` status only means the hand-off
  finished.

## Modes

- `DARWIN_MODE=proxy` (default while Darwin is down): 60 fictional agents across Nonna's use cases
  (`proxy-catalog.ts`), returned in Darwin's documented shape (`response.agents`). Threads are
  simulated: the agent acknowledges, asks a question if the brief is thin, stops at a payment
  request for payment agents, otherwise confirms with a code. Everything is marked `simulated`.
- `DARWIN_MODE=live`: real Search and Act. Needs `DARWIN_ACT_ENABLED=true` and `DARWIN_ACT_KEY`
  (an account-owner key with `agent:write`, or a person's OAuth grant with `human:actions`; a
  Search key alone can't act). The key is sent as both `Authorization: Bearer` and `x-api-key`
  until Darwin's reference pins one.

## Still needed for live

1. One real, unmodified Search response, to check against `darwin/types.ts`.
2. Act access for our credential, and one real thread state (to confirm the `requests` and
   `completion_confirmation` shapes).
3. Per-person authorization if several family members approve actions (today one key acts).
