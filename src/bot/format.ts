import type { Platform } from "../env";
import { escapeHtml, type InlineButton, type InlineKeyboard } from "./api";

export type Screen = { text: string; keyboard?: InlineKeyboard };

/** Telegram renders HTML. Bale's HTML support is not documented, so it gets plain text. */
export type Formatter = { esc(value: unknown): string; b(value: unknown): string; code(value: unknown): string };

export function formatter(platform: Platform): Formatter {
  if (platform === "telegram") {
    return {
      esc: escapeHtml,
      b: (v) => `<b>${escapeHtml(v)}</b>`,
      code: (v) => `<code>${escapeHtml(v)}</code>`,
    };
  }
  const plain = (v: unknown) => String(v ?? "");
  return { esc: plain, b: plain, code: plain };
}

export const MESSAGE_LIMIT = 4000;

export function clip(text: string, max = MESSAGE_LIMIT): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const btn = (text: string, callback_data: string): InlineButton => ({ text, callback_data });

/** sendMessage / editMessageText payload fields for a screen on a platform. */
export function screenPayload(platform: Platform, screen: Screen): Record<string, unknown> {
  return {
    text: clip(screen.text),
    ...(platform === "telegram" ? { parse_mode: "HTML", link_preview_options: { is_disabled: true } } : {}),
    ...(screen.keyboard ? { reply_markup: screen.keyboard } : {}),
  };
}
