export const LIMITS = {
  bodyBytes: 16 * 1024,
  nameMax: 100,
  emailMax: 254,
  messageMin: 2,
  messageMax: 4000,
  pageMax: 500,
  maxLinks: 5,
} as const;

const EMAIL = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;
/** Control characters other than tab and newline, bidi overrides and zero-width characters. */
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/;
const LINK = /\b(?:https?:\/\/|www\.)\S{3,}/gi;

export type MessageInput = { name: string; email: string; message: string; page: string };
export type FieldErrors = Partial<Record<keyof MessageInput, string>>;

function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return "\u0000"; // forces a BAD_CHARS error
  return value.replace(/\r\n?/g, "\n").normalize("NFC").trim();
}

export function validateMessage(raw: Record<string, unknown>, opts: { requireEmail: boolean }): { value: MessageInput; errors: FieldErrors } {
  const value: MessageInput = {
    name: text(raw.name),
    email: text(raw.email).toLowerCase(),
    message: text(raw.message),
    page: text(raw.page),
  };
  const errors: FieldErrors = {};

  if (value.name.length > LIMITS.nameMax) errors.name = `Name must be at most ${LIMITS.nameMax} characters.`;
  else if (BAD_CHARS.test(value.name) || value.name.includes("\n")) errors.name = "Name contains invalid characters.";

  if (!value.email) {
    if (opts.requireEmail) errors.email = "Email is required.";
  } else if (value.email.length > LIMITS.emailMax || !EMAIL.test(value.email) || value.email.includes("..")) {
    errors.email = "Email must be a valid address.";
  }

  if (value.message.length < LIMITS.messageMin) errors.message = "Message is required.";
  else if (value.message.length > LIMITS.messageMax) errors.message = `Message must be at most ${LIMITS.messageMax} characters.`;
  else if (BAD_CHARS.test(value.message)) errors.message = "Message contains invalid characters.";
  else if ((value.message.match(LINK) ?? []).length > LIMITS.maxLinks) errors.message = "Message contains too many links.";

  if (value.page) {
    try {
      const url = new URL(value.page);
      if (!/^https?:$/.test(url.protocol) || value.page.length > LIMITS.pageMax) throw new Error();
      value.page = url.href;
    } catch {
      errors.page = "page must be an http(s) URL.";
    }
  }
  return { value, errors };
}
