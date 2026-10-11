import type { DialMessageReceived } from "@nonna/shared";

/**
 * Nonna's Dial numbers. They may be the same number: with an iMessage-capable line, one number
 * can serve both the elder (1:1 iMessage + calls) and the family group, and no SMS 10DLC
 * registration is needed.
 * - elder: the number the elder texts and calls; Nonna texts the elder from it.
 * - family: in the family iMessage group; places outbound task and alert calls.
 */
export interface DialLines {
  elder: string;
  family: string;
}

export type InboundRoute =
  | { kind: "group"; groupId: string }
  | { kind: "direct" }
  | { kind: "other" };

/**
 * Where a message arrived. Who it is from (elder or family) is decided by the sender, not by the
 * line, so a shared number works.
 */
export function routeInbound(msg: DialMessageReceived, lines: DialLines): InboundRoute {
  if (msg.groupId) return { kind: "group", groupId: msg.groupId };
  if (msg.to === lines.elder || msg.to === lines.family) return { kind: "direct" };
  return { kind: "other" };
}
