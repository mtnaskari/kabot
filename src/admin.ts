import { createBotApi } from "./bot/api";
import { webhookHeaderSecret, webhookPathSecret } from "./bot/webhook";
import { timingSafeEqual } from "./crypto";
import { configuredBots, requireSecret, type Env, type Platform } from "./env";
import { bearer, HttpError, json, readJson } from "./http";
import { createPairingCode, getSite, issueApiKey, revokeApiKey, siteColumns, SITE_ID, toSite, type SiteRow } from "./sites";

const BOT_COMMANDS = [
  { command: "inbox", description: "Unread messages" },
  { command: "sites", description: "Linked sites" },
  { command: "help", description: "How kabot works" },
];

function authorize(request: Request, env: Env): void {
  const expected = env.ADMIN_TOKEN?.trim();
  if (!expected || expected.length < 32) throw new HttpError(503, "not_configured", "ADMIN_TOKEN must be set to at least 32 characters.");
  if (!timingSafeEqual(bearer(request) ?? "", expected)) throw new HttpError(401, "unauthorized", "A valid admin token is required.");
}

async function requireSite(db: D1Database, id: string): Promise<SiteRow> {
  const site = await getSite(db, id);
  if (!site) throw new HttpError(404, "not_found", "Site not found.");
  return site;
}

/** Pairing code, the command to send, and a link to each configured bot. */
async function pairing(env: Env, siteId: string) {
  const { code, expiresAt } = await createPairingCode(env.DB, siteId);
  const links: Partial<Record<Platform, string>> = {};
  for (const bot of configuredBots(env)) {
    let username: string | undefined;
    try {
      username = (await createBotApi(bot).call<{ username?: string }>("getMe", {})).username;
    } catch {
      // Unreachable bot: the command below still works.
    }
    // Telegram deep links carry the code. Bale does not document start parameters,
    // so its link only opens the bot and the owner sends the command.
    if (username) links[bot.platform] = bot.platform === "telegram" ? `https://t.me/${username}?start=${code}` : `https://ble.ir/${username}`;
  }
  return { code, expiresAt, command: `/start ${code}`, links };
}

async function subscriptions(db: D1Database, siteId: string) {
  const { results } = await db
    .prepare("SELECT platform, chat_id AS chatId, created_at AS createdAt FROM subscriptions WHERE site_id = ? ORDER BY created_at")
    .bind(siteId)
    .all();
  return results;
}

export async function handleAdmin(request: Request, env: Env, path: string[]): Promise<Response> {
  authorize(request, env);
  const secret = requireSecret(env);
  const method = request.method;
  const [resource, id, sub] = path;

  if (resource === "sites" && !id) {
    if (method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM sites ORDER BY created_at").all<SiteRow>();
      return json(200, { ok: true, sites: results.map(toSite) });
    }
    if (method === "POST") {
      const input = await readJson(request, 8 * 1024);
      if (typeof input.id !== "string" || !SITE_ID.test(input.id)) {
        throw new HttpError(400, "validation", "id must be 1-40 lowercase letters, digits or hyphens.");
      }
      const cols = await siteColumns(input, secret, false);
      if (await getSite(env.DB, input.id)) throw new HttpError(409, "conflict", "A site with this id already exists.");
      const names = Object.keys(cols);
      await env.DB.prepare(`INSERT INTO sites (id, ${names.join(", ")}) VALUES (?, ${names.map(() => "?").join(", ")})`)
        .bind(input.id, ...names.map((n) => cols[n]))
        .run();
      const apiKey = input.apiKey === false ? null : await issueApiKey(env.DB, input.id);
      const site = toSite(await requireSite(env.DB, input.id));
      return json(201, { ok: true, site, apiKey, pairing: await pairing(env, site.id) });
    }
  }

  if (resource === "sites" && id) {
    const row = await requireSite(env.DB, id);
    if (!sub) {
      if (method === "GET") return json(200, { ok: true, site: toSite(row), subscriptions: await subscriptions(env.DB, id) });
      if (method === "PATCH") {
        const cols = await siteColumns(await readJson(request, 8 * 1024), secret, true);
        const names = Object.keys(cols);
        if (names.length) {
          await env.DB.prepare(`UPDATE sites SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE id = ?`)
            .bind(...names.map((n) => cols[n]), id)
            .run();
        }
        return json(200, { ok: true, site: toSite(await requireSite(env.DB, id)) });
      }
      if (method === "DELETE") {
        // D1 does not enforce foreign keys by default, so delete dependants explicitly.
        await env.DB.batch([
          env.DB.prepare("DELETE FROM deliveries WHERE message_id IN (SELECT id FROM messages WHERE site_id = ?)").bind(id),
          env.DB.prepare("DELETE FROM messages WHERE site_id = ?").bind(id),
          env.DB.prepare("DELETE FROM subscriptions WHERE site_id = ?").bind(id),
          env.DB.prepare("DELETE FROM pairing_codes WHERE site_id = ?").bind(id),
          env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(id),
        ]);
        return json(200, { ok: true });
      }
    }
    if (sub === "api-key" && method === "POST") return json(200, { ok: true, apiKey: await issueApiKey(env.DB, id) });
    if (sub === "api-key" && method === "DELETE") {
      await revokeApiKey(env.DB, id);
      return json(200, { ok: true });
    }
    if (sub === "pairing-codes" && method === "POST") return json(201, { ok: true, pairing: await pairing(env, id) });
    if (sub === "subscriptions" && method === "GET") return json(200, { ok: true, subscriptions: await subscriptions(env.DB, id) });
  }

  if (resource === "webhooks" && !id && (method === "POST" || method === "GET")) {
    const bots = configuredBots(env);
    if (!bots.length) throw new HttpError(400, "not_configured", "Set TELEGRAM_BOT_TOKEN or BALE_BOT_TOKEN first.");
    const origin = new URL(request.url).origin;
    const results: Record<string, unknown> = {};
    for (const bot of bots) {
      const api = createBotApi(bot);
      try {
        if (method === "POST") {
          const url = `${origin}/bot/${bot.platform}/${await webhookPathSecret(secret, bot.platform)}`;
          await api.call("setWebhook", {
            url,
            allowed_updates: ["message", "callback_query"],
            ...(bot.platform === "telegram" ? { secret_token: await webhookHeaderSecret(secret, bot.platform), drop_pending_updates: true } : {}),
          });
          await api.call("setMyCommands", { commands: BOT_COMMANDS }).catch(() => undefined);
        }
        const info = await api.call<{ url?: string; pending_update_count?: number; last_error_message?: string }>("getWebhookInfo", {});
        results[bot.platform] = {
          ok: true,
          // The path contains a secret; show only where it points.
          url: info.url ? info.url.replace(/\/[^/]+$/, "/…") : null,
          pendingUpdates: info.pending_update_count ?? 0,
          lastError: info.last_error_message ?? null,
        };
      } catch (error) {
        results[bot.platform] = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    return json(200, { ok: true, webhooks: results });
  }

  throw new HttpError(404, "not_found", "Unknown admin route.");
}
