import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { contextMcpRoutes } from "./dial/context-mcp.js";
import { dialWebhookRoutes } from "./dial/webhook.js";
import type { Logger } from "./logger.js";
import type { OmbRelay } from "./omb/relay.js";
import type { Store } from "./store.js";
import { type NonnaToolsDeps, nonnaToolsRoutes } from "./tools/nonna-tools.js";

export interface AppDeps {
  store: Store;
  log: Logger;
  dialWebhookSecret: string;
  escalate: (args: { elderId: string; groupId?: string | undefined; trigger: string }) => void;
  /** Hands messages and new tasks to the family's OMB channel. */
  relay?: OmbRelay | undefined;
  /** The MCP tools OMB bots call. Omit to leave /mcp/tools unmounted. */
  tools?: Omit<NonnaToolsDeps, "store" | "log" | "onEscalate"> | undefined;
}

/** Builds the HTTP app from injected dependencies so tests can run it without a network. */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.use(secureHeaders());

  app.get("/health", (c) => c.json({ ok: true }));
  app.route(
    "/webhooks/dial",
    dialWebhookRoutes({
      store: deps.store,
      log: deps.log,
      secret: deps.dialWebhookSecret,
      onEmergency: deps.escalate,
      relay: deps.relay,
    }),
  );
  app.route(
    "/mcp/context",
    contextMcpRoutes({ store: deps.store, onEscalate: deps.escalate, relay: deps.relay }),
  );
  if (deps.tools) {
    app.route(
      "/mcp/tools",
      nonnaToolsRoutes({
        ...deps.tools,
        store: deps.store,
        log: deps.log,
        onEscalate: deps.escalate,
      }),
    );
  }

  app.onError((err, c) => {
    deps.log.error("unhandled error", { error: err.message, path: c.req.path });
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
