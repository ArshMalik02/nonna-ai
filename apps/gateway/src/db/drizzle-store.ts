import { randomUUID } from "node:crypto";
import type { CircleMember, Elder, Task } from "@nonna/shared";
import { asc, eq } from "drizzle-orm";
import type { NewTask, Store } from "../store.js";
import type { Db } from "./client.js";
import { auditLog, circleMembers, elders, familyGroups, inboundEvents, tasks } from "./schema.js";

type ElderRow = typeof elders.$inferSelect;

const toElder = (r: ElderRow): Elder => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  timezone: r.timezone,
  language: r.language,
  ...(r.address ? { address: r.address } : {}),
  ...(r.preferences ? { preferences: r.preferences } : {}),
  ...(r.careNotes ? { careNotes: r.careNotes } : {}),
  ...(r.consentAt ? { consentAt: r.consentAt.toISOString() } : {}),
});

export class DrizzleStore implements Store {
  constructor(private readonly db: Db) {}

  async recordInboundEvent(event: { id: string; type: string; receivedAt: Date }) {
    const inserted = await this.db
      .insert(inboundEvents)
      .values({ dialEventId: event.id, type: event.type, receivedAt: event.receivedAt })
      .onConflictDoNothing()
      .returning({ id: inboundEvents.dialEventId });
    return inserted.length > 0;
  }

  async findElderByPhone(phone: string) {
    const [row] = await this.db.select().from(elders).where(eq(elders.phone, phone)).limit(1);
    return row ? toElder(row) : undefined;
  }

  async findElderByGroupId(groupId: string) {
    const [row] = await this.db
      .select({ elder: elders })
      .from(familyGroups)
      .innerJoin(elders, eq(familyGroups.elderId, elders.id))
      .where(eq(familyGroups.dialGroupId, groupId))
      .limit(1);
    return row ? toElder(row.elder) : undefined;
  }

  async getElder(id: string) {
    const [row] = await this.db.select().from(elders).where(eq(elders.id, id)).limit(1);
    return row ? toElder(row) : undefined;
  }

  async listCircle(elderId: string): Promise<CircleMember[]> {
    return this.db
      .select()
      .from(circleMembers)
      .where(eq(circleMembers.elderId, elderId))
      .orderBy(asc(circleMembers.priority));
  }

  async createTask(input: NewTask): Promise<Task> {
    const task: Task = { id: randomUUID(), status: "received", priority: 0, ...input };
    await this.db.insert(tasks).values({
      id: task.id,
      elderId: task.elderId,
      kind: task.kind,
      status: task.status,
      summary: task.summary,
    });
    return task;
  }

  async audit(entry: { actor: string; action: string; taskId?: string; detail?: string }) {
    await this.db.insert(auditLog).values(entry);
  }
}
