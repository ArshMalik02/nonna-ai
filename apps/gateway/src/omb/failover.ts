import type { Logger } from "../logger.js";
import type { ModelSelection, OmbClient } from "./client.js";

/** OpenMausBot's wording when a Claude subscription hits its 5-hour or weekly limit. */
const USAGE_LIMIT = /reached its .*limit|hit your (session|weekly|usage|opus) limit|usage limit/i;

export function isUsageLimitError(toolName: string | undefined) {
  return Boolean(toolName?.startsWith("error:") && USAGE_LIMIT.test(toolName));
}

export interface FailoverDeps {
  omb: Pick<OmbClient, "getChannel" | "setBotModel">;
  log: Logger;
  /** Normally the Claude Code subscription login (`claude` instance). */
  primary: ModelSelection;
  /** An Anthropic API key engine (`claudeApi`), used only while the primary is limited. */
  fallback: ModelSelection;
  /** When to try the primary again. */
  retryPrimaryAfterMs?: number;
}

/**
 * Moves a channel's bots to the API-key engine when the subscription is out of usage, and back
 * to the subscription later. Returns whether it switched, so the relay can retry the turn once.
 */
export function createModelFailover(deps: FailoverDeps) {
  const { retryPrimaryAfterMs = 60 * 60_000 } = deps;
  const onFallback = new Set<string>();

  async function setAll(channelId: string, selection: ModelSelection) {
    const channel = await deps.omb.getChannel(channelId);
    for (const botId of channel?.memberIds ?? []) await deps.omb.setBotModel(botId, selection);
  }

  return {
    get active() {
      return onFallback.size > 0 ? "fallback" : "primary";
    },

    async onUsageLimit(channelId: string): Promise<boolean> {
      if (onFallback.has(channelId)) {
        deps.log.error("fallback engine is limited too", { channelId });
        return false;
      }
      try {
        await setAll(channelId, deps.fallback);
      } catch (err) {
        deps.log.error("could not switch to fallback engine", { channelId, error: String(err) });
        return false;
      }
      onFallback.add(channelId);
      deps.log.warn("subscription limited: switched to API key engine", { channelId });

      setTimeout(() => {
        setAll(channelId, deps.primary)
          .then(() => {
            onFallback.delete(channelId);
            deps.log.info("switched back to subscription engine", { channelId });
          })
          .catch((err: unknown) =>
            deps.log.error("could not switch back to primary", { error: String(err) }),
          );
      }, retryPrimaryAfterMs).unref();
      return true;
    },
  };
}
