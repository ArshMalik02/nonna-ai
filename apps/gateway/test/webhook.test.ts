import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type AppDeps, createApp } from "../src/app.js";
import { signDialPayload } from "../src/dial/signature.js";
import { createLogger } from "../src/logger.js";
import { MemoryStore } from "../src/store.js";

const secret = "whsec_test";

function event(id: string, body: string, from = "+14155550123") {
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
      to: "+14155550100",
      groupId: null,
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
    escalate = vi.fn<AppDeps["escalate"]>();
    app = createApp({ store, log: createLogger("error"), dialWebhookSecret: secret, escalate });
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
