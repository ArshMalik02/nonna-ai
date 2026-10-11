import type { Logger } from "../logger.js";
import type { DarwinRun, Store } from "../store.js";
import type { DarwinExecutor } from "./executor.js";
import type { DarwinThreadMessage } from "./types.js";

export interface WatcherDeps {
  executor: Pick<DarwinExecutor, "check">;
  store: Pick<Store, "listActiveDarwinRuns" | "getTask">;
  /** Posts an update into the elder's team channel (the bot relays it to the family). */
  postToTeam: (elderId: string, text: string) => Promise<void>;
  log: Logger;
}

const quote = (m: DarwinThreadMessage) => (m.text ? `- ${m.text}` : `- (${m.type})`);

/** Tells the Nonna bot what changed on a run and what it should do next. */
export function describeUpdate(
  run: DarwinRun,
  taskSummary: string,
  newMessages: DarwinThreadMessage[],
) {
  const who = `${run.agentName ?? run.agentId}${run.mode === "proxy" ? " (simulated)" : ""}`;
  const lines = [
    `Darwin update on task ${run.taskId} (${taskSummary}) from ${who}: ${run.status}.`,
  ];
  const said = newMessages.filter((m) => m.text);
  if (said.length) lines.push(`The agent said:\n${said.map(quote).join("\n")}`);

  const questions = run.pending.filter((r) => r.type === "question");
  const typed = run.pending.filter((r) => r.type !== "question");
  if (questions.length) {
    lines.push(
      `It asks: ${questions.map((q) => q.text ?? q.requestId).join(" / ")}`,
      "If the answer is already known from the family or the elder's profile, answer with darwin_reply. Otherwise ask the family, then darwin_reply.",
    );
  }
  if (typed.length) {
    lines.push(
      `It is waiting on ${typed.map((r) => r.type).join(", ")}: ${typed.map((r) => r.text ?? "").join(" ")}`,
      "This can't be answered by text. Tell the family plainly what is needed and that a family member who can approve or pay must complete it.",
    );
  }
  if (run.status === "completed") {
    lines.push(
      run.mode === "proxy"
        ? "Tell the family the outcome and say clearly it was a TEST booking: nothing real was booked or paid. Then update the task."
        : "Tell the family the confirmed outcome with any confirmation details, then update the task.",
    );
  }
  if (run.status === "failed" || run.status === "needs_review" || run.status === "unknown") {
    lines.push(
      `${run.error ?? "Something went wrong."} Tell the family briefly. Don't start another Darwin agent for this task; offer dial_call_business instead.`,
    );
  }
  return lines.join("\n\n");
}

/**
 * Follows every active Darwin run in the background and posts changes into the elder's team
 * channel, so a booking that takes minutes never blocks a request or needs manual polling.
 */
export function startDarwinWatcher(deps: WatcherDeps, everyMs = 10_000) {
  let busy = false;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (const run of await deps.store.listActiveDarwinRuns()) {
        const before = run.status;
        const checked = await deps.executor.check(run.taskId);
        if (!checked) continue;
        // Only status changes reach the team: each post is a bot turn and a family message, so
        // routine "still working" chatter stays out of the group.
        if (checked.run.status === before) continue;
        const task = await deps.store.getTask(run.taskId);
        if (!task) continue;
        await deps.postToTeam(
          task.elderId,
          describeUpdate(checked.run, task.summary, checked.newMessages),
        );
      }
    } catch (err) {
      deps.log.error("darwin watcher failed", { error: String(err) });
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(() => void tick(), everyMs);
  return { tick, stop: () => clearInterval(timer) };
}
