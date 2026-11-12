# Configuration and operations

## Contents

- [Secrets](#secrets)
- [Variables](#variables)
- [Rate limits](#rate-limits)
- [Scheduled maintenance](#scheduled-maintenance)
- [Using your own domain](#using-your-own-domain)
- [Updating kabot](#updating-kabot)
- [Backups](#backups)
- [Logs](#logs)
- [Costs](#costs)

## Secrets

Secrets are set with `npx wrangler secret put <NAME>` or in the Cloudflare dashboard under the Worker's **Settings → Variables and Secrets**. They are never visible after they are saved.

| Secret | Required | Description |
| --- | --- | --- |
| `ADMIN_TOKEN` | yes | Bearer token for the [admin API](admin.md). At least 32 characters. Without it, the admin API answers `503`. |
| `KABOT_SECRET` | yes | Master secret. At least 32 characters. Without it, submissions and webhooks fail. |
| `TELEGRAM_BOT_TOKEN` | no | Enables [Telegram](telegram.md). |
| `BALE_BOT_TOKEN` | no | Enables [Bale](bale.md). |

Generate the first two with `openssl rand -hex 32`. At least one bot token is needed to deliver anything.

### What `KABOT_SECRET` protects

Several values are derived from it with HMAC-SHA-256:

- the secret part of each webhook URL, and Telegram's webhook header;
- the hash of each visitor's IP address;
- the key that encrypts stored Turnstile secrets.

Changing it has consequences. If you must change it:

1. Set the new value with `npx wrangler secret put KABOT_SECRET`.
2. Register the webhooks again with `POST /admin/webhooks`.
3. Store each site's Turnstile secret again with `PATCH /admin/sites/:id`, because the old ones can no longer be decrypted.

Daily limits per IP start from zero, because the hashes change. Messages, sites, links and API keys are unaffected.

### Rotating `ADMIN_TOKEN`

Set a new value with `wrangler secret put ADMIN_TOKEN`. Nothing else depends on it.

## Variables

Variables are set in `wrangler.toml` under `[vars]` and take effect on the next deploy.

| Variable | Default | Description |
| --- | --- | --- |
| `DAILY_LIMIT_PER_IP` | `20` | Messages per visitor IP and site in 24 hours. `0` turns the cap off. |
| `RETENTION_DAYS` | `0` | Archived messages older than this many days are deleted. `0` keeps everything. New and read messages are never deleted. |
| `TELEGRAM_API_BASE` | `https://api.telegram.org` | Telegram Bot API address. |
| `BALE_API_BASE` | `https://tapi.bale.ai` | Bale Bot API address. |

Example:

```toml
[vars]
DAILY_LIMIT_PER_IP = "10"
RETENTION_DAYS = "90"
```

## Rate limits

The per-minute limits use Cloudflare's [rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), configured in `wrangler.toml`:

```toml
[[ratelimits]]
name = "RATE_LIMITER"          # per visitor IP and site, and pairing attempts per chat
namespace_id = "7301"
simple = { limit = 5, period = 60 }

[[ratelimits]]
name = "SERVER_RATE_LIMITER"   # per site, for server requests without visitorIp
namespace_id = "7302"
simple = { limit = 60, period = 60 }
```

`period` must be `10` or `60` seconds. The binding counts per Cloudflare location, so the limits are approximate; the daily cap is counted exactly in D1.

## Scheduled maintenance

A cron trigger runs every ten minutes (`[triggers] crons` in `wrangler.toml`). Each run:

- retries notifications that failed, up to five attempts within two days of the message, 25 messages per run;
- deletes expired pairing codes and webhook update ids older than seven days;
- applies `RETENTION_DAYS`.

You can see the runs in the Cloudflare dashboard under the Worker's **Logs**.

## Using your own domain

A custom domain such as `kabot.example.com` looks better in the widget tag and in your Content Security Policy. The domain's zone must be on Cloudflare.

Add a route to `wrangler.toml`:

```toml
routes = [
  { pattern = "kabot.example.com", custom_domain = true }
]
```

Then deploy and register the webhooks on the new address, because the webhook URL follows the host you call:

```bash
npm run deploy
curl -X POST "https://kabot.example.com/admin/webhooks" -H "Authorization: Bearer $ADMIN_TOKEN"
```

Update the widget's `src` on your sites. The `workers.dev` address keeps working unless you set `workers_dev = false`.

## Updating kabot

If you deployed from a clone:

```bash
git pull
npm ci
npm run deploy
```

`npm run deploy` applies new database migrations after deploying. Read the release notes before updating across a major version.

If you used the Deploy button, the repository was copied to your GitHub account and Cloudflare deploys it on every push. Pull the changes from `mtnaskari/kabot` into your copy, for example with GitHub's **Sync fork**, or by adding it as a remote and merging.

## Backups

Messages live in your D1 database. Export it to a SQL file:

```bash
npx wrangler d1 export kabot --remote --output kabot-backup.sql
```

D1 also keeps its own point-in-time history; see [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

## Logs

Observability is enabled in `wrangler.toml`, so the Worker's logs appear in the Cloudflare dashboard. To follow them live:

```bash
npx wrangler tail
```

kabot's own log lines never contain message text, bot tokens or IP addresses. Bot API errors include the platform's error description. Cloudflare's request logs are separate; see [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) for what they record and how long they are kept.

## Costs

kabot uses Workers, D1, the rate limiting binding, static assets and a cron trigger. For the traffic of a typical contact form, all of these fit in Cloudflare's free plan. Check [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) for the current limits. Telegram and Bale bots are free.
