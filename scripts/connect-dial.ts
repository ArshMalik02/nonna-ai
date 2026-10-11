/**
 * Points Dial at this gateway: registers the webhook and the live-call Context MCP for a public
 * base URL (e.g. a cloudflared tunnel), then writes DIAL_WEBHOOK_SECRET and CONTEXT_MCP_TOKEN
 * into .env. Safe to re-run when the URL changes: it replaces Nonna's previous registrations.
 *
 * Dial probes the MCP when it is registered, so the gateway must already be running behind the
 * URL with CONTEXT_MCP_TOKEN loaded. On first run the token is created and the script stops;
 * start the gateway, then run it again.
 *
 * Usage (from repo root): pnpm dial:connect https://<public-host>
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { setEnvVar } from "./env-file.js";

const ENV_PATH = resolve(import.meta.dirname, "../.env");
const MCP_NAME = "nonna-context";
const WEBHOOK_PATH = "/webhooks/dial";

const baseUrl = (process.argv[2] ?? process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
if (!baseUrl.startsWith("https://")) {
  throw new Error("Pass the public https base URL: pnpm dial:connect https://<host>");
}
const apiUrl = process.env.DIAL_API_URL ?? "https://api.getdial.ai";
const apiKey = process.env.DIAL_API_KEY;
if (!apiKey) throw new Error("DIAL_API_KEY is not set in .env");

async function dial<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Dial ${method} ${path}: ${res.status} ${await res.text()}`);
  return (res.status === 204 ? {} : await res.json()) as T;
}

// 1. Webhook: keep it if it already points here; otherwise replace earlier Nonna webhooks
// (old tunnel URLs) with a new one. Either way, sync its signing secret into .env.
const targetUrl = `${baseUrl}${WEBHOOK_PATH}`;
const { webhooks } = await dial<{ webhooks: { id: string; targetUrl: string }[] }>(
  "GET",
  "/api/v1/webhooks",
);
let webhook = webhooks.find((w) => w.targetUrl === targetUrl);
for (const w of webhooks) {
  if (w !== webhook && new URL(w.targetUrl).pathname === WEBHOOK_PATH) {
    await dial("DELETE", `/api/v1/webhooks/${w.id}`);
  }
}
webhook ??= (
  await dial<{ webhook: { id: string; targetUrl: string } }>("POST", "/api/v1/webhooks", {
    targetUrl,
    eventTypes: ["message.received", "call.ended", "call.transcribed"],
  })
).webhook;
const { secret } = await dial<{ secret: string }>("GET", `/api/v1/webhooks/${webhook.id}/secret`);
setEnvVar(ENV_PATH, "DIAL_WEBHOOK_SECRET", secret);
setEnvVar(ENV_PATH, "PUBLIC_BASE_URL", baseUrl);

// 2. Context MCP: a shared token Dial sends on every request. Created once, then reused.
const token = process.env.CONTEXT_MCP_TOKEN;
if (!token) {
  setEnvVar(ENV_PATH, "CONTEXT_MCP_TOKEN", randomBytes(24).toString("base64url"));
  process.stdout.write(
    "Webhook registered. Created CONTEXT_MCP_TOKEN in .env: (re)start the gateway, then run this again to connect the Context MCP.\n",
  );
  process.exit(0);
}
const { contextMcps = [] } = await dial<{ contextMcps?: { id: string; name: string }[] }>(
  "GET",
  "/api/v1/context-mcps",
);
for (const m of contextMcps.filter((m) => m.name === MCP_NAME)) {
  await dial("DELETE", `/api/v1/context-mcps/${m.id}`);
}
await dial("POST", "/api/v1/context-mcps", {
  name: MCP_NAME,
  url: `${baseUrl}/mcp/context`,
  headers: { "x-nonna-mcp-token": token },
  timeoutMs: 10_000,
});

process.stdout.write(
  `Connected Dial to ${baseUrl}\n  webhook ${webhook.id}\n  context MCP ${MCP_NAME}\nRestart the gateway so it picks up the new secrets.\n`,
);
