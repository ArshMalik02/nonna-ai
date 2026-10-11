import { randomUUID } from "node:crypto";
import type { CircleMember, Elder, Task, TaskKind } from "@nonna/shared";

export interface NewTask {
  elderId: string;
  kind: TaskKind;
  summary: string;
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
  createTask(input: NewTask): Promise<Task>;
  audit(entry: { actor: string; action: string; taskId?: string; detail?: string }): Promise<void>;
}

export class MemoryStore implements Store {
  readonly events = new Set<string>();
  readonly elders = new Map<string, Elder>();
  readonly circle: CircleMember[] = [];
  readonly groups = new Map<string, string>();
  readonly tasks: Task[] = [];
  readonly auditLog: { actor: string; action: string }[] = [];

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
  async createTask(input: NewTask) {
    const task: Task = { id: randomUUID(), status: "received", priority: 0, ...input };
    this.tasks.push(task);
    return task;
  }
  async audit(entry: { actor: string; action: string }) {
    this.auditLog.push(entry);
  }
}
