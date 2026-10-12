import { randomUUID } from "node:crypto";
import {
  type CircleMember,
  type Elder,
  normalizePhone,
  type Task,
  type TaskKind,
  type TaskStatus,
} from "@nonna/shared";
import type { DarwinAgent, DarwinPendingRequest } from "./darwin/types.js";

export interface NewTask {
  elderId: string;
  kind: TaskKind;
  summary: string;
}

export interface NewTaskStep {
  taskId: string;
  executor: "darwin_act" | "dial_call" | "human";
  status: string;
  dialCallId?: string | undefined;
  darwinSearchId?: string | undefined;
  darwinThreadId?: string | undefined;
  result?: string | undefined;
}

export type DarwinRunStatus =
  | "starting"
  | "running"
  | "needs_input"
  | "needs_review"
  | "unknown"
  | "failed"
  | "completed";

export interface DarwinRun {
  id: string;
  taskId: string;
  mode: "live" | "proxy";
  searchId?: string | undefined;
  agentId: string;
  capabilityId: string;
  agentName?: string | undefined;
  idempotencyKey: string;
  status: DarwinRunStatus;
  actRequestId?: string | undefined;
  threadId?: string | undefined;
  pending: DarwinPendingRequest[];
  outcome?: unknown;
  seenMessages: number;
  replies: Record<string, { text: string; status: "sending" | "sent" | "unknown" }>;
  error?: string | undefined;
}

export interface FamilyGroup {
  dialGroupId: string;
  elderId: string;
  /** Set when a family member replies OK to Nonna's welcome message. */
  confirmedAt?: Date | undefined;
  /** The OpenMausBot channel this family's conversation is relayed to. */
  ombChannelId?: string | undefined;
}

/**
 * Persistence boundary for the gateway. Route handlers depend on this interface only, so tests
 * run against `MemoryStore` and production uses the Drizzle implementation in `db/`.
 */
export interface Store {
  /** Records a webhook event. Returns false if this event id was already seen (duplicate). */
  recordInboundEvent(event: { id: string; type: string; receivedAt: Date }): Promise<boolean>;
  listElders(): Promise<Elder[]>;
  getElder(id: string): Promise<Elder | undefined>;
  findElderByPhone(phone: string): Promise<Elder | undefined>;
  /**
   * Direct iMessages to the family line: which elder does this family member belong to?
   * `handle` is what Dial reports as `from`: an E.164 phone or an Apple ID email.
   */
  findElderByFamilyHandle(handle: string): Promise<Elder | undefined>;
  listCircle(elderId: string): Promise<CircleMember[]>;
  getFamilyGroup(dialGroupId: string): Promise<FamilyGroup | undefined>;
  bindFamilyGroup(dialGroupId: string, elderId: string): Promise<void>;
  confirmFamilyGroup(dialGroupId: string): Promise<void>;
  setFamilyGroupChannel(dialGroupId: string, ombChannelId: string): Promise<void>;
  listFamilyGroups(elderId: string): Promise<FamilyGroup[]>;
  createTask(input: NewTask): Promise<Task>;
  getTask(id: string): Promise<Task | undefined>;
  listOpenTasks(elderId: string): Promise<Task[]>;
  setTaskStatus(id: string, status: TaskStatus): Promise<void>;
  /** Tasks created at or after `since` (e.g. by the voice agent during a call). */
  listTasksCreatedSince(elderId: string, since: Date): Promise<Task[]>;
  addTaskStep(step: NewTaskStep): Promise<void>;
  /** The task a Dial call was placed for, if any. */
  findTaskByCallId(dialCallId: string): Promise<Task | undefined>;
  saveDarwinSearch(search: {
    searchId: string;
    taskId?: string | undefined;
    mode: "live" | "proxy";
    agents: DarwinAgent[];
  }): Promise<void>;
  getDarwinSearch(
    searchId: string,
  ): Promise<{ taskId?: string | undefined; agents: DarwinAgent[] } | undefined>;
  createDarwinRun(run: DarwinRun): Promise<void>;
  updateDarwinRun(id: string, patch: Partial<Omit<DarwinRun, "id" | "taskId">>): Promise<DarwinRun>;
  /** The most recent run for a task. */
  latestDarwinRun(taskId: string): Promise<DarwinRun | undefined>;
  /** Runs the watcher should keep following. */
  listActiveDarwinRuns(): Promise<DarwinRun[]>;
  audit(entry: { actor: string; action: string; taskId?: string; detail?: string }): Promise<void>;
}

const ACTIVE_RUN: ReadonlySet<DarwinRunStatus> = new Set(["running", "needs_input", "starting"]);

export class MemoryStore implements Store {
  readonly events = new Set<string>();
  readonly elders = new Map<string, Elder>();
  readonly circle: CircleMember[] = [];
  readonly groups = new Map<string, FamilyGroup>();
  readonly tasks: Task[] = [];
  readonly taskCreatedAt = new Map<string, Date>();
  readonly steps: NewTaskStep[] = [];
  readonly auditLog: { actor: string; action: string }[] = [];
  readonly searches = new Map<string, { taskId?: string | undefined; agents: DarwinAgent[] }>();
  readonly runs: DarwinRun[] = [];

  async saveDarwinSearch(search: {
    searchId: string;
    taskId?: string | undefined;
    agents: DarwinAgent[];
  }) {
    this.searches.set(search.searchId, { taskId: search.taskId, agents: search.agents });
  }
  async getDarwinSearch(searchId: string) {
    return this.searches.get(searchId);
  }
  async createDarwinRun(run: DarwinRun) {
    if (this.runs.some((r) => r.idempotencyKey === run.idempotencyKey)) {
      throw new Error("duplicate idempotency key");
    }
    this.runs.push(structuredClone(run));
  }
  async updateDarwinRun(id: string, patch: Partial<Omit<DarwinRun, "id" | "taskId">>) {
    const run = this.runs.find((r) => r.id === id);
    if (!run) throw new Error(`No run ${id}`);
    Object.assign(run, structuredClone(patch));
    return structuredClone(run);
  }
  async latestDarwinRun(taskId: string) {
    const run = this.runs.filter((r) => r.taskId === taskId).at(-1);
    return run ? structuredClone(run) : undefined;
  }
  async listActiveDarwinRuns() {
    return this.runs.filter((r) => ACTIVE_RUN.has(r.status)).map((r) => structuredClone(r));
  }

  async recordInboundEvent(event: { id: string }) {
    if (this.events.has(event.id)) return false;
    this.events.add(event.id);
    return true;
  }
  async listElders() {
    return [...this.elders.values()];
  }
  async getElder(id: string) {
    return this.elders.get(id);
  }
  async findElderByPhone(phone: string) {
    const p = normalizePhone(phone);
    return [...this.elders.values()].find((e) => e.phone === p);
  }
  async findElderByFamilyHandle(handle: string) {
    const h = normalizePhone(handle);
    const member = this.circle.find((m) => m.phone === h || m.imessageHandle === h);
    return member ? this.elders.get(member.elderId) : undefined;
  }
  async listCircle(elderId: string) {
    return this.circle.filter((m) => m.elderId === elderId).sort((a, b) => a.priority - b.priority);
  }
  async getFamilyGroup(dialGroupId: string) {
    return this.groups.get(dialGroupId);
  }
  async bindFamilyGroup(dialGroupId: string, elderId: string) {
    if (!this.groups.has(dialGroupId)) this.groups.set(dialGroupId, { dialGroupId, elderId });
  }
  async confirmFamilyGroup(dialGroupId: string) {
    const g = this.groups.get(dialGroupId);
    if (g) g.confirmedAt = new Date();
  }
  async setFamilyGroupChannel(dialGroupId: string, ombChannelId: string) {
    const g = this.groups.get(dialGroupId);
    if (g) g.ombChannelId = ombChannelId;
  }
  async listFamilyGroups(elderId: string) {
    return [...this.groups.values()].filter((g) => g.elderId === elderId);
  }
  async getTask(id: string) {
    return this.tasks.find((t) => t.id === id);
  }
  async listOpenTasks(elderId: string) {
    const done = new Set(["closed", "failed", "cancelled"]);
    return this.tasks.filter((t) => t.elderId === elderId && !done.has(t.status));
  }
  async setTaskStatus(id: string, status: TaskStatus) {
    const t = this.tasks.find((x) => x.id === id);
    if (t) t.status = status;
  }
  async listTasksCreatedSince(elderId: string, since: Date) {
    return this.tasks.filter(
      (t) => t.elderId === elderId && (this.taskCreatedAt.get(t.id) ?? new Date(0)) >= since,
    );
  }
  async addTaskStep(step: NewTaskStep) {
    this.steps.push(step);
  }
  async findTaskByCallId(dialCallId: string) {
    const step = this.steps.find((s) => s.dialCallId === dialCallId);
    return step ? this.tasks.find((t) => t.id === step.taskId) : undefined;
  }
  async createTask(input: NewTask) {
    const task: Task = { id: randomUUID(), status: "received", priority: 0, ...input };
    this.tasks.push(task);
    this.taskCreatedAt.set(task.id, new Date());
    return task;
  }
  async audit(entry: { actor: string; action: string }) {
    this.auditLog.push(entry);
  }
}
