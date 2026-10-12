# Darwin ride search: findings for Darwin staff

Tested 2026-10-11 against `POST https://api.darwin.so/api/v3/search` (anonymous and with a Search key; both work, and both `x-api-key` and `Authorization: Bearer` are accepted). Search only: no provider was contacted through Darwin. Reproduce with `python ride_search.py`.

## What Search returns for rides

| Query | status | Agents |
|---|---|---|
| `book_ride` | completed | 2 (`book_ride` for Rovv, `book_ride` for Taxis Fabbrimone) |
| `request_ride` | completed | 5 (Seat Sherpa, GraceRoad, `book_ride`, ...) |
| `ride-hailing` | completed | 2 (`book_ride`, `search_places`) |
| `book a taxi` | needs_input | 2; asks which taxi service and which locations |
| Request a ride from home to a medical clinic | needs_input | 2; asks "Rovv or Taxis Fabbrimone?" |
| Ride to a doctor appointment on Thursday | no_match | 0 |
| Schedule a wheelchair-accessible ride for an elderly person | no_match | 0 |
| Non-emergency medical transportation for seniors | no_match | 0 |

Results vary between calls: the same query has flipped between `no_match` and `needs_input` on different runs. Tool-name wording (`book_ride`) finds more agents than plain-language wording.

## Gaps

1. **No ride agent is usable through Darwin.** 13 distinct ride-related agents surfaced; all are `readiness: unavailable`, `providerCheck: not_attempted`, `canStartThread: false`, with no `connectionMethods`. For `book_ride` (Rovv) and GraceRoad the capability record shows `EXECUTION_METADATA_PENDING` and a blocked route (`SOURCE_RECEIPT_MISSING`, recovery `REFRESH_EVIDENCE`).
2. **Coverage is not US.** Rovv (Africa), Taxis Fabbrimone (Belgium), RIED.TAXI (Austria), GraceRoad (West African freight), GeoArm (Tbilisi to Yerevan), Seat Sherpa (CA/NV long-distance carpool). No US ride-hailing agent was found; `Uber`, `Lyft`, `ride booking API` return `no_match`.
3. **Sourced from the official MCP registry.** These agents are tagged `mcp-official-registry`, and the registry holds the real endpoints. We used those to connect directly (see USE_DARWIN.md).

## What works outside Darwin's route (direct MCP, read-only)

| Provider | Endpoint (from MCP registry) | Result |
|---|---|---|
| RIED.TAXI | `https://ried.taxi/api/mcp` | quote EUR 160 (Ried im Innkreis to Salzburg Airport), availability check |
| Taxis Fabbrimone | `https://taxisfabbrimone.com/mcp` | route price EUR 55.50 |
| GeoArm Taxi | `https://geoarmtaxi.com/mcp` | prices and schedule |
| Rovv | `https://rovvafrica.com/api/v1/mcp` | lists 9 tools; every call returns 401 (needs OAuth rider login) |

No booking tool was called on any provider.

## Questions for Darwin

1. Why are the ride routes blocked (`SOURCE_RECEIPT_MISSING`, `EXECUTION_METADATA_PENDING`), and can they be refreshed? Which ride agent can be made `ready` first?
2. Is there any US ride agent (ride-hailing, taxi or non-emergency medical transport) in the index?
3. The Act quickstart says Act is open to authenticated users with no pilot enrollment; the Act reference says new starts need an allowlisted credential (`ACT_PREVIEW_ACCESS_REQUIRED`). Which is current for our key?
4. Why does the same query give different statuses between runs?
5. Is there a sandbox ride agent we can use with Act without real-world effects?

Raw responses: `results/rides/`. Provider tool lists and read-only call results: `results/providers/`.
