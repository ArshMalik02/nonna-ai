import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { DarwinClient } from "./darwin/client.js";
import { createDb } from "./db/client.js";
import { DrizzleStore } from "./db/drizzle-store.js";
import { DialClient } from "./dial/client.js";
import { loadEnv } from "./env.js";
import { discoverGroups } from "./family/onboarding.js";
import { createLogger } from "./logger.js";
import { createTeamBridge } from "./omb/bridge.js";
import { OmbClient } from "./omb/client.js";
import { escalate } from "./safety/escalate.js";

const env = loadEnv();
const log = createLogger(env.LOG_LEVEL);
const store = new DrizzleStore(createDb(env.DATABASE_URL));
const dial = new DialClient({ baseUrl: env.DIAL_API_URL, apiKey: env.DIAL_API_KEY });
const dialLines = { elder: env.DIAL_ELDER_NUMBER, family: env.DIAL_FAMILY_NUMBER };
const darwin = new DarwinClient({
  baseUrl: env.DARWIN_API_URL,
  searchKey: env.DARWIN_SEARCH_KEY,
  actKey: env.DARWIN_ACT_KEY,
  actEnabled: env.DARWIN_ACT_ENABLED,
});
const omb = new OmbClient({ baseUrl: env.OMB_API_URL, token: env.OMB_API_TOKEN });
const toTeam = createTeamBridge({ store, dial, omb, log });

/** Run background work without blocking the webhook ack; never let it crash the process. */
const background = (name: string, work: () => Promise<unknown>) => {
  work().catch((err: unknown) => log.error(`${name} failed`, { error: String(err) }));
};

let discovering = false;
const runDiscovery = () =>
  background("group discovery", async () => {
    if (discovering) return;
    discovering = true;
    try {
      await discoverGroups({ dial, store, log });
    } finally {
      discovering = false;
    }
  });

const app = createApp({
  store,
  log,
  dialWebhookSecret: env.DIAL_WEBHOOK_SECRET,
  dialLines,
  contextMcpToken: env.CONTEXT_MCP_TOKEN,
  escalate: ({ elderId, groupId, trigger }) =>
    background("escalation", async () => {
      const elder = await store.getElder(elderId);
      if (!elder) return;
      const circle = await store.listCircle(elderId);
      await escalate({ dial, log, lines: dialLines }, elder, circle, { groupId, trigger });
    }),
  onUnknownGroup: runDiscovery,
  onInbound: (msg) => background("team handoff", () => toTeam(msg)),
  tools: { dial, darwin, lines: dialLines, token: env.NONNA_TOOLS_TOKEN },
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) =>
  log.info("gateway listening", { port: info.port }),
);

runDiscovery();
const poll = setInterval(runDiscovery, env.GROUP_POLL_SECONDS * 1000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log.info("shutting down", { signal });
    clearInterval(poll);
    server.close(() => process.exit(0));
  });
}
