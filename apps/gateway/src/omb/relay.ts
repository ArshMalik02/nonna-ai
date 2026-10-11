import type { Task } from "@nonna/shared";
import type { Logger } from "../logger.js";
import type { Store } from "../store.js";
import type { OmbClient } from "./client.js";

/**
 * Hands work from the gateway to the Nonna team in the family's OMB channel (docs/build-plan.md
 * §7, Flow B step 3). Both methods are fire-and-forget: webhooks and live-call tools must answer
 * fast, so they never wait on OMB. Message bodies go to OMB (the agent runtime) but never into
 * our logs.
 */
export interface OmbRelay {
  /** A family member or the elder wrote to Nonna (non-emergency). */
  forwardMessage(args: { elderId: string; from: string; body: string }): void;
  /** A new task exists (e.g. created by the voice agent during a call). */
  announceTask(task: Task): void;
}

export interface OmbRelayDeps {
  store: Store;
  omb: Pick<OmbClient, "postToChannel">;
  log: Logger;
}

export function createOmbRelay(deps: OmbRelayDeps): OmbRelay {
  const { store, omb, log } = deps;

  async function channelFor(elderId: string) {
    const group = await store.getFamilyGroup(elderId);
    if (!group?.ombChannelId) {
      log.warn("no OMB channel linked for elder", { elderId });
      return undefined;
    }
    return group.ombChannelId;
  }

  async function senderLabel(elderId: string, from: string) {
    const elder = await store.getElder(elderId);
    if (elder?.phone === from) return `${elder.name} (the elder)`;
    const member = (await store.listCircle(elderId)).find((m) => m.phone === from);
    return member ? `${member.name} (${member.relation})` : "an unknown member of the group";
  }

  function run(what: string, elderId: string, job: () => Promise<void>) {
    job().catch((err: unknown) =>
      log.error("OMB relay failed", { what, elderId, error: String(err) }),
    );
  }

  return {
    forwardMessage({ elderId, from, body }) {
      run("forwardMessage", elderId, async () => {
        const channelId = await channelFor(elderId);
        if (!channelId) return;
        const sender = await senderLabel(elderId, from);
        await omb.postToChannel(
          channelId,
          `New message for elder ${elderId} from ${sender}:\n\n${body}`,
        );
        await store.audit({ actor: "gateway", action: "omb_forward_message" });
      });
    },

    announceTask(task) {
      run("announceTask", task.elderId, async () => {
        const channelId = await channelFor(task.elderId);
        if (!channelId) return;
        await omb.postToChannel(
          channelId,
          `New task ${task.id} for elder ${task.elderId} (kind: ${task.kind}, status: ${task.status}).\n\n${task.summary}\n\nNonna: plan it, delegate to the right specialist and keep the family posted.`,
        );
        await store.audit({ actor: "gateway", action: "omb_announce_task", taskId: task.id });
      });
    },
  };
}
