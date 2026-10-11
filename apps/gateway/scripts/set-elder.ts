/**
 * Registers the real elder: updates the elder record in place (local database only), keeping
 * their family group, family circle and tasks linked. `--phone` is the elder's OWN phone, the
 * number they text and call Nonna from — not Nonna's elder line.
 *
 * Usage (from repo root):
 *   pnpm elder:set --name "Rosa" --phone +14155550123 [--address "..."] [--language en]
 *     [--timezone America/Los_Angeles] [--preferences "..."] [--care-notes "..."] [--id <elder id>]
 * Then re-run `pnpm omb:setup` so the team channel uses the new name.
 */
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client.js";
import { elders } from "../src/db/schema.js";

const { values: a } = parseArgs({
  options: {
    id: { type: "string" },
    name: { type: "string" },
    phone: { type: "string" },
    address: { type: "string" },
    language: { type: "string" },
    timezone: { type: "string" },
    preferences: { type: "string" },
    "care-notes": { type: "string" },
  },
});

if (a.phone && !/^\+[1-9]\d{6,14}$/.test(a.phone)) {
  throw new Error("--phone must be E.164, e.g. +14155550123");
}
const lines = [process.env.DIAL_ELDER_NUMBER, process.env.DIAL_FAMILY_NUMBER];
if (a.phone && lines.includes(a.phone)) {
  throw new Error("That is one of Nonna's own Dial numbers. Use the elder's personal phone.");
}

const db = createDb(process.env.DATABASE_URL ?? "file:./data/nonna.db");
const all = await db.select().from(elders);
const elder = a.id ? all.find((e) => e.id === a.id) : all.length === 1 ? all[0] : undefined;
if (!elder) throw new Error(`Found ${all.length} elders; pass --id <elder id>`);

const update = {
  ...(a.name ? { name: a.name } : {}),
  ...(a.phone ? { phone: a.phone } : {}),
  ...(a.address !== undefined ? { address: a.address } : {}),
  ...(a.language ? { language: a.language } : {}),
  ...(a.timezone ? { timezone: a.timezone } : {}),
  ...(a.preferences !== undefined ? { preferences: a.preferences } : {}),
  ...(a["care-notes"] !== undefined ? { careNotes: a["care-notes"] } : {}),
  consentAt: new Date(),
};
await db.update(elders).set(update).where(eq(elders.id, elder.id));
process.stdout.write(`Updated elder ${elder.id}: ${Object.keys(update).join(", ")}\n`);
