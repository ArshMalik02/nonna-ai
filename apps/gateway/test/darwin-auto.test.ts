import { describe, expect, it, vi } from "vitest";
import { autoDarwin, type DarwinService, proxyDarwin } from "../src/darwin/service.js";
import type { DarwinSearchResult } from "../src/darwin/types.js";

const proxy = proxyDarwin({ workMs: 0 });
const liveWith = (search: () => Promise<DarwinSearchResult>): DarwinService => ({
  mode: "live",
  search: vi.fn(search),
  start: vi.fn(async () => ({ actRequestId: "act_live", threads: [{ threadId: "thr_live" }] })),
  read: vi.fn(async (id: string) => ({ actRequestId: id, threads: [] })),
  reply: vi.fn(async () => ({})),
});
const QUERY = { query: "book a ride to the doctor" };

describe("auto Darwin mode", () => {
  it("uses live Darwin when it returns an agent that can start a thread", async () => {
    const live = liveWith(async () => ({
      searchId: "s_live",
      status: "ok",
      response: { agents: [{ agentId: "rovv", capabilityId: "book_ride", canStartThread: true }] },
    }));
    const r = await autoDarwin(live, proxy).search(QUERY);
    expect(r.searchId).toBe("s_live");
    expect(r.mode).toBe("live");
  });

  it("falls back to the proxy when live agents can't be started, saying what Darwin found", async () => {
    const live = liveWith(async () => ({
      searchId: "s_live",
      status: "ok",
      response: {
        agents: [{ agentId: "uber", capabilityId: "ride", name: "Uber", canStartThread: false }],
      },
    }));
    const r = await autoDarwin(live, proxy).search(QUERY);
    expect(r.response.agents?.[0]?.agentId).toMatch(/^proxy\./);
    expect(r.liveDarwin).toMatchObject({ agentsFound: ["Uber"] });
  });

  it("falls back to the proxy when Darwin is down", async () => {
    const live = liveWith(async () => Promise.reject(new TypeError("fetch failed")));
    const r = await autoDarwin(live, proxy).search(QUERY);
    expect(r.response.agents?.length).toBeGreaterThan(0);
    expect(r.liveDarwin).toMatchObject({ status: "unavailable" });
  });

  it("sends each run to the side its agent came from", async () => {
    const live = liveWith(async () => ({ searchId: "s", status: "no_match", response: {} }));
    const auto = autoDarwin(live, proxy);
    const p = await auto.start({
      agentId: "proxy.rides.easyride",
      capabilityId: "book_ride",
      brief: "Pick up Grandpa at 2537 Ellsworth St at 9:30",
      idempotencyKey: "k",
    });
    expect(p.actRequestId).toMatch(/^proxyact_/);
    expect(live.start).not.toHaveBeenCalled();
    await auto.start({
      agentId: "rovv",
      capabilityId: "book_ride",
      brief: "x",
      idempotencyKey: "k2",
    });
    expect(live.start).toHaveBeenCalledTimes(1);
    expect(auto.modeOf("proxy.rides.easyride")).toBe("proxy");
    expect(auto.modeOf("act_live")).toBe("live");
  });
});
