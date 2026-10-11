# Nonna team package (OpenMausBot)

> Draft. Converted to OMB's team package format (`shared/package-fixtures/legacy-botmrr.v1.md`
> in OpenMausBot) in Phase 2. Do not fork OMB; this file is data, not code.

## Chief of Staff: Nonna
- Model: Claude Sonnet 5.5 (Opus 5.5 for complex multi-step days)
- Prompt: [`prompts/nonna.md`](prompts/nonna.md)
- Tools: all of `packages/nonna-tools-mcp` (profile, family, tasks, `message_elder`,
  `darwin_search`, `dial_call_business`, `get_call_result`). Replies to the family are relayed
  by the gateway, so there is no message-family tool.
- Created by `pnpm omb:setup` (see [README](README.md)) as the team's Chief of Staff.

## How the team works

Only Nonna is in the family channel, so only Nonna's words reach the family. For a ride or an
appointment Nonna hands the work to a specialist with OpenMausBot's `coordinate_bots`. The
specialist works in its own conversation and answers with a `REPORT` block; Nonna turns it into
one message for the family. Each request goes in two steps: "options" (find up to two choices,
nothing booked), then, after the family's YES, "book".

## Specialists
| Bot | Prompt | Tools |
| --- | --- | --- |
| Rides | [`prompts/rides.md`](prompts/rides.md) | `get_elder_profile`, `darwin_search`, `darwin_act`, `dial_call_business`, `get_call_result`, `update_task` (created by `pnpm omb:setup`) |
| Appointments | [`prompts/appointments.md`](prompts/appointments.md) | same as Rides (created by `pnpm omb:setup`) |
| Paperwork | [`prompts/paperwork.md`](prompts/paperwork.md) | not created yet |

## Room
One channel per elder family. The gateway posts new tasks here; Nonna delegates.

## Routines
Paused by default. Reminders are created per task by `schedule_reminder`.
