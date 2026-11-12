import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { admin, call, createSite, env, mockOutbound } from "./helpers";

let out: ReturnType<typeof mockOutbound>;
beforeEach(() => (out = mockOutbound()));
afterEach(() => out.restore());

describe("admin API", () => {
  it("requires the admin token", async () => {
    const none = await call("/admin/sites");
    expect(none.status).toBe(401);
    const wrong = await call("/admin/sites", { headers: { authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
  });

  it("creates a site with an API key and pairing links", async () => {
    const res = await admin("/sites", "POST", { id: "blog", name: "My blog", allowedOrigins: ["https://blog.example/"] });
    expect(res.status).toBe(201);
    expect(res.body.site).toMatchObject({ id: "blog", name: "My blog", allowedOrigins: ["https://blog.example"], hasApiKey: true, requireEmail: true });
    expect(res.body.apiKey).toMatch(/^kb_[A-Za-z0-9_-]{43}$/);
    expect(res.body.pairing.code).toMatch(/^[a-z0-9]{20}$/);
    expect(res.body.pairing.links.telegram).toBe(`https://t.me/telegram_kabot_bot?start=${res.body.pairing.code}`);
    expect(res.body.pairing.links.bale).toBe("https://ble.ir/bale_kabot_bot");
    expect(res.body.pairing.command).toBe(`/start ${res.body.pairing.code}`);

    // Only a hash of the key is stored.
    const row = await env.DB.prepare("SELECT api_key_hash FROM sites WHERE id = 'blog'").first<{ api_key_hash: string }>();
    expect(row!.api_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.api_key_hash).not.toContain(res.body.apiKey);

    const dup = await admin("/sites", "POST", { id: "blog", name: "Again" });
    expect(dup.status).toBe(409);
  });

  it("validates ids and origins", async () => {
    expect((await admin("/sites", "POST", { id: "Bad Id", name: "x" })).status).toBe(400);
    expect((await admin("/sites", "POST", { id: "ok", name: "" })).status).toBe(400);
    for (const origin of ["http://example.com", "https://example.com/path", "javascript:alert(1)", "https://user:pw@example.com"]) {
      const res = await admin("/sites", "POST", { id: "o", name: "x", allowedOrigins: [origin] });
      expect(res.status, origin).toBe(400);
    }
    const local = await admin("/sites", "POST", { id: "local", name: "x", allowedOrigins: ["http://localhost:3000"] });
    expect(local.status).toBe(201);
  });

  it("stores the Turnstile secret encrypted and never returns it", async () => {
    const site = await createSite({ turnstileSiteKey: "0x4AAA", turnstileSecret: "0x4AAA-secret" });
    expect(site.body.site.turnstileEnabled).toBe(true);
    expect(JSON.stringify(site.body)).not.toContain("0x4AAA-secret");
    const row = await env.DB.prepare("SELECT turnstile_secret FROM sites WHERE id = ?").bind(site.id).first<{ turnstile_secret: string }>();
    expect(row!.turnstile_secret).not.toContain("secret");
  });

  it("updates, rotates keys, issues pairing codes and deletes", async () => {
    const site = await createSite();
    const patched = await admin(`/sites/${site.id}`, "PATCH", { name: "Renamed", requireEmail: false });
    expect(patched.body.site).toMatchObject({ name: "Renamed", requireEmail: false });

    const rotated = await admin(`/sites/${site.id}/api-key`, "POST");
    expect(rotated.body.apiKey).not.toBe(site.apiKey);

    const code = await admin(`/sites/${site.id}/pairing-codes`, "POST");
    expect(code.status).toBe(201);
    expect(code.body.pairing.code).not.toBe(site.code);

    expect((await admin(`/sites/${site.id}`, "DELETE")).status).toBe(200);
    expect((await admin(`/sites/${site.id}`)).status).toBe(404);
  });

  it("registers webhooks with a secret path and header", async () => {
    const res = await admin("/webhooks", "POST");
    expect(res.status).toBe(200);
    const hooks = out.sent("setWebhook");
    expect(hooks.map((h) => h.platform).sort()).toEqual(["bale", "telegram"]);
    const tg = hooks.find((h) => h.platform === "telegram")!;
    expect(tg.payload.url).toMatch(/^https:\/\/kabot\.test\/bot\/telegram\/[0-9a-f]{40}$/);
    expect(tg.payload.secret_token).toMatch(/^[0-9a-f]{64}$/);
    expect(hooks.find((h) => h.platform === "bale")!.payload.secret_token).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/[0-9a-f]{40}/);
  });
});
