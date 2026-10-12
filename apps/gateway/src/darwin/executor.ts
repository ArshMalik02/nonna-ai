import { randomUUID } from "node:crypto";
import type { Logger } from "../logger.js";
import type { DarwinRun, DarwinRunStatus, Store } from "../store.js";
import { DarwinHttpError } from "./client.js";
import type { DarwinService } from "./service.js";
import type {
  DarwinActRequest,
  DarwinPendingRequest,
  DarwinSearchResult,
  DarwinThreadMessage,
} from "./types.js";

export interface ExecutorDeps {
  darwin: DarwinService;
  store: Store;
  log: Logger;
}

/** A refusal the bot should read and act on (not a crash). */
export class ExecutorRefusal extends Error {}

const TERMINAL: ReadonlySet<DarwinRunStatus> = new Set(["completed", "failed"]);
const UNANSWERED = new Set([undefined, "pending", "awaiting_confirmation", "open"]);

/**
 * Executes tasks through Darwin Act, safely:
 *  - Only agents a real search returned can be started (ids copied, never invented).
 *  - The run and its idempotency key are saved BEFORE the outbound call.
 *  - One run per task. An uncertain start ("unknown") is never retried or rerouted to another
 *    agent, so a booking or payment can't be made twice. Only a definite failure allows a new run.
 *  - Only text questions can be answered with text. Approval, sign-in and payment requests go
 *    to a person through Darwin's hosted flow.
 *  - "Completed" comes only from a completion confirmation in the thread state. The act
 *    request's own `completed` status only means the hand-off finished.
 */
export function createDarwinExecutor({ darwin, store, log }: ExecutorDeps) {
  async function search(input: {
    query: string;
    context?: string | undefined;
    taskId?: string | undefined;
  }) {
    const result = await darwin.search({ ...input, maxResults: 5 });
    const agents = result.response?.agents ?? [];
    if (result.searchId && agents.length > 0) {
      await store.saveDarwinSearch({
        searchId: result.searchId,
        taskId: input.taskId,
        // In auto mode a search may have been answered by the proxy.
        mode: result.mode === "proxy" ? "proxy" : darwin.mode,
        agents,
      });
    }
    return result;
  }

  async function start(input: {
    taskId: string;
    searchId: string;
    agentId: string;
    capabilityId?: string | undefined;
    brief: string;
  }): Promise<DarwinRun> {
    const task = await store.getTask(input.taskId);
    if (!task) throw new ExecutorRefusal(`No task ${input.taskId}.`);

    const existing = await store.latestDarwinRun(input.taskId);
    if (existing && existing.status !== "failed") {
      // Never start a second agent for the same task (it could book or pay twice).
      return existing;
    }

    const search = await store.getDarwinSearch(input.searchId);
    if (!search)
      throw new ExecutorRefusal("Unknown searchId. Run darwin_search first and use its searchId.");
    const matches = search.agents.filter(
      (a) =>
        a.agentId === input.agentId &&
        (!input.capabilityId || a.capabilityId === input.capabilityId),
    );
    if (matches.length !== 1) {
      throw new ExecutorRefusal(
        "agentId/capabilityId must match exactly one agent from that search.",
      );
    }
    const [agent] = matches;
    if (agent?.canStartThread !== true) {
      throw new ExecutorRefusal(
        "That agent can't be started through Darwin Act. Use dial_call_business instead.",
      );
    }

    const run: DarwinRun = {
      id: randomUUID(),
      taskId: input.taskId,
      mode: darwin.modeOf?.(agent.agentId) ?? darwin.mode,
      searchId: input.searchId,
      agentId: agent.agentId,
      capabilityId: agent.capabilityId,
      agentName: typeof agent.name === "string" ? agent.name : undefined,
      idempotencyKey: randomUUID(),
      status: "starting",
      pending: [],
      seenMessages: 0,
      replies: {},
    };
    await store.createDarwinRun(run); // committed before the outbound call
    await store.audit({
      actor: "darwin",
      action: `act_start_${darwin.mode}`,
      taskId: input.taskId,
      detail: run.id,
    });

    try {
      const receipt = await darwin.start({
        agentId: run.agentId,
        capabilityId: run.capabilityId,
        searchId: run.searchId,
        brief: input.brief,
        idempotencyKey: run.idempotencyKey,
      });
      const threadId = receipt.threads?.[0]?.threadId;
      return await store.updateDarwinRun(run.id, {
        actRequestId: receipt.actRequestId,
        threadId,
        status: threadId ? "running" : receipt.status === "failed" ? "failed" : "unknown",
        ...(threadId
          ? {}
          : { error: `Darwin accepted no thread (status ${receipt.status ?? "none"}).` }),
      });
    } catch (err) {
      // A definite refusal (4xx) means nothing started; anything else is uncertain.
      const definite = err instanceof DarwinHttpError && err.status >= 400 && err.status < 500;
      log.error("darwin start failed", { runId: run.id, definite, error: String(err) });
      return store.updateDarwinRun(run.id, {
        status: definite ? "failed" : "unknown",
        error: definite
          ? `Darwin refused the start: ${String((err as Error).message)}`
          : "Start outcome uncertain. Do not start another agent; a person must check with Darwin.",
      });
    }
  }

  /** Reads the thread and updates the run. Returns the run and any provider messages not yet seen. */
  async function check(
    taskId: string,
  ): Promise<{ run: DarwinRun; newMessages: DarwinThreadMessage[] } | undefined> {
    const run = await store.latestDarwinRun(taskId);
    if (!run) return undefined;
    if (TERMINAL.has(run.status) || !run.actRequestId) return { run, newMessages: [] };

    let request: DarwinActRequest;
    try {
      request = await darwin.read(run.actRequestId);
    } catch (err) {
      log.warn("darwin read failed", { runId: run.id, error: String(err) });
      return { run, newMessages: [] }; // retry later; the run itself is unchanged
    }
    const state = request.threads.find((t) => t.threadId === run.threadId)?.state;
    if (!state) return { run, newMessages: [] };

    const pending = state.requests.filter((r) => UNANSWERED.has(r.status));
    const completion = state.messages.find((m) => m.type === "completion_confirmation");
    const status: DarwinRunStatus =
      request.status === "failed"
        ? "failed"
        : state.errors?.length
          ? "needs_review"
          : pending.length > 0 || state.needsAttention
            ? "needs_input"
            : completion
              ? "completed"
              : "running";

    const newMessages = state.messages.slice(run.seenMessages);
    const updated = await store.updateDarwinRun(run.id, {
      status,
      pending,
      seenMessages: state.messages.length,
      ...(completion ? { outcome: completion } : {}),
    });
    return { run: updated, newMessages };
  }

  /** Answers the agent's text question on the same thread. Idempotent per operationId. */
  async function reply(input: {
    taskId: string;
    text: string;
    operationId: string;
  }): Promise<DarwinRun> {
    const run = await store.latestDarwinRun(input.taskId);
    if (!run?.threadId) throw new ExecutorRefusal("No Darwin thread for this task yet.");
    if (TERMINAL.has(run.status) || run.status === "unknown") {
      throw new ExecutorRefusal(`Can't reply: the run is ${run.status}.`);
    }
    const typed = run.pending.filter((r: DarwinPendingRequest) => r.type !== "question");
    if (typed.length > 0) {
      throw new ExecutorRefusal(
        `The agent is waiting on ${typed.map((r) => r.type).join(", ")}. Text can't answer that: a family member must complete it in Darwin's hosted flow.`,
      );
    }
    const previous = run.replies[input.operationId];
    if (previous) {
      if (previous.text !== input.text)
        throw new ExecutorRefusal("operationId already used for a different reply.");
      return run;
    }

    const replies = {
      ...run.replies,
      [input.operationId]: { text: input.text, status: "sending" as const },
    };
    await store.updateDarwinRun(run.id, { replies });
    try {
      await darwin.reply({
        threadId: run.threadId,
        text: input.text,
        idempotencyKey: `${run.id}:${input.operationId}`,
      });
    } catch (err) {
      log.error("darwin reply failed", { runId: run.id, error: String(err) });
      return store.updateDarwinRun(run.id, {
        replies: { ...replies, [input.operationId]: { text: input.text, status: "unknown" } },
        error: "Reply outcome uncertain. Check progress before replying again.",
      });
    }
    return store.updateDarwinRun(run.id, {
      replies: { ...replies, [input.operationId]: { text: input.text, status: "sent" } },
      status: "running",
      pending: [],
      error: undefined,
    });
  }

  return { search, start, check, reply };
}

export type DarwinExecutor = ReturnType<typeof createDarwinExecutor>;

/** What the bot sees: no internal keys, provider text kept as-is. */
export function describeRun(run: DarwinRun, newMessages: DarwinThreadMessage[] = []) {
  return {
    status: run.status,
    mode: run.mode,
    simulated: run.mode === "proxy",
    agent: { agentId: run.agentId, capabilityId: run.capabilityId, name: run.agentName ?? null },
    pending: run.pending,
    outcome: run.outcome ?? null,
    newMessages,
    error: run.error ?? null,
  };
}

export type { DarwinSearchResult };
