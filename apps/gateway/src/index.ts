import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";
import { DrizzleStore } from "./db/drizzle-store.js";
import { DialClient } from "./dial/client.js";
import { loadEnv } from "./env.js";
import { discoverGroups, handleFamilyGroupMessage } from "./family/onboarding.js";
import { createLogger } from "./logger.js";
import { escalate } from "./safety/escalate.js";

const env = loadEnv();
const log = createLogger(env.LOG_LEVEL);
const store = new DrizzleStore(createDb(env.DATABASE_URL));
const dial = new DialClient({ baseUrl: env.DIAL_API_URL, apiKey: env.DIAL_API_KEY });
const dialLines = { elder: env.DIAL_ELDER_NUMBER, family: env.DIAL_FAMILY_NUMBER };

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
  onFamilyGroupMessage: (msg) =>
    background("family message", () => handleFamilyGroupMessage({ dial, store, log }, msg)),
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
