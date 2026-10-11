# Nonna team package (OpenMausBot)

> Draft. Converted to OMB's team package format (`shared/package-fixtures/legacy-botmrr.v1.md`
> in OpenMausBot) in Phase 2. Do not fork OMB; this file is data, not code.

## Chief of Staff: Nonna
- Model: Claude Sonnet 5.5 (Opus 5.5 for complex multi-step days)
- Prompt: [`prompts/nonna.md`](prompts/nonna.md)
- Tools: `get_elder_profile`, `update_task`, `message_family`, `message_elder`,
  `request_family_approval`, `schedule_reminder`

## Specialists
| Bot | Prompt | Tools |
| --- | --- | --- |
| Rides | [`prompts/rides.md`](prompts/rides.md) | `darwin_search`, `dial_call_business`, `update_task` |
| Appointments | [`prompts/appointments.md`](prompts/appointments.md) | `darwin_search`, `dial_call_business`, `update_task` |
| Paperwork | [`prompts/paperwork.md`](prompts/paperwork.md) | `darwin_search`, `request_family_approval`, `update_task` |

## Room
One channel per elder family (its id is stored in `family_groups.omb_channel_id`). The gateway
posts two kinds of messages here, and Nonna delegates from them:
- `New message for elder <elderId> from <name> (<relation>): ...` for every non-emergency
  iMessage or SMS from the family group or the elder.
- `New task <taskId> for elder <elderId> (kind, status): ...` when the voice agent creates a
  task during a call.

Emergencies never reach this room first. The gateway alerts the family before anything else.

## Tools server
All tools above are served by the gateway at `/mcp/tools` (Streamable HTTP MCP). Add it once in
OMB under *Plugins -> MCP servers*:
- URL: `https://<tunnel>/mcp/tools`
- Header: `Authorization: Bearer <NONNA_TOOLS_TOKEN>`

Bots pass the `elderId` and `taskId` from the room messages into the tools. A call that would
skip a step of the task state machine is refused with a readable error.

## Routines
Paused by default. Reminders are created per task by `schedule_reminder`.
