export interface DarwinClientOptions {
  baseUrl: string;
  searchKey?: string | undefined;
  actKey?: string | undefined;
  actEnabled: boolean;
  fetch?: typeof fetch;
}

export interface DarwinContextItem {
  type: "text" | "budget" | "deadline" | "pdf" | "image";
  value: unknown;
}

export interface DarwinSearchInput {
  query: string;
  maxResults?: number;
  /** Up to 10 typed items (location, time, budget...). */
  context?: DarwinContextItem[];
  previousResponseId?: string;
  /** Only return agents we can actually start a thread with. */
  requiresExecutableRoute?: boolean;
}

/**
 * Darwin discovery client. Search is public; Act is a gated pilot, so it stays behind
 * `DARWIN_ACT_ENABLED`. An HTTP 200 from Act is NOT completion — read the thread state.
 * https://darwin.so/docs
 */
export class DarwinClient {
  readonly #fetch: typeof fetch;

  constructor(private readonly opts: DarwinClientOptions) {
    this.#fetch = opts.fetch ?? fetch;
  }

  search({ requiresExecutableRoute, ...input }: DarwinSearchInput) {
    return this.#request("POST", "/api/v3/search", this.opts.searchKey, {
      ...input,
      ...(requiresExecutableRoute ? { filters: { requiresExecutableRoute: true } } : {}),
    });
  }

  act(input: {
    searchId?: string;
    threadId?: string;
    targets?: { agentId: string; capabilityId?: string }[];
    message: unknown;
    idempotencyKey: string;
  }) {
    if (!this.opts.actEnabled) throw new Error("Darwin Act is disabled (DARWIN_ACT_ENABLED=false)");
    const { idempotencyKey, ...body } = input;
    return this.#request("POST", "/api/v3/act", this.opts.actKey, body, {
      "Idempotency-Key": idempotencyKey,
    });
  }

  getActRequest(actRequestId: string) {
    return this.#request(
      "GET",
      `/api/v3/act/requests/${encodeURIComponent(actRequestId)}?includeThreadState=true`,
      this.opts.actKey,
    );
  }

  async #request(
    method: string,
    path: string,
    key: string | undefined,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await this.#fetch(new URL(path, this.opts.baseUrl), {
      method,
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new Error(`Darwin ${method} ${path} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as unknown;
  }
}
