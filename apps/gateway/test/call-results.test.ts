import { describe, expect, it, vi } from "vitest";
import { type DialCallRecord, describeCall, handleCallFinished } from "../src/calls/results.js";
import { createLogger } from "../src/logger.js";
import { MemoryStore } from "../src/store.js";

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
  store.circle.push({
    id: "m1",
    elderId: "e1",
    name: "Anna",
    phone: "+14155550124",
    relation: "daughter",
    priority: 0,
    canApprove: true,
    canPay: false,
    isNearby: false,
  });
  const team = { postToTeam: vi.fn(async () => {}) };
  const deps = (call: DialCallRecord) => ({
    store,
    team,
    lines,
    log: createLogger("error"),
    dial: { getCall: vi.fn(async () => ({ call })) },
  });
  return { store, team, deps };
}

const call = (over: Partial<DialCallRecord>): DialCallRecord => ({
  id: "call_1",
  from: "+14155550123",
  to: lines.elder,
  direction: "inbound",
  status: "completed",
  duration: 95,
  transcriptTurns: [
    { speaker: "agent", text: "Hi Mary, it's Nonna." },
    { speaker: "user", text: "I need to see Dr. Patel tomorrow." },
  ],
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  ...over,
});

describe("call results", () => {
  it("gives the team the elder's call transcript and the tasks created during it", async () => {
    const { store, team, deps } = setup();
    await store.createTask({
      elderId: "e1",
      kind: "appointment",
      summary: "See Dr. Patel tomorrow",
    });
    const c = call({});
    await handleCallFinished(deps(c), c.id);
    const [elderId, text] = team.postToTeam.mock.calls[0] as unknown as [string, string];
    expect(elderId).toBe("e1");
    expect(text).toContain("The elder called Nonna (2 min)");
    expect(text).toContain("appointment: See Dr. Patel tomorrow");
    expect(text).toContain("Elder: I need to see Dr. Patel tomorrow.");
  });

  it("reports a business call back against its task", async () => {
    const { store, deps } = setup();
    const task = await store.createTask({ elderId: "e1", kind: "appointment", summary: "Dentist" });
    await store.addTaskStep({
      taskId: task.id,
      executor: "dial_call",
      status: "placed",
      dialCallId: "call_2",
    });
    const c = call({
      id: "call_2",
      direction: "outbound",
      from: lines.family,
      to: "+14155550199",
      status: "no-answer",
      duration: null,
      transcriptTurns: [],
    });
    const message = await describeCall(deps(c), c);
    expect(message?.text).toContain(`for task ${task.id} (Dentist) ended: no-answer`);
  });

  it("ignores calls from unknown numbers", async () => {
    const { deps } = setup();
    const c = call({ from: "+19998887777" });
    expect(await describeCall(deps(c), c)).toBeUndefined();
  });
});
