# OpenMausBot setup

Nonna's agents run in an **unmodified** OpenMausBot (OMB) harness. This folder holds the team as
data: the bot prompt(s) and the team description. The gateway talks to OMB over its HTTP API.

```
family iMessage / elder SMS ─► gateway ─► OMB channel "Family · <elder>" ─► Nonna bot
                                  ▲                                        │ tools (MCP)
                                  └── relays every bot reply to the group ◄┘ gateway /mcp/tools
```

## Run OMB headless

OMB needs Node 24. Give it its own data folder and port so it never touches a desktop install:

```bash
npm i --prefix ~/.openmausbot-nonna/cli openmausbot
~/.openmausbot-nonna/cli/node_modules/.bin/openmausbot serve \
  --port 8899 --data-dir ~/.openmausbot-nonna/data --label nonna --no-pair
```

Loopback requests are trusted as the owner, so keep port 8899 private (never tunnel it). The
Claude engine uses the Claude Code CLI login on the same machine.

## Create the team

```bash
pnpm omb:setup   # first run creates NONNA_TOOLS_TOKEN in .env: restart the gateway, run again
```

This registers the gateway's `/mcp/tools` as the `nonna` MCP server, creates the **Nonna** bot
(Claude Sonnet 5.5, `computer: off`: no shell, files or screen) from
[`prompts/nonna.md`](prompts/nonna.md), and one channel per elder with a family group. Re-run it
after editing the prompt.

## How a message flows

1. A family member writes in the group (or the elder texts the elder line).
2. The gateway runs the safety rules, then posts the message to the elder's channel, labelled
   with who wrote it.
3. Claude asks before every MCP tool call. The gateway approves cards **only for `nonna`
   tools**; anything else waits for a person in the OMB UI.
4. Each text reply the bot writes is sent to the family group as an iMessage.

## When the Claude login runs out of usage

Nonna runs on the Claude Code login (`claude` engine). When that account hits its 5-hour or
weekly limit, OpenMausBot records the error in the channel; the gateway then switches the
channel's bots to the API-key engine (`claudeApi`, same model), re-posts the message once, and
tries the login again an hour later.

Add the key once, in OpenMausBot itself (never in this repo): open http://127.0.0.1:8899 →
**Settings → API keys → Anthropic**. OpenMausBot keeps it in its own data folder, owner-only.
