import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { proxyDarwin } from "../src/darwin/service.js";
import { createLogger } from "../src/logger.js";
import { MemoryStore } from "../src/store.js";

const token = "tools-token-0123456789abcdef";
const lines = { elder: "+14155550100", family: "+14155550101" };

function setup() {
  const store = new MemoryStore();
  store.elders.set("e1", {
    id: "e1",
    name: "Mary Lee",
    phone: "+14155550123",
    timezone: "America/Los_Angeles",
    language: "en",
  });
  const dial = {
    sendMessage: vi.fn(async () => ({})),
    placeCall: vi.fn(async () => ({ id: "call_1" })),
    getCall: vi.fn(async () => ({})),
  };
  const app = createApp({
    store,
    log: createLogger("error"),
    dialWebhookSecret: "s",
    dialLines: lines,
    contextMcpToken: undefined,
    escalate: vi.fn(),
    tools: { dial, darwin: proxyDarwin(), lines, token },
  });
  let id = 0;
  const call = async (name: string, args: Record<string, unknown>, auth = token) => {
    const res = await app.request("/mcp/tools", {
      method: "POST",
      headers: {
        "x-nonna-tools-token": auth,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    return { status: res.status, body: await res.text() };
  };
  return { store, dial, call };
}

describe("Nonna tools MCP", () => {
  it("rejects calls without the shared token", async () => {
    const { call } = setup();
    expect(
      (await call("get_elder_profile", { elderId: "e1" }, "wrong-token-000000000000000")).status,
    ).toBe(401);
  });

  it("returns the profile without the elder's phone number", async () => {
    const { call } = setup();
    const { body } = await call("get_elder_profile", { elderId: "e1" });
    expect(body).toContain("Mary Lee");
    expect(body).not.toContain("+14155550123");
  });

  it("creates tasks and enforces the task state machine", async () => {
    const { store, call } = setup();
    await call("create_task", { elderId: "e1", kind: "ride", summary: "Ride to the dentist" });
    const [task] = store.tasks;
    expect(task?.status).toBe("received");
    const skip = await call("update_task", { taskId: task?.id, status: "executing", note: "go" });
    expect(skip.body).toContain("cannot go from received to executing");
    await call("update_task", { taskId: task?.id, status: "triaged", note: "ok" });
    expect(store.tasks[0]?.status).toBe("triaged");
  });

  it("texts the elder from the elder line and calls businesses from the family line", async () => {
    const { store, dial, call } = setup();
    await call("message_elder", { elderId: "e1", body: "Your ride is at 10." });
    expect(dial.sendMessage).toHaveBeenCalledWith({
      to: "+14155550123",
      fromNumber: lines.elder,
      body: "Your ride is at 10.",
    });

    await call("create_task", { elderId: "e1", kind: "appointment", summary: "Dentist follow-up" });
    await call("dial_call_business", {
      elderId: "e1",
      taskId: store.tasks[0]?.id,
      to: "+14155550199",
      goal: "Book a follow-up appointment, mornings preferred",
    });
    expect(dial.placeCall).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+14155550199", fromNumber: lines.family }),
    );
    expect(store.steps).toContainEqual(
      expect.objectContaining({
        taskId: store.tasks[0]?.id,
        executor: "dial_call",
        dialCallId: undefined,
      }),
    );
  });

  it("searches and acts through the Darwin proxy, marking the result simulated", async () => {
    const { store, call } = setup();
    const search = await call("darwin_search", { query: "wheelchair ride to the clinic" });
    expect(search.body).toContain("proxy.rides.wheelchairvan");
    await call("create_task", { elderId: "e1", kind: "ride", summary: "Ride to the clinic" });
    const act = await call("darwin_act", {
      taskId: store.tasks[0]?.id,
      agentId: "proxy.rides.wheelchairvan",
      request:
        "Pick up Mary Lee at 123 Demo St at 9:30 on Tuesday, wheelchair, to Berkeley Clinic.",
    });
    expect(act.body).toContain('\\"simulated\\":true');
    expect(store.steps).toContainEqual(expect.objectContaining({ executor: "darwin_act" }));
  });
});
