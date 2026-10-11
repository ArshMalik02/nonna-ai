import { randomUUID } from "node:crypto";

export interface DialClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export interface PlaceCallInput {
  to: string;
  fromNumber: string;
  /** Per-call system prompt. Name the goal so the agent can navigate phone menus. */
  outboundInstruction: string;
  language?: string;
  maxCallDurationSeconds?: number;
  /** Wait for a real human, then cold-transfer to this number. */
  transferTo?: string;
  /** Always pass a stable key on retries, or Dial will place a second call. */
  idempotencyKey?: string;
}

export interface SendMessageInput {
  to?: string;
  groupId?: string;
  body: string;
  mediaUrls?: string[];
}

/** Thin typed wrapper over the Dial REST API. https://docs.getdial.ai/openapi.json */
export class DialClient {
  readonly #fetch: typeof fetch;

  constructor(private readonly opts: DialClientOptions) {
    this.#fetch = opts.fetch ?? fetch;
  }

  sendMessage(input: SendMessageInput) {
    return this.#request("POST", "/api/v1/messages", input);
  }

  /** Typing indicator is free; show it while Nonna works so the family sees activity. */
  startTyping(input: { to?: string; groupId?: string }) {
    return this.#request("POST", "/api/v1/typing", input);
  }

  placeCall({ idempotencyKey = randomUUID(), ...body }: PlaceCallInput) {
    return this.#request("POST", "/api/v1/calls", body, { "Idempotency-Key": idempotencyKey });
  }

  getCall(callId: string) {
    return this.#request("GET", `/api/v1/calls/${encodeURIComponent(callId)}`);
  }

  /** Dial cannot join groups; poll this to discover groups a family member added Nonna to. */
  listGroups() {
    return this.#request("GET", "/api/v1/groups");
  }

  async #request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await this.#fetch(new URL(path, this.opts.baseUrl), {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new Error(`Dial ${method} ${path} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as unknown;
  }
}
