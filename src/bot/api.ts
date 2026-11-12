import type { BotConfig } from "../env";

export class BotApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    description: string,
  ) {
    super(`${method} failed (${code}): ${description}`);
    this.name = "BotApiError";
  }
}

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };

export type BotApi = {
  platform: BotConfig["platform"];
  call<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T>;
};

/**
 * Minimal Bot API client. Telegram and Bale share the same method names and
 * payloads, so the only difference is the API base URL.
 */
export function createBotApi(bot: BotConfig): BotApi {
  const base = `${bot.apiBase}/bot${bot.token}`;
  return {
    platform: bot.platform,
    async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
      const res = await fetch(`${base}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; result: T }
        | { ok: false; error_code?: number; description?: string }
        | null;
      if (!data || !data.ok) {
        const code = data && !data.ok && data.error_code ? data.error_code : res.status;
        const description = (data && !data.ok && data.description) || "no response";
        // Never include the URL: it contains the bot token.
        throw new BotApiError(method, code, description.slice(0, 200));
      }
      return data.result;
    },
  };
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** Escapes text for the Bot API's HTML parse mode. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
}
