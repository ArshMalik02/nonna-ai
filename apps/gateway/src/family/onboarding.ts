import { parseApprovalReply } from "../approvals/parse.js";
import type { DialClient } from "../dial/client.js";
import type { Logger } from "../logger.js";
import type { Store } from "../store.js";

export interface OnboardingDeps {
  dial: Pick<DialClient, "listGroups" | "sendMessage">;
  store: Store;
  log: Logger;
}

export const welcomeMessage = (elderName: string) =>
  `Hi, I'm Nonna 👋 I help look after ${elderName}. I'll post updates here about rides, appointments, bills and anything urgent. Reply OK so I know this is the right group.`;

export const confirmedMessage = (elderName: string) =>
  `Thanks! This group is now ${elderName}'s family circle. If ${elderName} ever needs urgent help, I'll alert everyone here right away.`;

/**
 * Dial cannot create or join groups, and there is no join event: a family member creates the
 * iMessage group and adds the family line. We find new groups by polling GET /groups (and right
 * away when a message arrives from a group we don't know), then bind each to its elder.
 *
 * With exactly one elder on file, a new group is bound to them. With several, binding needs a
 * human (TODO: ask in the group which elder it is for).
 */
export async function discoverGroups({ dial, store, log }: OnboardingDeps) {
  const { groups } = await dial.listGroups();
  for (const group of groups) {
    if (group.channel !== "imessage") continue;
    if (await store.getFamilyGroup(group.id)) continue;

    const elders = await store.listElders();
    const [elder] = elders;
    if (elders.length !== 1 || !elder) {
      log.warn("new family group needs manual binding", {
        groupId: group.id,
        elders: elders.length,
      });
      continue;
    }

    await store.bindFamilyGroup(group.id, elder.id);
    await store.audit({ actor: "onboarding", action: "group_bound", detail: group.id });
    await dial.sendMessage({ groupId: group.id, body: welcomeMessage(elder.name) });
    log.info("family group bound", { groupId: group.id, elderId: elder.id });
  }
}

/**
 * Handles a message in a family group that has not confirmed yet. Returns true when the message
 * was part of onboarding (so it should not go on to the team).
 */
export async function handleFamilyGroupMessage(
  { dial, store, log }: OnboardingDeps,
  msg: { groupId: string; elderId: string; body: string },
): Promise<boolean> {
  const group = await store.getFamilyGroup(msg.groupId);
  if (!group || group.confirmedAt) return false;
  if (parseApprovalReply(msg.body) !== "yes") return true;

  const elder = await store.getElder(msg.elderId);
  await store.confirmFamilyGroup(msg.groupId);
  await store.audit({ actor: "onboarding", action: "group_confirmed", detail: msg.groupId });
  await dial.sendMessage({
    groupId: msg.groupId,
    body: confirmedMessage(elder?.name ?? "your family member"),
  });
  log.info("family group confirmed", { groupId: msg.groupId });
  return true;
}
