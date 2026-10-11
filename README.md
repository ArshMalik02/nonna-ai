# Nonna AI

Nonna is an AI care coordinator for older adults and their families. An elder calls or texts
one number; Nonna books rides and appointments, handles paperwork, keeps the family in the
loop over iMessage, and escalates to real people when something is wrong.

- **[Dial](https://docs.getdial.ai)** is the communication layer: phone number, AI voice, iMessage groups, outbound calls.
- **[Darwin](https://darwin.so/docs)** is the discovery layer: finds outside agents (rides, bookings, payments) and acts through them. While Darwin is unavailable, `DARWIN_MODE=proxy` uses a local catalog of 60 fictional agents across Nonna's use cases ([`proxy-catalog.ts`](apps/gateway/src/darwin/proxy-catalog.ts)); acting through one returns a clearly simulated confirmation. How execution stays safe: [`docs/darwin-execution.md`](docs/darwin-execution.md).
- **[OpenMausBot](https://github.com/milind-soni/OpenMausBot)** runs the agent team, unmodified.
- **This repo** is the glue: the gateway, the safety rules, the task engine and the team definition.

### One iMessage number for everyone

Nonna uses one iMessage-capable Dial number (`DIAL_ELDER_NUMBER` = `DIAL_FAMILY_NUMBER`):

- **The elder** iMessages and calls it 1:1 (they need an iPhone). iMessage needs no SMS 10DLC
  registration.
- **The family** has it in their iMessage group (a family member creates the group and adds it)
  and can iMessage it directly.
- **Outbound** task and alert calls are placed from it.

The gateway tells the elder and family apart by **sender** (the elder's own phone vs. a family
member's phone or Apple ID), so the two env vars can also point at separate numbers, e.g. an SMS
line for an elder without an iPhone (that line then needs 10DLC registration).

Read [`docs/architecture.md`](docs/architecture.md) and [`docs/build-plan.md`](docs/build-plan.md) first.

```
Elder (call / iMessage) ─► Dial ─► webhooks ─► nonna-gateway ─► OpenMausBot (Nonna + specialists)
                            ▲        Context MCP (live calls)│              │
                            └──── family iMessage group ◄────┘      Darwin Search / Act
```

## Repository layout

| Path | What lives there |
| --- | --- |
| `apps/gateway` | Hono + TypeScript server: Dial webhooks (HMAC verify, dedupe), live-call Context MCP, safety rules, task state machine, DB |
| `packages/shared` | Zod schemas and types shared across the repo (Elder, Task, Dial events) |
| `packages/nonna-tools-mcp` | Tool contract for the MCP server that OMB bots call |
| `omb/` | OpenMausBot team, prompts and setup guide (data, not a fork) |
| `dial/` | Front-door voice instruction and outbound call templates |
| `apps/gateway/scripts` | Ops scripts: seed, add family, connect Dial, set up OpenMausBot |
| `docs/` | Architecture and build plan |

## Getting started

Requires **Node 22+** (see `.nvmrc`) and **pnpm 10** (`npm i -g pnpm@10`, or `corepack enable`).

```bash
pnpm install
cp .env.example .env          # fill in Dial / Darwin keys
pnpm db:migrate               # create the local SQLite database
pnpm seed                     # fake demo elder + family
pnpm dev                      # gateway on http://localhost:8787
```

Then connect Dial ([`dial/README.md`](dial/README.md)) and OpenMausBot ([`omb/README.md`](omb/README.md)).

### Keep it running (macOS)

```bash
bash ops/macos/install.sh     # OpenMausBot + gateway + tunnel as login services
launchctl list | grep ai.nonna
bash ops/macos/uninstall.sh   # stop and remove
```

They start at login, restart if they crash, and keep the Mac from idle-sleeping while on power.
Each tunnel start gets a new public address; the tunnel service re-points Dial at it and restarts
the gateway by itself. Logs: `apps/gateway/data/logs/`. A closed lid or a shutdown still stops
Nonna: for always-on, run the same services on a server.

### One phone line

Nonna runs on one Dial number, which carries one call at a time. All outbound calls go through a
queue ([`calls/line.ts`](apps/gateway/src/calls/line.ts)): emergency calls first, business calls
capped at 5 minutes, and a busy line (e.g. the elder calling in) is retried. The emergency ladder
alerts the family group and the elder by iMessage at once, then calls family one at a time,
nearest first, until someone answers.

To connect Dial to a gateway on your machine (tunnel, webhook, live-call MCP, family group),
follow [`dial/README.md`](dial/README.md#connecting-dial-to-a-local-gateway).

## Scripts

| Command | Does |
| --- | --- |
| `pnpm dev` | Run the gateway with reload |
| `pnpm check` | Lint + typecheck + tests (what CI runs, plus build) |
| `pnpm format` | Auto-fix formatting and lint (Biome) |
| `pnpm build` | Bundle the gateway to `apps/gateway/dist` |
| `pnpm db:generate` | Generate a migration after changing `apps/gateway/src/db/schema.ts` |
| `docker compose up --build` | Run the gateway in a container |

## Non-negotiables

1. **Emergencies are deterministic.** Safety rules run in the gateway before anything else and never wait on an LLM, an agent turn or the router. Nonna never dials 911 itself; it tells the elder to and alerts family.
2. **Every live-call tool is authorized by caller number** (`X-Dial-User-Number`). Unknown callers get nothing.
3. **No real health data in the repo,** in tests, fixtures or logs. Log ids and event types, not message bodies.
4. **Plain text never approves a payment.** Payments go through a hosted checkout link to a family member who can pay.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).
