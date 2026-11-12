<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.png">
  <img alt="kabot: a website message box that delivers to Telegram and Bale, running on a single Cloudflare Worker" src="docs/assets/banner-light.png" width="100%">
</picture>

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

- **Three ways to send:** an embeddable widget (`widget.js`), a React component (`kabot/react`), and a fetch-only client (`kabot/client`) with a per-site API key for Node.js, Workers, Deno and Bun.
- **Spam and abuse protection:** Cloudflare Turnstile, a honeypot field, per-IP rate limits, a daily cap per IP, allowed origins per site, and size and character checks.
- **Telegram and Bale**, together or separately. Bale's Bot API is compatible with Telegram's and is reachable from Iran.
- **An inbox in the chat:** buttons to mark messages read or unread and to archive them, `/inbox` for unread messages, and the same status in every linked chat.
- **Many sites, many recipients:** one deployment serves any number of sites, and each site can deliver to several private chats and groups, linked with one-time pairing codes.
- **Messages are never lost:** each message is stored before it is delivered, and failed deliveries are retried.
- **Privacy:** messages stay in your own Cloudflare account, IP addresses are only stored as keyed hashes, and archived messages can expire automatically.
- **Small and dependency-free:** the Worker, the widget and the client have no runtime dependencies.

## Quick start

You need a Cloudflare account and a Telegram bot from [@BotFather](https://t.me/BotFather).

**1. Deploy** with the button above, or from a clone:

```bash
git clone https://github.com/mtnaskari/kabot && cd kabot
npm ci
npx wrangler login
npm run deploy
```

**2. Set the secrets:**

```bash
openssl rand -hex 32 | tee admin-token.txt | npx wrangler secret put ADMIN_TOKEN
openssl rand -hex 32 | npx wrangler secret put KABOT_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

**3. Connect the bot and add your site:**

```bash
export KABOT=https://kabot.<your-subdomain>.workers.dev
export ADMIN_TOKEN=$(cat admin-token.txt)

curl -X POST "$KABOT/admin/webhooks" -H "Authorization: Bearer $ADMIN_TOKEN"

curl -X POST "$KABOT/admin/sites" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"id": "my-site", "name": "My site", "allowedOrigins": ["https://example.com"]}'
```

**4. Link your chat:** open the `pairing.links.telegram` link from the response and press **Start**.

**5. Add the message box** to your website:

```html
<script src="https://kabot.<your-subdomain>.workers.dev/widget.js" data-site="my-site" async></script>
```

Messages from your website now arrive in Telegram:

```
📬 My site · #1 · 🔵 New
From: Sara <sara@example.org>
Page: https://example.com/contact
At: 2026-11-12 09:14 UTC

Hello! I'd like to ask about your services.

[ ✅ Mark read ]  [ 🗄 Archive ]
```

[Getting started](docs/getting-started.md) walks through every step in detail.

## Documentation

| | |
| --- | --- |
| **Set up** | [Getting started](docs/getting-started.md) · [Telegram](docs/telegram.md) · [Bale](docs/bale.md) |
| **Send messages** | [The widget](docs/widget.md) · [React](docs/react.md) · [Sending from a server](docs/server.md) |
| **Run it** | [Managing sites](docs/admin.md) · [Configuration and operations](docs/configuration.md) · [Troubleshooting and FAQ](docs/troubleshooting.md) |
| **Reference** | [HTTP API](docs/api.md) · [Security model](#security-model) · [Local development](docs/development.md) |

## Security model

kabot is designed so that a leaked or misused piece gives away as little as possible.

**Browser submissions** name the site in the body. The Worker accepts them only when the `Origin` header is in the site's `allowedOrigins`. Browsers set `Origin` themselves, so other websites cannot post through a visitor's browser. A script outside a browser can forge `Origin`, which is why browser submissions also pass:

- **Turnstile**, when the site has a Turnstile secret. The token is verified on the Worker, and verification fails closed.
- **A honeypot field.** Submissions that fill it get a success response and are discarded.
- **Rate limits**: 5 messages a minute for each visitor IP and site through the rate limiting binding, and `DAILY_LIMIT_PER_IP` messages per 24 hours, 20 by default, counted in D1.
- **Input checks**: a 16 KiB body limit, length limits, no control characters, bidirectional overrides or zero-width characters, at most five links, and an http(s) `page` URL only.

**Server submissions** use a per-site API key in the `Authorization` header. Keys are 256-bit random values. Only their SHA-256 hash is stored, so the database never holds a usable key. A request that carries both an API key and an `Origin` header is refused, and the CORS preflight does not allow the `Authorization` header, so browsers cannot send keys. Rotating a key invalidates the old one immediately.

**Privacy.** Raw IP addresses are never stored. The Worker keeps a keyed HMAC of the IP, truncated to 128 bits, only to count messages per visitor. Messages stay in your own D1 database. Set `RETENTION_DAYS` to delete archived messages after a period.

**The bot webhook** URL contains a secret derived from `KABOT_SECRET`. Telegram also sends a secret header, which is checked in constant time. Update ids are recorded, so retried deliveries are processed once. Text from visitors is HTML-escaped before it is sent to Telegram.

**Chats** are linked only with single-use pairing codes. A code has 100 bits of entropy, expires after an hour, and is stored as a hash. Pairing attempts are rate-limited per chat. A chat can only see and change messages of the sites it is linked to. Everyone in a linked group can use the buttons, so link groups deliberately.

**Admin API.** `ADMIN_TOKEN` controls the whole deployment. Keep it out of websites and repositories. It is compared in constant time. Turnstile secrets are encrypted with AES-GCM before they are stored.

**Trust boundary.** Cloudflare runs the Worker and the database, and Telegram or Bale carries the notification. Anyone with access to your Cloudflare account can read the messages.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and [Local development](docs/development.md).

## License

[Apache-2.0](LICENSE). Copyright 2026 Matin Askari.
