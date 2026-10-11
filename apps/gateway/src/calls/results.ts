import type { Task } from "@nonna/shared";
import type { DialClient } from "../dial/client.js";
import type { DialLines } from "../dial/lines.js";
import type { Logger } from "../logger.js";
import type { TeamBridge } from "../omb/bridge.js";
import type { Store } from "../store.js";

export interface DialCallRecord {
  id: string;
  from: string;
  to: string;
  direction: "inbound" | "outbound" | string;
  status: string;
  duration?: number | null;
  transcript?: string | null;
  transcriptTurns?: { speaker: string; text: string }[] | null;
  createdAt: string;
}

export interface CallResultDeps {
  dial: Pick<DialClient, "getCall">;
  store: Store;
  team: Pick<TeamBridge, "postToTeam">;
  lines: DialLines;
  log: Logger;
}

const MAX_TRANSCRIPT = 6_000;

export function formatTranscript(call: DialCallRecord, labels: Record<string, string>) {
  const turns = call.transcriptTurns?.length
    ? call.transcriptTurns.map((t) => `${labels[t.speaker] ?? t.speaker}: ${t.text}`).join("\n")
    : (call.transcript ?? "(no transcript)");
  return turns.length > MAX_TRANSCRIPT ? `${turns.slice(0, MAX_TRANSCRIPT)}\n[…cut]` : turns;
}

const minutes = (s?: number | null) => (s ? `${Math.max(1, Math.round(s / 60))} min` : "short");
const taskLine = (t: Task) => `- ${t.kind}: ${t.summary} (task ${t.id}, ${t.status})`;

/**
 * Turns a finished Dial call into a message for the elder's team channel. The bot's reply to it
 * (a short summary, a status update) is relayed to the family group like any other reply.
 *
 * - The elder called the elder line: transcript + tasks the voice agent created during the call.
 * - Nonna called a business for a task: the outcome, so the bot can update the task.
 * - A family member called, or answered an emergency call: what was said.
 */
export async function describeCall(
  deps: CallResultDeps,
  call: DialCallRecord,
): Promise<{ elderId: string; text: string } | undefined> {
  const { store, lines } = deps;

  // Inbound calls are told apart by caller (one number may serve the elder and the family).
  if (call.direction === "inbound" && (call.to === lines.elder || call.to === lines.family)) {
    const elder = await store.findElderByPhone(call.from);
    if (elder) {
      const tasks = await store.listTasksCreatedSince(elder.id, new Date(call.createdAt));
      return {
        elderId: elder.id,
        text: [
          `The elder called Nonna (${minutes(call.duration)}).`,
          tasks.length
            ? `Tasks created during the call:\n${tasks.map(taskLine).join("\n")}`
            : "No tasks were created during the call.",
          `Transcript:\n${formatTranscript(call, { agent: "Nonna", user: "Elder" })}`,
          "Post a short, warm summary of the call for the family, then start on any tasks.",
        ].join("\n\n"),
      };
    }
    const family = await store.findElderByFamilyHandle(call.from);
    if (!family) return undefined;
    return {
      elderId: family.id,
      text: [
        `A family member (${call.from}) called Nonna (${minutes(call.duration)}).`,
        `Transcript:\n${formatTranscript(call, { agent: "Nonna", user: "Caller" })}`,
        "Act on anything they asked for and confirm in the family group.",
      ].join("\n\n"),
    };
  }

  if (call.direction === "outbound") {
    const task = await store.findTaskByCallId(call.id);
    if (task) {
      return {
        elderId: task.elderId,
        text: [
          `Nonna's call to ${call.to} for task ${task.id} (${task.summary}) ended: ${call.status}, ${minutes(call.duration)}.`,
          `Transcript:\n${formatTranscript(call, { agent: "Nonna", user: "Them", transfer_target: "Transferred to" })}`,
          "Update the task from what was actually agreed, and tell the family the outcome in one short message.",
        ].join("\n\n"),
      };
    }
    // Otherwise an escalation call to a family member.
    const elder = await store.findElderByFamilyHandle(call.to);
    if (!elder) return undefined;
    return {
      elderId: elder.id,
      text: [
        `Emergency alert call to family member ${call.to} ended: ${call.status}.`,
        `Transcript:\n${formatTranscript(call, { agent: "Nonna", user: "Family member" })}`,
        "If nobody has confirmed they are with the elder, say so clearly in the family group.",
      ].join("\n\n"),
    };
  }

  return undefined;
}

/** For `call.transcribed` (and failed outbound `call.ended`): fetch the call, tell the team. */
export async function handleCallFinished(deps: CallResultDeps, callId: string) {
  const { call } = (await deps.dial.getCall(callId)) as { call: DialCallRecord };
  const message = await describeCall(deps, call);
  if (!message) {
    deps.log.info("call not linked to an elder", { callId, direction: call.direction });
    return;
  }
  await deps.store.audit({ actor: "dial", action: "call_result", detail: callId });
  await deps.team.postToTeam(message.elderId, message.text);
}
