import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";
import { createTeamBridge } from "../src/omb/bridge.js";
import type { OmbMessage } from "../src/omb/client.js";
import { MemoryStore } from "../src/store.js";

function setup({ confirmed }: { confirmed: boolean }) {
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
  store.groups.set("grp_1", {
    dialGroupId: "grp_1",
    elderId: "e1",
    ombChannelId: "c1",
    confirmedAt: confirmed ? new Date() : undefined,
  });
  const omb = {
    getChannel: vi.fn(async () => ({ id: "c1", name: "Family", threadId: "t1", busyBotId: null })),
    postToChannel: vi.fn(async () => {}),
    threadMessages: vi.fn(
      async (): Promise<{ messages: OmbMessage[]; hasMore: boolean }> => ({
        messages: [],
        hasMore: false,
      }),
    ),
    respond: vi.fn(async () => {}),
  };
  const dial = {
    sendMessage: vi.fn(async () => ({})),
    setTyping: vi.fn(async () => ({})),
    listGroups: vi.fn(async () => ({ groups: [] })),
  };
  const lines = { elder: "+14155550100", family: "+14155550101" };
  const bridge = createTeamBridge({
    store,
    dial,
    omb,
    lines,
    log: createLogger("error"),
    pollMs: 1,
  });
  return { omb, dial, handle: bridge.handle, bridge, lines };
}

describe("team bridge", () => {
  it("posts family group messages to the elder's channel with who wrote them", async () => {
    const { omb, handle } = setup({ confirmed: true });
    await handle({
      elderId: "e1",
      source: "family_group",
      from: "+14155550124",
      body: "Can Mom get a ride Tuesday?",
      groupId: "grp_1",
      escalated: false,
    });
    expect(omb.postToChannel).toHaveBeenCalledWith(
      "c1",
      "t1",
      "Anna (daughter) in the family group:\nCan Mom get a ride Tuesday?",
    );
  });

  it("routes the elder's texts to the same channel, replies going to the family group", async () => {
    const { omb, handle } = setup({ confirmed: true });
    await handle({
      elderId: "e1",
      source: "elder",
      from: "+14155550123",
      body: "I need my pills refilled",
      escalated: false,
    });
    expect(omb.postToChannel).toHaveBeenCalledWith(
      "c1",
      "t1",
      "The elder texted Nonna (your reply goes to the elder and the family group):\nI need my pills refilled",
    );
  });

  it("sends replies to an elder's text to the family group and back to the elder", async () => {
    const { omb, dial, handle, lines } = setup({ confirmed: true });
    let polls = 0;
    omb.threadMessages.mockImplementation(async () => {
      polls += 1;
      return {
        messages:
          polls > 1
            ? [{ id: "r1", role: "bot", kind: "text", text: "I'll refill them today." }]
            : [],
        hasMore: false,
      };
    });
    await handle({
      elderId: "e1",
      source: "elder",
      from: "+14155550123",
      body: "Pills?",
      escalated: false,
    });
    expect(dial.sendMessage).toHaveBeenCalledWith({
      groupId: "grp_1",
      body: "I'll refill them today.",
    });
    expect(dial.sendMessage).toHaveBeenCalledWith({
      to: "+14155550123",
      fromNumber: lines.elder,
      body: "I'll refill them today.",
    });
  });

  it("keeps onboarding replies out of the team channel", async () => {
    const { omb, dial, handle } = setup({ confirmed: false });
    await handle({
      elderId: "e1",
      source: "family_group",
      from: "+14155550124",
      body: "OK",
      groupId: "grp_1",
      escalated: false,
    });
    expect(omb.postToChannel).not.toHaveBeenCalled();
    expect(dial.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ groupId: "grp_1" }));
  });
});
