import type { DialMessageReceived } from "@nonna/shared";

/**
 * Nonna runs two Dial numbers with fixed roles:
 * - elder line (SMS + voice): the only number the elder texts and calls. Kept free for them, so
 *   Nonna never places task calls from it.
 * - family line (iMessage + voice): sits in the family iMessage group, takes direct iMessages
 *   from family members, and places outbound task calls (clinic, cab company, family alerts).
 */
export interface DialLines {
  elder: string;
  family: string;
}

export type InboundRoute =
  | { line: "family"; kind: "group"; groupId: string }
  | { line: "family"; kind: "direct" }
  | { line: "elder"; kind: "direct" }
  | { line: "unknown" };

export function routeInbound(msg: DialMessageReceived, lines: DialLines): InboundRoute {
  if (msg.groupId) return { line: "family", kind: "group", groupId: msg.groupId };
  if (msg.to === lines.elder) return { line: "elder", kind: "direct" };
  if (msg.to === lines.family) return { line: "family", kind: "direct" };
  return { line: "unknown" };
}
