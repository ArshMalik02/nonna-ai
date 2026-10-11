import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type AppDeps, createApp } from "../src/app.js";
import { signDialPayload } from "../src/dial/signature.js";
import { createLogger } from "../src/logger.js";
import { MemoryStore } from "../src/store.js";

const secret = "whsec_test";
const dialLines = { elder: "+17852688267", family: "+12134764803" };

function event(
  id: string,
  body: string,
  from = "+14155550123",
  { to = dialLines.elder as string | null, groupId = null as string | null } = {},
) {
  return JSON.stringify({
    id,
    object: "event",
    type: "message.received",
    version: 1,
    createdAt: new Date().toISOString(),
    relatedObject: { id: "msg_1", type: "message", url: null },
    data: {
      messageId: "msg_1",
      from,
      to,
      groupId,
      channel: "imessage",
      body,
      media: [],
      source: "external",
    },
  });
}

describe("POST /webhooks/dial", () => {
  let store: MemoryStore;
  let escalate: Mock<AppDeps["escalate"]>;
  let app: ReturnType<typeof createApp>;

  const post = (raw: string, sig = signDialPayload(raw, secret, Math.floor(Date.now() / 1000))) =>
    app.request("/webhooks/dial", {
      method: "POST",
      headers: { "x-dial-signature": sig, "content-type": "application/json" },
      body: raw,
    });

  beforeEach(() => {
    store = new MemoryStore();
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
      name: "Anna Lee",
      phone: "+14155550124",
      relation: "daughter",
      priority: 0,
      canApprove: true,
      canPay: true,
      isNearby: false,
    });
    store.groups.set("grp_family", "e1");
    escalate = vi.fn<AppDeps["escalate"]>();
    app = createApp({
      store,
      log: createLogger("error"),
      dialWebhookSecret: secret,
      dialLines,
      escalate,
    });
  });

  it("rejects an unsigned request", async () => {
    const res = await post(event("evt_1", "hi"), "t=1,v1=00");
    expect(res.status).toBe(401);
  });

  it("dedupes repeated deliveries", async () => {
    const raw = event("evt_2", "hello");
    expect(await (await post(raw)).json()).toEqual({ ok: true });
    expect(await (await post(raw)).json()).toEqual({ ok: true, duplicate: true });
  });

  it("escalates an emergency from a known elder", async () => {
    const res = await post(event("evt_3", "I fell and I can't get up"));
    expect(await res.json()).toEqual({ ok: true, escalated: true });
    expect(escalate).toHaveBeenCalledWith(expect.objectContaining({ elderId: "e1" }));
  });

  it("escalates from the family iMessage group and alerts that group", async () => {
    await post(
      event("evt_5", "Mom fell, she can't get up", "+14155550124", {
        to: null,
        groupId: "grp_family",
      }),
    );
    expect(escalate).toHaveBeenCalledWith(
      expect.objectContaining({ elderId: "e1", groupId: "grp_family" }),
    );
  });

  it("matches a direct iMessage to the family line to the member's elder", async () => {
    await post(event("evt_6", "I think dad fell", "+14155550124", { to: dialLines.family }));
    expect(escalate).toHaveBeenCalledWith(
      expect.objectContaining({ elderId: "e1", trigger: "family message" }),
    );
  });

  it("does not treat a family member texting the elder line as the elder", async () => {
    await post(event("evt_7", "I fell", "+14155550124", { to: dialLines.elder }));
    expect(escalate).not.toHaveBeenCalled();
  });

  it("ignores unknown senders", async () => {
    await post(event("evt_4", "I fell", "+19998887777"));
    expect(escalate).not.toHaveBeenCalled();
  });
});

describe("context MCP auth", () => {
  it("rejects callers that are not a registered elder", async () => {
    const app = createApp({
      store: new MemoryStore(),
      log: createLogger("error"),
      dialWebhookSecret: secret,
      dialLines,
      escalate: vi.fn(),
    });
    const res = await app.request("/mcp/context", {
      method: "POST",
      headers: { "x-dial-user-number": "+19998887777" },
    });
    expect(res.status).toBe(403);
  });
});

describe("context MCP tools", () => {
  it("lists tools for a registered elder", async () => {
    const store = new MemoryStore();
    store.elders.set("e1", {
      id: "e1",
      name: "Mary Lee",
      phone: "+14155550123",
      timezone: "America/Los_Angeles",
      language: "en",
    });
    const app = createApp({
      store,
      log: createLogger("error"),
      dialWebhookSecret: secret,
      dialLines,
      escalate: vi.fn(),
    });
    const res = await app.request("/mcp/context", {
      method: "POST",
      headers: {
        "x-dial-user-number": "+14155550123",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const tool of ["get_elder_profile", "create_task", "escalate_now"]) {
      expect(text).toContain(tool);
    }
  });
});
