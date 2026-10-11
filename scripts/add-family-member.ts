/**
 * Adds someone to an elder's family circle (local database only; never commit real numbers).
 *
 * Usage (from repo root):
 *   pnpm family:add --name "Anna" [--phone +14155550124] [--imessage anna@icloud.com]
 *     [--relation daughter] [--priority 0] [--can-approve] [--can-pay] [--nearby] [--elder <id>]
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { createDb } from "../apps/gateway/src/db/client.js";
import { circleMembers, elders } from "../apps/gateway/src/db/schema.js";

const { values: a } = parseArgs({
  options: {
    name: { type: "string" },
    phone: { type: "string" },
    imessage: { type: "string" },
    relation: { type: "string", default: "family" },
    priority: { type: "string", default: "0" },
    elder: { type: "string" },
    "can-approve": { type: "boolean", default: false },
    "can-pay": { type: "boolean", default: false },
    nearby: { type: "boolean", default: false },
  },
});

if (!a.name || !(a.phone || a.imessage)) {
  throw new Error('Required: --name "<name>" and --phone <E.164> and/or --imessage <apple id>');
}
if (a.phone && !/^\+[1-9]\d{6,14}$/.test(a.phone)) {
  throw new Error("--phone must be E.164, e.g. +14155550124");
}

const db = createDb(process.env.DATABASE_URL ?? "file:./data/nonna.db");
let elderId = a.elder;
if (!elderId) {
  const all = await db.select({ id: elders.id }).from(elders);
  const [only] = all;
  if (all.length !== 1 || !only) throw new Error(`Found ${all.length} elders; pass --elder <id>`);
  elderId = only.id;
}

await db.insert(circleMembers).values({
  id: randomUUID(),
  elderId,
  name: a.name,
  phone: a.phone ?? null,
  imessageHandle: a.imessage?.toLowerCase() ?? null,
  relation: a.relation,
  priority: Number(a.priority),
  canApprove: a["can-approve"],
  canPay: a["can-pay"],
  isNearby: a.nearby,
});
process.stdout.write(`Added ${a.name} to ${elderId}'s circle.\n`);
