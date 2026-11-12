# HTTP API reference

All requests and responses use JSON. All responses have an `ok` field.

## Errors

Every error response has this shape:

```json
{
  "ok": false,
  "error": {
    "code": "validation",
    "message": "Email must be a valid address.",
    "fields": { "email": "Email must be a valid address." }
  }
}
```

`fields` is present only for validation errors of message fields, and has one entry per invalid field. `message` is English text meant for people; `code` is stable and meant for programs.

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `validation` | A field is invalid. |
| 400 | `bad_request` | The body isn't a JSON object, or an API key came with an `Origin` header. |
| 400 | `not_configured` | `POST /admin/webhooks` without any bot token. |
| 401 | `unauthorized` | Missing or wrong API key or admin token. |
| 403 | `origin_not_allowed` | The `Origin` header isn't in the site's `allowedOrigins`. |
| 403 | `turnstile_failed` | The Turnstile token is missing or invalid. |
| 404 | `unknown_site` | No site has the given id. |
| 404 | `not_found` | Unknown route or admin resource. |
| 405 | `method_not_allowed` | Wrong HTTP method. |
| 409 | `conflict` | A site with that id already exists. |
| 413 | `too_large` | The body is larger than allowed. |
| 429 | `rate_limited` | Too many requests. The `Retry-After` header gives the seconds to wait. |
| 500 | `internal` | An unexpected error. The Worker's logs have details. |
| 503 | `not_configured` | `ADMIN_TOKEN` is missing or shorter than 32 characters. |

## Public endpoints

### POST /v1/messages

Submits a message. It works in one of two modes.

**Browser mode** has no `Authorization` header. The body names the site, and the `Origin` header must be one of the site's allowed origins.

```http
POST /v1/messages HTTP/1.1
Origin: https://example.com
Content-Type: application/json

{"site": "my-site", "name": "Sara", "email": "sara@example.org", "message": "Hello!", "turnstileToken": "…"}
```

**Server mode** sends the site's API key. The key identifies the site, and requests carrying an `Origin` header are refused.

```http
POST /v1/messages HTTP/1.1
Authorization: Bearer kb_…
Content-Type: application/json

{"name": "Sara", "email": "sara@example.org", "message": "Hello!", "visitorIp": "203.0.113.7"}
```

Body fields:

| Field | Type | Mode | Rules |
| --- | --- | --- | --- |
| `site` | string | browser, required | Site id. |
| `message` | string | both, required | 2 to 4000 characters after trimming; at most five links. |
| `name` | string | both | Up to 100 characters; no line breaks. |
| `email` | string | both | A valid address of up to 254 characters. Required when the site has `requireEmail: true`. Stored in lower case. |
| `page` | string | both | An `http` or `https` URL of up to 500 characters. |
| `turnstileToken` | string | browser | Required when the site has a Turnstile secret. Ignored in server mode. |
| `visitorIp` | string | server | The visitor's IPv4 or IPv6 address, used for rate limits. Ignored in browser mode, where the connection's address is used. |
| `website` | string | both | Honeypot. Any value makes the Worker discard the message and still answer `201`. |

Unknown fields are ignored. Text fields are trimmed, line endings are normalized to `\n`, and Unicode is normalized to NFC. Control characters other than tab and newline, bidirectional overrides and zero-width characters are rejected. The body may be at most 16 KiB.

Checks run in this order: honeypot, rate limit, validation, Turnstile, daily cap. The message is then stored and the notification is sent in the background.

Responses:

| Status | Body | Meaning |
| --- | --- | --- |
| 201 | `{"ok": true}` | Browser mode: stored. |
| 201 | `{"ok": true, "id": 12}` | Server mode: stored as message 12. |
| 4xx, 5xx | error | See [Errors](#errors). |

Rate limits per site:

| Applies to | Limit |
| --- | --- |
| Each visitor IP (browser mode, or server mode with `visitorIp`) | 5 per minute, and `DAILY_LIMIT_PER_IP` (default 20) per 24 hours |
| Server mode without `visitorIp` | 60 per minute for the whole site |

In browser mode, responses include `Access-Control-Allow-Origin` only for allowed origins. The preflight (`OPTIONS /v1/messages`) allows `POST` with a `Content-Type` header, and not the `Authorization` header.

### GET /v1/sites/:id/config

The site's public settings, used by the widget and `KabotForm`.

```json
{ "ok": true, "site": { "id": "my-site", "name": "My site", "requireEmail": true, "turnstileSiteKey": "0x4AAAAAAA…" } }
```

`turnstileSiteKey` is `null` when Turnstile is off. Browsers must send an allowed `Origin`; requests without `Origin` are answered too, because the data is public. Responses are cacheable for five minutes.

### GET /widget.js

The [widget](widget.md) script. Cacheable for one hour.

### GET /health

```json
{ "ok": true, "name": "kabot", "version": "0.1.0" }
```

`GET /` returns the same.

## Admin endpoints

Every admin request needs `Authorization: Bearer <ADMIN_TOKEN>`. Bodies are limited to 8 KiB. Usage examples are in [Managing sites](admin.md).

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /admin/sites` | | `{ ok, sites: Site[] }` |
| `POST /admin/sites` | `id`, `name`, and optionally `allowedOrigins`, `requireEmail`, `turnstileSiteKey`, `turnstileSecret`, `apiKey: false` | `201 { ok, site, apiKey, pairing }` |
| `GET /admin/sites/:id` | | `{ ok, site, subscriptions }` |
| `PATCH /admin/sites/:id` | any of `name`, `allowedOrigins`, `requireEmail`, `turnstileSiteKey`, `turnstileSecret` | `{ ok, site }` |
| `DELETE /admin/sites/:id` | | `{ ok }` |
| `POST /admin/sites/:id/api-key` | | `{ ok, apiKey }` |
| `DELETE /admin/sites/:id/api-key` | | `{ ok }` |
| `POST /admin/sites/:id/pairing-codes` | | `201 { ok, pairing }` |
| `GET /admin/sites/:id/subscriptions` | | `{ ok, subscriptions }` |
| `POST /admin/webhooks` | | `{ ok, webhooks }`, after registering each bot's webhook and commands |
| `GET /admin/webhooks` | | `{ ok, webhooks }` |

In `PATCH`, `allowedOrigins` replaces the whole list, and `null` clears `turnstileSiteKey` or `turnstileSecret`.

## Bot webhooks

`POST /bot/telegram/:secret` and `POST /bot/bale/:secret` receive updates from the platforms. `POST /admin/webhooks` registers them; you never call them yourself. The path secret is derived from `KABOT_SECRET`, and Telegram requests must also carry the `X-Telegram-Bot-API-Secret-Token` header. A wrong path returns `404` and a wrong header `403`. Every valid update is answered with `200`, even when processing fails, so the platform doesn't retry it forever.

## Objects

### Site

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Public id. |
| `name` | string | Display name. |
| `allowedOrigins` | string[] | Origins allowed to use browser mode. |
| `hasApiKey` | boolean | Whether an API key is active. |
| `requireEmail` | boolean | Whether `email` is required. |
| `turnstileSiteKey` | string or null | Public Turnstile key. |
| `turnstileEnabled` | boolean | Whether a Turnstile secret is stored. |
| `createdAt` | string | ISO 8601 time. |

### Pairing

| Field | Type | Description |
| --- | --- | --- |
| `code` | string | 20 characters, single-use. |
| `expiresAt` | string | ISO 8601 time, one hour after creation. |
| `command` | string | `/start <code>`, to send to the bot. |
| `links` | object | `telegram`: a link that opens the bot and sends the code. `bale`: a link that opens the bot. Present for configured bots whose username could be read. |

### Subscription

| Field | Type | Description |
| --- | --- | --- |
| `platform` | `"telegram"` or `"bale"` | |
| `chatId` | string | The chat's id on that platform. |
| `createdAt` | string | ISO 8601 time. |

### Webhook status

| Field | Type | Description |
| --- | --- | --- |
| `ok` | boolean | Whether the bot's API answered. |
| `url` | string or null | Webhook address with the secret part hidden. |
| `pendingUpdates` | number | Updates the platform has not delivered yet. |
| `lastError` | string or null | The platform's last delivery error. |
| `error` | string | Present when `ok` is `false`. |
