import { normalizePhone } from "@nonna/shared";
import { describe, expect, it, vi } from "vitest";
import { describeCall } from "../src/calls/results.js";
import { createLogger } from "../src/logger.js";
import { MemoryStore } from "../src/store.js";

describe("normalizePhone", () => {
  it.each([
    ["3412193611", "+13412193611"],
    ["13412193611", "+13412193611"],
    ["+13412193611", "+13412193611"],
    ["(341) 219-3611", "+13412193611"],
    ["+1 (341) 219‑3611", "+13412193611"],
    ["Grandkid@Example.com", "grandkid@example.com"],
  ])("%j → %j", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});

describe("caller numbers without +1 (as on Dial call records)", () => {
  it("still recognizes the elder on an inbound call", async () => {
    const store = new MemoryStore();
    store.elders.set("e1", {
      id: "e1",
      name: "Grandpa",
      phone: "+13412193611",
      timezone: "America/Los_Angeles",
      language: "en",
    });
    const lines = { elder: "+14155550101", family: "+14155550101" };
    const message = await describeCall(
      {
        store,
        lines,
        log: createLogger("error"),
        team: { postToTeam: vi.fn() },
        dial: { getCall: vi.fn() },
      },
      {
        id: "c1",
        from: "3412193611",
        to: lines.elder,
        direction: "inbound",
        status: "completed",
        duration: 40,
        transcript: "hi",
        createdAt: new Date().toISOString(),
      },
    );
    expect(message?.elderId).toBe("e1");
    expect(message?.text).toContain("The elder called Nonna");
  });
});
