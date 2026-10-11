import { randomUUID } from "node:crypto";
import type { Approval, CircleMember, Elder, Task, TaskKind, TaskStatus } from "@nonna/shared";

export interface NewTask {
  elderId: string;
  kind: TaskKind;
  summary: string;
}

export interface FamilyGroup {
  dialGroupId: string;
  elderId: string;
  ombChannelId?: string | undefined;
}

export interface NewApproval {
  taskId: string;
  askedMemberId: string;
  question: string;
  expiresAt: Date;
}

export interface Reminder {
  id: string;
  taskId: string;
  fireAt: string;
  channel: "imessage" | "call";
  text: string;
  status: "pending" | "sent" | "cancelled";
}

export interface NewReminder {
  taskId: string;
  fireAt: Date;
  channel: Reminder["channel"];
  text: string;
}

/**
 * Persistence boundary for the gateway. Route handlers depend on this interface only, so tests
 * run against `MemoryStore` and production uses the Drizzle implementation in `db/`.
 */
export interface Store {
  /** Records a webhook event. Returns false if this event id was already seen (duplicate). */
  recordInboundEvent(event: { id: string; type: string; receivedAt: Date }): Promise<boolean>;
  findElderByPhone(phone: string): Promise<Elder | undefined>;
  findElderByGroupId(groupId: string): Promise<Elder | undefined>;
  getElder(id: string): Promise<Elder | undefined>;
  listCircle(elderId: string): Promise<CircleMember[]>;
  /** The family iMessage group bound to this elder, with its OMB channel if one is linked. */
  getFamilyGroup(elderId: string): Promise<FamilyGroup | undefined>;
  createTask(input: NewTask): Promise<Task>;
  getTask(id: string): Promise<Task | undefined>;
  /** Persists a status the caller already validated with `tasks/state-machine.ts`. */
  setTaskStatus(id: string, status: TaskStatus): Promise<void>;
  createApproval(input: NewApproval): Promise<Approval>;
  createReminder(input: NewReminder): Promise<Reminder>;
  audit(entry: { actor: string; action: string; taskId?: string; detail?: string }): Promise<void>;
}

export class MemoryStore implements Store {
  readonly events = new Set<string>();
  readonly elders = new Map<string, Elder>();
  readonly circle: CircleMember[] = [];
  /** Dial group id -> elder id. */
  readonly groups = new Map<string, string>();
  /** Dial group id -> OMB channel id. */
  readonly ombChannels = new Map<string, string>();
  readonly tasks: Task[] = [];
  readonly approvals: Approval[] = [];
  readonly reminders: Reminder[] = [];
  readonly auditLog: { actor: string; action: string; taskId?: string; detail?: string }[] = [];

  async recordInboundEvent(event: { id: string }) {
    if (this.events.has(event.id)) return false;
    this.events.add(event.id);
    return true;
  }
  async findElderByPhone(phone: string) {
    return [...this.elders.values()].find((e) => e.phone === phone);
  }
  async findElderByGroupId(groupId: string) {
    const elderId = this.groups.get(groupId);
    return elderId ? this.elders.get(elderId) : undefined;
  }
  async getElder(id: string) {
    return this.elders.get(id);
  }
  async listCircle(elderId: string) {
    return this.circle.filter((m) => m.elderId === elderId).sort((a, b) => a.priority - b.priority);
  }
  async getFamilyGroup(elderId: string) {
    for (const [dialGroupId, owner] of this.groups) {
      if (owner === elderId) {
        return { dialGroupId, elderId, ombChannelId: this.ombChannels.get(dialGroupId) };
      }
    }
    return undefined;
  }
  async createTask(input: NewTask) {
    const task: Task = { id: randomUUID(), status: "received", priority: 0, ...input };
    this.tasks.push(task);
    return task;
  }
  async getTask(id: string) {
    return this.tasks.find((t) => t.id === id);
  }
  async setTaskStatus(id: string, status: TaskStatus) {
    const task = this.tasks.find((t) => t.id === id);
    if (task) task.status = status;
  }
  async createApproval(input: NewApproval) {
    const approval: Approval = {
      id: randomUUID(),
      taskId: input.taskId,
      askedMemberId: input.askedMemberId,
      question: input.question,
      expiresAt: input.expiresAt.toISOString(),
    };
    this.approvals.push(approval);
    return approval;
  }
  async createReminder(input: NewReminder) {
    const reminder: Reminder = {
      id: randomUUID(),
      taskId: input.taskId,
      fireAt: input.fireAt.toISOString(),
      channel: input.channel,
      text: input.text,
      status: "pending",
    };
    this.reminders.push(reminder);
    return reminder;
  }
  async audit(entry: { actor: string; action: string; taskId?: string; detail?: string }) {
    this.auditLog.push(entry);
  }
}
