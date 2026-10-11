/**
 * Seeds a FAKE elder and family for local demos. Never put real people or health data here.
 * Usage: pnpm db:migrate && pnpm seed
 */
import { createDb } from "../apps/gateway/src/db/client.js";
import { circleMembers, elders } from "../apps/gateway/src/db/schema.js";

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

process.stdout.write("Seeded demo elder and family.\n");
