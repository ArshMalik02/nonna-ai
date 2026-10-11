import { describe, expect, it, vi } from "vitest";
import { placesDarwin, toE164 } from "../src/darwin/places.js";

const PLACES = [
  {
    id: "abc",
    displayName: { text: "Bay Senior Rides" },
    formattedAddress: "1 Main St, Berkeley, CA",
    internationalPhoneNumber: "+1 510-555-0101",
    nationalPhoneNumber: "(510) 555-0101",
    rating: 4.7,
    regularOpeningHours: { openNow: true },
  },
  {
    id: "nophone",
    displayName: { text: "No Phone Cabs" },
    formattedAddress: "2 Main St, Berkeley, CA",
  },
];

type Search = {
  mode: string;
  status: string;
  noMatchReason?: string;
  agents?: { agentId: string; name: string; phone: string | null; address: string | null }[];
};
type Act = { status: string; simulated?: boolean; callId?: string; demoCall?: boolean };

function setup(opts: { callsEnabled?: boolean; demoTarget?: string } = {}) {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ places: PLACES }), { status: 200 }),
  );
  const placeCall = vi.fn(async (_input: { to: string }) => ({ call: { id: "call_9" } }));
  const darwin = placesDarwin({
    apiKey: "test-key",
    dial: { placeCall },
    fromNumber: "+14155550101",
    callsEnabled: opts.callsEnabled ?? false,
    demoTarget: opts.demoTarget,
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { darwin, fetch, placeCall };
}

describe("Darwin places mode (Google Places + Dial)", () => {
  it("maps Google results to the Darwin search shape and drops places without a phone", async () => {
    const { darwin, fetch } = setup();
    const r = (await darwin.search({ query: "senior ride service Berkeley" })) as Search;

    expect(r.mode).toBe("places");
    expect(r.status).toBe("ok");
    expect(r.agents).toHaveLength(1);
    expect(r.agents?.[0]).toMatchObject({
      agentId: "places:abc",
      name: "Bay Senior Rides",
      phone: "+1 510-555-0101",
      address: "1 Main St, Berkeley, CA",
    });

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://places.googleapis.com/v1/places:searchText");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(headers["X-Goog-FieldMask"]).toContain("places.internationalPhoneNumber");
  });

  it("never calls the business while PLACES_CALLS_ENABLED is off", async () => {
    const { darwin, placeCall } = setup({ callsEnabled: false });
    await darwin.search({ query: "senior ride service Berkeley" });
    const r = (await darwin.act({
      agentId: "places:abc",
      request: "Book a ride Tuesday 10am",
      idempotencyKey: "k1",
    })) as Act;

    expect(placeCall).not.toHaveBeenCalled();
    expect(r.simulated).toBe(true);
  });

  it("calls the demo phone instead of the business when DEMO_CALL_TARGET is set", async () => {
    const { darwin, placeCall } = setup({ callsEnabled: false, demoTarget: "+14155550199" });
    await darwin.search({ query: "senior ride service Berkeley" });
    const r = (await darwin.act({
      agentId: "places:abc",
      request: "Book a ride Tuesday 10am",
      idempotencyKey: "k2",
      onBehalfOf: "Mary Lee",
    })) as Act;

    expect(placeCall).toHaveBeenCalledOnce();
    expect(placeCall.mock.calls[0]?.[0].to).toBe("+14155550199");
    expect(r).toMatchObject({ status: "calling", callId: "call_9", demoCall: true });
  });

  it("calls the real business only when PLACES_CALLS_ENABLED is on", async () => {
    const { darwin, placeCall } = setup({ callsEnabled: true });
    await darwin.search({ query: "senior ride service Berkeley" });
    const r = (await darwin.act({
      agentId: "places:abc",
      request: "Book a ride Tuesday 10am",
      idempotencyKey: "k3",
      onBehalfOf: "Mary Lee",
    })) as Act;

    const input = placeCall.mock.calls[0]?.[0] as { to: string; outboundInstruction: string };
    expect(input.to).toBe("+15105550101");
    expect(input.outboundInstruction).toMatch(/AI assistant calling on behalf of Mary Lee/);
    expect(r).toMatchObject({ status: "calling", callId: "call_9", simulated: false });
  });

  it("refuses emergencies in search and act", async () => {
    const { darwin, fetch, placeCall } = setup({ callsEnabled: true });
    const s = (await darwin.search({ query: "mom fell and needs an ambulance" })) as Search;
    expect(s.status).toBe("no_match");
    expect(s.noMatchReason).toMatch(/911/);
    expect(fetch).not.toHaveBeenCalled();

    const a = (await darwin.act({
      agentId: "places:abc",
      request: "She has chest pain, send someone",
      idempotencyKey: "k4",
    })) as Act;
    expect(a.status).toBe("refused");
    expect(placeCall).not.toHaveBeenCalled();
  });

  it("only dials numbers in international format", () => {
    expect(toE164({ internationalPhoneNumber: "+1 510-555-0101" })).toBe("+15105550101");
    expect(toE164({})).toBeUndefined();
  });
});
