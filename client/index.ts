/**
 * kabot/client: a dependency-free client for the kabot Worker.
 * Uses only fetch, so it runs in Node 18+, Cloudflare Workers, Deno, Bun and browsers.
 */

export type KabotMessage = {
  message: string;
  name?: string;
  email?: string;
  /** URL of the page the message was sent from. */
  page?: string;
  /** Server mode: the visitor's IP, so rate limits apply per visitor instead of per site. */
  visitorIp?: string;
  /** Browser mode: a Turnstile token, when the site has Turnstile enabled. */
  turnstileToken?: string;
  /** Honeypot field for browser forms. Leave it empty. */
  website?: string;
};

export type KabotClientOptions = {
  /** Base URL of the Worker, for example https://kabot.example.workers.dev */
  endpoint: string;
  /** Server mode: the site's API key. Never ship it to a browser. */
  apiKey?: string;
  /** Browser mode: the site id. Requests must come from one of the site's allowed origins. */
  site?: string;
  fetch?: typeof fetch;
  /** Request timeout in milliseconds. Default 10000. */
  timeoutMs?: number;
};

export type KabotSendResult = { ok: true; id?: number | null };

export class KabotError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "KabotError";
  }
}

export type KabotClient = {
  send(message: KabotMessage): Promise<KabotSendResult>;
};

export function createKabotClient(options: KabotClientOptions): KabotClient {
  const endpoint = options.endpoint.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(endpoint)) throw new TypeError("endpoint must be an http(s) URL.");
  if (!options.apiKey === !options.site) throw new TypeError("Pass exactly one of apiKey (server) or site (browser).");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 10_000;

  return {
    async send(message) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
      const body = options.site ? { ...message, site: options.site } : message;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(`${endpoint}/v1/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        const aborted = controller.signal.aborted;
        throw new KabotError(0, aborted ? "timeout" : "network", aborted ? "The request timed out." : String(error));
      } finally {
        clearTimeout(timer);
      }

      const data = (await res.json().catch(() => null)) as
        | { ok: true; id?: number | null }
        | { ok: false; error?: { code?: string; message?: string; fields?: Record<string, string> } }
        | null;
      if (res.ok && data?.ok) return { ok: true, ...(data.id !== undefined ? { id: data.id } : {}) };
      const err = data && !data.ok ? data.error : undefined;
      const retry = Number(res.headers.get("retry-after"));
      throw new KabotError(
        res.status,
        err?.code ?? "http_error",
        err?.message ?? `Request failed with status ${res.status}.`,
        err?.fields,
        Number.isFinite(retry) && retry > 0 ? retry : undefined,
      );
    },
  };
}
