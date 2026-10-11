import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { DarwinClient } from "./darwin/client.js";
import { createDb } from "./db/client.js";
import { DrizzleStore } from "./db/drizzle-store.js";
import { DialClient } from "./dial/client.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { OmbClient } from "./omb/client.js";
import { createOmbRelay } from "./omb/relay.js";
import { escalate } from "./safety/escalate.js";

const env = loadEnv();
const log = createLogger(env.LOG_LEVEL);
const store = new DrizzleStore(createDb(env.DATABASE_URL));
const dial = new DialClient({ baseUrl: env.DIAL_API_URL, apiKey: env.DIAL_API_KEY });
const darwin = new DarwinClient({
  baseUrl: env.DARWIN_API_URL,
  searchKey: env.DARWIN_SEARCH_KEY,
  actKey: env.DARWIN_ACT_KEY,
  actEnabled: env.DARWIN_ACT_ENABLED,
});
const omb = new OmbClient({ baseUrl: env.OMB_API_URL, token: env.OMB_API_TOKEN });
const relay = createOmbRelay({ store, omb, log });

if (!env.NONNA_TOOLS_TOKEN) {
  log.warn("NONNA_TOOLS_TOKEN is not set: /mcp/tools answers 503 and the OMB bots cannot act");
}

const app = createApp({
  store,
  log,
  dialWebhookSecret: env.DIAL_WEBHOOK_SECRET,
  relay,
  tools: { dial, darwin, token: env.NONNA_TOOLS_TOKEN, workerNumber: env.DIAL_WORKER_NUMBER },
  escalate: ({ elderId, groupId, trigger }) => {
    void (async () => {
      const elder = await store.getElder(elderId);
      if (!elder) return;
      const circle = await store.listCircle(elderId);
      await escalate({ dial, log, workerNumber: env.DIAL_WORKER_NUMBER }, elder, circle, {
        groupId,
        trigger,
      });
    })().catch((err: unknown) => log.error("escalation failed", { error: String(err) }));
  },
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) =>
  log.info("gateway listening", { port: info.port }),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log.info("shutting down", { signal });
    server.close(() => process.exit(0));
  });
}
