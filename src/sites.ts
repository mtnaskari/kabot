import { randomCode, seal, sha256, toBase64Url, randomBytes } from "./crypto";
import type { Platform } from "./env";
import { HttpError } from "./http";

export type SiteRow = {
  id: string;
  name: string;
  allowed_origins: string;
  api_key_hash: string | null;
  require_email: number;
  turnstile_site_key: string | null;
  turnstile_secret: string | null;
  created_at: string;
};

export type Site = {
  id: string;
  name: string;
  allowedOrigins: string[];
  hasApiKey: boolean;
  requireEmail: boolean;
  turnstileSiteKey: string | null;
  turnstileEnabled: boolean;
  createdAt: string;
};

export const SITE_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const API_KEY_PREFIX = "kb_";
const PAIRING_TTL_MINUTES = 60;

export function toSite(row: SiteRow): Site {
  return {
    id: row.id,
    name: row.name,
    allowedOrigins: parseOrigins(row.allowed_origins),
    hasApiKey: row.api_key_hash !== null,
    requireEmail: row.require_email === 1,
    turnstileSiteKey: row.turnstile_site_key,
    turnstileEnabled: row.turnstile_secret !== null,
    createdAt: row.created_at,
  };
}

function parseOrigins(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Normalizes an origin such as "https://example.com" and rejects anything else. */
export function normalizeOrigin(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "validation", "Origins must be strings.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, "validation", `Invalid origin: ${value.slice(0, 100)}`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new HttpError(400, "validation", `Origin must use https: ${value.slice(0, 100)}`);
  }
  if (url.origin === "null" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new HttpError(400, "validation", `Origin must not have a path, query or credentials: ${value.slice(0, 100)}`);
  }
  return url.origin;
}

export function originAllowed(site: Site, origin: string | null): boolean {
  return origin !== null && site.allowedOrigins.includes(origin);
}

export async function getSite(db: D1Database, id: string): Promise<SiteRow | null> {
  return db.prepare("SELECT * FROM sites WHERE id = ?").bind(id).first<SiteRow>();
}

export async function siteByApiKey(db: D1Database, key: string): Promise<SiteRow | null> {
  if (!key.startsWith(API_KEY_PREFIX) || key.length > 100) return null;
  return db.prepare("SELECT * FROM sites WHERE api_key_hash = ?").bind(await sha256(key)).first<SiteRow>();
}

export type SiteInput = {
  name?: unknown;
  allowedOrigins?: unknown;
  requireEmail?: unknown;
  turnstileSiteKey?: unknown;
  turnstileSecret?: unknown;
};

/** Validates admin input and returns the columns to write. */
export async function siteColumns(input: SiteInput, secret: string, partial: boolean): Promise<Record<string, unknown>> {
  const cols: Record<string, unknown> = {};
  if (input.name !== undefined || !partial) {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 80) {
      throw new HttpError(400, "validation", "name is required and must be at most 80 characters.");
    }
    cols.name = input.name.trim();
  }
  if (input.allowedOrigins !== undefined) {
    if (!Array.isArray(input.allowedOrigins) || input.allowedOrigins.length > 20) {
      throw new HttpError(400, "validation", "allowedOrigins must be an array of at most 20 origins.");
    }
    cols.allowed_origins = JSON.stringify([...new Set(input.allowedOrigins.map(normalizeOrigin))]);
  }
  if (input.requireEmail !== undefined) {
    if (typeof input.requireEmail !== "boolean") throw new HttpError(400, "validation", "requireEmail must be a boolean.");
    cols.require_email = input.requireEmail ? 1 : 0;
  }
  if (input.turnstileSiteKey !== undefined) {
    if (input.turnstileSiteKey !== null && (typeof input.turnstileSiteKey !== "string" || input.turnstileSiteKey.length > 200)) {
      throw new HttpError(400, "validation", "turnstileSiteKey must be a string or null.");
    }
    cols.turnstile_site_key = input.turnstileSiteKey || null;
  }
  if (input.turnstileSecret !== undefined) {
    if (input.turnstileSecret !== null && (typeof input.turnstileSecret !== "string" || input.turnstileSecret.length > 200)) {
      throw new HttpError(400, "validation", "turnstileSecret must be a string or null.");
    }
    cols.turnstile_secret = input.turnstileSecret ? await seal(secret, input.turnstileSecret) : null;
  }
  return cols;
}

/** Issues a new server API key. Only its hash is stored, so the key is shown once. */
export async function issueApiKey(db: D1Database, siteId: string): Promise<string> {
  const key = `${API_KEY_PREFIX}${toBase64Url(randomBytes(32))}`;
  await db.prepare("UPDATE sites SET api_key_hash = ? WHERE id = ?").bind(await sha256(key), siteId).run();
  return key;
}

export async function revokeApiKey(db: D1Database, siteId: string): Promise<void> {
  await db.prepare("UPDATE sites SET api_key_hash = NULL WHERE id = ?").bind(siteId).run();
}

/** Creates a one-time pairing code valid for an hour. 20 characters carry 100 bits. */
export async function createPairingCode(db: D1Database, siteId: string): Promise<{ code: string; expiresAt: string }> {
  const code = randomCode(20);
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM pairing_codes WHERE expires_at < ?").bind(new Date().toISOString()),
    db.prepare("INSERT INTO pairing_codes (code_hash, site_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(code), siteId, expiresAt),
  ]);
  return { code, expiresAt };
}

/** Consumes a pairing code and subscribes the chat. Returns the site, or null when the code is invalid. */
export async function redeemPairingCode(db: D1Database, code: string, platform: Platform, chatId: string): Promise<SiteRow | null> {
  if (!/^[a-z0-9]{20}$/.test(code)) return null;
  const hash = await sha256(code);
  const row = await db
    .prepare("DELETE FROM pairing_codes WHERE code_hash = ? AND expires_at > ? RETURNING site_id")
    .bind(hash, new Date().toISOString())
    .first<{ site_id: string }>();
  if (!row) return null;
  await db
    .prepare("INSERT OR IGNORE INTO subscriptions (site_id, platform, chat_id) VALUES (?, ?, ?)")
    .bind(row.site_id, platform, chatId)
    .run();
  return getSite(db, row.site_id);
}

export type Subscription = { site_id: string; platform: Platform; chat_id: string };

export async function subscriptionsForSite(db: D1Database, siteId: string): Promise<Subscription[]> {
  const { results } = await db.prepare("SELECT site_id, platform, chat_id FROM subscriptions WHERE site_id = ?").bind(siteId).all<Subscription>();
  return results;
}

export async function sitesForChat(db: D1Database, platform: Platform, chatId: string): Promise<(SiteRow & { unread: number })[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.site_id = s.id AND m.status = 'new') AS unread
       FROM sites s JOIN subscriptions sub ON sub.site_id = s.id
       WHERE sub.platform = ? AND sub.chat_id = ? ORDER BY s.name`,
    )
    .bind(platform, chatId)
    .all<SiteRow & { unread: number }>();
  return results;
}

export async function isSubscribed(db: D1Database, siteId: string, platform: Platform, chatId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM subscriptions WHERE site_id = ? AND platform = ? AND chat_id = ?")
    .bind(siteId, platform, chatId)
    .first<{ ok: number }>();
  return row !== null;
}
