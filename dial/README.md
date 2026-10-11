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

## Connecting Dial to a local gateway

```bash
pnpm db:migrate && pnpm seed                      # demo elder (fake)
pnpm family:add --name "Anna" --phone +1... --can-approve   # repeat per family member;
                                                  # --imessage <apple id> if they iMessage from an email
cloudflared tunnel --url http://localhost:8787    # note the https://*.trycloudflare.com URL
pnpm dial:connect https://<tunnel>                # registers the webhook, creates CONTEXT_MCP_TOKEN
pnpm build && pnpm --filter @nonna/gateway start  # start (or restart) the gateway
pnpm dial:connect https://<tunnel>                # again: connects the live-call Context MCP
```

Quick-tunnel URLs change on every restart; re-run `pnpm dial:connect` with the new URL and
restart the gateway. The gateway polls for new family groups every minute, binds a new group to
the elder, and posts a welcome; a family member replies OK to confirm.

## Still to do

- 10DLC registration for the elder line: US carriers may filter SMS from unregistered numbers.
- A real elder phone number (the seed uses a fake one, so the elder line can't match them yet).
