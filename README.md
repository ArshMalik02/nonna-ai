# Nonna AI

Nonna is an AI care coordinator for older adults and their families. An elder calls or texts
one number; Nonna books rides and appointments, handles paperwork, keeps the family in the
loop over iMessage, and escalates to real people when something is wrong.

- **[Dial](https://docs.getdial.ai)** is the communication layer: phone number, AI voice, iMessage groups, outbound calls.
- **[Darwin](https://darwin.so/docs)** is the discovery layer: finds outside agents (rides, bookings, payments) and acts through them.
- **[OpenMausBot](https://github.com/milind-soni/OpenMausBot)** runs the agent team, unmodified.
- **This repo** is the glue: the gateway, the safety rules, the task engine and the team definition.

### Two numbers, two audiences

| Line | Dial capabilities | Who uses it |
| --- | --- | --- |
| **Elder line** | SMS + voice | The elder: the one number they text and call. Nonna never places task calls from it, so it is always free for them. |
| **Family line** | iMessage + voice | The family iMessage group (a family member creates the group and adds this number), direct iMessages from family, and Nonna's outbound task calls (clinic, cab company, family alerts). |

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
| `omb/` | OpenMausBot team package and bot prompts (data, not a fork) |
| `dial/` | Front-door voice instruction and outbound call templates |
| `scripts/` | Seed and provisioning scripts |
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
