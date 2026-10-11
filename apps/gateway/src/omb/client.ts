export interface OmbClientOptions {
  baseUrl: string;
  token?: string | undefined;
  fetch?: typeof fetch;
}

export interface OmbChannel {
  id: string;
  name: string;
  /** The channel's active task (conversation) id. */
  threadId: string;
  /** Set while a bot is working in this channel. */
  busyBotId?: string | null;
  memberIds?: string[];
}

export interface ModelSelection {
  instanceId: string;
  model: string;
}

export interface OmbMessage {
  id: string;
  role: "user" | "bot" | string;
  kind?: string;
  text?: string;
  botId?: string;
  /** Activity rows; a failed turn shows `ok: false` with `name: "error: …"`. */
  tool?: { name?: string; ok?: boolean };
  /** Approval and question cards a turn is waiting on. */
  card?: {
    requestId?: string;
    requestType?: "permission" | "question" | string;
    tool?: string;
    answered?: boolean;
    dismissed?: boolean;
  };
}

export interface OmbBot {
  id: string;
  name: string;
  threadId: string;
}

/**
 * Client for the unmodified OpenMausBot harness HTTP API (see docs/build-plan.md §2).
 * Routes mirror OpenMausBot's own MCP control plane (scripts/mcp-server.ts upstream).
 */
export class OmbClient {
  readonly #fetch: typeof fetch;

  constructor(private readonly opts: OmbClientOptions) {
    this.#fetch = opts.fetch ?? fetch;
  }

  /** Bots and channels with their live state (`busyBotId`), without message bodies. */
  async fleet() {
    return (await this.#request("GET", "/api/bots?messages=0")) as {
      bots: OmbBot[];
      groups: OmbChannel[];
    };
  }

  async getChannel(channelId: string) {
    return (await this.fleet()).groups.find((g) => g.id === channelId);
  }

  async postToChannel(channelId: string, threadId: string, text: string) {
    await this.#request("POST", `/api/groups/${encodeURIComponent(channelId)}/messages`, {
      text,
      threadId,
    });
  }

  async threadMessages(threadId: string, limit = 50) {
    return (await this.#request(
      "GET",
      `/api/threads/${encodeURIComponent(threadId)}/messages?limit=${limit}`,
    )) as { messages: OmbMessage[]; hasMore: boolean };
  }

  /** Switches an idle bot's default and selected-task model. */
  async setBotModel(botId: string, modelSelection: ModelSelection) {
    await this.#request("PATCH", `/api/bots/${encodeURIComponent(botId)}`, {
      modelSelection,
      requireAvailableModel: true,
    });
  }

  /** Answers an approval card. `always` remembers it for the rest of the session. */
  async respond(threadId: string, requestId: string, behavior: "allow" | "deny", always = false) {
    await this.#request("POST", `/api/threads/${encodeURIComponent(threadId)}/respond`, {
      requestId,
      behavior,
      ...(always ? { always: true } : {}),
    });
  }

  async #request(method: string, path: string, body?: unknown) {
    const res = await this.#fetch(new URL(path, this.opts.baseUrl), {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`OMB ${method} ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as unknown;
  }
}
