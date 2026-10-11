# Nonna AI Build Plan on OpenMausBot

Based on a full read of `milind-soni/OpenMausBot` at commit `8b53c03` (Oct 11, 2026 Pacific), plus the Dial and Darwin notes in `nonna-architecture.md`.

## 1. What OpenMausBot is

OpenMausBot (OMB) is a local-first "team of AI bots in a chat app". It has two processes.

- **Harness server** (`server/`, port 8799). Owns every agent process, normalizes each engine into one runtime event stream, stores transcripts in `~/.openmausbot`, and exposes an HTTP + SSE API.
- **App** (`src/`, React, plus `electron/` desktop shells). The operator UI.

It is big (about 3,100 files, `server/index.ts` alone is 26,700 lines) and Apache 2.0, except `enterprise/`, which has its own license. Do not copy from `enterprise/`.

## 2. What Nonna can reuse

| OMB feature | Where | What it gives Nonna |
| --- | --- | --- |
| Bots with persona, model, memory | `server/store.ts`, `docs/memory.md` | One bot per specialist (rides, appointments, billing). Each keeps notes in markdown memory |
| Chief of Staff | `server/chief-of-staff.ts`, `server/delegations.ts` | A lead bot that owns the outcome, delegates to specialists with `delegate_bot`, is woken when results return, and never claims work it did not see finish. This is exactly the "Nonna" coordinator role |
| Decision model router | `server/decider/room-routing.ts` | Picks which bot answers a message with a probability. Uses it only at p >= 0.6, otherwise falls back to the lead. Never blocks, fails open. Good pattern for "which agent handles this task" |
| Channels (rooms) | `docs/` features, `server/channel-queue.ts` | One channel per elder family. Shared instructions, roster, responder rules |
| Routines | `server/routines.ts`, `docs/routine-schedules.md` | Run once, weekdays, interval or cron with timezone. Use for "cab arrives in 10 minutes" reminders and medication or appointment nudges |
| Webhook triggers | `server/webhooks.ts`, `server/webhook-ingress.ts` (port 8800) | An inbound POST starts a bot task. Has dedupe, rate limits, max pending runs |
| Custom MCP servers | `docs/custom-mcp-servers.md` | Plug Nonna's own tools (Dial, Darwin, approvals) into every bot with no OMB code change |
| Stdio MCP control plane | `scripts/mcp-server.ts` | Tools `send_channel_message`, `send_bot_message`, `wait_for_conversation`, `create_task`, `get_channel_messages`. The same HTTP API (`/api/groups/:id/messages`, `/api/bots/:id/messages`) is callable from our gateway |
| Team package format | `shared/package-fixtures/legacy-botmrr.v1.md` | Ship the whole Nonna team (bots, chief, room, routines) as one markdown file with YAML frontmatter |
| Approvals and decision log | `docs/approval-levels.md`, `server/decision-log.ts` | Audit trail of who approved what. Operator approvals in the UI |
| Server mode | `npx openmausbot serve --tunnel` or Docker (`docs/deploy-vps.md`) | Runs headless on a VPS with HTTPS |

## 3. What OMB does not do for Nonna (gaps)

1. **No iMessage or phone channel in the open-source edition.** The Slack integration lives in `enterprise/`. Nonna must own the Dial side.
2. **Dial webhook headers are not recognized.** OMB dedupes on `idempotency-key`, `x-webhook-id`, `x-github-delivery`, `webhook-id` and reads event type from `x-github-event`, `x-webhook-event`, `x-event-type`, `ce-type`. Dial sends `X-Dial-Event-ID` and `X-Dial-Event-Type`, and signs with `X-Dial-Signature`, which OMB does not verify. Put a gateway in front.
3. **Agent turns are slow for live calls.** A bot turn takes seconds to minutes. A live phone call needs answers in well under a second. Live-call tools must hit our gateway directly, not an OMB turn.
4. **Approvals happen in the OMB app, not in iMessage.** Family approval over iMessage must be built by us.
5. **Engines are CLIs** (Claude Code, Codex, Grok). On a server, log the Claude Code CLI in with an API key. Its own voice calls are macOS only, which does not matter because Dial handles voice.
6. **Data is plaintext on disk** (`~/.openmausbot`, API keys in `config.json` mode 0600). Fine for a prototype with fake data, not for real health data.
7. **Emergency handling must never wait on an agent turn or the router.** Keep it deterministic in the gateway.

## 4. Recommended structure (do not fork OMB)

Run OMB unmodified as a service and build a thin Nonna repo around it. OMB's own licensing note says customer-specific skills and connectors belong in your own repository as data and configuration, never as a fork.

```
                 iMessage group / elder phone
                            |
                          Dial
          webhooks |                | Context MCP (live calls)
                   v                v
        +------------------------------------------+
        |  nonna-gateway (our code)                 |
        |  - verify + dedupe Dial events           |
        |  - safety rules (deterministic)          |
        |  - task state machine + DB               |
        |  - family approvals over iMessage        |
        |  - scheduler hooks                       |
        +------------------------------------------+
             | OMB HTTP API           ^ nonna-tools MCP (remote)
             v                        |
        +------------------------------------------+
        |  OpenMausBot harness (unmodified)        |
        |  Nonna Chief of Staff -> specialist bots  |
        |  routines, memory, transcripts, UI       |
        +------------------------------------------+
                            |
                     Darwin Search / Act
```

## 5. Models

### 5.1 Agent roster (OMB bots)

| Bot | Role | Suggested model | Tools (via nonna-tools MCP) |
| --- | --- | --- | --- |
| **Nonna** (Chief of Staff) | Front door. Understands the request, plans, delegates, writes the one message the family sees | Claude Sonnet 5.5 (Opus 5.5 for hard multi-step days) | `get_elder_profile`, `update_task`, `message_family`, `message_elder`, `request_family_approval`, `schedule_reminder` |
| **Rides** | Book, track and confirm transport | Claude Sonnet 5.5 | `darwin_search`, `darwin_act`, `dial_call_business`, `update_task` |
| **Appointments** | Doctor, pharmacy, lab bookings, reschedules | Claude Sonnet 5.5 | `darwin_search`, `darwin_act`, `dial_call_business`, `calendar` (Composio Google Calendar), `update_task` |
| **Paperwork** | Invoices, payments, visit reports, plain-language summaries | Claude Sonnet 5.5 | `read_attachment`, `darwin_search`, `darwin_act`, `request_family_approval` |
| Router | Pick specialist for a new message | OMB decider (Jev) or Claude Haiku 5.5 with the same p >= 0.6 rule | none |
| Voice agent | Talks to the elder on the phone | Dial managed voice agent | Context MCP tools `get_elder_profile`, `create_task`, `escalate_now` |

Safety and escalation is **not** a bot. It is code in the gateway.

### 5.2 Data models (gateway database)

| Model | Key fields |
| --- | --- |
| `Elder` | id, name, phone (E.164), address, timezone, language, preferences, care notes, consent record |
| `CircleMember` | id, elder_id, name, phone, relation, priority order, can_approve, can_pay, is_nearby |
| `Line` | dial_number_id, purpose (front_door or worker), elder_id |
| `FamilyGroup` | dial_group_id, elder_id, omb_channel_id |
| `Inbound` | dial_event_id (unique, for dedupe), type, channel, from, body, media, call_id, received_at |
| `Task` | id, elder_id, kind (ride, appointment, payment, report, other), status, owner_bot, priority, due_at, summary, omb_thread_id |
| `TaskStep` | task_id, executor (darwin_act, dial_call, human), darwin_search_id, darwin_thread_id, dial_call_id, result, status |
| `Approval` | task_id, asked_member_id, question, options, decision, decided_at, expires_at |
| `Reminder` | task_id, fire_at, channel (imessage or call), text, omb_routine_id, status |
| `Provider` | name, phone, darwin_agent_id, darwin_capability_id, last_used, notes |
| `Escalation` | elder_id, trigger, level, members_contacted, outcome, timestamps |
| `AuditLog` | actor, action, task_id, payload hash, at |

### 5.3 Task state machine

```
received -> triaged -> planned -> awaiting_approval -> executing
   -> waiting_external -> confirmed -> elder_notified -> closed
any state -> failed | escalated | cancelled
```

## 6. Repository structure

```
nonna/
  apps/
    gateway/                    Node + TypeScript (Hono or Fastify)
      src/
        dial/webhook.ts         verify X-Dial-Signature, dedupe X-Dial-Event-ID
        dial/client.ts          send message, typing, place call, lookup
        dial/context-mcp.ts     live-call MCP endpoint (per-call auth by X-Dial-User-Number)
        darwin/client.ts        search, act, read act request
        omb/client.ts           post to channel, wait for conversation, create task
        safety/rules.ts         emergency keywords, silence, no-answer ladder
        safety/escalate.ts      family alert + call ladder
        tasks/state-machine.ts
        approvals/imessage.ts   ask, parse YES/NO, expire
        scheduler/reminders.ts
        db/schema.ts            Drizzle or Prisma over SQLite (Postgres later)
  packages/
    nonna-tools-mcp/             remote MCP server that OMB bots call
    shared/                     types (Task, Approval, Elder), zod schemas
  omb/
    nonna-team.md                OMB team package (bots, chief, room, routines)
    prompts/                    persona and playbook text per bot
  dial/
    inbound-instruction.md      front-door voice prompt
    outbound/                   call templates (clinic, cab company, family alert)
  scripts/
    provision-numbers.ts        buy iMessage numbers, set identity
    register-webhooks.ts
    seed-demo.ts                fake elder + family
  docker-compose.yml            gateway + omb + db
  docs/
```

## 7. How things happen

### Flow A. Onboarding
1. `seed-demo.ts` creates Elder and CircleMembers.
2. A family member creates an iMessage group with grandma and adds the Nonna number. Dial cannot create groups.
3. The gateway polls `GET /v1/groups`, finds the new group, binds it to the elder, creates an OMB channel with the Nonna team, and posts "Hi, I am Nonna. Reply OK so I can help."

### Flow B. Grandma calls "I need to see Dr. Patel tomorrow"
1. Dial answers with the front-door instruction.
2. The voice agent calls Context MCP `create_task`. The gateway checks `X-Dial-User-Number` is Grandma, creates Task (`received`) and returns at once. The agent says "I will set that up and text your family."
3. The gateway posts the task to the OMB channel. The router or Nonna picks Appointments.
4. Appointments calls `darwin_search`. If a result has `canStartThread`, it uses `darwin_act`. Otherwise it calls `dial_call_business` from the worker number with an instruction such as "book a follow-up for Mary Lee, mornings preferred".
5. On `call.transcribed`, the gateway reads the transcript and updates the TaskStep.
6. Nonna asks the family "Dr. Patel 10:30 tomorrow. Book a ride too? Reply YES or NO."
7. Approval YES from a `can_approve` member. Rides books the trip. Reminders are scheduled.
8. Next day, "Your cab is outside now. Please go to the front door." goes as an iMessage and, if unread or no reply, as a short Dial call.
9. After the visit, the photo of the invoice or report arrives as media. Paperwork summarizes it, sends a payment link only to a `can_pay` member, and posts the plain-language report to the group. Task `closed`.

### Flow C. Emergency (bypasses OMB)
1. Safety rules fire on words like "fell", "chest pain", "cannot breathe", or on long silence in `transcriptTurns`, or on no answer to a check-in.
2. The gateway immediately messages the family group, calls members in priority order (nearby first), and uses `transferTo` to connect a real person.
3. Nonna tells Grandma to call 911 herself. Do not rely on an AI dialing 911.
4. Only after that, OMB gets a summary for follow-up work.

## 8. Task breakdown

### Phase 0. Setup (half a day)
1. Create the `nonna/` repo with the structure above.
2. Run OMB headless (`npx openmausbot serve` or Docker) and log the Claude Code CLI in with an API key.
3. Dial account, top up, buy two iMessage numbers (front door and worker), set the "Nonna" identity.
4. Darwin account, application Search key, Act access request.

### Phase 1. Messaging spine (day 1)
5. Gateway webhook endpoint with HMAC verify and dedupe on `X-Dial-Event-ID`.
6. DB schema and seed data.
7. Group discovery by polling, binding group to elder.
8. Echo test. Family message in iMessage appears in the OMB channel and the reply goes back.

### Phase 2. Agents (day 1 to 2)
9. Write `nonna-team.md` (Nonna chief, Rides, Appointments, Paperwork, one room, paused routines).
10. Build `nonna-tools-mcp` and add it in OMB under Plugins, MCP servers.
11. Task state machine and `update_task` tool.
12. Router. Start with the OMB Chief of Staff delegating. Add decider routing later.

### Phase 3. Execution (day 2)
13. `darwin_search` with context (location, time, budget).
14. `darwin_act` behind a feature flag (only when access is granted).
15. `dial_call_business` with outbound templates and `Idempotency-Key`.
16. Transcript reader on `call.transcribed` that extracts the outcome into TaskStep.

### Phase 4. Family loop (day 2 to 3)
17. Approval requests in iMessage with YES or NO parsing and expiry.
18. Reminders and "cab is here" nudges (iMessage first, call as backup).
19. Report and invoice summaries posted to the group. Payment links only to `can_pay` members.

### Phase 5. Voice front door (day 3)
20. Front-door `inboundInstruction`.
21. Context MCP endpoint with `get_elder_profile`, `create_task`, `escalate_now`, authorized per call by caller number.

### Phase 6. Safety and demo (day 3)
22. Deterministic emergency rules and the call ladder.
23. Audit log and a simple status page per task.
24. Scripted end-to-end demo with fake data. Record it.

## 9. Open decisions for the team
- Keep OMB as the agent runtime for the demo, or move to a plain Claude Agent SDK loop later when OMB's desktop-first design gets in the way.
- Jev router (extra vendor key) or Claude Haiku router.
- Who in the family may approve and who may pay.
