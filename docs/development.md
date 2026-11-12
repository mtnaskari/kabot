# Local development

This guide is for running kabot on your own computer, to try it out or to change it.

## Setup

```bash
git clone https://github.com/mtnaskari/kabot
cd kabot
npm ci
cp .dev.vars.example .dev.vars
```

Fill in `.dev.vars`. It is ignored by Git.

```ini
ADMIN_TOKEN=<openssl rand -hex 32>
KABOT_SECRET=<openssl rand -hex 32>
TELEGRAM_BOT_TOKEN=<a token for a separate test bot>
BALE_BOT_TOKEN=
```

> [!IMPORTANT]
> Use a separate test bot, not the bot of a deployed kabot. The next section explains why.

## Running the Worker

```bash
npm run dev
```

This creates the local database tables and starts `wrangler dev` at `http://localhost:8787`. The local database lives in `.wrangler/state` and is separate from your deployed one.

Create a site that allows a local page:

```bash
export KABOT=http://localhost:8787
export ADMIN_TOKEN=<the value from .dev.vars>

curl -X POST "$KABOT/admin/sites" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"id": "local", "name": "Local test", "allowedOrigins": ["http://localhost:8080"]}'
```

## Receiving bot updates locally

Telegram and Bale can only deliver webhooks to a public HTTPS address, not to `localhost`. In a second terminal, run:

```bash
npm run dev:poll                 # Telegram
npm run dev:poll -- --bale       # Bale
```

The script asks the Bot API for new updates with `getUpdates` and forwards each one to `wrangler dev`, with the same secret path and header the real webhook uses. Now `/start <code>` and the buttons work locally.

`getUpdates` doesn't work while the bot has a webhook, so the script stops if the bot has one. `--delete-webhook` removes it, but that stops a deployed kabot using the same bot from receiving anything until you run `POST /admin/webhooks` on it again. This is why you should develop with a separate bot.

Use `--url` if `wrangler dev` runs on another address:

```bash
npm run dev:poll -- --url http://localhost:9000
```

## Trying the widget

Serve any HTML page from the origin you allowed, for example:

```html
<!-- index.html -->
<script src="http://localhost:8787/widget.js" data-site="local" async></script>
```

```bash
npx serve -l 8080 .
```

Open `http://localhost:8080`, send a message, and it arrives in your test bot's chat.

## Tests

```bash
npm test             # tests only
npm run check        # TypeScript, tests and the package build
```

The tests use [`@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/) and run inside the Workers runtime with a real local D1 database and rate limiter. Calls to the Telegram, Bale and Turnstile APIs are replaced by fakes in `test/helpers.ts`, so no token or network access is needed.

| File | Covers |
| --- | --- |
| `test/admin.test.ts` | Admin authentication, site validation, key storage, webhook registration |
| `test/pairing.test.ts` | Webhook secrets, pairing codes, duplicate updates, Bale, unlinking |
| `test/messages.test.ts` | Browser and server submissions, every protection, notifications, buttons, retries, retention |
| `test/client.test.ts` | `kabot/client` against the Worker |
| `test/validate.test.ts` | Input and origin validation |
| `test/entry.test.ts` | The Worker entry exports only its handler |

## Project layout

```
src/
  index.ts          routing, CORS, the cron handler
  messages.ts       intake pipeline, notifications, status changes, maintenance
  admin.ts          admin API
  sites.ts          sites, API keys, pairing codes, links
  validate.ts       message validation
  bot/api.ts        Bot API client for Telegram and Bale
  bot/webhook.ts    webhook verification, commands and buttons
  bot/format.ts     message formatting per platform
public/widget.js    the embeddable widget, served as a static asset
client/             kabot/client
react/              kabot/react
migrations/         D1 schema
scripts/dev-poll.mjs
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) before opening a pull request.
