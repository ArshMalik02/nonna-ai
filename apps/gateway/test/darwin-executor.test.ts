import { describe, expect, it, vi } from "vitest";
import { DarwinHttpError } from "../src/darwin/client.js";
import { createDarwinExecutor, ExecutorRefusal } from "../src/darwin/executor.js";
import { type DarwinService, proxyDarwin } from "../src/darwin/service.js";
import { describeUpdate } from "../src/darwin/watcher.js";
import { createLogger } from "../src/logger.js";
import { MemoryStore } from "../src/store.js";

const BRIEF =
  "Pick up Mary Lee at 123 Demo St at 9:30 Tuesday for Smile Dental; she uses a walker.";

async function setup(darwin: DarwinService = proxyDarwin({ workMs: 0 })) {
  const store = new MemoryStore();
  store.elders.set("e1", {
    id: "e1",
    name: "Mary Lee",
    phone: "+14155550123",
    timezone: "America/Los_Angeles",
    language: "en",
  });
  const task = await store.createTask({ elderId: "e1", kind: "ride", summary: "Dentist ride" });
  const ex = createDarwinExecutor({ darwin, store, log: createLogger("error") });
  const found = await ex.search({ query: "ride to the dentist with a walker", taskId: task.id });
  const agent = found.response.agents?.[0];
  if (!agent) throw new Error("no agent");
  return { store, ex, task, searchId: found.searchId, agent };
}

describe("Darwin executor", () => {
  it("starts one agent from a real search and reports completion only from the thread", async () => {
    const { ex, task, searchId, agent } = await setup();
    const run = await ex.start({ taskId: task.id, searchId, agentId: agent.agentId, brief: BRIEF });
    expect(run.status).toBe("running");
    const checked = await ex.check(task.id);
    expect(checked?.run.status).toBe("completed");
    expect(checked?.run.outcome).toMatchObject({ type: "completion_confirmation" });
  });

  it("refuses agent ids the search did not return", async () => {
    const { ex, task, searchId } = await setup();
    await expect(
      ex.start({ taskId: task.id, searchId, agentId: "proxy.made.up", brief: BRIEF }),
    ).rejects.toBeInstanceOf(ExecutorRefusal);
    await expect(
      ex.start({
        taskId: task.id,
        searchId: "srch_unknown",
        agentId: "proxy.rides.easyride",
        brief: BRIEF,
      }),
    ).rejects.toThrow(/Unknown searchId/);
  });

  it("never starts a second agent for the same task", async () => {
    const darwin = proxyDarwin({ workMs: 60_000 });
    const start = vi.spyOn(darwin, "start");
    const { ex, task, searchId, agent } = await setup(darwin);
    const first = await ex.start({
      taskId: task.id,
      searchId,
      agentId: agent.agentId,
      brief: BRIEF,
    });
    const second = await ex.start({
      taskId: task.id,
      searchId,
      agentId: agent.agentId,
      brief: `${BRIEF} again`,
    });
    expect(second.id).toBe(first.id);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("marks a network failure on start as unknown and does not retry", async () => {
    const base = proxyDarwin();
    const darwin: DarwinService = {
      ...base,
      start: vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
    };
    const { store, ex, task, searchId, agent } = await setup(darwin);
    const run = await ex.start({ taskId: task.id, searchId, agentId: agent.agentId, brief: BRIEF });
    expect(run.status).toBe("unknown");
    expect(store.runs).toHaveLength(1); // saved before the call, with its idempotency key
    const again = await ex.start({
      taskId: task.id,
      searchId,
      agentId: agent.agentId,
      brief: BRIEF,
    });
    expect(again.id).toBe(run.id);
    expect(darwin.start).toHaveBeenCalledTimes(1);
  });

  it("allows a new run only after a definite refusal", async () => {
    const base = proxyDarwin({ workMs: 60_000 });
    let refuse = true;
    const darwin: DarwinService = {
      ...base,
      start: vi.fn(async (input) => {
        if (refuse) throw new DarwinHttpError(403, "ACT_PREVIEW_ACCESS_REQUIRED");
        return base.start(input);
      }),
    };
    const { ex, task, searchId, agent } = await setup(darwin);
    expect(
      (await ex.start({ taskId: task.id, searchId, agentId: agent.agentId, brief: BRIEF })).status,
    ).toBe("failed");
    refuse = false;
    expect(
      (await ex.start({ taskId: task.id, searchId, agentId: agent.agentId, brief: BRIEF })).status,
    ).toBe("running");
  });

  it("answers text questions once per operation, and refuses to answer payments with text", async () => {
    const { ex, task, searchId, agent } = await setup();
    await ex.start({ taskId: task.id, searchId, agentId: agent.agentId, brief: "a ride" });
    expect((await ex.check(task.id))?.run.status).toBe("needs_input");
    const replied = await ex.reply({ taskId: task.id, text: BRIEF, operationId: "op1" });
    expect(replied.status).toBe("running");
    await expect(
      ex.reply({ taskId: task.id, text: "different", operationId: "op1" }),
    ).rejects.toThrow(/already used/);

    const pay = await setup();
    const bill = await pay.ex.search({ query: "pay the hospital bill", taskId: pay.task.id });
    const billAgent = bill.response.agents?.[0];
    await pay.ex.start({
      taskId: pay.task.id,
      searchId: bill.searchId,
      agentId: billAgent?.agentId ?? "",
      brief: "Pay invoice 4411 from Berkeley Clinic, $40.",
    });
    expect((await pay.ex.check(pay.task.id))?.run.status).toBe("needs_input");
    await expect(
      pay.ex.reply({ taskId: pay.task.id, text: "yes pay it", operationId: "p1" }),
    ).rejects.toThrow(/hosted flow/);
  });

  it("tells the bot what to do for each kind of update", async () => {
    const { ex, task, searchId, agent } = await setup();
    await ex.start({ taskId: task.id, searchId, agentId: agent.agentId, brief: BRIEF });
    const checked = await ex.check(task.id);
    if (!checked) throw new Error("no run");
    const text = describeUpdate(checked.run, task.summary, checked.newMessages);
    expect(text).toContain("completed");
    expect(text).toContain("TEST booking");
  });
});
