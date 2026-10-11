import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DialGroup } from "../src/dial/client.js";
import {
  confirmedMessage,
  discoverGroups,
  handleFamilyGroupMessage,
  welcomeMessage,
} from "../src/family/onboarding.js";
import { createLogger } from "../src/logger.js";
import { MemoryStore } from "../src/store.js";

const group = (id: string, channel: DialGroup["channel"] = "imessage"): DialGroup => ({
  id,
  channel,
  name: null,
  createdAt: new Date().toISOString(),
});

describe("family group onboarding", () => {
  let store: MemoryStore;
  let groups: DialGroup[];
  const sendMessage = vi.fn(async () => ({}));
  const deps = () => ({
    store,
    log: createLogger("error"),
    dial: { listGroups: async () => ({ groups }), sendMessage },
  });

  beforeEach(() => {
    sendMessage.mockClear();
    store = new MemoryStore();
    store.elders.set("e1", {
      id: "e1",
      name: "Mary Lee",
      phone: "+14155550123",
      timezone: "America/Los_Angeles",
      language: "en",
    });
    groups = [group("grp_1")];
  });

  it("binds a new iMessage group to the only elder and says hello once", async () => {
    await discoverGroups(deps());
    await discoverGroups(deps());
    expect(store.groups.get("grp_1")?.elderId).toBe("e1");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      groupId: "grp_1",
      body: welcomeMessage("Mary Lee"),
    });
  });

  it("does not guess when there is more than one elder", async () => {
    store.elders.set("e2", {
      id: "e2",
      name: "Joe Lee",
      phone: "+14155550999",
      timezone: "America/Los_Angeles",
      language: "en",
    });
    await discoverGroups(deps());
    expect(store.groups.size).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("ignores WhatsApp groups", async () => {
    groups = [group("grp_wa", "whatsapp")];
    await discoverGroups(deps());
    expect(store.groups.size).toBe(0);
  });

  it("confirms the group when a family member replies OK", async () => {
    await discoverGroups(deps());
    sendMessage.mockClear();
    await handleFamilyGroupMessage(deps(), { groupId: "grp_1", elderId: "e1", body: "maybe" });
    expect(store.groups.get("grp_1")?.confirmedAt).toBeUndefined();
    await handleFamilyGroupMessage(deps(), { groupId: "grp_1", elderId: "e1", body: "OK!" });
    expect(store.groups.get("grp_1")?.confirmedAt).toBeInstanceOf(Date);
    expect(sendMessage).toHaveBeenCalledWith({
      groupId: "grp_1",
      body: confirmedMessage("Mary Lee"),
    });
  });
});
