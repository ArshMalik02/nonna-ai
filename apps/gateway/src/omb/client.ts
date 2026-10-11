export interface OmbClientOptions {
  baseUrl: string;
  token?: string | undefined;
  fetch?: typeof fetch;
}

/**
 * Client for the unmodified OpenMausBot harness HTTP API (see docs/build-plan.md §2).
 * The gateway posts tasks into a family channel; the Nonna chief-of-staff bot takes it from there.
 */
export class OmbClient {
  readonly #fetch: typeof fetch;

  constructor(private readonly opts: OmbClientOptions) {
    this.#fetch = opts.fetch ?? fetch;
  }

  async postToChannel(channelId: string, text: string) {
    const res = await this.#fetch(
      new URL(`/api/groups/${encodeURIComponent(channelId)}/messages`, this.opts.baseUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}),
        },
        body: JSON.stringify({ text }),
      },
    );
    if (!res.ok) throw new Error(`OMB post failed: ${res.status} ${await res.text()}`);
  }
}
