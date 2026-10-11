import { randomUUID } from "node:crypto";
import { type CircleMember, type Elder, type Task, TaskStatus } from "@nonna/shared";
import { and, asc, desc, eq, gte, inArray, notInArray, or } from "drizzle-orm";
import type { DarwinAgent, DarwinPendingRequest } from "../darwin/types.js";
import type { DarwinRun, FamilyGroup, NewTask, NewTaskStep, Store } from "../store.js";
import type { Db } from "./client.js";
import {
  auditLog,
  circleMembers,
  darwinRuns,
  darwinSearches,
  elders,
  familyGroups,
  inboundEvents,
  taskSteps,
  tasks,
} from "./schema.js";

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

const toGroup = (r: typeof familyGroups.$inferSelect): FamilyGroup => ({
  dialGroupId: r.dialGroupId,
  elderId: r.elderId,
  confirmedAt: r.confirmedAt ?? undefined,
  ombChannelId: r.ombChannelId ?? undefined,
});

const toTask = (r: typeof tasks.$inferSelect): Task => ({
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

type RunRow = typeof darwinRuns.$inferSelect;

const toRun = (r: RunRow): DarwinRun => ({
  id: r.id,
  taskId: r.taskId,
  mode: r.mode,
  searchId: r.searchId ?? undefined,
  agentId: r.agentId,
  capabilityId: r.capabilityId,
  agentName: r.agentName ?? undefined,
  idempotencyKey: r.idempotencyKey,
  status: r.status,
  actRequestId: r.actRequestId ?? undefined,
  threadId: r.threadId ?? undefined,
  pending: (r.pending as DarwinPendingRequest[] | null) ?? [],
  outcome: r.outcome ?? undefined,
  seenMessages: r.seenMessages,
  replies: (r.replies as DarwinRun["replies"] | null) ?? {},
  error: r.error ?? undefined,
});

/** undefined → SQL NULL for optional columns. */
const nulls = (o: object) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v]));

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
    return row ? toGroup(row) : undefined;
  }

  async setFamilyGroupChannel(dialGroupId: string, ombChannelId: string) {
    await this.db
      .update(familyGroups)
      .set({ ombChannelId })
      .where(eq(familyGroups.dialGroupId, dialGroupId));
  }

  async listFamilyGroups(elderId: string) {
    const rows = await this.db.select().from(familyGroups).where(eq(familyGroups.elderId, elderId));
    return rows.map(toGroup);
  }

  async getTask(id: string) {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return row ? toTask(row) : undefined;
  }

  async listOpenTasks(elderId: string) {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.elderId, elderId),
          notInArray(tasks.status, ["closed", "failed", "cancelled"]),
        ),
      );
    return rows.map(toTask);
  }

  async listTasksCreatedSince(elderId: string, since: Date) {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.elderId, elderId), gte(tasks.createdAt, since)));
    return rows.map(toTask);
  }

  async addTaskStep(step: NewTaskStep) {
    await this.db.insert(taskSteps).values({ id: randomUUID(), ...step });
  }

  async findTaskByCallId(dialCallId: string) {
    const [row] = await this.db
      .select({ task: tasks })
      .from(taskSteps)
      .innerJoin(tasks, eq(taskSteps.taskId, tasks.id))
      .where(eq(taskSteps.dialCallId, dialCallId))
      .limit(1);
    return row ? toTask(row.task) : undefined;
  }

  async setTaskStatus(id: string, status: TaskStatus) {
    await this.db.update(tasks).set({ status }).where(eq(tasks.id, id));
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

  async saveDarwinSearch(search: {
    searchId: string;
    taskId?: string | undefined;
    mode: "live" | "proxy";
    agents: DarwinAgent[];
  }) {
    await this.db
      .insert(darwinSearches)
      .values({ ...search, taskId: search.taskId ?? null })
      .onConflictDoNothing();
  }

  async getDarwinSearch(searchId: string) {
    const [row] = await this.db
      .select()
      .from(darwinSearches)
      .where(eq(darwinSearches.searchId, searchId))
      .limit(1);
    return row
      ? { taskId: row.taskId ?? undefined, agents: row.agents as DarwinAgent[] }
      : undefined;
  }

  async createDarwinRun(run: DarwinRun) {
    await this.db.insert(darwinRuns).values({
      id: run.id,
      taskId: run.taskId,
      mode: run.mode,
      searchId: run.searchId ?? null,
      agentId: run.agentId,
      capabilityId: run.capabilityId,
      agentName: run.agentName ?? null,
      idempotencyKey: run.idempotencyKey,
      status: run.status,
      actRequestId: run.actRequestId ?? null,
      threadId: run.threadId ?? null,
      pending: run.pending,
      outcome: run.outcome ?? null,
      seenMessages: run.seenMessages,
      replies: run.replies,
      error: run.error ?? null,
      updatedAt: new Date(),
    });
  }

  async updateDarwinRun(id: string, patch: Partial<Omit<DarwinRun, "id" | "taskId">>) {
    await this.db
      .update(darwinRuns)
      .set({ ...nulls(patch), updatedAt: new Date() })
      .where(eq(darwinRuns.id, id));
    const [row] = await this.db.select().from(darwinRuns).where(eq(darwinRuns.id, id)).limit(1);
    if (!row) throw new Error(`No run ${id}`);
    return toRun(row);
  }

  async latestDarwinRun(taskId: string) {
    const [row] = await this.db
      .select()
      .from(darwinRuns)
      .where(eq(darwinRuns.taskId, taskId))
      .orderBy(desc(darwinRuns.createdAt), desc(darwinRuns.updatedAt))
      .limit(1);
    return row ? toRun(row) : undefined;
  }

  async listActiveDarwinRuns() {
    const rows = await this.db
      .select()
      .from(darwinRuns)
      .where(inArray(darwinRuns.status, ["running", "needs_input", "starting"]));
    return rows.map(toRun);
  }

  async audit(entry: { actor: string; action: string; taskId?: string; detail?: string }) {
    await this.db.insert(auditLog).values(entry);
  }
}
