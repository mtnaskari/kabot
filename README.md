# kabot

A self-hosted contact form that delivers your website's messages to Telegram or Bale. It runs entirely on one Cloudflare Worker, so your website's own server neither stores the messages nor talks to a messaging API.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mtnaskari/kabot)

**The name.** *Kabot* joins the Persian word *کبوتر* (*kabutar*, the carrier pigeon) with *bot*. A carrier pigeon takes a note from one place and delivers it to its owner somewhere else. kabot does the same for the messages people leave on your website.

## Why kabot exists

A "message me" box on a personal or small business website needs three things: a form, somewhere to keep the messages, and a way to notify the owner. Doing that on the website's own server has two common problems:

- **The server may not be able to reach the messaging API.** Many hosts, for example servers in Iran, cannot connect to `api.telegram.org`. A common workaround keeps the messages on the server and relays notifications through a proxy, which leaves two systems to secure and run.
- **Every site rebuilds the same thing.** Validation, spam protection, rate limits, storage, notifications and inbox actions are the same on every site.

kabot moves all of it to a single Cloudflare Worker. The website either embeds a script or makes one HTTPS request. The Worker validates the message, stores it in Cloudflare D1, and sends it to you through the Bot API. The bot's webhook runs on the same Worker, so you can mark messages as read or archive them from the chat. One deployment serves any number of sites.

```
 visitor ──► website ──(widget.js or POST /v1/messages)──► kabot Worker ──► Telegram / Bale ──► you
                                                              │   ▲
                                                              ▼   │ buttons: Mark read, Archive
                                                             D1 ──┘
```

## Features

- An embeddable widget (`widget.js`): a floating button or an inline form, with Shadow DOM isolation, dark mode, right-to-left layouts and custom labels.
- A small React component (`kabot/react`) and a fetch-only client (`kabot/client`) for Node.js 18+, Cloudflare Workers, Deno, Bun and browsers.
- A server API with a per-site API key, for sites that prefer to send messages from their own backend.
- Protection: Cloudflare Turnstile, a honeypot field, per-IP rate limits through the Workers rate limiting binding, a daily cap per IP, an allowed origin list for each site, and size and character checks.
- Telegram and Bale. Bale's Bot API is compatible with Telegram's and is reachable from Iran. Each linked chat can be on either platform.
- Inline buttons to mark messages read or unread and to archive them. Every chat's copy of a message is updated.
- Pairing with one-time codes: `/start <code>` links a chat, or a group, to a site.
- Delivery retries from a cron trigger, so a message is never lost when the Bot API is unavailable.
- An optional retention period for archived messages.

## Quick start

You need a Cloudflare account and a bot. Create a Telegram bot with [@BotFather](https://t.me/BotFather), a Bale bot with Bale's BotFather, or both.

### 1. Deploy

Click **Deploy to Cloudflare** above. It copies the repository to your GitHub account, creates the D1 database and asks for the secrets below.

To deploy from a clone instead:

```bash
git clone https://github.com/mtnaskari/kabot && cd kabot
npm ci
npx wrangler login
npm run deploy
```

`npm run deploy` deploys the Worker, which creates the D1 database on the first run, and then applies the migrations.

### 2. Set the secrets

| Secret | Purpose |
| --- | --- |
| `ADMIN_TOKEN` | Bearer token for the `/admin` API. At least 32 random characters. |
| `KABOT_SECRET` | Master secret. The webhook URLs, the IP hashes and the encryption key for Turnstile secrets are derived from it. At least 32 random characters. |
| `TELEGRAM_BOT_TOKEN` | Optional. Enables Telegram. |
| `BALE_BOT_TOKEN` | Optional. Enables Bale. |

```bash
openssl rand -hex 32 | npx wrangler secret put ADMIN_TOKEN
openssl rand -hex 32 | npx wrangler secret put KABOT_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

Changing `KABOT_SECRET` later changes the webhook URLs, so register the webhooks again, and makes stored Turnstile secrets unreadable, so set them again.

### 3. Register the webhooks

```bash
export KABOT=https://kabot.<your-subdomain>.workers.dev
export ADMIN_TOKEN=...

curl -X POST "$KABOT/admin/webhooks" -H "Authorization: Bearer $ADMIN_TOKEN"
```

This points every configured bot at the Worker and sets the bot's command menu.

### 4. Add a site

```bash
curl -X POST "$KABOT/admin/sites" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"id": "my-blog", "name": "My blog", "allowedOrigins": ["https://blog.example.com"]}'
```

The response contains the site's API key, which is shown only once, and a pairing code:

```json
{
  "ok": true,
  "site": { "id": "my-blog", "name": "My blog", "allowedOrigins": ["https://blog.example.com"], "hasApiKey": true, "requireEmail": true, "turnstileSiteKey": null, "turnstileEnabled": false, "createdAt": "…" },
  "apiKey": "kb_…",
  "pairing": {
    "code": "k3m9…",
    "expiresAt": "…",
    "command": "/start k3m9…",
    "links": { "telegram": "https://t.me/your_bot?start=k3m9…", "bale": "https://ble.ir/your_bot" }
  }
}
```

### 5. Link your chat

Open the Telegram link, or open the bot in Bale and send the command. The bot confirms that the chat now receives the site's messages. Codes are single-use and expire after one hour. To link another chat, request a new code with `POST /admin/sites/my-blog/pairing-codes`. To deliver to a group, add the bot to the group and send the command there.

### 6. Add the message box to your site

```html
<script src="https://kabot.<your-subdomain>.workers.dev/widget.js" data-site="my-blog" async></script>
```

That's all. Messages now arrive in your chat.

## Sending messages

### The widget

The script tag adds a floating button in the bottom corner. Set `data-target` to render an inline form instead.

```html
<div id="contact"></div>
<script
  src="https://kabot.example.workers.dev/widget.js"
  data-site="my-blog"
  data-target="#contact"
  data-dir="rtl"
  data-title="پیام بگذارید"
  data-name-label="نام"
  data-email-label="ایمیل"
  data-message-label="پیام"
  data-send-label="ارسال"
  data-success-text="پیام شما ارسال شد."
  async
></script>
```

| Attribute | Default | Description |
| --- | --- | --- |
| `data-site` | required | The site id. |
| `data-target` | none | CSS selector of an element to render an inline form into. |
| `data-position` | `right` | `left` or `right`, for the floating button. |
| `data-dir` | `ltr` | `rtl` for right-to-left languages. |
| `data-accent` | `#1f6feb` | Accent colour as a hex value. |
| `data-endpoint` | the script's origin | Worker URL, if the script is served from somewhere else. |
| `data-title`, `data-open-label`, `data-close-label`, `data-name-label`, `data-email-label`, `data-message-label`, `data-send-label`, `data-sending-label`, `data-success-text`, `data-error-text` | English | Text shown in the widget. |

The widget dispatches a `kabot:sent` event on success. When the site has Turnstile enabled, the widget loads Turnstile and sends its token.

### React

```tsx
import { KabotForm } from "kabot/react";

export function Contact() {
  return <KabotForm endpoint="https://kabot.example.workers.dev" site="my-blog" onSent={() => console.log("sent")} />;
}
```

`KabotForm` is unstyled. Its elements have `kabot-*` class names. It reads the site's Turnstile key and email requirement from the Worker unless you pass `turnstileSiteKey` and `requireEmail`. For a custom form, use the `useKabot({ endpoint, site })` hook, which returns `send`, `status` and `error`.

### From your server

Use the API key when the message should go through your own backend, for example to add your own checks or to keep the Worker URL private. The client uses only `fetch`.

```ts
import { createKabotClient, KabotError } from "kabot/client";

const kabot = createKabotClient({
  endpoint: "https://kabot.example.workers.dev",
  apiKey: process.env.KABOT_API_KEY!,
});

try {
  const { id } = await kabot.send({
    name: "Sara",
    email: "sara@example.org",
    message: "Hello!",
    page: "https://blog.example.com/contact",
    visitorIp: request.headers.get("x-forwarded-for") ?? undefined,
  });
} catch (error) {
  if (error instanceof KabotError) console.log(error.status, error.code, error.fields);
}
```

Pass `visitorIp` so rate limits apply to each visitor. Without it, requests share one limit for the whole site. The same code runs in Deno (`npm:kabot/client`), Bun and Workers. Or call the API directly:

```bash
curl -X POST "$KABOT/v1/messages" \
  -H "Authorization: Bearer kb_…" -H "Content-Type: application/json" \
  -d '{"name": "Sara", "email": "sara@example.org", "message": "Hello!"}'
```

## Using Bale

Set `BALE_BOT_TOKEN` and run `POST /admin/webhooks` again. Bale's Bot API at `https://tapi.bale.ai` uses the same methods as Telegram's. Bale chats are linked with the same `/start <code>` command, and a site can deliver to Telegram and Bale chats at the same time. Bale messages are sent as plain text, because Bale does not document HTML formatting.

`TELEGRAM_API_BASE` and `BALE_API_BASE` change the API base URL for each platform, for example to use a self-hosted [Telegram Bot API server](https://github.com/tdlib/telegram-bot-api).

## Bot commands

| Command | Description |
| --- | --- |
| `/start <code>` | Links this chat to a site. |
| `/sites` | Lists linked sites with their unread counts, with buttons to unlink them. |
| `/inbox` | Lists the ten newest unread messages. |
| `/help` | Shows help. |

Each message arrives with **Mark read** and **Archive** buttons. Pressing one updates the message's status and every linked chat's copy of it.

## Security model

kabot is designed so that a leaked or misused piece gives away as little as possible.

**Browser submissions** name the site in the body. The Worker accepts them only when the `Origin` header is in the site's `allowedOrigins`. Browsers set `Origin` themselves, so other websites cannot post through a visitor's browser. A script outside a browser can forge `Origin`, which is why browser submissions also pass:

- **Turnstile**, when the site has a Turnstile secret. The token is verified on the Worker, and verification fails closed.
- **A honeypot field.** Submissions that fill it get a success response and are discarded.
- **Rate limits**: 5 messages a minute for each visitor IP and site through the rate limiting binding, and `DAILY_LIMIT_PER_IP` messages per 24 hours, 20 by default, counted in D1.
- **Input checks**: a 16 KiB body limit, length limits, no control characters, bidirectional overrides or zero-width characters, at most five links, and an http(s) `page` URL only.

**Server submissions** use a per-site API key in the `Authorization` header. Keys are 256-bit random values. Only their SHA-256 hash is stored, so the database never holds a usable key. A request that carries both an API key and an `Origin` header is refused, and the CORS preflight does not allow the `Authorization` header, so browsers cannot send keys. Rotate a key with `POST /admin/sites/:id/api-key`; the old key stops working immediately.

**Privacy.** Raw IP addresses are never stored. The Worker keeps a keyed HMAC of the IP, truncated to 128 bits, only to count messages per visitor. Messages stay in your own D1 database. Set `RETENTION_DAYS` to delete archived messages after a period.

**The bot webhook** URL contains a secret derived from `KABOT_SECRET`. Telegram also sends a secret header, which is checked in constant time. Update ids are recorded, so retried deliveries are processed once. Text from visitors is HTML-escaped before it is sent to Telegram.

**Chats** are linked only with single-use pairing codes. A code has 100 bits of entropy, expires after an hour, and is stored as a hash. Pairing attempts are rate-limited per chat. A chat can only see and change messages of the sites it is linked to. Everyone in a linked group can use the buttons, so link groups deliberately.

**Admin API.** `ADMIN_TOKEN` controls the whole deployment. Keep it out of websites and repositories. It is compared in constant time. Turnstile secrets are encrypted with AES-GCM before they are stored.

**Trust boundary.** Cloudflare runs the Worker and the database, and Telegram or Bale carries the notification. Anyone with access to your Cloudflare account can read the messages.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## API

All responses are JSON. Errors have this shape:

```json
{ "ok": false, "error": { "code": "validation", "message": "Email must be a valid address.", "fields": { "email": "Email must be a valid address." } } }
```

Rate-limited responses have status `429` and a `Retry-After` header.

### Public

| Method and path | Description |
| --- | --- |
| `POST /v1/messages` | Submits a message. See below. |
| `GET /v1/sites/:id/config` | The site's public settings: `name`, `requireEmail` and `turnstileSiteKey`. Browsers need an allowed origin. |
| `GET /widget.js` | The widget script. |
| `GET /health` | Returns the name and version. |

`POST /v1/messages` body:

| Field | Type | Notes |
| --- | --- | --- |
| `site` | string | Browser mode only. The site id. |
| `message` | string | Required. 2 to 4000 characters. |
| `name` | string | Optional. Up to 100 characters. |
| `email` | string | Required unless the site sets `requireEmail: false`. |
| `page` | string | Optional http(s) URL of the page. |
| `turnstileToken` | string | Browser mode, when the site has Turnstile. |
| `visitorIp` | string | Server mode only. The visitor's IP for rate limiting. |
| `website` | string | Honeypot. Must be empty. |

It returns `201` with `{ "ok": true }` in browser mode, and `{ "ok": true, "id": 42 }` in server mode.

### Admin

Every admin request needs `Authorization: Bearer <ADMIN_TOKEN>`.

| Method and path | Description |
| --- | --- |
| `GET /admin/sites` | Lists sites. |
| `POST /admin/sites` | Creates a site. Body: `id`, `name`, and optionally `allowedOrigins`, `requireEmail`, `turnstileSiteKey`, `turnstileSecret`, and `apiKey: false` to skip issuing a key. Returns the API key and a pairing code. |
| `GET /admin/sites/:id` | Returns a site and its linked chats. |
| `PATCH /admin/sites/:id` | Updates `name`, `allowedOrigins`, `requireEmail`, `turnstileSiteKey` or `turnstileSecret`. Use `null` to clear the Turnstile fields. |
| `DELETE /admin/sites/:id` | Deletes a site with its messages and links. |
| `POST /admin/sites/:id/api-key` | Issues a new API key and invalidates the old one. |
| `DELETE /admin/sites/:id/api-key` | Revokes the API key. |
| `POST /admin/sites/:id/pairing-codes` | Creates a new pairing code. |
| `GET /admin/sites/:id/subscriptions` | Lists linked chats. |
| `POST /admin/webhooks` | Registers the webhook and commands for every configured bot. |
| `GET /admin/webhooks` | Shows each bot's webhook status. |

`allowedOrigins` entries must be exact origins such as `https://example.com`. Plain `http` is accepted only for `localhost` and `127.0.0.1`.

## Configuration

Set these variables in `wrangler.toml` under `[vars]`:

| Variable | Default | Description |
| --- | --- | --- |
| `DAILY_LIMIT_PER_IP` | `20` | Messages per visitor IP and site in 24 hours. `0` disables the cap. |
| `RETENTION_DAYS` | `0` | Deletes archived messages older than this many days. `0` keeps them. |
| `TELEGRAM_API_BASE` | `https://api.telegram.org` | Telegram Bot API base URL. |
| `BALE_API_BASE` | `https://tapi.bale.ai` | Bale Bot API base URL. |

The per-minute limits are the `simple` settings of the two `[[ratelimits]]` bindings. `RATE_LIMITER` applies to visitor IPs and `SERVER_RATE_LIMITER` to server requests without `visitorIp`. A cron trigger runs every ten minutes. It retries a failed delivery up to five times within two days, removes expired pairing codes and old update ids, and applies `RETENTION_DAYS`.

## Local development

```bash
npm ci
cp .dev.vars.example .dev.vars   # fill in the values
npm run dev                      # applies migrations locally and starts wrangler dev on :8787
```

Bot platforms cannot deliver webhooks to `localhost`. In a second terminal, run:

```bash
npm run dev:poll                 # or: npm run dev:poll -- --bale
```

It long-polls `getUpdates` and forwards each update to `wrangler dev`. Use a separate test bot, because `getUpdates` doesn't work while a webhook is set. The `--delete-webhook` flag removes the webhook, which would stop a deployed kabot using the same bot.

Run the checks:

```bash
npm run check                    # typecheck, tests and the package build
```

The tests run inside the Workers runtime with [`@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/), with a real local D1 database and rate limiter and fake Bot API and Turnstile endpoints.

## License

[Apache-2.0](LICENSE). Copyright 2026 Matin Askari.
