import { randomUUID } from "node:crypto";
import type { CircleMember, Elder, Task } from "@nonna/shared";
import { asc, eq, or } from "drizzle-orm";
import type { FamilyGroup, NewTask, Store } from "../store.js";
import type { Db } from "./client.js";
import { auditLog, circleMembers, elders, familyGroups, inboundEvents, tasks } from "./schema.js";

type ElderRow = typeof elders.$inferSelect;
type MemberRow = typeof circleMembers.$inferSelect;

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

const toMember = ({ imessageHandle, phone, ...r }: MemberRow): CircleMember => ({
  ...r,
  ...(phone ? { phone } : {}),
  ...(imessageHandle ? { imessageHandle } : {}),
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

  async listElders() {
    return (await this.db.select().from(elders)).map(toElder);
  }

  async getElder(id: string) {
    const [row] = await this.db.select().from(elders).where(eq(elders.id, id)).limit(1);
    return row ? toElder(row) : undefined;
  }

  async findElderByPhone(phone: string) {
    const [row] = await this.db.select().from(elders).where(eq(elders.phone, phone)).limit(1);
    return row ? toElder(row) : undefined;
  }

  async findElderByFamilyHandle(handle: string) {
    const [row] = await this.db
      .select({ elder: elders })
      .from(circleMembers)
      .innerJoin(elders, eq(circleMembers.elderId, elders.id))
      .where(
        or(eq(circleMembers.phone, handle), eq(circleMembers.imessageHandle, handle.toLowerCase())),
      )
      .limit(1);
    return row ? toElder(row.elder) : undefined;
  }

  async listCircle(elderId: string) {
    const rows = await this.db
      .select()
      .from(circleMembers)
      .where(eq(circleMembers.elderId, elderId))
      .orderBy(asc(circleMembers.priority));
    return rows.map(toMember);
  }

  async getFamilyGroup(dialGroupId: string): Promise<FamilyGroup | undefined> {
    const [row] = await this.db
      .select()
      .from(familyGroups)
      .where(eq(familyGroups.dialGroupId, dialGroupId))
      .limit(1);
    return row
      ? {
          dialGroupId: row.dialGroupId,
          elderId: row.elderId,
          confirmedAt: row.confirmedAt ?? undefined,
        }
      : undefined;
  }

  async bindFamilyGroup(dialGroupId: string, elderId: string) {
    await this.db.insert(familyGroups).values({ dialGroupId, elderId }).onConflictDoNothing();
  }

  async confirmFamilyGroup(dialGroupId: string) {
    await this.db
      .update(familyGroups)
      .set({ confirmedAt: new Date() })
      .where(eq(familyGroups.dialGroupId, dialGroupId));
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
