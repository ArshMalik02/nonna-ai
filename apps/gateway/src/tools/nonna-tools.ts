import { createHash, timingSafeEqual } from "node:crypto";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { nonnaTools } from "@nonna/tools-mcp";
import { Hono } from "hono";
import type { DarwinClient } from "../darwin/client.js";
import type { DialClient } from "../dial/client.js";
import type { Logger } from "../logger.js";
import type { Store } from "../store.js";
import { canTransition } from "../tasks/state-machine.js";

/**
 * The remote MCP server the OpenMausBot team calls (OMB: Plugins -> MCP servers, URL
 * `<gateway>/mcp/tools`, header `Authorization: Bearer <NONNA_TOOLS_TOKEN>`). Every way a bot
 * acts in the world goes through here, so the gateway keeps the credentials, the state machine
 * and the audit log. Tool names and input schemas come from `@nonna/tools-mcp` (the contract).
 */
export interface NonnaToolsDeps {
  store: Store;
  log: Logger;
  dial: Pick<DialClient, "sendMessage" | "placeCall">;
  darwin: Pick<DarwinClient, "search">;
  /** Shared secret OMB sends as a bearer token. Unset means the endpoint is off (503). */
  token: string | undefined;
  /** Dial number that places outbound task calls, so the front door stays free. */
  workerNumber: string;
  /** Fired when a bot marks a task `escalated`, so the family is alerted deterministically. */
  onEscalate: (args: { elderId: string; trigger: string }) => void;
  now?: () => Date;
}

const ok = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value),
    },
  ],
});
const fail = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

const APPROVAL_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_REMINDER_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TOOL_RESULT_CHARS = 8000;

function tokenMatches(header: string | undefined, token: string) {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function buildServer(deps: NonnaToolsDeps) {
  const { store, dial, darwin, log } = deps;
  const now = () => deps.now?.() ?? new Date();
  const server = new McpServer({ name: "nonna-tools", version: "0.1.0" });
  const tool = <N extends keyof typeof nonnaTools>(name: N) => ({
    description: nonnaTools[name].description,
    inputSchema: nonnaTools[name].input.shape,
  });

  server.registerTool("get_elder_profile", tool("get_elder_profile"), async ({ elderId }) => {
    const elder = await store.getElder(elderId);
    if (!elder) return fail(`Unknown elder ${elderId}.`);
    const circle = await store.listCircle(elderId);
    // Phone numbers stay in the gateway; bots address people through the tools.
    return ok({
      id: elder.id,
      name: elder.name,
      timezone: elder.timezone,
      language: elder.language,
      address: elder.address ?? null,
      preferences: elder.preferences ?? null,
      careNotes: elder.careNotes ?? null,
      circle: circle.map((m) => ({
        id: m.id,
        name: m.name,
        relation: m.relation,
        canApprove: m.canApprove,
        canPay: m.canPay,
        isNearby: m.isNearby,
      })),
    });
  });

  server.registerTool("update_task", tool("update_task"), async ({ taskId, status }) => {
    const task = await store.getTask(taskId);
    if (!task) return fail(`Unknown task ${taskId}.`);
    if (!canTransition(task.status, status)) {
      return fail(`Task ${taskId} cannot move from ${task.status} to ${status}.`);
    }
    await store.setTaskStatus(taskId, status);
    // The note can hold health details, so only the transition is audited.
    await store.audit({
      actor: "omb",
      action: "update_task",
      taskId,
      detail: `${task.status}->${status}`,
    });
    if (status === "escalated") {
      deps.onEscalate({ elderId: task.elderId, trigger: "agent flagged a task" });
    }
    return ok(`Task ${taskId} is now ${status}.`);
  });

  server.registerTool("message_family", tool("message_family"), async ({ elderId, body }) => {
    const group = await store.getFamilyGroup(elderId);
    if (!group) return fail(`Elder ${elderId} has no family group yet. Nothing was sent.`);
    await dial.sendMessage({ groupId: group.dialGroupId, body });
    await store.audit({ actor: "omb", action: "message_family" });
    return ok("Sent to the family group.");
  });

  server.registerTool("message_elder", tool("message_elder"), async ({ elderId, body }) => {
    const elder = await store.getElder(elderId);
    if (!elder) return fail(`Unknown elder ${elderId}.`);
    await dial.sendMessage({ to: elder.phone, body });
    await store.audit({ actor: "omb", action: "message_elder" });
    return ok(`Sent to ${elder.name}.`);
  });

  server.registerTool(
    "request_family_approval",
    tool("request_family_approval"),
    async ({ taskId, question }) => {
      const task = await store.getTask(taskId);
      if (!task) return fail(`Unknown task ${taskId}.`);
      const approver = (await store.listCircle(task.elderId)).find((m) => m.canApprove);
      if (!approver) return fail("Nobody in this family can approve. Ask the family to set one.");

      const approval = await store.createApproval({
        taskId,
        askedMemberId: approver.id,
        question,
        expiresAt: new Date(now().getTime() + APPROVAL_TTL_MS),
      });
      if (canTransition(task.status, "awaiting_approval")) {
        await store.setTaskStatus(taskId, "awaiting_approval");
      }
      await dial.sendMessage({
        to: approver.phone,
        body: `Nonna here. ${question}\n\nReply YES or NO.`,
      });
      await store.audit({ actor: "omb", action: "request_family_approval", taskId });
      return ok({
        approvalId: approval.id,
        askedMember: `${approver.name} (${approver.relation})`,
        expiresAt: approval.expiresAt,
        note: "Wait for the reply. Do not act on the task until it is approved.",
      });
    },
  );

  server.registerTool(
    "schedule_reminder",
    tool("schedule_reminder"),
    async ({ taskId, fireAt, text }) => {
      const task = await store.getTask(taskId);
      if (!task) return fail(`Unknown task ${taskId}.`);
      const at = new Date(fireAt);
      const ahead = at.getTime() - now().getTime();
      if (ahead <= 0) return fail("fireAt must be in the future.");
      if (ahead > MAX_REMINDER_AHEAD_MS) return fail("fireAt must be within 30 days.");

      const reminder = await store.createReminder({ taskId, fireAt: at, channel: "imessage", text });
      await store.audit({ actor: "omb", action: "schedule_reminder", taskId });
      return ok({ reminderId: reminder.id, fireAt: reminder.fireAt, channel: reminder.channel });
    },
  );

  server.registerTool("darwin_search", tool("darwin_search"), async ({ taskId, kind, query }) => {
    const task = await store.getTask(taskId);
    if (!task) return fail(`Unknown task ${taskId}.`);
    const elder = await store.getElder(task.elderId);
    const result = await darwin.search({
      query,
      maxResults: 5,
      context: [
        { type: "text", value: `Task kind: ${kind}` },
        ...(elder?.address ? [{ type: "text" as const, value: `Location: ${elder.address}` }] : []),
      ],
    });
    await store.audit({ actor: "omb", action: "darwin_search", taskId });
    const json = JSON.stringify(result);
    return ok(
      json.length > MAX_TOOL_RESULT_CHARS ? `${json.slice(0, MAX_TOOL_RESULT_CHARS)}…` : json,
    );
  });

  server.registerTool("dial_call_business", tool("dial_call_business"), async (input) => {
    const { taskId, to, goal } = input;
    const task = await store.getTask(taskId);
    if (!task) return fail(`Unknown task ${taskId}.`);
    const elder = await store.getElder(task.elderId);
    if (!elder) return fail(`Unknown elder for task ${taskId}.`);

    // Same task + number + goal always gets the same key, so a retried tool call never
    // places a second phone call.
    const idempotencyKey = createHash("sha256")
      .update(`${taskId}|${to}|${goal}`)
      .digest("hex")
      .slice(0, 32);
    const call = await dial.placeCall({
      to,
      fromNumber: deps.workerNumber,
      outboundInstruction: `You are Nonna, an AI assistant calling on behalf of ${elder.name}. Say at the start that you are an AI assistant calling for ${elder.name}. Your goal: ${goal}. Be polite and brief. Confirm any date, time and price out loud before you end the call. Never share payment details.`,
      maxCallDurationSeconds: 600,
      idempotencyKey,
    });
    await store.audit({ actor: "omb", action: "dial_call_business", taskId });
    log.info("task call placed", { taskId });
    return ok({
      call,
      note: "The outcome arrives later with the call transcript. Do not mark the task confirmed yet.",
    });
  });

  return server;
}

export function nonnaToolsRoutes(deps: NonnaToolsDeps) {
  const app = new Hono();

  app.all("/", async (c) => {
    if (!deps.token) return c.json({ error: "tools endpoint disabled" }, 503);
    if (!tokenMatches(c.req.header("authorization"), deps.token)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    // Stateless, like the context MCP: a fresh server per request.
    const server = buildServer(deps);
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(c);
  });

  return app;
}
