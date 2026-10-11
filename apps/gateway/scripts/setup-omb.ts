/**
 * Sets up the Nonna team in a running OpenMausBot harness (unmodified, see docs/build-plan.md §4):
 *  1. registers the gateway's /mcp/tools as the "nonna" MCP server (token-protected) and enables it
 *  2. creates (or updates) the "Nonna" chief bot: Claude, no computer access, Nonna tools pre-allowed
 *  3. creates (or updates) one channel per elder that has a family group, and links them
 *
 * Safe to re-run. The gateway must be running with NONNA_TOOLS_TOKEN loaded: on first run the
 * token is created and the script stops; restart the gateway and run it again.
 *
 * Usage (from repo root): pnpm omb:setup
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client.js";
import { elders, familyGroups } from "../src/db/schema.js";
import { NONNA_MCP_SERVER } from "../src/omb/bridge.js";
import { setEnvVar } from "./env-file.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const ENV_PATH = resolve(ROOT, ".env");
const OMB = process.env.OMB_API_URL ?? "http://127.0.0.1:8899";
const GATEWAY = `http://127.0.0.1:${process.env.PORT ?? "8787"}`;
const MCP_NAME = NONNA_MCP_SERVER;
const BOT_NAME = "Nonna";
const MODEL = { instanceId: "claude", model: process.env.NONNA_MODEL ?? "claude-sonnet-5-5" };

const token = process.env.NONNA_TOOLS_TOKEN;
if (!token) {
  setEnvVar(ENV_PATH, "NONNA_TOOLS_TOKEN", randomBytes(24).toString("base64url"));
  process.stdout.write(
    "Created NONNA_TOOLS_TOKEN in .env. Restart the gateway, then run this again.\n",
  );
  process.exit(0);
}

async function omb<T = Record<string, unknown>>(method: string, path: string, body?: unknown) {
  const res = await fetch(`${OMB}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok)
    throw Object.assign(new Error(`OMB ${method} ${path}: ${res.status} ${text}`), {
      status: res.status,
    });
  return (text ? JSON.parse(text) : {}) as T;
}

// 1. Nonna tools MCP server.
const server = {
  type: "http",
  url: `${GATEWAY}/mcp/tools`,
  headers: { "x-nonna-tools-token": token },
};
try {
  await omb("POST", "/api/mcp/servers", { name: MCP_NAME, ...server });
} catch (err) {
  if ((err as { status?: number }).status !== 409) throw err;
  await omb("PUT", `/api/mcp/servers/${MCP_NAME}`, server);
}
await omb("PATCH", `/api/mcp/servers/${MCP_NAME}`, { enabled: true });
const probe = await omb<{ ok: boolean; tools?: { name: string }[]; error?: string }>(
  "POST",
  `/api/mcp/servers/${MCP_NAME}/test`,
);
if (!probe.ok)
  throw new Error(
    `OpenMausBot cannot reach Nonna tools: ${probe.error ?? "unknown"}. Is the gateway running with the token?`,
  );
process.stdout.write(`MCP "${MCP_NAME}": ${probe.tools?.length ?? 0} tools\n`);

// 2. The Nonna chief bot.
const prompt = readFileSync(resolve(ROOT, "omb/prompts/nonna.md"), "utf8");
type Fleet = { bots: { id: string; name: string }[]; groups: { id: string; name: string }[] };
let fleet = await omb<Fleet>("GET", "/api/bots?messages=0");
let bot = fleet.bots.find((b) => b.name === BOT_NAME);
if (!bot) {
  const created = await omb<{ bot: { id: string; name: string } }>("POST", "/api/bots", {
    name: BOT_NAME,
    title: "Care coordinator",
    description: prompt,
    modelSelection: MODEL,
    requireAvailableModel: true,
  });
  bot = created.bot;
}
await omb("PATCH", `/api/bots/${bot.id}`, {
  description: prompt,
  // Nonna acts only through its tools: no shell, files or screen on this machine.
  computer: "off",
  // Approval cards for Nonna's own tools are answered by the gateway (omb/relay.ts).
  alwaysAllow: [],
});
process.stdout.write(`Bot "${BOT_NAME}": ${bot.id}\n`);

// 3. One channel per elder with a family group.
const db = createDb(process.env.DATABASE_URL ?? "file:./data/nonna.db");
fleet = await omb<Fleet>("GET", "/api/bots?messages=0");
for (const elder of await db.select().from(elders)) {
  const groups = await db.select().from(familyGroups).where(eq(familyGroups.elderId, elder.id));
  if (groups.length === 0) continue;

  const bulletin = [
    `This channel is ${elder.name}'s family circle. elderId: ${elder.id}`,
    `Timezone: ${elder.timezone}. Language: ${elder.language}.`,
    "Every message here comes from the family iMessage group or from the elder, relayed by the Nonna gateway.",
    "Everything you write here is sent to the family group as an iMessage: keep it short, warm and plain.",
  ].join("\n");

  const existing = groups.find((g) => g.ombChannelId)?.ombChannelId;
  let channelId = fleet.groups.find((g) => g.id === existing)?.id;
  if (channelId) {
    await omb("PATCH", `/api/groups/${channelId}`, { bulletin });
  } else {
    const created = await omb<{ group: { id: string } }>("POST", "/api/groups", {
      name: `Family · ${elder.name}`,
      memberIds: [bot.id],
      setup: { bulletin, defaultResponder: { kind: "member", botId: bot.id } },
    });
    channelId = created.group.id;
  }
  await db
    .update(familyGroups)
    .set({ ombChannelId: channelId })
    .where(eq(familyGroups.elderId, elder.id));
  process.stdout.write(`Channel for ${elder.name}: ${channelId}\n`);
}
