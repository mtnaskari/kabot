import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hmac } from "../src/crypto";
import { maintenance } from "../src/messages";
import { admin, browserPost, call, createSite, env, mockOutbound, ORIGIN, pairedSite, press, serverPost, text, uniqueIp, webhook } from "./helpers";

let out: ReturnType<typeof mockOutbound>;
beforeEach(() => (out = mockOutbound()));
afterEach(() => out.restore());

const valid = { name: "Sara", email: "sara@example.org", message: "Hello there, I would like to talk." };

async function messagesOf(siteId: string) {
  const { results } = await env.DB.prepare("SELECT * FROM messages WHERE site_id = ? ORDER BY id").bind(siteId).all<any>();
  return results;
}

describe("browser submissions", () => {
  it("stores the message and notifies every paired chat", async () => {
    const site = await pairedSite("telegram", 42);
    await webhook("bale", text(77, `/start ${(await admin(`/sites/${site.id}/pairing-codes`, "POST")).body.pairing.code}`));
    out.clear();

    const res = await browserPost({ site: site.id, ...valid, page: "https://example.com/contact" });
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(await res.json()).toEqual({ ok: true });

    const [row] = await messagesOf(site.id);
    expect(row).toMatchObject({ name: "Sara", email: "sara@example.org", source: "browser", status: "new" });
    expect(row.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(row.notified_at).not.toBeNull();

    const sends = out.sent();
    expect(sends.map((s) => `${s.platform}:${s.payload.chat_id}`).sort()).toEqual(["bale:77", "telegram:42"]);
    const tg = sends.find((s) => s.platform === "telegram")!;
    expect(tg.payload.parse_mode).toBe("HTML");
    expect(tg.payload.text).toContain("Hello there");
    expect(tg.payload.text).toContain("&lt;sara@example.org&gt;");
    expect(tg.payload.reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)).toEqual([`r:${row.id}`, `a:${row.id}`]);
    const bale = sends.find((s) => s.platform === "bale")!;
    expect(bale.payload.text).toContain("<sara@example.org>");

    const deliveries = await env.DB.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE message_id = ?").bind(row.id).first<{ n: number }>();
    expect(deliveries!.n).toBe(2);
  });

  it("escapes HTML in visitor input", async () => {
    const site = await pairedSite();
    out.clear();
    await browserPost({ site: site.id, ...valid, name: "<b>x</b>", message: "<script>alert(1)</script> & more" });
    const sent = out.sent()[0].payload.text as string;
    expect(sent).not.toContain("<script>");
    expect(sent).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
  });

  it("rejects origins that are not allowed, without CORS headers", async () => {
    const site = await createSite();
    const res = await browserPost({ site: site.id, ...valid }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const noOrigin = await browserPost({ site: site.id, ...valid }, { origin: null });
    expect(noOrigin.status).toBe(403);
    expect(await messagesOf(site.id)).toHaveLength(0);
  });

  it("returns 404 for an unknown site", async () => {
    expect((await browserPost({ site: "nope", ...valid })).status).toBe(404);
  });

  it("drops honeypot submissions while reporting success", async () => {
    const site = await createSite();
    const res = await browserPost({ site: site.id, ...valid, website: "http://spam" });
    expect(res.status).toBe(201);
    expect(await messagesOf(site.id)).toHaveLength(0);
  });

  it("validates fields", async () => {
    const site = await createSite();
    const res = await browserPost({ site: site.id, name: "a", email: "not-an-email", message: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("validation");
    expect(Object.keys(body.error.fields).sort()).toEqual(["email", "message"]);

    const missingEmail = await browserPost({ site: site.id, message: "Hello without email" });
    expect(missingEmail.status).toBe(400);
    await admin(`/sites/${site.id}`, "PATCH", { requireEmail: false });
    expect((await browserPost({ site: site.id, message: "Hello without email" })).status).toBe(201);

    const zeroWidth = await browserPost({ site: site.id, ...valid, message: "hi‮evil" });
    expect(zeroWidth.status).toBe(400);
    const wrongType = await browserPost({ site: site.id, ...valid, name: { $ne: 1 } });
    expect(wrongType.status).toBe(400);
  });

  it("refuses oversized bodies", async () => {
    const site = await createSite();
    const res = await browserPost({ site: site.id, ...valid, message: "x".repeat(20_000) });
    expect(res.status).toBe(413);
  });

  it("rate-limits a visitor IP", async () => {
    const site = await createSite();
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await browserPost({ site: site.id, ...valid }, { ip })).status);
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses.at(-1)).toBe(429);
  });

  it("enforces the daily cap per IP", async () => {
    const site = await createSite();
    const ip = uniqueIp();
    const hash = (await hmac(env.KABOT_SECRET!, `ip:${ip}`)).slice(0, 32);
    const insert = env.DB.prepare("INSERT INTO messages (site_id, body, source, ip_hash) VALUES (?, 'old', 'browser', ?)");
    await env.DB.batch(Array.from({ length: 20 }, () => insert.bind(site.id, hash)));
    const res = await browserPost({ site: site.id, ...valid }, { ip });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3600");
  });

  it("requires a valid Turnstile token when the site has a secret", async () => {
    const site = await createSite({ turnstileSiteKey: "0x4AAA", turnstileSecret: "ts-secret" });
    expect((await browserPost({ site: site.id, ...valid })).status).toBe(403);
    expect((await browserPost({ site: site.id, ...valid, turnstileToken: "fail" })).status).toBe(403);
    expect((await browserPost({ site: site.id, ...valid, turnstileToken: "pass" })).status).toBe(201);
    const verify = out.calls.filter((c) => c.platform === "turnstile");
    expect(verify.at(-1)!.payload.secret).toBe("ts-secret");
  });

  it("answers preflight without allowing Authorization", async () => {
    const res = await call("/v1/messages", { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-method": "POST" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("serves the public site config to allowed origins", async () => {
    const site = await createSite({ turnstileSiteKey: "0x4AAA", turnstileSecret: "ts-secret" });
    const res = await call(`/v1/sites/${site.id}/config`, { headers: { origin: ORIGIN } });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(await res.json()).toEqual({ ok: true, site: { id: site.id, name: expect.any(String), requireEmail: true, turnstileSiteKey: "0x4AAA" } });
    const evil = await call(`/v1/sites/${site.id}/config`, { headers: { origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
  });
});

describe("server submissions", () => {
  it("accepts a valid API key and returns the id", async () => {
    const site = await pairedSite();
    const res = await serverPost(site.apiKey!, { ...valid, visitorIp: "198.51.100.7" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.id).toEqual(expect.any(Number));
    const [row] = await messagesOf(site.id);
    expect(row.source).toBe("server");
    expect(row.ip_hash).not.toBe("");
    expect(out.sent().at(-1)!.payload.text).toContain("via API");
  });

  it("does not require Turnstile for servers", async () => {
    const site = await createSite({ turnstileSiteKey: "0x4AAA", turnstileSecret: "ts-secret" });
    expect((await serverPost(site.apiKey!, valid)).status).toBe(201);
  });

  it("rejects bad keys, rotated keys and keys sent from a browser", async () => {
    const site = await createSite();
    expect((await serverPost("kb_wrong", valid)).status).toBe(401);
    expect((await serverPost(site.apiKey!, valid, { origin: ORIGIN })).status).toBe(400);
    await admin(`/sites/${site.id}/api-key`, "POST");
    expect((await serverPost(site.apiKey!, valid)).status).toBe(401);
  });
});

describe("bot actions", () => {
  it("marks read, unread and archived, updating every copy", async () => {
    const site = await pairedSite("telegram", 50);
    await webhook("telegram", text(51, `/start ${(await admin(`/sites/${site.id}/pairing-codes`, "POST")).body.pairing.code}`));
    out.clear();
    await browserPost({ site: site.id, ...valid });
    const [msg] = await messagesOf(site.id);

    await webhook("telegram", press(50, `r:${msg.id}`));
    expect((await messagesOf(site.id))[0].status).toBe("read");
    const edits = out.sent("editMessageText");
    expect(edits.map((e) => e.payload.chat_id).sort()).toEqual(["50", "51"]);
    expect(edits[0].payload.text).toContain("Read");
    expect(edits[0].payload.reply_markup.inline_keyboard[0][0].callback_data).toBe(`u:${msg.id}`);
    expect(out.sent("answerCallbackQuery").at(-1)!.payload.text).toBe("Marked read.");

    await webhook("telegram", press(50, `a:${msg.id}`));
    expect((await messagesOf(site.id))[0].status).toBe("archived");
    await webhook("telegram", press(50, `u:${msg.id}`));
    expect((await messagesOf(site.id))[0].status).toBe("new");
  });

  it("does not let other chats act on a message", async () => {
    const site = await pairedSite("telegram", 60);
    await browserPost({ site: site.id, ...valid });
    const [msg] = await messagesOf(site.id);
    await webhook("telegram", press(61, `a:${msg.id}`));
    expect((await messagesOf(site.id))[0].status).toBe("new");
    // Same chat id on the other platform is a different chat.
    await webhook("bale", press(60, `a:${msg.id}`));
    expect((await messagesOf(site.id))[0].status).toBe("new");
  });

  it("lists unread messages with /inbox and opens one", async () => {
    const site = await pairedSite("telegram", 70);
    await browserPost({ site: site.id, ...valid });
    const [msg] = await messagesOf(site.id);
    out.clear();
    await webhook("telegram", text(70, "/inbox"));
    const inbox = out.sent()[0];
    expect(inbox.payload.reply_markup.inline_keyboard[0][0].callback_data).toBe(`o:${msg.id}`);
    await webhook("telegram", press(70, `o:${msg.id}`));
    expect(out.sent().at(-1)!.payload.text).toContain("Hello there");
  });
});

describe("delivery failures", () => {
  it("keeps the message, records the error and retries from the cron", async () => {
    const site = await pairedSite("telegram", 80);
    out.restore();
    out = mockOutbound({ fail: (c) => c.method === "sendMessage" });
    await browserPost({ site: site.id, ...valid });
    let [row] = await messagesOf(site.id);
    expect(row.notified_at).toBeNull();
    expect(row.notify_attempts).toBe(1);
    expect(row.notify_error).toContain("blocked");

    out.restore();
    out = mockOutbound();
    const result = await maintenance(env);
    expect(result.retried).toBeGreaterThanOrEqual(1);
    [row] = await messagesOf(site.id);
    expect(row.notified_at).not.toBeNull();
    expect(row.notify_error).toBeNull();
  });

  it("records that no chat is paired", async () => {
    const site = await createSite();
    await browserPost({ site: site.id, ...valid });
    const [row] = await messagesOf(site.id);
    expect(row.notify_error).toContain("No chat is paired");
  });

  it("deletes archived messages after RETENTION_DAYS", async () => {
    const site = await createSite();
    await env.DB.prepare(
      "INSERT INTO messages (site_id, body, source, status, created_at) VALUES (?, 'old', 'browser', 'archived', '2000-01-01T00:00:00.000Z'), (?, 'kept', 'browser', 'new', '2000-01-01T00:00:00.000Z')",
    )
      .bind(site.id, site.id)
      .run();
    const result = await maintenance({ ...env, RETENTION_DAYS: "30" });
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect((await messagesOf(site.id)).map((m) => m.body)).toEqual(["kept"]);
  });
});
