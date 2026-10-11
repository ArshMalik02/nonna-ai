# Dial setup

Nonna currently uses **one iMessage number** (`nonna-family`) for both the elder and the family,
set as both `DIAL_ELDER_NUMBER` and `DIAL_FAMILY_NUMBER`. iMessage avoids SMS 10DLC registration;
the elder needs an iPhone. Its voice agent runs [`inbound-instruction.md`](inbound-instruction.md),
which handles the elder (with the Context MCP tools) and family callers (message-taking).

The SMS-only numbers on the account (`nonna-elder`, and any others) are unused. An elder without
an iPhone would need one of them as `DIAL_ELDER_NUMBER`, plus 10DLC registration.

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

- Register the real elder: `pnpm elder:set --name "<name>" --phone <their own phone>` (the seed
  uses a fake person). Their own phone, not Nonna's elder line, is what Dial reports as `from`.

## What happens after a call

When Dial reports a call transcript (`call.transcribed`), or an outbound call that never
connected (`call.ended`), the gateway fetches the call and posts it to the elder's team channel:
the elder's calls with any tasks the voice agent created, business calls against their task, and
emergency calls to family. Nonna then posts a short summary to the family group and acts on it.
