# Dial setup

Nonna uses two Dial numbers (`dial number list`):

| Nickname | Role | Capabilities | Env var |
| --- | --- | --- | --- |
| `nonna-elder` | Elder line | SMS + voice | `DIAL_ELDER_NUMBER` |
| `nonna-family` | Family line | iMessage + voice | `DIAL_FAMILY_NUMBER` |

- **Elder line** answers the elder's calls with [`inbound-instruction.md`](inbound-instruction.md)
  and texts them by SMS. Keep it free: no outbound task calls from this number.
- **Family line** shows up as "Nonna" in Messages. A family member creates the iMessage group
  (elder's family + this number); Dial cannot create or join groups itself, so the gateway polls
  `GET /api/v1/groups` to find it. Outbound calls in [`outbound/`](outbound/) are placed from here.

Nicknames work anywhere Dial takes `fromNumber`, e.g. `dial message --from nonna-family ...`.

## Still to do

- Register the gateway webhook (`/webhooks/dial`) once it has a public URL, and put its signing
  secret in `DIAL_WEBHOOK_SECRET`.
- Attach the Context MCP (`/mcp/context`) to the elder line.
- 10DLC registration for the elder line: US carriers may filter SMS from unregistered numbers.
