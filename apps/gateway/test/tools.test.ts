import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { MemoryStore } from "../src/store.js";

const TOKEN = "test-token-0123456789abcdef";
const NOW = new Date("2026-10-11T18:00:00Z");

function seed() {
  const store = new MemoryStore();
  store.elders.set("e1", {
    id: "e1",
    name: "Mary Lee",
    phone: "+14155550123",
    timezone: "America/Los_Angeles",
    language: "en",
    address: "123 Demo St, Berkeley, CA",
  });
  store.circle.push({
    id: "m1",
    elderId: "e1",
    name: "Anna Lee",
    phone: "+14155550124",
    relation: "daughter",
    priority: 0,
    canApprove: true,
    canPay: true,
    isNearby: false,
  });
  store.groups.set("grp_1", "e1");
  return store;
}

function setup(store = seed()) {
  const dial = {
    sendMessage: vi.fn(async () => ({ ok: true })),
    placeCall: vi.fn(async () => ({ id: "call_1", status: "queued" })),
  };
  const darwin = { search: vi.fn(async () => ({ status: "ok", agents: [] })) };
  const escalate = vi.fn();
  const app = createApp({
    store,
    log: createLogger("error"),
    dialWebhookSecret: "whsec_test",
    escalate,
    tools: { dial, darwin, token: TOKEN, workerNumber: "+14155550101", now: () => NOW },
  });

  async function call(name: string, args: Record<string, unknown>, token = TOKEN) {
    const res = await app.request("/mcp/tools", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const raw = await res.text();
    // Streamable HTTP may answer as plain JSON or as one SSE "data:" line.
    const line = raw.split("\n").find((l) => l.startsWith("data: "));
    if (!res.ok) return { status: res.status, text: raw, isError: true };
    const payload = JSON.parse(line ? line.slice(6) : raw) as {
      result?: { content: { text: string }[]; isError?: boolean };
      error?: { message: string };
    };
    return {
      status: res.status,
      text: payload.result?.content.map((c) => c.text).join("\n") ?? payload.error?.message ?? raw,
      // Bad input comes back either as a tool error or as a JSON-RPC error, depending on the SDK.
      isError: payload.result?.isError === true || payload.error !== undefined,
    };
  }

  return { store, dial, darwin, escalate, app, call };
}

describe("/mcp/tools auth", () => {
  it("rejects a wrong token", async () => {
    const { call } = setup();
    const res = await call("get_elder_profile", { elderId: "e1" }, "wrong-token-0123456789abcd");
    expect(res.status).toBe(401);
  });

  it("is off (503) when no token is configured", async () => {
    const app = createApp({
      store: seed(),
      log: createLogger("error"),
      dialWebhookSecret: "whsec_test",
      escalate: vi.fn(),
      tools: {
        dial: { sendMessage: vi.fn(), placeCall: vi.fn() },
        darwin: { search: vi.fn() },
        token: undefined,
        workerNumber: "+14155550101",
      },
    });
    const res = await app.request("/mcp/tools", { method: "POST" });
    expect(res.status).toBe(503);
  });
});

describe("/mcp/tools", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("returns the profile without phone numbers", async () => {
    const res = await t.call("get_elder_profile", { elderId: "e1" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("Mary Lee");
    expect(res.text).toContain("Anna Lee");
    expect(res.text).not.toContain("+1415555");
  });

  it("moves a task along the state machine and refuses skips", async () => {
    const task = await t.store.createTask({ elderId: "e1", kind: "ride", summary: "Clinic" });
    const step = await t.call("update_task", { taskId: task.id, status: "triaged", note: "" });
    expect(step.isError).toBe(false);
    expect(t.store.tasks[0]?.status).toBe("triaged");

    const skip = await t.call("update_task", { taskId: task.id, status: "closed", note: "" });
    expect(skip.isError).toBe(true);
    expect(t.store.tasks[0]?.status).toBe("triaged");
  });

  it("alerts the family when a bot escalates a task", async () => {
    const task = await t.store.createTask({ elderId: "e1", kind: "other", summary: "Odd call" });
    await t.call("update_task", { taskId: task.id, status: "escalated", note: "sounded hurt" });
    expect(t.escalate).toHaveBeenCalledWith(expect.objectContaining({ elderId: "e1" }));
  });

  it("messages the family group and the elder", async () => {
    await t.call("message_family", { elderId: "e1", body: "Ride booked for 10:00." });
    await t.call("message_elder", { elderId: "e1", body: "Your cab comes at 10." });
    expect(t.dial.sendMessage).toHaveBeenCalledWith({
      groupId: "grp_1",
      body: "Ride booked for 10:00.",
    });
    expect(t.dial.sendMessage).toHaveBeenCalledWith({
      to: "+14155550123",
      body: "Your cab comes at 10.",
    });
  });

  it("asks the approver and parks the task in awaiting_approval", async () => {
    const task = await t.store.createTask({ elderId: "e1", kind: "ride", summary: "Clinic" });
    await t.store.setTaskStatus(task.id, "planned");
    const res = await t.call("request_family_approval", {
      taskId: task.id,
      question: "Book a cab for 10:00 tomorrow?",
    });
    expect(res.isError).toBe(false);
    expect(t.store.approvals).toHaveLength(1);
    expect(t.store.tasks[0]?.status).toBe("awaiting_approval");
    expect(t.dial.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+14155550124" }),
    );
  });

  it("only schedules reminders in the future", async () => {
    const task = await t.store.createTask({ elderId: "e1", kind: "ride", summary: "Clinic" });
    const past = await t.call("schedule_reminder", {
      taskId: task.id,
      fireAt: "2026-10-11T17:00:00Z",
      text: "Cab soon",
    });
    expect(past.isError).toBe(true);
    const ok = await t.call("schedule_reminder", {
      taskId: task.id,
      fireAt: "2026-10-12T16:50:00Z",
      text: "Your cab is outside now.",
    });
    expect(ok.isError).toBe(false);
    expect(t.store.reminders).toHaveLength(1);
  });

  it("places task calls from the worker line with a stable idempotency key", async () => {
    const task = await t.store.createTask({ elderId: "e1", kind: "appointment", summary: "Dr" });
    const args = { taskId: task.id, to: "+14155559999", goal: "Book a follow-up, mornings." };
    await t.call("dial_call_business", args);
    await t.call("dial_call_business", args);
    const [first, second] = t.dial.placeCall.mock.calls as unknown as [
      { fromNumber: string; idempotencyKey: string; outboundInstruction: string },
    ][];
    expect(first?.[0].fromNumber).toBe("+14155550101");
    expect(first?.[0].outboundInstruction).toContain("AI assistant");
    expect(first?.[0].idempotencyKey).toBe(second?.[0].idempotencyKey);
  });

  it("rejects a call to something that is not a phone number", async () => {
    const task = await t.store.createTask({ elderId: "e1", kind: "ride", summary: "Cab" });
    const res = await t.call("dial_call_business", { taskId: task.id, to: "911", goal: "x" });
    expect(res.isError).toBe(true);
    expect(t.dial.placeCall).not.toHaveBeenCalled();
  });

  it("searches Darwin with the elder's location as context", async () => {
    const task = await t.store.createTask({ elderId: "e1", kind: "ride", summary: "Cab" });
    await t.call("darwin_search", { taskId: task.id, kind: "ride", query: "book a taxi" });
    expect(t.darwin.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "book a taxi",
        context: expect.arrayContaining([
          { type: "text", value: "Location: 123 Demo St, Berkeley, CA" },
        ]),
      }),
    );
  });
});
