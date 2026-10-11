import type { DialMessageReceived } from "@nonna/shared";
import { describe, expect, it } from "vitest";
import { routeInbound } from "../src/dial/lines.js";

const lines = { elder: "+14155550100", family: "+14155550101" };
const msg = (over: Partial<DialMessageReceived>): DialMessageReceived => ({
  messageId: "m",
  from: "+14155550123",
  to: null,
  channel: "imessage",
  body: "hi",
  media: [],
  source: "external",
  ...over,
});

describe("routeInbound", () => {
  it("routes group messages by group", () => {
    expect(routeInbound(msg({ groupId: "grp_1" }), lines)).toEqual({
      kind: "group",
      groupId: "grp_1",
    });
  });
  it("treats a message to either of Nonna's numbers as direct", () => {
    expect(routeInbound(msg({ to: lines.elder }), lines)).toEqual({ kind: "direct" });
    expect(routeInbound(msg({ to: lines.family }), lines)).toEqual({ kind: "direct" });
  });
  it("works when the elder and family share one number", () => {
    const shared = { elder: "+14155550101", family: "+14155550101" };
    expect(routeInbound(msg({ to: shared.elder }), shared)).toEqual({ kind: "direct" });
  });
  it("flags messages to any other number", () => {
    expect(routeInbound(msg({ to: "+10000000000" }), lines)).toEqual({ kind: "other" });
  });
});
