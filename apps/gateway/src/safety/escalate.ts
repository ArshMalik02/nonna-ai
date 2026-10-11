import type { CircleMember, Elder } from "@nonna/shared";
import type { DialClient } from "../dial/client.js";
import type { DialLines } from "../dial/lines.js";
import type { Logger } from "../logger.js";

export interface EscalateDeps {
  dial: DialClient;
  log: Logger;
  lines: DialLines;
}

/**
 * Emergency ladder. Nonna never dials 911 itself — it tells the elder to, alerts the family
 * group immediately, and calls circle members in priority order (nearby first), transferring
 * the first human who answers to the elder.
 */
export async function escalate(
  deps: EscalateDeps,
  elder: Elder,
  circle: CircleMember[],
  opts: { groupId?: string | undefined; trigger: string },
) {
  const { dial, log } = deps;
  const alert = `URGENT: ${elder.name} may need help (${opts.trigger}). Please call them now. Nonna is calling family in order.`;

  const ladder = circle
    .filter((m): m is CircleMember & { phone: string } => Boolean(m.phone))
    .sort((a, b) => Number(b.isNearby) - Number(a.isNearby) || a.priority - b.priority);

  const results = await Promise.allSettled([
    // The elder always hears from the elder line, the one number they know.
    dial.sendMessage({
      to: elder.phone,
      fromNumber: deps.lines.elder,
      body: "If this is an emergency, please call 911 now. I am alerting your family.",
    }),
    opts.groupId ? dial.sendMessage({ groupId: opts.groupId, body: alert }) : Promise.resolve(),
    ...ladder.slice(0, 3).map((m) =>
      dial.placeCall({
        to: m.phone,
        // Calls go out from the family line so the elder line stays free for the elder.
        fromNumber: deps.lines.family,
        outboundInstruction: `You are Nonna, an AI assistant for ${elder.name}. Tell ${m.name} that ${elder.name} may need urgent help (${opts.trigger}) and ask them to call or go to ${elder.name} right away. Be brief and calm.`,
        transferTo: elder.phone,
        maxCallDurationSeconds: 120,
      }),
    ),
  ]);

  for (const r of results) {
    if (r.status === "rejected") log.error("escalation step failed", { error: String(r.reason) });
  }
}
