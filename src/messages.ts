import { createBotApi, type BotApi } from "./bot/api";
import { btn, formatter, screenPayload, type Screen } from "./bot/format";
import { hmac, unseal } from "./crypto";
import { botConfig, intVar, requireSecret, type Env, type Platform } from "./env";
import { HttpError } from "./http";
import { subscriptionsForSite, type SiteRow } from "./sites";
import { verifyTurnstile } from "./turnstile";
import { validateMessage } from "./validate";

export type MessageStatus = "new" | "read" | "archived";

export type MessageRow = {
  id: number;
  site_id: string;
  name: string;
  email: string;
  body: string;
  page: string;
  source: "browser" | "server";
  status: MessageStatus;
  ip_hash: string;
  notify_attempts: number;
  notified_at: string | null;
  notify_error: string | null;
  created_at: string;
};

export type SubmitContext = {
  env: Env;
  site: SiteRow;
  source: "browser" | "server";
  /** The visitor's IP; empty when a server did not forward it. */
  ip: string;
  waitUntil(promise: Promise<unknown>): void;
};

export type SubmitResult = { id: number | null };

/**
 * Accepts a message. Order: honeypot, rate limit, validation, Turnstile,
 * daily cap, store, then notify in the background. A failed notification
 * never loses the message: it is already in D1 and the cron retries it.
 */
export async function submitMessage(ctx: SubmitContext, input: Record<string, unknown>): Promise<SubmitResult> {
  const { env, site } = ctx;
  const secret = requireSecret(env);

  // Humans never see this field. Bots fill it; pretend success and drop the message.
  if (typeof input.website === "string" && input.website !== "") return { id: null };

  const ipHash = ctx.ip ? (await hmac(secret, `ip:${ctx.ip}`)).slice(0, 32) : "";
  const limiter = ipHash ? env.RATE_LIMITER : env.SERVER_RATE_LIMITER;
  const { success } = await limiter.limit({ key: ipHash ? `${site.id}:${ipHash}` : `${site.id}:server` });
  if (!success) throw new HttpError(429, "rate_limited", "Too many messages. Please try again later.", undefined, 60);

  const { value, errors } = validateMessage(input, { requireEmail: site.require_email === 1 });
  const first = Object.values(errors)[0];
  if (first) throw new HttpError(400, "validation", first, errors);

  // Turnstile protects browser submissions. A server holding the API key is trusted.
  if (ctx.source === "browser" && site.turnstile_secret) {
    const turnstileSecret = await unseal(secret, site.turnstile_secret);
    if (!(await verifyTurnstile(turnstileSecret, input.turnstileToken, ctx.ip))) {
      throw new HttpError(403, "turnstile_failed", "Verification failed. Please try again.");
    }
  }

  if (ipHash) {
    const daily = intVar(env.DAILY_LIMIT_PER_IP, 20);
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE site_id = ? AND ip_hash = ? AND created_at > ?")
      .bind(site.id, ipHash, since)
      .first<{ n: number }>();
    if (daily > 0 && (row?.n ?? 0) >= daily) {
      throw new HttpError(429, "rate_limited", "Daily message limit reached. Please try again tomorrow.", undefined, 3600);
    }
  }

  const message = await env.DB.prepare(
    "INSERT INTO messages (site_id, name, email, body, page, source, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
  )
    .bind(site.id, value.name, value.email, value.message, value.page, ctx.source, ipHash)
    .first<MessageRow>();
  if (!message) throw new Error("message insert returned no row");

  ctx.waitUntil(notifyMessage(env, site, message).catch((error) => console.error("notify_unhandled", String(error))));
  return { id: message.id };
}

const STATUS_LABEL: Record<MessageStatus, string> = { new: "🔵 New", read: "✅ Read", archived: "🗄 Archived" };

export function messageScreen(platform: Platform, site: Pick<SiteRow, "name">, m: MessageRow): Screen {
  const f = formatter(platform);
  const lines = [
    `📬 ${f.b(site.name)} · #${m.id} · ${STATUS_LABEL[m.status]}`,
    `From: ${m.name ? f.b(m.name) : "Anonymous"}${m.email ? ` ${f.esc(`<${m.email}>`)}` : ""}`,
    ...(m.page ? [`Page: ${f.esc(m.page)}`] : []),
    `At: ${f.esc(m.created_at.replace("T", " ").slice(0, 16))} UTC${m.source === "server" ? " · via API" : ""}`,
    "",
    f.esc(m.body),
  ];

  const actions =
    m.status === "new"
      ? [btn("✅ Mark read", `r:${m.id}`), btn("🗄 Archive", `a:${m.id}`)]
      : m.status === "read"
        ? [btn("🔵 Mark unread", `u:${m.id}`), btn("🗄 Archive", `a:${m.id}`)]
        : [btn("📥 Unarchive", `r:${m.id}`)];
  return { text: lines.join("\n"), keyboard: { inline_keyboard: [actions] } };
}

function apiFor(env: Env, platform: Platform, cache: Map<Platform, BotApi | null>): BotApi | null {
  if (!cache.has(platform)) {
    const bot = botConfig(env, platform);
    cache.set(platform, bot ? createBotApi(bot) : null);
  }
  return cache.get(platform) ?? null;
}

/** Sends a message to every chat paired with its site, skipping chats that already have it. */
export async function notifyMessage(env: Env, site: SiteRow, message: MessageRow): Promise<void> {
  const subs = await subscriptionsForSite(env.DB, site.id);
  const { results: done } = await env.DB.prepare("SELECT platform, chat_id FROM deliveries WHERE message_id = ?")
    .bind(message.id)
    .all<{ platform: string; chat_id: string }>();
  const delivered = new Set(done.map((d) => `${d.platform}:${d.chat_id}`));
  const apis = new Map<Platform, BotApi | null>();
  const errors: string[] = [];

  if (!subs.length) errors.push("No chat is paired with this site.");
  for (const sub of subs) {
    if (delivered.has(`${sub.platform}:${sub.chat_id}`)) continue;
    const api = apiFor(env, sub.platform, apis);
    if (!api) {
      errors.push(`${sub.platform} bot token is not configured.`);
      continue;
    }
    try {
      const sent = await api.call<{ message_id: number }>("sendMessage", {
        chat_id: sub.chat_id,
        ...screenPayload(sub.platform, messageScreen(sub.platform, site, message)),
      });
      await env.DB.prepare("INSERT OR IGNORE INTO deliveries (message_id, platform, chat_id, bot_message_id) VALUES (?, ?, ?, ?)")
        .bind(message.id, sub.platform, sub.chat_id, sent.message_id)
        .run();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (errors.length) {
    await env.DB.prepare("UPDATE messages SET notify_attempts = notify_attempts + 1, notify_error = ? WHERE id = ?")
      .bind(errors.join("; ").slice(0, 500), message.id)
      .run();
  } else {
    await env.DB.prepare(
      "UPDATE messages SET notify_attempts = notify_attempts + 1, notify_error = NULL, notified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    )
      .bind(message.id)
      .run();
  }
}

export async function getMessage(db: D1Database, id: number): Promise<MessageRow | null> {
  return db.prepare("SELECT * FROM messages WHERE id = ?").bind(id).first<MessageRow>();
}

/** Changes a message's status and refreshes every chat's copy of it. */
export async function setStatus(env: Env, message: MessageRow, status: MessageStatus): Promise<MessageRow> {
  const updated = await env.DB.prepare("UPDATE messages SET status = ? WHERE id = ? RETURNING *").bind(status, message.id).first<MessageRow>();
  if (!updated) throw new HttpError(404, "not_found", "Message not found.");
  const site = await env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(updated.site_id).first<SiteRow>();
  if (!site) return updated;

  const { results } = await env.DB.prepare("SELECT platform, chat_id, bot_message_id FROM deliveries WHERE message_id = ?")
    .bind(updated.id)
    .all<{ platform: Platform; chat_id: string; bot_message_id: number }>();
  const apis = new Map<Platform, BotApi | null>();
  await Promise.all(
    results.map(async (d) => {
      const api = apiFor(env, d.platform, apis);
      if (!api) return;
      try {
        await api.call("editMessageText", {
          chat_id: d.chat_id,
          message_id: d.bot_message_id,
          ...screenPayload(d.platform, messageScreen(d.platform, site, updated)),
        });
      } catch {
        // The copy was deleted or is unchanged; the status change itself succeeded.
      }
    }),
  );
  return updated;
}

/** Retries failed notifications and applies the retention policy. Runs from the cron trigger. */
export async function maintenance(env: Env): Promise<{ retried: number; deleted: number }> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM messages WHERE notified_at IS NULL AND notify_attempts BETWEEN 1 AND 5
       AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days') ORDER BY id LIMIT 25`,
  ).all<MessageRow>();
  for (const message of results) {
    const site = await env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(message.site_id).first<SiteRow>();
    if (site) await notifyMessage(env, site, message);
  }

  await env.DB.prepare("DELETE FROM updates WHERE received_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')").run();
  await env.DB.prepare("DELETE FROM pairing_codes WHERE expires_at < ?").bind(new Date().toISOString()).run();

  let deleted = 0;
  const days = intVar(env.RETENTION_DAYS, 0);
  if (days > 0) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const res = await env.DB.prepare("DELETE FROM messages WHERE status = 'archived' AND created_at < ?").bind(cutoff).run();
    deleted = res.meta.changes ?? 0;
  }
  return { retried: results.length, deleted };
}

