import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type AppDeps, createApp } from "../src/app.js";
import { signDialPayload } from "../src/dial/signature.js";
import { createLogger } from "../src/logger.js";
import { MemoryStore } from "../src/store.js";

const secret = "whsec_test";
const dialLines = { elder: "+14155550100", family: "+14155550101" };
const contextMcpToken = "test-token-0123456789abcdef";

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
    store.groups.set("grp_family", { dialGroupId: "grp_family", elderId: "e1" });
    escalate = vi.fn<AppDeps["escalate"]>();
    app = createApp({
      store,
      log: createLogger("error"),
      dialWebhookSecret: secret,
      dialLines,
      contextMcpToken,
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

  it("passes family group messages on to the team", async () => {
    const onInbound = vi.fn();
    app = createApp({
      store,
      log: createLogger("error"),
      dialWebhookSecret: secret,
      dialLines,
      contextMcpToken,
      escalate,
      onInbound,
    });
    await post(event("evt_8", "OK", "grandkid@example.com", { to: null, groupId: "grp_family" }));
    expect(onInbound).toHaveBeenCalledWith({
      elderId: "e1",
      source: "family_group",
      from: "grandkid@example.com",
      body: "OK",
      groupId: "grp_family",
      escalated: false,
    });
  });

  it("triggers group discovery for a group it has not bound", async () => {
    const onUnknownGroup = vi.fn();
    app = createApp({
      store,
      log: createLogger("error"),
      dialWebhookSecret: secret,
      dialLines,
      contextMcpToken,
      escalate,
      onUnknownGroup,
    });
    await post(event("evt_9", "Hi", "grandkid@example.com", { to: null, groupId: "grp_new" }));
    expect(onUnknownGroup).toHaveBeenCalledWith("grp_new");
  });

  it("matches family members who iMessage from an Apple ID email", async () => {
    store.circle.push({
      id: "m2",
      elderId: "e1",
      name: "Sam",
      phone: "+14155550199",
      imessageHandle: "grandkid@example.com",
      relation: "grandson",
      priority: 1,
      canApprove: true,
      canPay: false,
      isNearby: false,
    });
    await post(event("evt_10", "Grandma fell", "Grandkid@Example.com", { to: dialLines.family }));
    expect(escalate).toHaveBeenCalledWith(expect.objectContaining({ elderId: "e1" }));
  });

  it("ignores unknown senders", async () => {
    await post(event("evt_4", "I fell", "+19998887777"));
    expect(escalate).not.toHaveBeenCalled();
  });
});

describe("context MCP auth", () => {
  const app = () =>
    createApp({
      store: new MemoryStore(),
      log: createLogger("error"),
      dialWebhookSecret: secret,
      dialLines,
      contextMcpToken,
      escalate: vi.fn(),
    });

  it("rejects requests without the shared token (spoofed caller headers)", async () => {
    const res = await app().request("/mcp/context", {
      method: "POST",
      headers: { "x-dial-user-number": "+14155550123" },
    });
    expect(res.status).toBe(401);
  });

  it("gives callers that are not a registered elder no tools", async () => {
    const res = await app().request("/mcp/context", {
      method: "POST",
      headers: {
        "x-nonna-mcp-token": contextMcpToken,
        "x-dial-user-number": "+19998887777",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const body = await res.text();
    expect(body).toContain('"tools":[]');
    expect(body).not.toContain("get_elder_profile");
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
      contextMcpToken,
      escalate: vi.fn(),
    });
    const res = await app.request("/mcp/context", {
      method: "POST",
      headers: {
        "x-nonna-mcp-token": contextMcpToken,
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
