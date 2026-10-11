import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { contextMcpRoutes } from "./dial/context-mcp.js";
import type { DialLines } from "./dial/lines.js";
import { dialWebhookRoutes, type InboundMessage } from "./dial/webhook.js";
import type { Logger } from "./logger.js";
import { type ToolsMcpDeps, toolsMcpRoutes } from "./omb/tools-mcp.js";
import type { Store } from "./store.js";

export interface AppDeps {
  store: Store;
  log: Logger;
  dialWebhookSecret: string;
  dialLines: DialLines;
  contextMcpToken: string | undefined;
  escalate: (args: { elderId: string; groupId?: string | undefined; trigger: string }) => void;
  onUnknownGroup?: (groupId: string) => void;
  onInbound?: (msg: InboundMessage) => void;
  onCallFinished?: (callId: string) => void;
  onCallEnded?: (ended: { callId: string; status: string; durationSeconds: number | null }) => void;
  /** Serves /mcp/tools for OpenMausBot when provided. */
  tools?: Omit<ToolsMcpDeps, "store" | "log"> | undefined;
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
      onUnknownGroup: deps.onUnknownGroup ?? (() => {}),
      onInbound: deps.onInbound ?? (() => {}),
      onCallFinished: deps.onCallFinished ?? (() => {}),
      onCallEnded: deps.onCallEnded ?? (() => {}),
    }),
  );
  app.route(
    "/mcp/context",
    contextMcpRoutes({
      store: deps.store,
      token: deps.contextMcpToken,
      onEscalate: deps.escalate,
    }),
  );

  if (deps.tools) {
    app.route("/mcp/tools", toolsMcpRoutes({ ...deps.tools, store: deps.store, log: deps.log }));
  }

  app.onError((err, c) => {
    // Protocol errors (e.g. from the MCP transport) carry their own status; pass them through.
    if (err instanceof HTTPException) {
      deps.log.warn("http error", { status: err.status, error: err.message, path: c.req.path });
      return err.getResponse();
    }
    deps.log.error("unhandled error", { error: err.message, path: c.req.path });
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
