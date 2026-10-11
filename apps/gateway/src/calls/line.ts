import type { DialClient, PlaceCallInput } from "../dial/client.js";
import { DialHttpError } from "../dial/client.js";
import type { Logger } from "../logger.js";

/**
 * A Dial number carries one call at a time (`429 call_limit_reached`), and Nonna runs on a single
 * number. This queue places outbound calls one after another:
 *  - emergency calls jump ahead of task calls;
 *  - a call is "on the line" from placement until Dial's call.ended (or a safety timeout);
 *  - if the line is busy (e.g. the elder is calling in), the call waits and retries.
 */
export type CallPriority = "emergency" | "task";

export interface CallJob {
  priority: CallPriority;
  input: PlaceCallInput;
  /** Called once Dial accepts the call. */
  onPlaced?: (callId: string) => Promise<void> | void;
  /** Called when the call can't be placed (not for a busy line, which retries). */
  onFailed?: (error: unknown) => Promise<void> | void;
  /** Called with Dial's call.ended data. */
  onEnded?: (ended: CallEnded) => Promise<void> | void;
}

export interface CallEnded {
  callId: string;
  status: string;
  durationSeconds: number | null;
}

export interface CallLineDeps {
  dial: Pick<DialClient, "placeCall">;
  log: Logger;
  /** Wait before retrying when the line is busy. */
  busyRetryMs?: number;
  /** Extra time after a call's max duration before assuming its call.ended was lost. */
  graceMs?: number;
}

export function createCallLine(deps: CallLineDeps) {
  const { busyRetryMs = 15_000, graceMs = 60_000 } = deps;
  const queue: CallJob[] = [];
  let active: { callId: string; job: CallJob; timeout: NodeJS.Timeout } | undefined;
  let placing = false;
  let retry: NodeJS.Timeout | undefined;

  function release() {
    if (active) clearTimeout(active.timeout);
    active = undefined;
    void pump();
  }

  async function pump(): Promise<void> {
    if (active || placing || queue.length === 0 || retry) return;
    const job = queue.shift();
    if (!job) return;
    placing = true;
    try {
      const result = (await deps.dial.placeCall(job.input)) as { call?: { id?: string } };
      const callId = result.call?.id;
      if (!callId) throw new Error("Dial accepted the call without an id");
      const maxMs = (job.input.maxCallDurationSeconds ?? 600) * 1000 + graceMs;
      active = {
        callId,
        job,
        timeout: setTimeout(() => {
          deps.log.warn("call.ended never arrived; freeing the line", { callId });
          release();
        }, maxMs),
      };
      await job.onPlaced?.(callId);
    } catch (err) {
      if (err instanceof DialHttpError && err.status === 429) {
        // The number is on another call (often the elder calling in). Try again shortly.
        queue.unshift(job);
        retry = setTimeout(() => {
          retry = undefined;
          void pump();
        }, busyRetryMs);
      } else {
        deps.log.error("call could not be placed", { priority: job.priority, error: String(err) });
        await job.onFailed?.(err);
      }
    } finally {
      placing = false;
    }
    if (!active) void pump();
  }

  return {
    /** Queues a call. Returns its place in line (0 = being placed now). */
    enqueue(job: CallJob) {
      if (job.priority === "emergency") {
        const firstTask = queue.findIndex((j) => j.priority !== "emergency");
        queue.splice(firstTask === -1 ? queue.length : firstTask, 0, job);
      } else {
        queue.push(job);
      }
      const position = queue.indexOf(job) + (active || placing ? 1 : 0);
      void pump();
      return { position };
    },

    /** Feed every call.ended event here; frees the line when it's ours. */
    async onCallEnded(ended: CallEnded) {
      if (!active || active.callId !== ended.callId) return;
      const { job } = active;
      // Let the handler queue a follow-up (e.g. the next emergency call) before the line frees,
      // so a waiting task call can't slip in between.
      try {
        await job.onEnded?.(ended);
      } catch (err) {
        deps.log.error("call ended handler failed", { error: String(err) });
      }
      release();
    },

    get busy() {
      return Boolean(active || placing);
    },
    get waiting() {
      return queue.length;
    },
  };
}

export type CallLine = ReturnType<typeof createCallLine>;
