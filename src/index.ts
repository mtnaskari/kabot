import { handleAdmin } from "./admin";
import { handleWebhook } from "./bot/webhook";
import { PLATFORMS, type Env, type Platform } from "./env";
import { bearer, clientIp, errorResponse, HttpError, json, readJson } from "./http";
import { maintenance, submitMessage } from "./messages";
import { getSite, originAllowed, siteByApiKey, SITE_ID, toSite } from "./sites";
import { LIMITS } from "./validate";

const VERSION = "0.1.0";
const IP_LIKE = /^[0-9a-fA-F:.]{2,45}$/;

function cors(origin: string | null, allowed: boolean): Record<string, string> {
  return allowed && origin ? { "access-control-allow-origin": origin, vary: "Origin" } : { vary: "Origin" };
}

async function postMessage(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const origin = request.headers.get("origin");
  const key = bearer(request);
  let headers: Record<string, string> = cors(origin, false);
  try {
    if (key) {
      // API keys belong on servers. A browser request always carries Origin.
      if (origin) throw new HttpError(400, "bad_request", "API keys must not be used from a browser.");
      const site = await siteByApiKey(env.DB, key);
      if (!site) throw new HttpError(401, "unauthorized", "Invalid API key.");
      const input = await readJson(request, LIMITS.bodyBytes);
      const ip = typeof input.visitorIp === "string" && IP_LIKE.test(input.visitorIp) ? input.visitorIp : "";
      const result = await submitMessage({ env, site, source: "server", ip, waitUntil: (p) => ctx.waitUntil(p) }, input);
      return json(201, { ok: true, id: result.id });
    }

    const input = await readJson(request, LIMITS.bodyBytes);
    const site = typeof input.site === "string" && SITE_ID.test(input.site) ? await getSite(env.DB, input.site) : null;
    if (!site) throw new HttpError(404, "unknown_site", "Unknown site.");
    const allowed = originAllowed(toSite(site), origin);
    headers = cors(origin, allowed);
    if (!allowed) throw new HttpError(403, "origin_not_allowed", "This origin may not send messages to this site.");
    await submitMessage({ env, site, source: "browser", ip: clientIp(request), waitUntil: (p) => ctx.waitUntil(p) }, input);
    return json(201, { ok: true }, headers);
  } catch (error) {
    return errorResponse(error, headers);
  }
}

async function siteConfig(request: Request, env: Env, id: string): Promise<Response> {
  const origin = request.headers.get("origin");
  const row = SITE_ID.test(id) ? await getSite(env.DB, id) : null;
  if (!row) return errorResponse(new HttpError(404, "unknown_site", "Unknown site."));
  const site = toSite(row);
  const allowed = originAllowed(site, origin);
  // Without an Origin (curl, server) the public config is still readable; browsers need an allowed origin.
  if (origin && !allowed) return errorResponse(new HttpError(403, "origin_not_allowed", "Origin not allowed."), cors(origin, false));
  return json(
    200,
    { ok: true, site: { id: site.id, name: site.name, requireEmail: site.requireEmail, turnstileSiteKey: site.turnstileEnabled ? site.turnstileSiteKey : null } },
    { ...cors(origin, allowed), "cache-control": "public, max-age=300" },
  );
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (url.pathname === "/v1/messages") {
        if (request.method === "OPTIONS") {
          // Content-Type only: Authorization is deliberately not allowed, so browsers cannot send API keys.
          return new Response(null, {
            status: 204,
            headers: {
              "access-control-allow-origin": request.headers.get("origin") ?? "*",
              "access-control-allow-methods": "POST",
              "access-control-allow-headers": "content-type",
              "access-control-max-age": "86400",
              vary: "Origin",
            },
          });
        }
        if (request.method === "POST") return await postMessage(request, env, ctx);
        return json(405, { ok: false, error: { code: "method_not_allowed", message: "Use POST." } }, { allow: "POST, OPTIONS" });
      }
      if (parts[0] === "v1" && parts[1] === "sites" && parts[2] && parts[3] === "config" && parts.length === 4 && request.method === "GET") {
        return await siteConfig(request, env, parts[2]);
      }
      if (parts[0] === "bot" && parts.length === 3 && PLATFORMS.includes(parts[1] as Platform)) {
        return await handleWebhook(request, env, parts[1] as Platform, parts[2]);
      }
      if (parts[0] === "admin") return await handleAdmin(request, env, parts.slice(1));
      if (url.pathname === "/" || url.pathname === "/health") return json(200, { ok: true, name: "kabot", version: VERSION });
      return json(404, { ok: false, error: { code: "not_found", message: "Not found." } });
    } catch (error) {
      return errorResponse(error);
    }
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      maintenance(env).then(
        (r) => console.log("maintenance", JSON.stringify(r)),
        (e) => console.error("maintenance_failed", String(e)),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
