import { createHash, timingSafeEqual } from "node:crypto";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { nonnaTools } from "@nonna/tools-mcp";
import { Hono } from "hono";
import type { CallLine } from "../calls/line.js";
import { type DarwinExecutor, describeRun, ExecutorRefusal } from "../darwin/executor.js";
import type { DialClient } from "../dial/client.js";
import type { DialLines } from "../dial/lines.js";
import type { Logger } from "../logger.js";
import type { Store } from "../store.js";
import { canTransition } from "../tasks/state-machine.js";

export interface ToolsMcpDeps {
  store: Store;
  dial: Pick<DialClient, "sendMessage" | "getCall">;
  line: Pick<CallLine, "enqueue">;
  darwin: DarwinExecutor;
  lines: DialLines;
  log: Logger;
  /** Shared secret OpenMausBot sends as x-nonna-tools-token. */
  token: string | undefined;
}

/** Business calls are capped so the single line frees up for the elder. */
export const BUSINESS_CALL_MAX_SECONDS = 300;

export const TOOLS_TOKEN_HEADER = "x-nonna-tools-token";
const MAX_TOOL_OUTPUT = 6_000;

const ok = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: (typeof value === "string" ? value : JSON.stringify(value)).slice(0, MAX_TOOL_OUTPUT),
    },
  ],
});
const fail = (message: string) => ({ ...ok(message), isError: true });

const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** System prompt for an outbound business call (see dial/outbound/). */
export function businessCallInstruction(elderName: string, goal: string) {
  return [
    `You are an AI assistant calling on behalf of ${elderName}. Say so at the start of the call.`,
    `Goal: ${goal}`,
    "If there is a phone menu, choose the option that reaches someone who can help with this goal.",
    "Confirm every detail (date, time, address, price, name) and repeat it back before ending.",
    "Do not share health information beyond what is needed. Never give card numbers or passwords.",
    "Be polite and brief. If they cannot help, ask who can and end the call.",
  ].join("\n");
}

function buildServer(deps: ToolsMcpDeps) {
  const { store } = deps;
  const server = new McpServer({ name: "nonna-tools", version: "0.0.0" });
  const t = nonnaTools;

  server.registerTool(
    "get_elder_profile",
    { description: t.get_elder_profile.description, inputSchema: t.get_elder_profile.input },
    async ({ elderId }) => {
      const elder = await store.getElder(elderId);
      if (!elder) return fail(`No elder ${elderId}`);
      const { phone: _phone, ...profile } = elder;
      return ok(profile);
    },
  );

  server.registerTool(
    "list_family",
    { description: t.list_family.description, inputSchema: t.list_family.input },
    async ({ elderId }) =>
      ok(
        (await store.listCircle(elderId)).map((m) => ({
          name: m.name,
          relation: m.relation,
          canApprove: m.canApprove,
          canPay: m.canPay,
          isNearby: m.isNearby,
        })),
      ),
  );

  server.registerTool(
    "list_open_tasks",
    { description: t.list_open_tasks.description, inputSchema: t.list_open_tasks.input },
    async ({ elderId }) => ok(await store.listOpenTasks(elderId)),
  );

  server.registerTool(
    "create_task",
    { description: t.create_task.description, inputSchema: t.create_task.input },
    async ({ elderId, kind, summary }) => {
      if (!(await store.getElder(elderId))) return fail(`No elder ${elderId}`);
      const task = await store.createTask({ elderId, kind, summary });
      await store.audit({ actor: "omb", action: "create_task", taskId: task.id });
      return ok(task);
    },
  );

  server.registerTool(
    "update_task",
    { description: t.update_task.description, inputSchema: t.update_task.input },
    async ({ taskId, status, note }) => {
      const task = await store.getTask(taskId);
      if (!task) return fail(`No task ${taskId}`);
      if (!canTransition(task.status, status)) {
        return fail(`A task cannot go from ${task.status} to ${status}.`);
      }
      await store.setTaskStatus(taskId, status);
      await store.audit({ actor: "omb", action: `task_${status}`, taskId, detail: note });
      return ok({ taskId, status });
    },
  );

  server.registerTool(
    "message_elder",
    { description: t.message_elder.description, inputSchema: t.message_elder.input },
    async ({ elderId, body }) => {
      const elder = await store.getElder(elderId);
      if (!elder) return fail(`No elder ${elderId}`);
      await deps.dial.sendMessage({ to: elder.phone, fromNumber: deps.lines.elder, body });
      await store.audit({ actor: "omb", action: "message_elder", detail: elderId });
      return ok("Sent.");
    },
  );

  const executorError = (err: unknown) =>
    err instanceof ExecutorRefusal ? fail(err.message) : fail(`Darwin error: ${String(err)}`);

  server.registerTool(
    "darwin_search",
    { description: t.darwin_search.description, inputSchema: t.darwin_search.input },
    async ({ taskId, query, context }) => {
      try {
        return ok(await deps.darwin.search({ query, context, taskId }));
      } catch (err) {
        return fail(`Darwin search failed: ${String(err)}. Fall back to dial_call_business.`);
      }
    },
  );

  server.registerTool(
    "darwin_act",
    { description: t.darwin_act.description, inputSchema: t.darwin_act.input },
    async ({ taskId, searchId, agentId, capabilityId, brief }) => {
      try {
        const run = await deps.darwin.start({ taskId, searchId, agentId, capabilityId, brief });
        return ok(describeRun(run));
      } catch (err) {
        return executorError(err);
      }
    },
  );

  server.registerTool(
    "darwin_check",
    { description: t.darwin_check.description, inputSchema: t.darwin_check.input },
    async ({ taskId }) => {
      try {
        const checked = await deps.darwin.check(taskId);
        return checked
          ? ok(describeRun(checked.run, checked.newMessages))
          : fail("No Darwin run on this task.");
      } catch (err) {
        return executorError(err);
      }
    },
  );

  server.registerTool(
    "darwin_reply",
    { description: t.darwin_reply.description, inputSchema: t.darwin_reply.input },
    async ({ taskId, text, operationId }) => {
      try {
        return ok(describeRun(await deps.darwin.reply({ taskId, text, operationId })));
      } catch (err) {
        return executorError(err);
      }
    },
  );

  server.registerTool(
    "dial_call_business",
    { description: t.dial_call_business.description, inputSchema: t.dial_call_business.input },
    async ({ elderId, taskId, to, goal }) => {
      const elder = await store.getElder(elderId);
      if (!elder) return fail(`No elder ${elderId}`);
      if (!(await store.getTask(taskId))) return fail(`No task ${taskId}`);
      const idempotencyKey = createHash("sha256").update(`${taskId}|${to}|${goal}`).digest("hex");
      // Nonna has one number and one line: calls are queued, emergencies first, and kept short
      // so the elder can get through.
      const { position } = deps.line.enqueue({
        priority: "task",
        input: {
          to,
          fromNumber: deps.lines.family,
          outboundInstruction: businessCallInstruction(elder.name, goal),
          maxCallDurationSeconds: BUSINESS_CALL_MAX_SECONDS,
          idempotencyKey,
        },
        onPlaced: (callId) =>
          store.addTaskStep({
            taskId,
            executor: "dial_call",
            status: "placed",
            dialCallId: callId,
          }),
        onFailed: (err) =>
          store.addTaskStep({
            taskId,
            executor: "dial_call",
            status: "failed",
            result: String(err),
          }),
      });
      await store.audit({ actor: "omb", action: "dial_call_business", taskId });
      return ok({
        status: position === 0 ? "calling" : "queued",
        position,
        note: "The call runs when Nonna's line is free. Its transcript is posted to this channel when it ends; don't place the same call again.",
      });
    },
  );

  server.registerTool(
    "get_call_result",
    { description: t.get_call_result.description, inputSchema: t.get_call_result.input },
    async ({ callId }) => ok(await deps.dial.getCall(callId)),
  );

  return server;
}

/** Remote MCP server OpenMausBot bots call (registered as "nonna" in OMB). */
export function toolsMcpRoutes(deps: ToolsMcpDeps) {
  const app = new Hono();
  app.all("/", async (c) => {
    const token = c.req.header(TOOLS_TOKEN_HEADER);
    if (!deps.token || !token || !safeEqual(token, deps.token)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const server = buildServer(deps);
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(c);
  });
  return app;
}
