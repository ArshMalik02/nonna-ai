import { describe, expect, it } from "vitest";
import { canTransition, transition } from "../src/tasks/state-machine.js";

describe("task state machine", () => {
  it("allows the happy path", () => {
    expect(canTransition("received", "triaged")).toBe(true);
    expect(canTransition("planned", "awaiting_approval")).toBe(true);
    expect(canTransition("elder_notified", "closed")).toBe(true);
  });

  it("allows escaping to failed/escalated/cancelled from any active state", () => {
    expect(canTransition("executing", "escalated")).toBe(true);
    expect(canTransition("received", "cancelled")).toBe(true);
  });

  it("rejects skipping steps and leaving terminal states", () => {
    expect(canTransition("received", "executing")).toBe(false);
    expect(canTransition("closed", "received")).toBe(false);
    expect(() => transition("cancelled", "triaged")).toThrow(/Invalid task transition/);
  });
});
