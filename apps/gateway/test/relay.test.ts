import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";
import type { OmbChannel, OmbMessage } from "../src/omb/client.js";
import { ChannelRelay } from "../src/omb/relay.js";

/** A scripted OpenMausBot channel: each poll advances one step of the script. */
function fakeOmb(steps: { busy: boolean; add?: OmbMessage[] }[], history: OmbMessage[] = []) {
  const messages = [...history];
  let polls = -1;
  const channel = (): OmbChannel => ({
    id: "c1",
    name: "Family",
    threadId: "t1",
    busyBotId: (steps[Math.max(polls, 0)]?.busy ?? false) ? "bot" : null,
  });
  return {
    posted: [] as string[],
    respond: vi.fn(async () => {}),
    getChannel: vi.fn(async () => channel()),
    postToChannel: vi.fn(async function (this: unknown, _c: string, _t: string, text: string) {
      messages.push({ id: `u${messages.length}`, role: "user", kind: "text", text });
    }),
    threadMessages: vi.fn(async () => {
      polls += 1;
      messages.push(...(steps[polls]?.add ?? []));
      return { messages: [...messages], hasMore: false };
    }),
  };
}

const run = (omb: ReturnType<typeof fakeOmb>, deliver = vi.fn(async () => {})) => ({
  deliver,
  relay: new ChannelRelay("c1", {
    omb,
    log: createLogger("error"),
    deliver,
    sleep: async () => {},
    autoApproveTool: (tool) => tool.startsWith("mcp__nonna__"),
  }),
});

describe("ChannelRelay", () => {
  it("forwards each new bot text reply once and stops when the channel settles", async () => {
    const omb = fakeOmb(
      [
        { busy: false }, // priming read
        { busy: true, add: [{ id: "b1", role: "bot", kind: "activity", text: "thinking" }] },
        { busy: true, add: [{ id: "b2", role: "bot", kind: "text", text: " Booked for 10am. " }] },
        { busy: false },
        { busy: false },
      ],
      [{ id: "old", role: "bot", kind: "text", text: "an old reply" }],
    );
    const { relay, deliver } = run(omb);
    await relay.send("Family: book a ride");
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith("Booked for 10am.", []);
  });

  it("approves Nonna's own tools and leaves other approvals for a person", async () => {
    const card = (requestId: string, tool: string): OmbMessage => ({
      id: requestId,
      role: "bot",
      kind: "options",
      card: { requestId, requestType: "permission", tool },
    });
    const omb = fakeOmb([
      { busy: false },
      { busy: true, add: [card("r1", "mcp__nonna__create_task"), card("r2", "Bash")] },
      { busy: false },
      { busy: false },
    ]);
    await run(omb).relay.send("Family: hi");
    expect(omb.respond).toHaveBeenCalledWith("t1", "r1", "allow", true);
    expect(omb.respond).not.toHaveBeenCalledWith("t1", "r2", expect.anything(), expect.anything());
  });
});
