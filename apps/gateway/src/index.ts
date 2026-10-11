import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createCallLine } from "./calls/line.js";
import { handleCallFinished } from "./calls/results.js";
import { DarwinClient } from "./darwin/client.js";
import { createDarwinExecutor } from "./darwin/executor.js";
import { liveDarwin, proxyDarwin } from "./darwin/service.js";
import { startDarwinWatcher } from "./darwin/watcher.js";
import { createDb } from "./db/client.js";
import { DrizzleStore } from "./db/drizzle-store.js";
import { DialClient } from "./dial/client.js";
import { loadEnv } from "./env.js";
import { discoverGroups } from "./family/onboarding.js";
import { createLogger } from "./logger.js";
import { createTeamBridge } from "./omb/bridge.js";
import { OmbClient } from "./omb/client.js";
import { createModelFailover } from "./omb/failover.js";
import { escalate } from "./safety/escalate.js";

const env = loadEnv();
const log = createLogger(env.LOG_LEVEL);
const store = new DrizzleStore(createDb(env.DATABASE_URL));
const dial = new DialClient({ baseUrl: env.DIAL_API_URL, apiKey: env.DIAL_API_KEY });
const dialLines = { elder: env.DIAL_ELDER_NUMBER, family: env.DIAL_FAMILY_NUMBER };
// One Dial number carries one call at a time: every outbound call goes through this queue.
const line = createCallLine({ dial, log });
const darwinClient = new DarwinClient({
  baseUrl: env.DARWIN_API_URL,
  searchKey: env.DARWIN_SEARCH_KEY,
  actKey: env.DARWIN_ACT_KEY,
  actEnabled: env.DARWIN_ACT_ENABLED,
});
const darwin = createDarwinExecutor({
  darwin: env.DARWIN_MODE === "live" ? liveDarwin(darwinClient) : proxyDarwin(),
  store,
  log,
});
const omb = new OmbClient({ baseUrl: env.OMB_API_URL, token: env.OMB_API_TOKEN });
const failover = createModelFailover({
  omb,
  log,
  primary: { instanceId: env.OMB_PRIMARY_INSTANCE, model: env.NONNA_MODEL },
  fallback: { instanceId: env.OMB_FALLBACK_INSTANCE, model: env.NONNA_MODEL },
});
const team = createTeamBridge({
  store,
  dial,
  omb,
  lines: dialLines,
  log,
  onUsageLimit: (channelId) => failover.onUsageLimit(channelId),
});

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
      await escalate({ dial, line, log, lines: dialLines }, elder, circle, { groupId, trigger });
    }),
  onUnknownGroup: runDiscovery,
  onInbound: (msg) => background("team handoff", () => team.handle(msg)),
  onCallFinished: (callId) =>
    background("call result", () =>
      handleCallFinished({ dial, store, team, lines: dialLines, log }, callId),
    ),
  tools: { dial, line, darwin, lines: dialLines, token: env.NONNA_TOOLS_TOKEN },
  onCallEnded: (ended) => background("call line", () => line.onCallEnded(ended)),
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) =>
  log.info("gateway listening", { port: info.port }),
);

runDiscovery();
const darwinWatcher = startDarwinWatcher({
  executor: darwin,
  store,
  postToTeam: (elderId, text) => team.postToTeam(elderId, text),
  log,
});
const poll = setInterval(runDiscovery, env.GROUP_POLL_SECONDS * 1000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log.info("shutting down", { signal });
    clearInterval(poll);
    darwinWatcher.stop();
    server.close(() => process.exit(0));
  });
}
