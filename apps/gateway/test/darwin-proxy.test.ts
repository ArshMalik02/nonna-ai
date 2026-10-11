import { describe, expect, it } from "vitest";
import { PROXY_AGENTS } from "../src/darwin/proxy-catalog.js";
import { proxyDarwin } from "../src/darwin/service.js";

const darwin = proxyDarwin();
const top = async (query: string) => (await darwin.search({ query })).response.agents?.[0]?.agentId;

describe("Darwin proxy", () => {
  it("has 50+ agents with unique ids, spread across every use case", () => {
    expect(PROXY_AGENTS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(PROXY_AGENTS.map((a) => a.agentId)).size).toBe(PROXY_AGENTS.length);
    expect(new Set(PROXY_AGENTS.map((a) => a.category)).size).toBeGreaterThanOrEqual(10);
  });

  it("returns Darwin's documented search shape (candidates under response.agents)", async () => {
    const r = await darwin.search({ query: "book a ride to the dentist" });
    expect(r).toMatchObject({ status: "ok", searchId: expect.any(String) });
    expect(r.response.agents?.[0]).toMatchObject({
      agentId: expect.any(String),
      capabilityId: expect.any(String),
      canStartThread: true,
      rank: 1,
    });
  });

  it.each([
    ["wheelchair van to dialysis", "proxy.rides.wheelchairvan"],
    ["refill her blood pressure prescription", "proxy.pharmacy.refill"],
    ["pay the hospital bill", "proxy.pay.medicalbill"],
    ["explain her lab results in plain words", "proxy.report.labexplain"],
    ["deliver groceries and milk", "proxy.food.groceries"],
    ["install grab bars in the bathroom", "proxy.home.grabbars"],
  ])("finds a fitting agent for %j", async (query, expected) => {
    expect(await top(query)).toBe(expected);
  });

  it("refuses emergencies and unknown requests with response.noMatchReason", async () => {
    const e = await darwin.search({ query: "mom fell and needs an ambulance" });
    expect(e.status).toBe("no_match");
    expect(e.response.noMatchReason).toMatch(/911/);
    expect((await darwin.search({ query: "launch a rocket to mars" })).status).toBe("no_match");
  });

  it("simulates a thread: working, then a completion confirmation", async () => {
    let now = 0;
    const d = proxyDarwin({ workMs: 1000, now: () => now });
    const brief = "Pick up Mary Lee at 123 Demo St at 9:30 Tuesday; she uses a walker.";
    const receipt = await d.start({
      agentId: "proxy.rides.easyride",
      capabilityId: "book_ride",
      brief,
      idempotencyKey: "k",
    });
    const id = receipt.actRequestId ?? "";
    const early = await d.read(id);
    expect(early.threads[0]?.state.messages.map((m) => m.type)).toEqual(["text"]);
    now = 1000;
    const done = await d.read(id);
    expect(done.threads[0]?.state.messages.at(-1)).toMatchObject({
      type: "completion_confirmation",
      simulated: true,
    });
  });

  it("asks a question when the brief is too thin, and stops at payment for payment agents", async () => {
    const thin = await darwin.start({
      agentId: "proxy.rides.easyride",
      capabilityId: "book_ride",
      brief: "ride",
      idempotencyKey: "a",
    });
    expect((await darwin.read(thin.actRequestId ?? "")).threads[0]?.state.requests[0]?.type).toBe(
      "question",
    );
    const pay = await darwin.start({
      agentId: "proxy.pay.medicalbill",
      capabilityId: "pay_medical_bill",
      brief: "Pay invoice 4411 from Berkeley Clinic, $40, payer Anna.",
      idempotencyKey: "b",
    });
    expect((await darwin.read(pay.actRequestId ?? "")).threads[0]?.state.requests[0]?.type).toBe(
      "payment",
    );
  });
});
