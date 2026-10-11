# @nonna/tools-mcp

The remote MCP server that OpenMausBot bots call (added in OMB under *Plugins → MCP servers*).
It is the only way bots act in the world: every tool goes through the gateway, which owns the
database, Dial and Darwin credentials, and the safety rules.

Right now this package holds the **tool contract** (names, descriptions, input schemas), so the
gateway and the OMB team package agree on it. The server itself is Phase 2 in
[`docs/build-plan.md`](../../docs/build-plan.md#8-task-breakdown).
