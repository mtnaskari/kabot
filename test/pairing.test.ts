import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call, createSite, env, mockOutbound, press, text, webhook } from "./helpers";

let out: ReturnType<typeof mockOutbound>;
beforeEach(() => (out = mockOutbound()));
afterEach(() => out.restore());

describe("bot webhook", () => {
  it("rejects a wrong path secret or a missing Telegram header", async () => {
    expect((await call("/bot/telegram/wrong", { method: "POST", body: "{}" })).status).toBe(404);
    const site = await createSite();
    const { webhookPathSecret } = await import("../src/bot/webhook");
    const path = await webhookPathSecret(env.KABOT_SECRET!, "telegram");
    out.clear();
    const res = await call(`/bot/telegram/${path}`, { method: "POST", body: JSON.stringify({ update_id: 1, ...text(1, `/start ${site.code}`) }) });
    expect(res.status).toBe(403);
    expect(out.calls).toHaveLength(0);
  });

  it("pairs a chat with /start <code> once", async () => {
    const site = await createSite();
    await webhook("telegram", text(7, `/start ${site.code}`));
    const reply = out.sent().at(-1)!;
    expect(reply.payload.chat_id).toBe("7");
    expect(reply.payload.text).toContain("now receives messages");
    const sub = await env.DB.prepare("SELECT * FROM subscriptions WHERE site_id = ?").bind(site.id).all();
    expect(sub.results).toEqual([expect.objectContaining({ platform: "telegram", chat_id: "7" })]);

    await webhook("telegram", text(8, `/start ${site.code}`));
    expect(out.sent().at(-1)!.payload.text).toContain("invalid or has expired");
  });

  it("rejects expired codes", async () => {
    const site = await createSite();
    await env.DB.prepare("UPDATE pairing_codes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE site_id = ?").bind(site.id).run();
    await webhook("telegram", text(9, `/start ${site.code}`));
    expect(out.sent().at(-1)!.payload.text).toContain("invalid or has expired");
  });

  it("ignores repeated update ids", async () => {
    const { webhookHeaderSecret, webhookPathSecret } = await import("../src/bot/webhook");
    const path = await webhookPathSecret(env.KABOT_SECRET!, "telegram");
    const init = {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": await webhookHeaderSecret(env.KABOT_SECRET!, "telegram") },
      body: JSON.stringify({ update_id: 99_999, ...text(5, "/help") }),
    };
    await call(`/bot/telegram/${path}`, init);
    const second = await call(`/bot/telegram/${path}`, init);
    expect(await second.json()).toMatchObject({ duplicate: true });
    expect(out.sent()).toHaveLength(1);
  });

  it("pairs Bale chats through tapi.bale.ai without HTML parse mode", async () => {
    const site = await createSite();
    await webhook("bale", text(11, `/start ${site.code}`));
    const reply = out.sent().at(-1)!;
    expect(reply.platform).toBe("bale");
    expect(reply.payload.parse_mode).toBeUndefined();
  });

  it("lists and unlinks sites", async () => {
    const site = await createSite();
    await webhook("telegram", text(12, `/start ${site.code}`));
    await webhook("telegram", text(12, "/sites"));
    const list = out.sent().at(-1)!;
    expect(list.payload.text).toContain(site.id);
    expect(list.payload.reply_markup.inline_keyboard[0][0].callback_data).toBe(`x:${site.id}`);

    // Another chat cannot unlink it.
    await webhook("telegram", press(13, `X:${site.id}`));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE site_id = ?").bind(site.id).first<{ n: number }>())!.n).toBe(1);

    await webhook("telegram", press(12, `x:${site.id}`));
    await webhook("telegram", press(12, `X:${site.id}`));
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE site_id = ?").bind(site.id).first<{ n: number }>())!.n).toBe(0);
  });
});
