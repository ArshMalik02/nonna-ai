import { createHash } from "node:crypto";
import type { DarwinClient } from "./client.js";
import { PROXY_AGENTS, type ProxyAgent } from "./proxy-catalog.js";
import type {
  DarwinActReceipt,
  DarwinActRequest,
  DarwinAgent,
  DarwinPendingRequest,
  DarwinSearchResult,
  DarwinThreadMessage,
} from "./types.js";

/**
 * What the gateway needs from Darwin. Two implementations with the same shapes:
 * - `live`: the real Darwin Search / Act API.
 * - `proxy`: a local catalog of fictional agents (proxy-catalog.ts) with simulated threads, used
 *   while Darwin is unavailable. Everything it returns is marked `simulated: true`.
 */
export interface DarwinService {
  readonly mode: "live" | "proxy";
  search(input: {
    query: string;
    context?: string | undefined;
    maxResults?: number;
  }): Promise<DarwinSearchResult>;
  /** Starts one thread with one agent. */
  start(input: {
    agentId: string;
    capabilityId: string;
    searchId?: string | undefined;
    brief: string;
    idempotencyKey: string;
  }): Promise<DarwinActReceipt>;
  /** Reads the act request with each thread's state. */
  read(actRequestId: string): Promise<DarwinActRequest>;
  /** Continues an existing thread with a text answer. */
  reply(input: {
    threadId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<DarwinActReceipt>;
}

export function liveDarwin(
  client: Pick<DarwinClient, "search" | "act" | "getActRequest">,
): DarwinService {
  return {
    mode: "live",
    search: ({ query, context, maxResults = 5 }) =>
      client.search({ query: context ? `${query}\nContext: ${context}` : query, maxResults }),
    start: ({ agentId, capabilityId, searchId, brief, idempotencyKey }) =>
      client.act({
        targets: [{ agentId, capabilityId }],
        ...(searchId ? { searchId } : {}),
        text: brief,
        idempotencyKey,
      }),
    read: (actRequestId) => client.getActRequest(actRequestId),
    reply: ({ threadId, text, idempotencyKey }) => client.act({ threadId, text, idempotencyKey }),
  };
}

// ── Proxy ──────────────────────────────────────────────────────────────────

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

const hash = (...parts: string[]) =>
  createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);

/** Proxy act ids encode the thread, so reads survive a gateway restart. */
interface ProxyThread {
  agentId: string;
  brief: string;
  startedAt: number;
}
const encode = (t: ProxyThread) =>
  `proxyact_${Buffer.from(JSON.stringify(t)).toString("base64url")}`;
function decode(id: string): ProxyThread {
  if (!id.startsWith("proxyact_")) throw new Error(`Not a proxy act id: ${id}`);
  return JSON.parse(
    Buffer.from(id.slice("proxyact_".length), "base64url").toString(),
  ) as ProxyThread;
}

export interface ProxyOptions {
  agents?: readonly ProxyAgent[];
  /** How long a simulated agent "works" before confirming. */
  workMs?: number;
  now?: () => number;
}

/**
 * Proxy Darwin. Threads behave like real ones so the whole flow can be exercised:
 * the agent acknowledges, asks for details when the brief is too thin, stops at a payment
 * request for payment agents (never "pays"), and otherwise sends a completion confirmation
 * with a confirmation code — all marked simulated.
 */
export function proxyDarwin(opts: ProxyOptions = {}): DarwinService {
  const { agents = PROXY_AGENTS, workMs = 8_000, now = Date.now } = opts;
  const answers = new Map<string, string[]>();

  return {
    mode: "proxy",

    async search({ query, context, maxResults = 5 }) {
      const searchId = `srch_proxy_${hash(query, context ?? "", String(now()))}`;
      const base = { searchId, simulated: true, mode: "proxy" };
      if (EMERGENCY.test(query)) {
        return {
          ...base,
          status: "no_match",
          response: {
            noMatchReason: "This sounds like an emergency. Call 911 or local emergency services.",
          },
        };
      }
      const ranked = agents
        .map((agent) => ({ agent, ...scoreAgent(agent, `${query} ${context ?? ""}`) }))
        .filter((r) => r.score >= 3)
        .sort((x, y) => y.score - x.score)
        .slice(0, maxResults);
      if (ranked.length === 0) {
        return {
          ...base,
          status: "no_match",
          response: {
            noMatchReason: "No proxy agent covers this. Use dial_call_business or ask the family.",
          },
        };
      }
      return {
        ...base,
        status: "ok",
        response: {
          agents: ranked.map(
            ({ agent, reasons }, i): DarwinAgent => ({
              rank: i + 1,
              agentId: agent.agentId,
              capabilityId: agent.capabilityId,
              name: agent.name,
              description: agent.description,
              reasons,
              uncertainties: [],
              requiredInputs: agent.requiredInputs,
              priceHint: agent.priceHint ?? null,
              leadTime: agent.leadTime ?? null,
              accessibility: agent.accessibility ?? [],
              readiness: "ready",
              canStartThread: true,
            }),
          ),
        },
      };
    },

    async start({ agentId, brief }) {
      if (!agents.some((a) => a.agentId === agentId))
        throw new Error(`Unknown proxy agent ${agentId}`);
      const id = encode({ agentId, brief, startedAt: now() });
      return { actRequestId: id, status: "accepted", threads: [{ threadId: id }], simulated: true };
    },

    async read(actRequestId) {
      const thread = decode(actRequestId);
      const agent = agents.find((a) => a.agentId === thread.agentId);
      const name = agent?.name ?? thread.agentId;
      const given = answers.get(actRequestId) ?? [];
      const messages: DarwinThreadMessage[] = [
        {
          type: "text",
          role: "agent",
          text: `${name} received the request and is working on it.`,
          simulated: true,
        },
      ];
      const requests: DarwinPendingRequest[] = [];

      if (thread.brief.trim().length < 40 && given.length === 0) {
        requests.push({
          requestId: "proxy-question-1",
          type: "question",
          status: "pending",
          text: `To book this, ${name} needs the address, the date and time, and anything they should know (mobility, preferences).`,
        });
      } else if (agent?.category === "payment") {
        requests.push({
          requestId: "proxy-payment-1",
          type: "payment",
          status: "pending",
          text: "Payment is needed. Darwin would send a hosted checkout link to the family member who can pay.",
          checkoutUrl: null,
        });
      } else if (now() - thread.startedAt >= workMs) {
        const code = hash(actRequestId).slice(0, 8).toUpperCase();
        messages.push({
          type: "completion_confirmation",
          role: "agent",
          text: `${name} confirmed the request. Confirmation ${code}.`,
          confirmationCode: code,
          simulated: true,
        });
      }
      return {
        actRequestId,
        status: "running",
        threads: [{ threadId: actRequestId, state: { messages, requests } }],
      };
    },

    async reply({ threadId, text }) {
      answers.set(threadId, [...(answers.get(threadId) ?? []), text]);
      return {
        actRequestId: threadId,
        status: "accepted",
        threads: [{ threadId }],
        simulated: true,
      };
    },
  };
}
