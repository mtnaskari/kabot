import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createKabotClient, KabotError } from "../client/index.js";
import { BASE, call, createSite, mockOutbound, ORIGIN, uniqueIp } from "./helpers";

let out: ReturnType<typeof mockOutbound>;
beforeEach(() => (out = mockOutbound()));
afterEach(() => out.restore());

/** Routes the client's fetch to the Worker under test. */
const workerFetch = (headers: Record<string, string> = {}): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return call(url.pathname, { ...init, headers: { ...(init?.headers as Record<string, string>), ...headers } });
  }) as typeof fetch;

describe("@mtnaskari/kabot/client", () => {
  it("requires exactly one of apiKey and site", () => {
    expect(() => createKabotClient({ endpoint: BASE })).toThrow(TypeError);
    expect(() => createKabotClient({ endpoint: BASE, apiKey: "kb_x", site: "x" })).toThrow(TypeError);
    expect(() => createKabotClient({ endpoint: "ftp://x", site: "x" })).toThrow(TypeError);
  });

  it("sends with an API key", async () => {
    const site = await createSite();
    const client = createKabotClient({ endpoint: `${BASE}/`, apiKey: site.apiKey!, fetch: workerFetch() });
    const result = await client.send({ email: "a@example.org", message: "Hello from a server" });
    expect(result).toEqual({ ok: true, id: expect.any(Number) });
  });

  it("sends in browser mode", async () => {
    const site = await createSite();
    const client = createKabotClient({ endpoint: BASE, site: site.id, fetch: workerFetch({ origin: ORIGIN, "cf-connecting-ip": uniqueIp() }) });
    expect(await client.send({ email: "a@example.org", message: "Hello from a browser" })).toEqual({ ok: true });
  });

  it("maps errors to KabotError with field details", async () => {
    const site = await createSite();
    const client = createKabotClient({ endpoint: BASE, apiKey: site.apiKey!, fetch: workerFetch() });
    const error = await client.send({ email: "bad", message: "" }).catch((e) => e);
    expect(error).toBeInstanceOf(KabotError);
    expect(error).toMatchObject({ status: 400, code: "validation" });
    expect(error.fields).toHaveProperty("email");
  });

  it("reports network failures and timeouts", async () => {
    const failing = createKabotClient({ endpoint: BASE, site: "x", fetch: (async () => Promise.reject(new Error("boom"))) as typeof fetch });
    await expect(failing.send({ message: "hi" })).rejects.toMatchObject({ code: "network" });
    const hanging = createKabotClient({
      endpoint: BASE,
      site: "x",
      timeoutMs: 20,
      fetch: ((_: unknown, init?: RequestInit) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch,
    });
    await expect(hanging.send({ message: "hi" })).rejects.toMatchObject({ code: "timeout" });
  });
});
