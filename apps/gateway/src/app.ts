import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { contextMcpRoutes } from "./dial/context-mcp.js";
import type { DialLines } from "./dial/lines.js";
import { dialWebhookRoutes } from "./dial/webhook.js";
import type { Logger } from "./logger.js";
import type { Store } from "./store.js";

export interface AppDeps {
  store: Store;
  log: Logger;
  dialWebhookSecret: string;
  dialLines: DialLines;
  escalate: (args: { elderId: string; groupId?: string | undefined; trigger: string }) => void;
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
      lines: deps.dialLines,
      onEmergency: deps.escalate,
    }),
  );
  app.route("/mcp/context", contextMcpRoutes({ store: deps.store, onEscalate: deps.escalate }));

  app.onError((err, c) => {
    deps.log.error("unhandled error", { error: err.message, path: c.req.path });
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
