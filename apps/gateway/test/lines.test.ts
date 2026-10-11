import type { DialMessageReceived } from "@nonna/shared";
import { describe, expect, it } from "vitest";
import { routeInbound } from "../src/dial/lines.js";

const lines = { elder: "+17852688267", family: "+12134764803" };
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
  it("routes group messages to the family line", () => {
    expect(routeInbound(msg({ groupId: "grp_1" }), lines)).toEqual({
      line: "family",
      kind: "group",
      groupId: "grp_1",
    });
  });
  it("routes SMS to the elder number to the elder line", () => {
    expect(routeInbound(msg({ to: lines.elder, channel: "sms" }), lines)).toEqual({
      line: "elder",
      kind: "direct",
    });
  });
  it("routes direct iMessages to the family number to the family line", () => {
    expect(routeInbound(msg({ to: lines.family }), lines)).toEqual({
      line: "family",
      kind: "direct",
    });
  });
  it("flags messages to any other number", () => {
    expect(routeInbound(msg({ to: "+10000000000" }), lines)).toEqual({ line: "unknown" });
  });
});
