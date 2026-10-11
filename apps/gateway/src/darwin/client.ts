import type { DarwinActReceipt, DarwinActRequest, DarwinSearchResult } from "./types.js";

export interface DarwinClientOptions {
  baseUrl: string;
  /** Application Search key (higher rate limits). Search also works anonymously. */
  searchKey?: string | undefined;
  /** Account-owner key with agent:write, or a person's OAuth token with human:actions. */
  actKey?: string | undefined;
  actEnabled: boolean;
  fetch?: typeof fetch;
}

/**
 * Thin client for the live Darwin API. https://darwin.so/docs
 * Act is a gated pilot, so it stays behind DARWIN_ACT_ENABLED.
 */
export class DarwinClient {
  readonly #fetch: typeof fetch;

  constructor(private readonly opts: DarwinClientOptions) {
    this.#fetch = opts.fetch ?? fetch;
  }

  search(input: { query: string; maxResults?: number; requiresExecutableRoute?: boolean }) {
    const { requiresExecutableRoute, ...body } = input;
    return this.#request<DarwinSearchResult>("POST", "/api/v3/search", this.opts.searchKey, {
      ...body,
      ...(requiresExecutableRoute ? { filters: { requiresExecutableRoute: true } } : {}),
    });
  }

  /** Starts a thread with exactly one target, or continues one (`threadId`). */
  act(input: {
    targets?: { agentId: string; capabilityId: string }[];
    threadId?: string;
    searchId?: string;
    text: string;
    idempotencyKey: string;
  }) {
    if (!this.opts.actEnabled) throw new Error("Darwin Act is disabled (DARWIN_ACT_ENABLED=false)");
    const { idempotencyKey, text, ...rest } = input;
    return this.#request<DarwinActReceipt>(
      "POST",
      "/api/v3/act",
      this.opts.actKey,
      { ...rest, message: { type: "text", text } },
      { "Idempotency-Key": idempotencyKey },
    );
  }

  getActRequest(actRequestId: string) {
    return this.#request<DarwinActRequest>(
      "GET",
      `/api/v3/act/requests/${encodeURIComponent(actRequestId)}?includeThreadState=true&limit=100`,
      this.opts.actKey,
    );
  }

  async #request<T>(
    method: string,
    path: string,
    key: string | undefined,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await this.#fetch(new URL(path, this.opts.baseUrl), {
      method,
      headers: {
        // Darwin's docs don't pin the header; send the key both ways it may be read.
        ...(key ? { Authorization: `Bearer ${key}`, "x-api-key": key } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new DarwinHttpError(
        res.status,
        `Darwin ${method} ${path} failed: ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  }
}

/** A definite HTTP answer from Darwin (as opposed to a network failure with an unknown outcome). */
export class DarwinHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
