import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { signDialPayload } from "../src/dial/signature.js";
import { createLogger } from "../src/logger.js";
import { createOmbRelay } from "../src/omb/relay.js";
import { MemoryStore } from "../src/store.js";

const secret = "whsec_test";
const flush = () => new Promise((r) => setTimeout(r, 0));

function seed() {
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
    name: "Anna Lee",
    phone: "+14155550124",
    relation: "daughter",
    priority: 0,
    canApprove: true,
    canPay: false,
    isNearby: false,
  });
  store.groups.set("grp_1", "e1");
  store.ombChannels.set("grp_1", "chan_1");
  return store;
}

function groupMessage(id: string, from: string, body: string) {
  return JSON.stringify({
    id,
    object: "event",
    type: "message.received",
    version: 1,
    createdAt: new Date().toISOString(),
    relatedObject: null,
    data: {
      messageId: "msg_1",
      from,
      to: "+14155550100",
      groupId: "grp_1",
      channel: "imessage",
      body,
      media: [],
      source: "external",
    },
  });
}

describe("OMB relay", () => {
  it("forwards a family message into the family's OMB channel", async () => {
    const store = seed();
    const omb = { postToChannel: vi.fn(async () => {}) };
    const log = createLogger("error");
    const app = createApp({
      store,
      log,
      dialWebhookSecret: secret,
      escalate: vi.fn(),
      relay: createOmbRelay({ store, omb, log }),
    });

    const raw = groupMessage("evt_1", "+14155550124", "Can Mom see Dr. Patel tomorrow?");
    const res = await app.request("/webhooks/dial", {
      method: "POST",
      headers: { "x-dial-signature": signDialPayload(raw, secret, Math.floor(Date.now() / 1000)) },
      body: raw,
    });
    expect(res.status).toBe(200);
    await flush();
    await flush();

    expect(omb.postToChannel).toHaveBeenCalledTimes(1);
    const [channel, text] = omb.postToChannel.mock.calls[0] as unknown as [string, string];
    expect(channel).toBe("chan_1");
    expect(text).toContain("Anna Lee (daughter)");
    expect(text).toContain("Dr. Patel");
  });

  it("does not forward emergencies to OMB (the gateway handles them)", async () => {
    const store = seed();
    const omb = { postToChannel: vi.fn(async () => {}) };
    const log = createLogger("error");
    const escalate = vi.fn();
    const app = createApp({
      store,
      log,
      dialWebhookSecret: secret,
      escalate,
      relay: createOmbRelay({ store, omb, log }),
    });

    const raw = groupMessage("evt_2", "+14155550123", "I fell and I can't get up");
    await app.request("/webhooks/dial", {
      method: "POST",
      headers: { "x-dial-signature": signDialPayload(raw, secret, Math.floor(Date.now() / 1000)) },
      body: raw,
    });
    await flush();

    expect(escalate).toHaveBeenCalled();
    expect(omb.postToChannel).not.toHaveBeenCalled();
  });

  it("announces a new task and skips elders without a linked channel", async () => {
    const store = seed();
    const omb = { postToChannel: vi.fn(async () => {}) };
    const relay = createOmbRelay({ store, omb, log: createLogger("error") });

    const task = await store.createTask({ elderId: "e1", kind: "ride", summary: "Clinic at 10" });
    relay.announceTask(task);
    await flush();
    await flush();
    expect(omb.postToChannel).toHaveBeenCalledWith("chan_1", expect.stringContaining(task.id));

    store.ombChannels.delete("grp_1");
    relay.announceTask(task);
    await flush();
    await flush();
    expect(omb.postToChannel).toHaveBeenCalledTimes(1);
  });
});
