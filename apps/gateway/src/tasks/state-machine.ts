import type { TaskStatus } from "@nonna/shared";

/** Happy-path transitions. See docs/build-plan.md §5.3. */
const NEXT: Record<TaskStatus, readonly TaskStatus[]> = {
  received: ["triaged"],
  triaged: ["planned"],
  planned: ["awaiting_approval", "executing"],
  awaiting_approval: ["executing"],
  executing: ["waiting_external", "confirmed"],
  waiting_external: ["executing", "confirmed"],
  confirmed: ["elder_notified"],
  elder_notified: ["closed"],
  closed: [],
  failed: [],
  escalated: [],
  cancelled: [],
};

const TERMINAL = new Set<TaskStatus>(["closed", "failed", "escalated", "cancelled"]);
/** Any non-terminal state may jump to one of these. */
const ESCAPES: readonly TaskStatus[] = ["failed", "escalated", "cancelled"];

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL.has(status);
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (isTerminal(from)) return false;
  return NEXT[from].includes(to) || ESCAPES.includes(to);
}

export function transition(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (!canTransition(from, to)) throw new Error(`Invalid task transition ${from} -> ${to}`);
  return to;
}
