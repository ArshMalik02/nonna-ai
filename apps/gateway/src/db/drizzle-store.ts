import { randomUUID } from "node:crypto";
import { type Approval, type CircleMember, type Elder, type Task, TaskStatus } from "@nonna/shared";
import { asc, eq } from "drizzle-orm";
import type { NewApproval, NewReminder, NewTask, Reminder, Store } from "../store.js";
import type { Db } from "./client.js";
import {
  approvals,
  auditLog,
  circleMembers,
  elders,
  familyGroups,
  inboundEvents,
  reminders,
  tasks,
} from "./schema.js";

type ElderRow = typeof elders.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

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

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  elderId: r.elderId,
  kind: r.kind,
  status: TaskStatus.parse(r.status),
  summary: r.summary,
  priority: r.priority,
  ...(r.ownerBot ? { ownerBot: r.ownerBot } : {}),
  ...(r.dueAt ? { dueAt: r.dueAt.toISOString() } : {}),
  ...(r.ombThreadId ? { ombThreadId: r.ombThreadId } : {}),
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

  async getFamilyGroup(elderId: string) {
    const [row] = await this.db
      .select()
      .from(familyGroups)
      .where(eq(familyGroups.elderId, elderId))
      .limit(1);
    if (!row) return undefined;
    return {
      dialGroupId: row.dialGroupId,
      elderId: row.elderId,
      ombChannelId: row.ombChannelId ?? undefined,
    };
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

  async getTask(id: string) {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return row ? toTask(row) : undefined;
  }

  async setTaskStatus(id: string, status: TaskStatus) {
    await this.db.update(tasks).set({ status }).where(eq(tasks.id, id));
  }

  async createApproval(input: NewApproval): Promise<Approval> {
    const id = randomUUID();
    await this.db.insert(approvals).values({ id, ...input });
    return {
      id,
      taskId: input.taskId,
      askedMemberId: input.askedMemberId,
      question: input.question,
      expiresAt: input.expiresAt.toISOString(),
    };
  }

  async createReminder(input: NewReminder): Promise<Reminder> {
    const id = randomUUID();
    await this.db.insert(reminders).values({ id, ...input, status: "pending" });
    return {
      id,
      taskId: input.taskId,
      fireAt: input.fireAt.toISOString(),
      channel: input.channel,
      text: input.text,
      status: "pending",
    };
  }

  async audit(entry: { actor: string; action: string; taskId?: string; detail?: string }) {
    await this.db.insert(auditLog).values(entry);
  }
}
