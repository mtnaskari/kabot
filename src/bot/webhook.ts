import { hmac, timingSafeEqual } from "../crypto";
import { botConfig, requireSecret, type Env, type Platform } from "../env";
import { json } from "../http";
import { getMessage, messageScreen, setStatus, type MessageRow, type MessageStatus } from "../messages";
import { getSite, isSubscribed, redeemPairingCode, sitesForChat } from "../sites";
import { createBotApi, type BotApi } from "./api";
import { btn, formatter, screenPayload, type Screen } from "./format";

type Chat = { id: number | string; type?: string };
type Update = {
  update_id: number;
  message?: { message_id: number; chat: Chat; text?: string; from?: { id: number; is_bot?: boolean } };
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: Chat } };
};

export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/** The secret path segment of a platform's webhook URL. */
export async function webhookPathSecret(secret: string, platform: Platform): Promise<string> {
  return (await hmac(secret, `webhook-path:${platform}`)).slice(0, 40);
}

/** Telegram also sends this value in a header. Bale does not document the header, so it relies on the path. */
export async function webhookHeaderSecret(secret: string, platform: Platform): Promise<string> {
  return hmac(secret, `webhook-header:${platform}`);
}

export async function handleWebhook(request: Request, env: Env, platform: Platform, pathSecret: string): Promise<Response> {
  const secret = requireSecret(env);
  if (!timingSafeEqual(pathSecret, await webhookPathSecret(secret, platform))) return json(404, { ok: false });
  if (platform === "telegram") {
    const header = request.headers.get(TELEGRAM_SECRET_HEADER) ?? "";
    if (!timingSafeEqual(header, await webhookHeaderSecret(secret, platform))) return json(403, { ok: false });
  }
  if (request.method !== "POST") return json(405, { ok: false });

  const bot = botConfig(env, platform);
  if (!bot) return json(503, { ok: false, error: `${platform} bot is not configured.` });

  let update: Update;
  try {
    update = (await request.json()) as Update;
  } catch {
    return json(400, { ok: false });
  }
  if (!update || !Number.isSafeInteger(update.update_id)) return json(400, { ok: false });

  // The platform retries until it gets a 2xx, so record the id first and skip repeats.
  const fresh = await env.DB.prepare("INSERT OR IGNORE INTO updates (platform, update_id) VALUES (?, ?)").bind(platform, update.update_id).run();
  if (!fresh.meta.changes) return json(200, { ok: true, duplicate: true });

  try {
    await processUpdate({ env, platform, api: createBotApi(bot) }, update);
  } catch (error) {
    // Answer 200 anyway: a retry would hit the same error.
    console.error("update_failed", platform, update.update_id, error instanceof Error ? error.message : String(error));
  }
  return json(200, { ok: true });
}

type Ctx = { env: Env; platform: Platform; api: BotApi };

async function send(ctx: Ctx, chatId: string, screen: Screen): Promise<void> {
  await ctx.api.call("sendMessage", { chat_id: chatId, ...screenPayload(ctx.platform, screen) });
}

export async function processUpdate(ctx: Ctx, update: Update): Promise<void> {
  if (update.callback_query) return handleCallback(ctx, update.callback_query);
  const message = update.message;
  if (!message?.text || message.from?.is_bot) return;
  const chatId = String(message.chat.id);
  const [rawCommand, ...args] = message.text.trim().split(/\s+/);
  const command = rawCommand.toLowerCase().replace(/@\S+$/, "");

  switch (command) {
    case "/start":
    case "/pair":
      return args[0] ? pair(ctx, chatId, args[0]) : send(ctx, chatId, welcome(ctx.platform));
    case "/sites":
      return send(ctx, chatId, await sitesScreen(ctx, chatId));
    case "/inbox":
      return send(ctx, chatId, await inboxScreen(ctx, chatId));
    case "/help":
      return send(ctx, chatId, welcome(ctx.platform));
    default:
      if (command.startsWith("/")) return send(ctx, chatId, { text: "Unknown command. Send /help for the list." });
  }
}

function welcome(platform: Platform): Screen {
  const f = formatter(platform);
  return {
    text: [
      `🕊 ${f.b("kabot")} delivers your website's messages to this chat.`,
      "",
      `To link a site, open the pairing link from your deployment, or send ${f.code("/start <pairing code>")}.`,
      "",
      `${f.code("/sites")} lists linked sites`,
      `${f.code("/inbox")} shows unread messages`,
      `${f.code("/help")} shows this text`,
    ].join("\n"),
  };
}

async function pair(ctx: Ctx, chatId: string, code: string): Promise<void> {
  const f = formatter(ctx.platform);
  const { success } = await ctx.env.RATE_LIMITER.limit({ key: `pair:${ctx.platform}:${chatId}` });
  if (!success) return send(ctx, chatId, { text: "Too many attempts. Wait a minute and try again." });
  const site = await redeemPairingCode(ctx.env.DB, code.toLowerCase(), ctx.platform, chatId);
  if (!site) return send(ctx, chatId, { text: "This pairing code is invalid or has expired. Ask for a new one." });
  return send(ctx, chatId, {
    text: `✅ This chat now receives messages from ${f.b(site.name)} (${f.code(site.id)}).`,
  });
}

async function sitesScreen(ctx: Ctx, chatId: string): Promise<Screen> {
  const f = formatter(ctx.platform);
  const sites = await sitesForChat(ctx.env.DB, ctx.platform, chatId);
  if (!sites.length) return { text: "No site is linked to this chat yet. Send /help to see how to link one." };
  return {
    text: ["🌐 " + f.b("Linked sites"), ...sites.map((s) => `• ${f.b(s.name)} (${f.code(s.id)}) · ${s.unread} unread`)].join("\n"),
    keyboard: { inline_keyboard: sites.map((s) => [btn(`Unlink ${s.name}`.slice(0, 60), `x:${s.id}`)]) },
  };
}

async function inboxScreen(ctx: Ctx, chatId: string): Promise<Screen> {
  const { results } = await ctx.env.DB.prepare(
    `SELECT m.id, m.name, m.email, m.body FROM messages m
       JOIN subscriptions sub ON sub.site_id = m.site_id
       WHERE sub.platform = ? AND sub.chat_id = ? AND m.status = 'new'
       ORDER BY m.id DESC LIMIT 10`,
  )
    .bind(ctx.platform, chatId)
    .all<Pick<MessageRow, "id" | "name" | "email" | "body">>();
  if (!results.length) return { text: "📭 No unread messages." };
  return {
    text: `📥 ${formatter(ctx.platform).b("Unread messages")}`,
    keyboard: {
      inline_keyboard: results.map((m) => [btn(`#${m.id} ${(m.name || m.email || "Anonymous").slice(0, 20)}: ${m.body.slice(0, 30)}`, `o:${m.id}`)]),
    },
  };
}

const STATUS_ACTIONS: Record<string, MessageStatus> = { r: "read", u: "new", a: "archived" };

async function handleCallback(ctx: Ctx, query: NonNullable<Update["callback_query"]>): Promise<void> {
  const answer = (text?: string) => ctx.api.call("answerCallbackQuery", { callback_query_id: query.id, ...(text ? { text } : {}) }).catch(() => {});
  const chat = query.message?.chat;
  const [action, arg] = (query.data ?? "").split(":");
  if (!chat || !action || !arg) return void (await answer());
  const chatId = String(chat.id);

  if (action === "x" || action === "X") {
    const site = await getSite(ctx.env.DB, arg);
    if (!site || !(await isSubscribed(ctx.env.DB, site.id, ctx.platform, chatId))) return void (await answer("Not linked."));
    if (action === "x") {
      await answer();
      return send(ctx, chatId, {
        text: `Stop receiving messages from ${formatter(ctx.platform).b(site.name)} in this chat?`,
        keyboard: { inline_keyboard: [[btn("Yes, unlink", `X:${site.id}`)]] },
      });
    }
    await ctx.env.DB.prepare("DELETE FROM subscriptions WHERE site_id = ? AND platform = ? AND chat_id = ?").bind(site.id, ctx.platform, chatId).run();
    await answer("Unlinked.");
    return send(ctx, chatId, { text: `This chat no longer receives messages from ${formatter(ctx.platform).b(site.name)}.` });
  }

  const message = /^\d+$/.test(arg) ? await getMessage(ctx.env.DB, Number(arg)) : null;
  // A chat may only act on messages of sites it is paired with.
  if (!message || !(await isSubscribed(ctx.env.DB, message.site_id, ctx.platform, chatId))) {
    return void (await answer("Message not found."));
  }

  if (action === "o") {
    const site = await getSite(ctx.env.DB, message.site_id);
    await answer();
    const sent = await ctx.api.call<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      ...screenPayload(ctx.platform, messageScreen(ctx.platform, site ?? { name: message.site_id }, message)),
    });
    await ctx.env.DB.prepare("INSERT OR REPLACE INTO deliveries (message_id, platform, chat_id, bot_message_id) VALUES (?, ?, ?, ?)")
      .bind(message.id, ctx.platform, chatId, sent.message_id)
      .run();
    return;
  }

  const status = STATUS_ACTIONS[action];
  if (!status) return void (await answer());
  await setStatus(ctx.env, message, status);
  await answer(status === "archived" ? "Archived." : status === "read" ? "Marked read." : "Marked unread.");
}
