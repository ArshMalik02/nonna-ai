# @nonna/tools-mcp

The remote MCP server that OpenMausBot bots call (added in OMB under *Plugins → MCP servers*).
It is the only way bots act in the world: every tool goes through the gateway, which owns the
database, Dial and Darwin credentials, and the safety rules.

This package holds the **tool contract** (names, descriptions, input schemas), so the gateway
and the OMB team package agree on it. The server lives in the gateway
(`apps/gateway/src/tools/nonna-tools.ts`) and is served at `/mcp/tools`, behind the bearer token
`NONNA_TOOLS_TOKEN`. See [`omb/nonna-team.md`](../../omb/nonna-team.md) for how to add it in OMB.
