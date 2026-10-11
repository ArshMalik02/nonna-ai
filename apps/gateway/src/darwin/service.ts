import { createHash } from "node:crypto";
import type { DarwinClient } from "./client.js";
import { PROXY_AGENTS, type ProxyAgent } from "./proxy-catalog.js";

/**
 * What Nonna's tools need from Darwin. Two implementations:
 * - `live`: the real Darwin Search/Act API.
 * - `proxy`: a local catalog of fictional agents (proxy-catalog.ts) with simulated Act, used
 *   while Darwin is unavailable. Results are always marked `mode: "proxy"` / `simulated: true`.
 */
export interface DarwinService {
  readonly mode: "live" | "proxy";
  search(input: {
    query: string;
    context?: string | undefined;
    maxResults?: number;
  }): Promise<unknown>;
  act(input: {
    agentId: string;
    capabilityId?: string | undefined;
    searchId?: string | undefined;
    request: string;
    idempotencyKey: string;
  }): Promise<unknown>;
}

export function liveDarwin(client: Pick<DarwinClient, "search" | "act">): DarwinService {
  return {
    mode: "live",
    search: ({ query, context, maxResults = 5 }) =>
      client.search({ query: context ? `${query}\nContext: ${context}` : query, maxResults }),
    act: ({ agentId, capabilityId, searchId, request, idempotencyKey }) =>
      client.act({
        ...(searchId ? { searchId } : {}),
        targets: [{ agentId, ...(capabilityId ? { capabilityId } : {}) }],
        message: { type: "text", text: request },
        idempotencyKey,
      }),
  };
}

// Darwin itself refuses emergencies; so does the proxy (the gateway's safety rules handle them).
const EMERGENCY =
  /\b(911|emergency|ambulance|fell|fallen|chest pain|can'?t breathe|stroke|unconscious)\b/i;
const STOP_WORDS = new Set(
  "a an and the to for of in on at my mom dad her his me i need want please can you book get find with from by is it".split(
    " ",
  ),
);

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

/** Scores how well an agent fits a request: phrase keywords count most, then shared words. */
export function scoreAgent(agent: ProxyAgent, query: string): { score: number; reasons: string[] } {
  const q = query.toLowerCase();
  const qWords = new Set(words(query));
  const reasons: string[] = [];
  let score = 0;

  for (const k of agent.keywords) {
    if (k.includes(" ") ? q.includes(k) : qWords.has(k)) {
      score += 3;
      reasons.push(`matches "${k}"`);
    }
  }
  const text = new Set(words(`${agent.name} ${agent.description} ${agent.category}`));
  for (const w of qWords) if (text.has(w)) score += 1;
  return { score, reasons: reasons.slice(0, 3) };
}

const id = (prefix: string, ...parts: string[]) =>
  `${prefix}_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16)}`;

export function proxyDarwin(agents: readonly ProxyAgent[] = PROXY_AGENTS): DarwinService {
  return {
    mode: "proxy",
    async search({ query, context, maxResults = 5 }) {
      const searchId = id("srch", query, context ?? "");
      if (EMERGENCY.test(query)) {
        return {
          mode: "proxy",
          searchId,
          status: "no_match",
          noMatchReason: "This sounds like an emergency. Call 911 or local emergency services.",
        };
      }
      const ranked = agents
        .map((agent) => ({ agent, ...scoreAgent(agent, `${query} ${context ?? ""}`) }))
        .filter((r) => r.score >= 3)
        .sort((x, y) => y.score - x.score)
        .slice(0, maxResults);
      if (ranked.length === 0) {
        return {
          mode: "proxy",
          searchId,
          status: "no_match",
          noMatchReason: "No proxy agent covers this. Use dial_call_business or ask the family.",
        };
      }
      return {
        mode: "proxy",
        searchId,
        status: "ok",
        agents: ranked.map(({ agent, reasons }) => ({
          agentId: agent.agentId,
          capabilityId: agent.capabilityId,
          name: agent.name,
          description: agent.description,
          reasons,
          requiredInputs: agent.requiredInputs,
          priceHint: agent.priceHint ?? null,
          leadTime: agent.leadTime ?? null,
          accessibility: agent.accessibility ?? [],
          readiness: "ready",
          canStartThread: true,
        })),
      };
    },

    async act({ agentId, request, idempotencyKey }) {
      const agent = agents.find((x) => x.agentId === agentId);
      if (!agent) throw new Error(`Unknown proxy agent ${agentId}`);
      const confirmation = id("conf", idempotencyKey).slice(5, 13).toUpperCase();
      const isPayment = agent.category === "payment";
      return {
        mode: "proxy",
        simulated: true,
        actRequestId: id("act", idempotencyKey),
        agent: { agentId, name: agent.name },
        status: isPayment ? "awaiting_payment" : "completed",
        confirmation: isPayment
          ? null
          : { code: confirmation, summary: `${agent.name} accepted the request: ${request}` },
        ...(isPayment
          ? { nextStep: "A hosted checkout link would go to the family member who can pay." }
          : {}),
        note: "SIMULATED by Nonna's proxy catalog while Darwin is unavailable: nothing real was booked, sent or paid.",
      };
    },
  };
}
