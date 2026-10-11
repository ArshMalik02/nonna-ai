import type { DialClient } from "../dial/client.js";
import type { InboundMessage } from "../dial/webhook.js";
import { handleFamilyGroupMessage } from "../family/onboarding.js";
import type { Logger } from "../logger.js";
import type { Store } from "../store.js";
import type { OmbClient } from "./client.js";
import { ChannelRelay } from "./relay.js";

/** The name the gateway's tools are registered under in OpenMausBot (see scripts/setup-omb.ts). */
export const NONNA_MCP_SERVER = "nonna";

export interface BridgeDeps {
  store: Store;
  dial: Pick<DialClient, "sendMessage" | "setTyping" | "listGroups">;
  omb: Pick<OmbClient, "getChannel" | "postToChannel" | "threadMessages" | "respond">;
  log: Logger;
  pollMs?: number;
}

/**
 * Routes elder and family messages into the elder's OpenMausBot channel, and relays the team's
 * replies back to the family iMessage group. One relay per channel.
 */
export function createTeamBridge(deps: BridgeDeps) {
  const relays = new Map<string, ChannelRelay>();

  async function senderLabel(msg: InboundMessage) {
    if (msg.source === "elder") return "The elder texted Nonna";
    const member = (await deps.store.listCircle(msg.elderId)).find(
      (m) => m.phone === msg.from || m.imessageHandle === msg.from.toLowerCase(),
    );
    const who = member ? `${member.name} (${member.relation})` : "A family member";
    return msg.source === "family_group" ? `${who} in the family group` : `${who}, privately`;
  }

  return async function handle(msg: InboundMessage) {
    if (msg.source === "family_group" && msg.groupId) {
      const onboarding = await handleFamilyGroupMessage(deps, {
        groupId: msg.groupId,
        elderId: msg.elderId,
        body: msg.body,
      });
      if (onboarding) return;
    }

    // Replies always go to the family group, whoever wrote in.
    const group = msg.groupId
      ? await deps.store.getFamilyGroup(msg.groupId)
      : (await deps.store.listFamilyGroups(msg.elderId)).find((g) => g.ombChannelId);
    if (!group?.ombChannelId) {
      deps.log.warn("no team channel for message", { elderId: msg.elderId, source: msg.source });
      return;
    }

    let relay = relays.get(group.ombChannelId);
    if (!relay) {
      const groupId = group.dialGroupId;
      relay = new ChannelRelay(group.ombChannelId, {
        omb: deps.omb,
        log: deps.log,
        ...(deps.pollMs ? { pollMs: deps.pollMs } : {}),
        deliver: (text) => deps.dial.sendMessage({ groupId, body: text }),
        autoApproveTool: (tool) => tool.startsWith(`mcp__${NONNA_MCP_SERVER}__`),
      });
      relays.set(group.ombChannelId, relay);
    }

    const note = msg.escalated
      ? "\n\n[Gateway: this was flagged as a possible emergency. The family group has already been alerted and family members are being called. Do not repeat the alert; follow up calmly.]"
      : "";
    const text = `${await senderLabel(msg)}:\n${msg.body}${note}`;

    await deps.dial.setTyping({ groupId: group.dialGroupId, value: true }).catch(() => undefined);
    await relay.send(text);
  };
}
