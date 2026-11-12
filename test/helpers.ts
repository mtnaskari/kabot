import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import { webhookHeaderSecret, webhookPathSecret } from "../src/bot/webhook";
import type { Platform } from "../src/env";
import worker from "../src/index";

export const ORIGIN = "https://example.com";
export const BASE = "https://kabot.test";
export { env };

/** Calls the Worker directly and waits for its background work, so notifications have run. */
export async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${BASE}${path}`, init) as Request<unknown, IncomingRequestCfProperties>, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export async function admin(path: string, method = "GET", body?: unknown): Promise<{ status: number; body: any }> {
  const res = await call(`/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${env.ADMIN_TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

export type BotCall = { platform: Platform | "turnstile"; method: string; payload: any };

/**
 * Replaces outbound fetch with fake Telegram, Bale and Turnstile endpoints and
 * records every call. Turnstile accepts the token "pass".
 */
export function mockOutbound(opts: { fail?: (c: BotCall) => boolean } = {}) {
  const calls: BotCall[] = [];
  let nextId = 1000;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "challenges.cloudflare.com") {
      const form = init?.body as FormData;
      calls.push({ platform: "turnstile", method: "siteverify", payload: Object.fromEntries(form.entries()) });
      return Response.json({ success: form.get("response") === "pass" });
    }
    const platform: Platform | null = url.hostname === "api.telegram.org" ? "telegram" : url.hostname === "tapi.bale.ai" ? "bale" : null;
    if (!platform) throw new Error(`unexpected fetch to ${url.href}`);
    const method = url.pathname.split("/").pop()!;
    const payload = init?.body ? JSON.parse(String(init.body)) : {};
    const record = { platform, method, payload };
    calls.push(record);
    if (opts.fail?.(record)) return Response.json({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, { status: 403 });
    const result =
      method === "sendMessage"
        ? { message_id: nextId++ }
        : method === "getMe"
          ? { id: 1, is_bot: true, username: `${platform}_kabot_bot` }
          : method === "getWebhookInfo"
            ? { url: "https://kabot.test/bot/x/secret", pending_update_count: 0 }
            : true;
    return Response.json({ ok: true, result });
  });
  return {
    calls,
    sent: (method = "sendMessage") => calls.filter((c) => c.method === method),
    clear: () => (calls.length = 0),
    restore: () => spy.mockRestore(),
  };
}

let siteCounter = 0;
let updateCounter = 1;

export async function createSite(input: Record<string, unknown> = {}) {
  const id = `site-${++siteCounter}-${crypto.randomUUID().slice(0, 6)}`;
  const res = await admin("/sites", "POST", { id, name: `Site ${siteCounter}`, allowedOrigins: [ORIGIN], ...input });
  if (res.status !== 201) throw new Error(`createSite failed: ${JSON.stringify(res.body)}`);
  return { id, apiKey: res.body.apiKey as string | null, code: res.body.pairing.code as string, body: res.body };
}

export async function webhook(platform: Platform, update: Record<string, unknown>): Promise<Response> {
  const path = await webhookPathSecret(env.KABOT_SECRET!, platform);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (platform === "telegram") headers["x-telegram-bot-api-secret-token"] = await webhookHeaderSecret(env.KABOT_SECRET!, platform);
  return call(`/bot/${platform}/${path}`, { method: "POST", headers, body: JSON.stringify({ update_id: updateCounter++, ...update }) });
}

export function text(chatId: number, value: string) {
  return { message: { message_id: updateCounter, chat: { id: chatId, type: "private" }, from: { id: chatId }, text: value } };
}

export function press(chatId: number, data: string, messageId = 1) {
  return { callback_query: { id: `cb${updateCounter}`, data, message: { message_id: messageId, chat: { id: chatId, type: "private" } } } };
}

export async function pairedSite(platform: Platform = "telegram", chatId = 42, input: Record<string, unknown> = {}) {
  const site = await createSite(input);
  await webhook(platform, text(chatId, `/start ${site.code}`));
  return site;
}


export function browserPost(body: Record<string, unknown>, opts: { origin?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": opts.ip ?? uniqueIp() };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  return call("/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
}

let ipSeq = 0;
/** A distinct documentation-range IPv6 address per call, so per-IP rate limits do not interfere. */
export function uniqueIp(): string {
  ipSeq++;
  return `2001:db8::${ipSeq.toString(16)}`;
}

export function serverPost(apiKey: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return call("/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, ...headers },
    body: JSON.stringify(body),
  });
}
