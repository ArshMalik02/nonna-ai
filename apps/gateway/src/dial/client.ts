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

export interface DialGroup {
  id: string;
  channel: "imessage" | "whatsapp";
  name: string | null;
  createdAt: string;
}

export interface SendMessageInput {
  to?: string;
  /** Group sends go out from whichever of our lines is in the group (the family line). */
  groupId?: string;
  /** Required for direct sends: an E.164 number, number id, or nickname of one of our lines. */
  fromNumber?: string;
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
  setTyping(input: { toNumber?: string; groupId?: string; fromNumber?: string; value: boolean }) {
    return this.#request("POST", "/api/v1/typing", input);
  }

  placeCall({ idempotencyKey = randomUUID(), ...body }: PlaceCallInput) {
    return this.#request("POST", "/api/v1/calls", body, { "Idempotency-Key": idempotencyKey });
  }

  getCall(callId: string) {
    return this.#request("GET", `/api/v1/calls/${encodeURIComponent(callId)}`);
  }

  /** Dial cannot join groups; poll this to discover groups a family member added Nonna to. */
  async listGroups() {
    return (await this.#request("GET", "/api/v1/groups")) as { groups: DialGroup[] };
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
      throw new DialHttpError(
        res.status,
        `Dial ${method} ${path} failed: ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as unknown;
  }
}

/** A definite HTTP answer from Dial. 429 on a call means the number is already on a call. */
export class DialHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
