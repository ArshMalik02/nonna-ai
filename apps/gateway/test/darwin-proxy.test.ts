import { describe, expect, it } from "vitest";
import { PROXY_AGENTS } from "../src/darwin/proxy-catalog.js";
import { proxyDarwin } from "../src/darwin/service.js";

type SearchResult = { status: string; agents?: { agentId: string }[]; noMatchReason?: string };
const darwin = proxyDarwin();
const top = async (query: string) =>
  ((await darwin.search({ query })) as SearchResult).agents?.[0]?.agentId;

describe("Darwin proxy catalog", () => {
  it("has 50+ agents with unique ids, spread across every use case", () => {
    expect(PROXY_AGENTS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(PROXY_AGENTS.map((a) => a.agentId)).size).toBe(PROXY_AGENTS.length);
    expect(new Set(PROXY_AGENTS.map((a) => a.category)).size).toBeGreaterThanOrEqual(10);
  });

  it.each([
    ["book a ride to the dentist for mom", "proxy"],
    ["wheelchair van to dialysis", "proxy.rides.wheelchairvan"],
    ["refill her blood pressure prescription", "proxy.pharmacy.refill"],
    ["pay the hospital bill", "proxy.pay.medicalbill"],
    ["explain her lab results in plain words", "proxy.report.labexplain"],
    ["deliver groceries and milk", "proxy.food.groceries"],
    ["install grab bars in the bathroom", "proxy.home.grabbars"],
  ])("finds a fitting agent for %j", async (query, expected) => {
    expect(await top(query)).toContain(expected);
  });

  it("refuses emergencies like Darwin does", async () => {
    const r = (await darwin.search({ query: "mom fell and needs an ambulance" })) as SearchResult;
    expect(r.status).toBe("no_match");
    expect(r.noMatchReason).toMatch(/911/);
  });

  it("returns no match rather than a bad guess", async () => {
    const r = (await darwin.search({ query: "launch a rocket to mars" })) as SearchResult;
    expect(r.status).toBe("no_match");
  });

  it("simulates acting, never real payment", async () => {
    const ride = (await darwin.act({
      agentId: "proxy.rides.easyride",
      request: "ride at 10",
      idempotencyKey: "k1",
    })) as { simulated: boolean; status: string; confirmation: { code: string } };
    expect(ride).toMatchObject({ simulated: true, status: "completed" });
    expect(ride.confirmation.code).toHaveLength(8);
    const bill = (await darwin.act({
      agentId: "proxy.pay.medicalbill",
      request: "pay $40",
      idempotencyKey: "k2",
    })) as { status: string };
    expect(bill.status).toBe("awaiting_payment");
  });
});
