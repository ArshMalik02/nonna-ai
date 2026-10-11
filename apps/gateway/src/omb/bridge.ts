import type { DialClient } from "../dial/client.js";
import type { DialLines } from "../dial/lines.js";
import type { InboundMessage } from "../dial/webhook.js";
import { handleFamilyGroupMessage } from "../family/onboarding.js";
import type { Logger } from "../logger.js";
import type { Store } from "../store.js";
import type { OmbClient } from "./client.js";
import { ChannelRelay } from "./relay.js";

/** The name the gateway's tools are registered under in OpenMausBot (see scripts/setup-omb.ts). */
export const NONNA_MCP_SERVER = "nonna";

/** OpenMausBot's own tools for handing work to teammates (Nonna -> Rides, Appointments). */
const TEAM_TOOLS = /(^|__)(coordinate_bots|ask_bot|delegate_bot)$/;

/**
 * Permission cards in the family channel that the gateway answers itself: Nonna's own MCP tools,
 * and handing work to the specialists. Anything else (shell, files, other servers) waits for a
 * person in the OpenMausBot UI.
 */
export function isAutoApprovedTool(tool: string): boolean {
  return tool.startsWith(`mcp__${NONNA_MCP_SERVER}__`) || TEAM_TOOLS.test(tool);
}

export interface BridgeDeps {
  store: Store;
  dial: Pick<DialClient, "sendMessage" | "setTyping" | "listGroups">;
  omb: Pick<OmbClient, "getChannel" | "postToChannel" | "threadMessages" | "respond">;
  lines: DialLines;
  log: Logger;
  pollMs?: number;
  /** How long to keep relaying after the channel goes quiet (see ChannelRelay). */
  lingerMs?: number;
  /** Switches engines when the model account runs out of usage (see failover.ts). */
  onUsageLimit?: (channelId: string) => Promise<boolean>;
}

export interface TeamBridge {
  /** An elder or family message from Dial. */
  handle(msg: InboundMessage): Promise<void>;
  /** Anything else the team should know about, e.g. a call transcript. */
  postToTeam(elderId: string, text: string): Promise<void>;
}

/**
 * Routes elder and family messages into the elder's OpenMausBot channel, and relays the team's
 * replies back: always to the family iMessage group, and also to the elder by SMS (from the
 * elder line) when the elder is the one who wrote in.
 */
export function createTeamBridge(deps: BridgeDeps): TeamBridge {
  const relays = new Map<string, ChannelRelay>();

  async function senderLabel(msg: InboundMessage) {
    if (msg.source === "elder")
      return "The elder texted Nonna (your reply goes to the elder and the family group)";
    const member = (await deps.store.listCircle(msg.elderId)).find(
      (m) => m.phone === msg.from || m.imessageHandle === msg.from.toLowerCase(),
    );
    const who = member ? `${member.name} (${member.relation})` : "A family member";
    return msg.source === "family_group" ? `${who} in the family group` : `${who}, privately`;
  }

  async function send(elderId: string, text: string, alsoTo: readonly string[], groupId?: string) {
    // Replies always go to the family group, whoever wrote in.
    const group = groupId
      ? await deps.store.getFamilyGroup(groupId)
      : (await deps.store.listFamilyGroups(elderId)).find((g) => g.ombChannelId);
    if (!group?.ombChannelId) {
      deps.log.warn("no team channel for elder", { elderId });
      return;
    }

    let relay = relays.get(group.ombChannelId);
    if (!relay) {
      const dialGroupId = group.dialGroupId;
      const channelId = group.ombChannelId;
      relay = new ChannelRelay(group.ombChannelId, {
        omb: deps.omb,
        log: deps.log,
        ...(deps.pollMs ? { pollMs: deps.pollMs } : {}),
        // Specialists report back minutes later (a cab company call takes a while); keep relaying
        // Nonna's follow-up to the family until the channel has been quiet this long.
        lingerMs: deps.lingerMs ?? 10 * 60_000,
        maxTurnMs: 30 * 60_000,
        deliver: async (reply, extra) => {
          await deps.dial.sendMessage({ groupId: dialGroupId, body: reply });
          for (const to of extra) {
            await deps.dial.sendMessage({ to, fromNumber: deps.lines.elder, body: reply });
          }
        },
        autoApproveTool: isAutoApprovedTool,
        ...(deps.onUsageLimit
          ? { onUsageLimit: () => deps.onUsageLimit?.(channelId) ?? Promise.resolve(false) }
          : {}),
      });
      relays.set(group.ombChannelId, relay);
    }

    await deps.dial.setTyping({ groupId: group.dialGroupId, value: true }).catch(() => undefined);
    await relay.send(text, { alsoTo });
  }

  return {
    async handle(msg) {
      if (msg.source === "family_group" && msg.groupId) {
        const onboarding = await handleFamilyGroupMessage(deps, {
          groupId: msg.groupId,
          elderId: msg.elderId,
          body: msg.body,
        });
        if (onboarding) return;
      }
      const note = msg.escalated
        ? "\n\n[Gateway: this was flagged as a possible emergency. The family group has already been alerted and family members are being called. Do not repeat the alert; follow up calmly.]"
        : "";
      const text = `${await senderLabel(msg)}:\n${msg.body}${note}`;
      const elder = msg.source === "elder" ? await deps.store.getElder(msg.elderId) : undefined;
      await send(msg.elderId, text, elder ? [elder.phone] : [], msg.groupId);
    },

    postToTeam: (elderId, text) => send(elderId, text, []),
  };
}
