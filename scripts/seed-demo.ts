/**
 * Seeds a FAKE demo elder. Never put real people or health data here.
 * Add family with `pnpm family:add` (stored only in your local database).
 * Usage: pnpm db:migrate && pnpm seed
 */
import { createDb } from "../apps/gateway/src/db/client.js";
import { elders } from "../apps/gateway/src/db/schema.js";

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

process.stdout.write("Seeded demo elder.\n");
