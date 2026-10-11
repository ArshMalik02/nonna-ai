import type { CircleMember, Elder } from "@nonna/shared";
import { describe, expect, it, vi } from "vitest";
import { createCallLine } from "../src/calls/line.js";
import { DialHttpError, type PlaceCallInput } from "../src/dial/client.js";
import { createLogger } from "../src/logger.js";
import { escalate } from "../src/safety/escalate.js";

const log = createLogger("error");
const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeDial() {
  let n = 0;
  const placed: PlaceCallInput[] = [];
  return {
    placed,
    placeCall: vi.fn(async (input: PlaceCallInput) => {
      placed.push(input);
      n += 1;
      return { call: { id: `call_${n}` } };
    }),
    sendMessage: vi.fn(async () => ({})),
  };
}

const input = (to: string): PlaceCallInput => ({
  to,
  fromNumber: "+14155550101",
  outboundInstruction: "x",
  maxCallDurationSeconds: 60,
});

describe("single-number call line", () => {
  it("places one call at a time and the next only after call.ended", async () => {
    const dial = fakeDial();
    const line = createCallLine({ dial, log });
    line.enqueue({ priority: "task", input: input("+1A") });
    line.enqueue({ priority: "task", input: input("+1B") });
    await flush();
    expect(dial.placed.map((c) => c.to)).toEqual(["+1A"]);
    await line.onCallEnded({ callId: "call_1", status: "completed", durationSeconds: 30 });
    await flush();
    expect(dial.placed.map((c) => c.to)).toEqual(["+1A", "+1B"]);
  });

  it("puts emergency calls ahead of waiting task calls", async () => {
    const dial = fakeDial();
    const line = createCallLine({ dial, log });
    line.enqueue({ priority: "task", input: input("+1TASK1") });
    line.enqueue({ priority: "task", input: input("+1TASK2") });
    line.enqueue({ priority: "emergency", input: input("+1SOS") });
    await flush();
    await line.onCallEnded({ callId: "call_1", status: "completed", durationSeconds: 30 });
    await flush();
    expect(dial.placed.map((c) => c.to)).toEqual(["+1TASK1", "+1SOS"]);
  });

  it("waits and retries while the number is busy (e.g. the elder is calling in)", async () => {
    vi.useFakeTimers();
    const dial = fakeDial();
    dial.placeCall.mockRejectedValueOnce(new DialHttpError(429, "call_limit_reached"));
    const line = createCallLine({ dial, log, busyRetryMs: 1000 });
    line.enqueue({ priority: "task", input: input("+1A") });
    await vi.advanceTimersByTimeAsync(0);
    expect(dial.placeCall).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(dial.placeCall).toHaveBeenCalledTimes(2);
    expect(line.busy).toBe(true);
    vi.useRealTimers();
  });
});

describe("emergency ladder", () => {
  const elder: Elder = {
    id: "e1",
    name: "Grandpa",
    phone: "+14155550123",
    timezone: "America/Los_Angeles",
    language: "en",
  };
  const member = (
    name: string,
    phone: string,
    priority: number,
    isNearby = false,
  ): CircleMember => ({
    id: name,
    elderId: "e1",
    name,
    phone,
    relation: "family",
    priority,
    canApprove: true,
    canPay: false,
    isNearby,
  });
  const circle = [
    member("Anna", "+1ANNA", 0),
    member("Sam", "+1SAM", 1, true),
    member("Raj", "+1RAJ", 2),
  ];
  const lines = { elder: "+14155550101", family: "+14155550101" };

  it("alerts at once, then calls family one at a time, nearby first, until someone answers", async () => {
    const dial = fakeDial();
    const line = createCallLine({ dial, log });
    await escalate({ dial, line, log, lines }, elder, circle, { groupId: "grp", trigger: "fell" });
    await flush();
    expect(dial.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ to: elder.phone }));
    expect(dial.placed.map((c) => c.to)).toEqual(["+1SAM"]); // only one call on the line

    await line.onCallEnded({ callId: "call_1", status: "no-answer", durationSeconds: null });
    await flush();
    expect(dial.placed.map((c) => c.to)).toEqual(["+1SAM", "+1ANNA"]);

    await line.onCallEnded({ callId: "call_2", status: "completed", durationSeconds: 45 });
    await flush();
    expect(dial.placed).toHaveLength(2); // Anna answered: stop
    expect(dial.sendMessage).toHaveBeenCalledWith({
      groupId: "grp",
      body: expect.stringContaining("Anna answered"),
    });
  });

  it("tells the group plainly when nobody answers", async () => {
    const dial = fakeDial();
    const line = createCallLine({ dial, log });
    await escalate({ dial, line, log, lines, maxCalls: 2 }, elder, circle, {
      groupId: "grp",
      trigger: "fell",
    });
    for (const id of ["call_1", "call_2"]) {
      await flush();
      await line.onCallEnded({ callId: id, status: "no-answer", durationSeconds: null });
    }
    await flush();
    expect(dial.sendMessage).toHaveBeenCalledWith({
      groupId: "grp",
      body: expect.stringContaining("Nobody answered"),
    });
  });
});
