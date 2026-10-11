import type { Logger } from "../logger.js";
import type { OmbClient, OmbMessage } from "./client.js";
import { isUsageLimitError } from "./failover.js";

export interface RelayDeps {
  omb: Pick<OmbClient, "getChannel" | "postToChannel" | "threadMessages" | "respond">;
  /**
   * Tools the gateway approves on the bot's behalf (its own MCP tools). Claude asks before every
   * MCP call; nobody is at the OpenMausBot keyboard, so without this every turn would stall.
   * Anything else (shell, files, other servers) stays pending for a person.
   */
  autoApproveTool?: (tool: string) => boolean;
  /**
   * The turn failed because the model account is out of usage. Return true after switching to
   * another engine; the relay then posts the same message again, once.
   */
  onUsageLimit?: () => Promise<boolean>;
  log: Logger;
  /**
   * Delivers one bot reply to the family group, plus any extra recipients (phone numbers)
   * collected for the current turn, e.g. the elder when the elder wrote in.
   */
  deliver: (text: string, alsoTo: readonly string[]) => Promise<unknown>;
  pollMs?: number;
  /** Give up on a turn that is still running after this long. */
  maxTurnMs?: number;
  /**
   * Keep watching this long after the channel goes quiet. Nonna hands rides and appointments to
   * specialists; their reports wake her up minutes later, and her reply must still reach the
   * family. 0 stops as soon as the channel settles.
   */
  lingerMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const isReply = (m: OmbMessage) => m.role === "bot" && m.kind === "text" && Boolean(m.text?.trim());

/**
 * Bridges one family conversation to one OpenMausBot channel.
 *
 * `send` posts a family message into the channel; a single watcher loop then forwards every new
 * bot text reply to the family until the channel settles. Messages that arrive while a turn is
 * running are posted too (OpenMausBot queues them) and the same loop keeps relaying, so replies
 * are never sent twice or dropped.
 */
export class ChannelRelay {
  readonly #seen = new Set<string>();
  readonly #alsoTo = new Set<string>();
  #lastText: string | undefined;
  #retried = false;
  #watching: Promise<void> | undefined;
  #primed = false;

  constructor(
    private readonly channelId: string,
    private readonly deps: RelayDeps,
  ) {}

  async send(text: string, opts: { alsoTo?: readonly string[] } = {}) {
    for (const to of opts.alsoTo ?? []) this.#alsoTo.add(to);
    const channel = await this.deps.omb.getChannel(this.channelId);
    if (!channel) throw new Error(`OpenMausBot channel ${this.channelId} not found`);

    // Everything already in the thread is history, not a reply to this message.
    if (!this.#primed) {
      const { messages } = await this.deps.omb.threadMessages(channel.threadId);
      for (const m of messages) this.#seen.add(m.id);
      this.#primed = true;
    }

    await this.deps.omb.postToChannel(this.channelId, channel.threadId, text);
    this.#lastText = text;
    this.#watching ??= this.#watch().finally(() => {
      this.#watching = undefined;
      this.#alsoTo.clear();
      this.#retried = false;
    });
    return this.#watching;
  }

  async #watch() {
    const {
      pollMs = 2_000,
      maxTurnMs = 10 * 60_000,
      lingerMs = 0,
      sleep = defaultSleep,
    } = this.deps;
    const deadline = Date.now() + maxTurnMs;
    let idlePolls = 0;
    let lastActivity = Date.now();

    while (Date.now() < deadline) {
      await sleep(pollMs);
      const channel = await this.deps.omb.getChannel(this.channelId);
      if (!channel) return;

      const { messages } = await this.deps.omb.threadMessages(channel.threadId);
      for (const m of messages) {
        const card = m.card;
        if (
          card?.requestType === "permission" &&
          card.requestId &&
          !card.answered &&
          !card.dismissed
        ) {
          await this.#onPermission(channel.threadId, card.requestId, card.tool ?? "");
        }
        if (this.#seen.has(m.id)) continue;
        this.#seen.add(m.id);
        lastActivity = Date.now();
        if (isReply(m)) await this.deps.deliver((m.text ?? "").trim(), [...this.#alsoTo]);
        if (m.tool?.ok === false && isUsageLimitError(m.tool.name)) {
          await this.#retryAfterLimit(channel.threadId);
          idlePolls = 0;
        }
      }

      // Settled: not busy for two polls in a row (a turn can take a moment to start).
      idlePolls = channel.busyBotId ? 0 : idlePolls + 1;
      if (channel.busyBotId) lastActivity = Date.now();
      if (idlePolls >= 2 && Date.now() - lastActivity >= lingerMs) return;
    }
    this.deps.log.warn("omb turn still running at relay deadline", { channelId: this.channelId });
  }

  async #retryAfterLimit(threadId: string) {
    if (this.#retried || !this.#lastText || !this.deps.onUsageLimit) return;
    this.#retried = true;
    if (await this.deps.onUsageLimit()) {
      await this.deps.omb.postToChannel(this.channelId, threadId, this.#lastText);
    }
  }

  async #onPermission(threadId: string, requestId: string, tool: string) {
    if (this.deps.autoApproveTool?.(tool)) {
      await this.deps.omb.respond(threadId, requestId, "allow", true);
      return;
    }
    if (!warned.has(requestId)) {
      warned.add(requestId);
      this.deps.log.warn("omb turn waiting on a person's approval", { tool, requestId });
    }
  }
}

const warned = new Set<string>();

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
