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
One channel per elder family. The gateway posts new tasks here; Nonna delegates.

## Routines
Paused by default. Reminders are created per task by `schedule_reminder`.
