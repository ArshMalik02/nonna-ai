# Nonna AI Architecture Notes (Dial + Darwin)

Researched October 11, 2026 from docs.getdial.ai and darwin.so/docs, plus live Darwin Search tests.

## 1. The big picture

Nonna has one brain (our orchestrator server) and two outside platforms.

- **Dial** is the communication layer. It gives Nonna a phone number that answers voice calls with an AI voice, sends and receives iMessage (including group chats), places outbound AI voice calls, and pushes every event to our server by webhook.
- **Darwin** is the discovery layer. Search finds the right outside agent for a task (ride, appointment, payment). Act opens a thread with that agent and handles sign-in, approval and payment. Act is a pilot preview today.
- **Nonna orchestrator** (ours) holds the elder profile, the family circle, the task state machine, the escalation rules and the scheduler. Neither Dial nor Darwin does multi-step planning for us. Darwin says Act opens single threads and does not schedule dependent multi-agent plans.

```
Elder (voice call or iMessage)
        |
      Dial  <---- webhooks (at-least-once) ---->  Nonna orchestrator  <---->  Darwin Search / Act
        |                                            |   ^                       |
        |  Context MCP tools during live calls ------+   |                       v
        |                                                |                outside agents
   Family iMessage group  <---------- updates -----------+                (rides, booking, pay)
        |
   Outbound AI calls (clinic, cab company, neighbor, loved one)
```

## 2. Dial, what matters for Nonna

### Numbers
- Buy an iMessage number with `includeImessage: true` (REST `capabilities: ["sms","call","imessage"]`). It is pay-as-you-go only, setup is async (`setupStatus: provisioning` until `ready`), and messaging is free. Calls are billed per minute.
- Only US numbers can be provisioned.
- Every purchase needs `explicitProgrammaticConsent`.
- Set a display identity (first name "Nonna", avatar) so it shows nicely in Messages.
- **Use at least two numbers.** A number carries one call at a time (`429 call_limit_reached`). Keep the "front door" number free for the elder, and place outbound task calls (clinic, cab company) from a separate worker number.

### Inbound voice (elder calls Nonna)
- Dial answers automatically with the number's `inboundInstruction` as the system prompt. Set `inboundLanguage` to pin the language if needed.
- To let the voice agent act during the call, attach a **Context MCP** server (our MCP). Its tools become callable mid-call. Dial adds headers `X-Dial-Direction`, `X-Dial-User-Number`, `X-Dial-Agent-Number` on every request.
- Security warning from Dial docs. The MCP connection has one identity for all callers. Our MCP must authorize per call using `X-Dial-User-Number`, for example only return Grandma's profile when the caller is Grandma's number, and reject unknown numbers.
- Alternative is **Self-Hosted LLM mode** (our server writes every spoken turn). It needs a manual access request and it routes **all** calls on the account, inbound and outbound. Start with Managed + Context MCP.
- After the call, `call.ended` fires, then `call.transcribed`. Fetch `GET /api/v1/calls/{id}` for `transcript` and `transcriptTurns`. Long silences between turns are measurable (could signal confusion).

### Outbound voice (Nonna calls someone)
- `POST /api/v1/calls` with `to`, `outboundInstruction` (the per-call system prompt), `fromNumber`, optional `language`, `voiceGender`, `maxCallDurationSeconds` (60 to 3600), `transferTo`.
- The agent navigates phone menus (DTMF) by itself when the instruction names the goal ("choose appointments").
- `transferTo` makes the agent wait for a real human, then cold-transfer. Useful to connect the clinic receptionist to the daughter, or a neighbor to the elder.
- Send an `Idempotency-Key` header (supported in the API reference, even though the guide page says otherwise). A retry without it places a second call.
- Free accounts are capped at 5 minutes per call and 2 concurrent calls. Top up once to lift this.

### iMessage and the family group
- Send with `POST /api/v1/messages` (`to` or `groupId`, `body`, `mediaUrls`). A lone audio file goes out as an iMessage voice message, good for elders who prefer listening.
- **Dial cannot create or join a group.** A family member must create the iMessage group (elder + loved ones) and add the Nonna number. There is no join event, so poll `GET /v1/groups` to discover new groups.
- Inbound group messages arrive as `message.received` with `groupId`, and `from` is the actual participant.
- In iMessage groups you cannot reply-to or react inside the group, and read receipts may never arrive. Never wait for `read`.
- Typing indicator (`POST /v1/typing`) is free. Use it while Nonna works so the family sees activity.
- Limits. 50 new conversations per number per day. The iMessage network also limits how many messages a recipient who never replied can get (`429`, no way to raise it), so the first onboarding message must invite a reply.
- `GET /api/v1/lookup` tells whether a number supports iMessage. If not, fall back to SMS (then 10DLC registration is needed for US SMS).

### Events
- Use **webhooks**, not the live stream. The stream is presence-based (replays only within 2 minutes). Webhooks are signed (HMAC, `X-Dial-Signature`), retried up to 6 times, and must be deduped on `X-Dial-Event-ID`.
- Useful events: `message.received`, `message.status_changed`, `call.status_changed`, `call.ended`, `call.transcribed`, `number.status_changed`.

## 3. Darwin, what matters for Nonna

### Search (public, works now)
- `POST https://api.darwin.so/api/v3/search` with `query`, `maxResults` (1 to 20), `context` (up to 10 typed items such as text, budget, deadline, PDF or image), `previousResponseId` to refine.
- Read `status` first. `needs_input` means ask `response.question`. `no_match` means show `noMatchReason`.
- Each agent has `agentId`, `capabilityId`, `capabilityRevision`, `reasons`, `uncertainties`, `readiness`, `canStartThread`, `requiredSetup`, `executionRequirements`, `connectionMethods`, `connectionPrompt`.
- `response.plan` can propose steps with `dependsOn`. Our orchestrator must run them.
- `filters.requiresExecutableRoute=true` returns only startable results.
- Rate limits. Until Oct 12, 2026 7:00 p.m. PDT there is a launch allowance of 1,000,000 per 24 hours. After that it is 100 per minute anonymous and 5,000 per minute with an application Search key. Get the key now.

### Act (pilot preview, gated)
- `POST /api/v3/act` with exactly one of `searchId`, `targets`, or `threadId`, plus `message` and an `Idempotency-Key`.
- Needs an account-owner key with `agent:write` or a person's OAuth grant with `human:actions`. Other callers get `ACT_PREVIEW_ACCESS_REQUIRED` (403). At SpeedHacks, access is requested from Sanjit.
- Read progress with `GET /api/v3/act/requests/{actRequestId}?includeThreadState=true`. Look at `threads[].state.messages`, `actions`, `requests`.
- Typed messages. `text`, `action_request`, `action_confirmation`, `approval_confirmation`, `completion_confirmation`, `cancellation_request`, `authentication_response`, `payment_response`.
- Plain text never approves an action or a payment. Payment opens a hosted checkout URL for a human. Credentials and card data never go through messages.
- Completion counts only when the thread state shows it. An HTTP 200 is not completion.

### Live coverage test (Oct 11, 2026)
| Query | Result |
| --- | --- |
| book a taxi / ride hailing | Matches (Rovv `book_ride`, Seat Sherpa, Uber/Lyft price info). All `readiness: unavailable`, `canStartThread: false`, no published endpoint |
| place a phone call to a business | `ai_call`, `Place a call`. Unavailable |
| pay a medical bill invoice | `invoice_pay`, `invoice_report_payment`. Unavailable |
| summarize a medical report for family | One weak match, `needs_input` |
| senior fell at home, urgent help | No agents. Darwin told the user to call local emergency services |
| doctor appointment, prescription refill (several phrasings) | HTTP 500 repeatedly |

Conclusion. Darwin finds relevant agents but none were executable during this test. Plan for Darwin as discovery plus Act where access is granted, and keep a Dial voice call fallback for every task.

## 4. How Nonna runs each use case

| Step | Who does it | How |
| --- | --- | --- |
| Elder asks for help | Dial inbound call or iMessage | Context MCP tool `create_task` during the call, or `message.received` webhook |
| Understand the need | Nonna orchestrator (Claude) | Classify into ride, appointment, payment, report, emergency |
| Find a provider | Darwin Search | Query with elder location, time, budget in `context` |
| Do the task | Darwin Act if `canStartThread`, else Dial outbound AI call | Example: call the clinic with `outboundInstruction` "book a follow-up for Mary Lee, prefer mornings" |
| Ask family to approve | iMessage group | Clear yes/no message. Payment goes only through the hosted checkout link to the family payer |
| Notify the elder | iMessage or outbound call | "Your cab is outside now. Please go to the front door." Scheduled by our own job runner |
| Invoice and report | Darwin (if available) or Nonna itself | Read PDF from `message.received` media, summarize, send to group as text plus PDF |

## 5. Emergencies (please read)

- Nothing in the Dial docs covers calling 911, and Darwin Search refuses emergency requests. Do not design Nonna to depend on an AI agent dialing 911.
- Safer pattern. When Nonna hears an emergency, it tells the elder to call 911 (or stay on the line while family is alerted), immediately posts to the family group, and places parallel outbound calls to the nearest family member or neighbor. Use `transferTo` to connect a real person to the elder.
- Ask Dial support directly whether emergency calling is supported before any demo claims it.

## 6. Risks and open questions

1. Darwin Act access is gated. Request it today.
2. Darwin Search returned 500 on medical queries. Retry and report this to Darwin (it also scores under "areas for improvement" at SpeedHacks).
3. Health data. Transcripts and reports are sensitive. Keep the elder profile on our server, authorize every MCP call by caller number, and log carefully.
4. Consent. The elder and family must agree to Nonna acting and calling for them. Outbound calls to businesses should say they are an AI assistant calling for a named person.
5. Dial doc inconsistencies found. The guide says calls have no idempotency key, but the API reference supports `Idempotency-Key`. The send-message reference says group sends are always WhatsApp, but the groups guide supports iMessage groups. The API reference allows one media item on iMessage numbers, while the guide says up to 10. Test each before relying on it.

## 7. Suggested build order

1. Dial account, top up, buy two iMessage numbers, set identity, register webhook.
2. Family onboarding flow (family creates the group, adds Nonna, Nonna confirms in the group).
3. Inbound call with Context MCP tools `get_profile`, `create_task`, `escalate`.
4. Task engine with Dial outbound calls as the default executor.
5. Darwin Search for provider discovery, then Act for any route that becomes executable.
6. Scheduler for reminders and "cab is here" nudges, and the end-of-task report to the group.
