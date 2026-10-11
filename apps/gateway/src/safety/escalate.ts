import type { CircleMember, Elder } from "@nonna/shared";
import type { CallEnded, CallLine } from "../calls/line.js";
import type { DialClient } from "../dial/client.js";
import type { DialLines } from "../dial/lines.js";
import type { Logger } from "../logger.js";

export interface EscalateDeps {
  dial: Pick<DialClient, "sendMessage">;
  line: Pick<CallLine, "enqueue">;
  log: Logger;
  lines: DialLines;
  /** How many family members to try before giving up. */
  maxCalls?: number;
}

/** A call counts as answered by a person if it connected and lasted long enough to talk. */
const ANSWERED_MIN_SECONDS = 20;
export const wasAnswered = (e: CallEnded) =>
  e.status === "completed" && (e.durationSeconds ?? 0) >= ANSWERED_MIN_SECONDS;

/**
 * Emergency ladder. Nonna never dials 911 itself: it tells the elder to, alerts the family
 * group at once, then calls family members ONE AT A TIME (nearby first, then by priority) on
 * Nonna's single number, ahead of any other call. The first person who answers is told what
 * happened and transferred to the elder; if nobody answers, the group is told plainly.
 */
export async function escalate(
  deps: EscalateDeps,
  elder: Elder,
  circle: CircleMember[],
  opts: { groupId?: string | undefined; trigger: string },
) {
  const { dial, log, maxCalls = 3 } = deps;
  const toGroup = (body: string) =>
    opts.groupId
      ? dial
          .sendMessage({ groupId: opts.groupId, body })
          .catch((err: unknown) => log.error("group alert failed", { error: String(err) }))
      : Promise.resolve();

  const ladder = circle
    .filter((m): m is CircleMember & { phone: string } => Boolean(m.phone))
    .sort((a, b) => Number(b.isNearby) - Number(a.isNearby) || a.priority - b.priority)
    .slice(0, maxCalls);

  // Messages need no phone line, so they go out immediately and in parallel.
  await Promise.all([
    dial
      .sendMessage({
        to: elder.phone,
        fromNumber: deps.lines.elder,
        body: "If this is an emergency, please call 911 now. I am alerting your family.",
      })
      .catch((err: unknown) => log.error("elder alert failed", { error: String(err) })),
    toGroup(
      `URGENT: ${elder.name} may need help (${opts.trigger}). Please call ${elder.name} now.` +
        (ladder.length ? ` Nonna is calling ${ladder.map((m) => m.name).join(", then ")}.` : ""),
    ),
  ]);

  const callNext = (i: number) => {
    const member = ladder[i];
    if (!member) {
      void toGroup(
        `Nobody answered Nonna's calls. Please call ${elder.name} directly, and call 911 if you can't reach them.`,
      );
      return;
    }
    deps.line.enqueue({
      priority: "emergency",
      input: {
        to: member.phone,
        fromNumber: deps.lines.family,
        outboundInstruction: `You are Nonna, an AI assistant for ${elder.name}. Tell ${member.name} calmly that ${elder.name} may need urgent help (${opts.trigger}) and ask them to call or go to ${elder.name} right away. Offer to connect them to ${elder.name} now. Be brief.`,
        transferTo: elder.phone,
        maxCallDurationSeconds: 120,
      },
      onEnded: async (ended) => {
        if (wasAnswered(ended)) {
          await toGroup(
            `${member.name} answered Nonna's call and knows ${elder.name} may need help.`,
          );
        } else {
          callNext(i + 1);
        }
      },
      onFailed: () => callNext(i + 1),
    });
  };
  callNext(0);
}
