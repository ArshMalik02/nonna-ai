import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { type Elder, TaskKind } from "@nonna/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Store } from "../store.js";

export interface ContextMcpDeps {
  store: Store;
  /** Static secret Dial sends on every request (set when connecting the MCP). */
  token: string | undefined;
  onEscalate: (args: { elderId: string; trigger: string }) => void;
}

export const CONTEXT_MCP_TOKEN_HEADER = "x-nonna-mcp-token";

const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/**
 * Context MCP for Dial live calls. Dial uses ONE connection identity for all callers, so every
 * request is authorized by the caller's number (X-Dial-User-Number): a caller only ever sees
 * their own profile, and unknown numbers are rejected. Tools must answer in well under a second —
 * never wait on an agent turn here.
 */
function buildServer(elder: Elder | undefined, deps: ContextMcpDeps) {
  const server = new McpServer({ name: "nonna-context", version: "0.0.0" });
  // Any caller that is not a registered elder (family, businesses on outbound calls) gets an
  // empty tool list (not an error, which Dial treats as a broken server).
  if (!elder) {
    server.server.registerCapabilities({ tools: {} });
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
    return server;
  }

  server.registerTool(
    "get_elder_profile",
    { description: "Get the caller's profile: name, language, preferences." },
    async () =>
      text(
        JSON.stringify({
          name: elder.name,
          language: elder.language,
          preferences: elder.preferences ?? null,
        }),
      ),
  );

  server.registerTool(
    "create_task",
    {
      description:
        "Record something the caller needs help with (ride, appointment, payment, report). Returns immediately; Nonna follows up by text with the family.",
      inputSchema: { kind: TaskKind, summary: z.string().min(3).max(500) },
    },
    async ({ kind, summary }) => {
      const task = await deps.store.createTask({ elderId: elder.id, kind, summary });
      await deps.store.audit({ actor: "voice", action: "create_task", taskId: task.id });
      return text(
        `Task ${task.id} created. Tell the caller you will set it up and text their family.`,
      );
    },
  );

  server.registerTool(
    "escalate_now",
    {
      description:
        "Use IMMEDIATELY if the caller may be hurt, fell, has chest pain, trouble breathing, or asks for urgent help. Alerts family right away.",
      inputSchema: { reason: z.string().max(300) },
    },
    async ({ reason }) => {
      deps.onEscalate({ elderId: elder.id, trigger: `voice: ${reason}` });
      return text(
        "Family is being alerted now. Tell the caller to call 911 if it is an emergency, and stay calm and on the line.",
      );
    },
  );

  return server;
}

export function contextMcpRoutes(deps: ContextMcpDeps) {
  const app = new Hono();

  app.all("/", async (c) => {
    // The caller-number header is only trustworthy if the request really comes from Dial.
    const token = c.req.header(CONTEXT_MCP_TOKEN_HEADER);
    if (!deps.token || !token || !safeEqual(token, deps.token)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const caller = c.req.header("x-dial-user-number");
    const elder = caller ? await deps.store.findElderByPhone(caller) : undefined;

    // Stateless: a fresh server per request, scoped to this caller only.
    const server = buildServer(elder, deps);
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(c);
  });

  return app;
}
