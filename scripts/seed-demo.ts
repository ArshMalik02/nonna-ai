/**
 * Seeds a FAKE elder and family for local demos. Never put real people or health data here.
 * Usage: pnpm db:migrate && pnpm seed
 *
 * To link a real family iMessage group to an OMB channel for a demo, also set
 * DEMO_DIAL_GROUP_ID (from `dial` / GET /v1/groups) and DEMO_OMB_CHANNEL_ID (from the OMB app).
 */
import { createDb } from "../apps/gateway/src/db/client.js";
import { circleMembers, elders, familyGroups } from "../apps/gateway/src/db/schema.js";

const db = createDb(process.env.DATABASE_URL ?? "file:./data/nonna.db");

await db
  .insert(elders)
  .values({
    id: "elder_demo",
    name: "Mary Lee",
    phone: "+14155550123",
    address: "123 Demo St, Berkeley, CA",
    preferences: "Prefers morning appointments. Uses a walker.",
  })
  .onConflictDoNothing();

await db
  .insert(circleMembers)
  .values([
    {
      id: "member_daughter",
      elderId: "elder_demo",
      name: "Anna Lee",
      phone: "+14155550124",
      relation: "daughter",
      priority: 0,
      canApprove: true,
      canPay: true,
    },
    {
      id: "member_neighbor",
      elderId: "elder_demo",
      name: "Sam Ortiz",
      phone: "+14155550125",
      relation: "neighbor",
      priority: 1,
      isNearby: true,
    },
  ])
  .onConflictDoNothing();

const groupId = process.env.DEMO_DIAL_GROUP_ID;
const channelId = process.env.DEMO_OMB_CHANNEL_ID;
if (groupId) {
  await db
    .insert(familyGroups)
    .values({ dialGroupId: groupId, elderId: "elder_demo", ombChannelId: channelId ?? null })
    .onConflictDoUpdate({
      target: familyGroups.dialGroupId,
      set: { ombChannelId: channelId ?? null },
    });
  process.stdout.write(`Linked group ${groupId} to OMB channel ${channelId ?? "(none)"}.\n`);
}

process.stdout.write("Seeded demo elder and family.\n");
