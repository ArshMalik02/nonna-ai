import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";
import type { OmbChannel, OmbMessage } from "../src/omb/client.js";
import { createModelFailover, isUsageLimitError } from "../src/omb/failover.js";
import { ChannelRelay } from "../src/omb/relay.js";

const primary = { instanceId: "claude", model: "claude-sonnet-5-5" };
const fallback = { instanceId: "claudeApi", model: "claude-sonnet-5-5" };
const LIMIT =
  "error: This Claude account has reached its weekly limit, which resets Oct 12, 2:30 PM (UTC). Until then, switch this bot to another engine or Claude account.";

describe("usage-limit failover", () => {
  it("recognizes OpenMausBot's usage-limit errors only", () => {
    expect(isUsageLimitError(LIMIT)).toBe(true);
    expect(isUsageLimitError("error: This Claude account has reached its 5-hour limit")).toBe(true);
    expect(isUsageLimitError("error: tool crashed")).toBe(false);
    expect(isUsageLimitError("Booked: usage limit of 2 rides")).toBe(false);
  });

  it("switches every bot in the channel to the fallback once, then back later", async () => {
    vi.useFakeTimers();
    const omb = {
      getChannel: vi.fn(
        async (): Promise<OmbChannel> => ({
          id: "c1",
          name: "F",
          threadId: "t1",
          memberIds: ["b1", "b2"],
        }),
      ),
      setBotModel: vi.fn(async () => {}),
    };
    const f = createModelFailover({
      omb,
      log: createLogger("error"),
      primary,
      fallback,
      retryPrimaryAfterMs: 1000,
    });
    expect(await f.onUsageLimit("c1")).toBe(true);
    expect(omb.setBotModel).toHaveBeenCalledWith("b1", fallback);
    expect(omb.setBotModel).toHaveBeenCalledWith("b2", fallback);
    expect(f.active).toBe("fallback");
    expect(await f.onUsageLimit("c1")).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(omb.setBotModel).toHaveBeenCalledWith("b1", primary);
    expect(f.active).toBe("primary");
    vi.useRealTimers();
  });

  it("makes the relay retry the message once after switching", async () => {
    const posted: string[] = [];
    let polls = 0;
    const omb = {
      getChannel: vi.fn(
        async (): Promise<OmbChannel> => ({
          id: "c1",
          name: "F",
          threadId: "t1",
          busyBotId: polls < 3 ? "b1" : null,
        }),
      ),
      postToChannel: vi.fn(async (_c: string, _t: string, text: string) => {
        posted.push(text);
      }),
      respond: vi.fn(async () => {}),
      threadMessages: vi.fn(async (): Promise<{ messages: OmbMessage[]; hasMore: boolean }> => {
        polls += 1;
        const messages: OmbMessage[] = [];
        if (polls >= 2)
          messages.push({
            id: "e1",
            role: "bot",
            kind: "activity",
            tool: { ok: false, name: LIMIT },
          });
        if (polls >= 3) messages.push({ id: "r1", role: "bot", kind: "text", text: "Done." });
        return { messages, hasMore: false };
      }),
    };
    const onUsageLimit = vi.fn(async () => true);
    const deliver = vi.fn(async () => {});
    const relay = new ChannelRelay("c1", {
      omb,
      log: createLogger("error"),
      deliver,
      onUsageLimit,
      sleep: async () => {},
    });
    await relay.send("Family: book a ride");
    expect(onUsageLimit).toHaveBeenCalledTimes(1);
    expect(posted).toEqual(["Family: book a ride", "Family: book a ride"]);
    expect(deliver).toHaveBeenCalledWith("Done.", []);
  });
});
