# Security model

kabot is designed so that a leaked or misused piece gives away as little as possible. This page describes what each protection covers and where the trust boundaries are. To report a vulnerability, follow the [security policy](https://github.com/mtnaskari/kabot/blob/main/SECURITY.md).

## At a glance

| Threat | Protection |
| --- | --- |
| Another website posts through a visitor's browser | Exact `Origin` allow list per site |
| Scripts and bots outside a browser | Turnstile, honeypot, rate limits, daily cap |
| Oversized or malformed input | 16 KiB body limit, length and character checks |
| A stolen database | API keys, pairing codes and IPs stored only as hashes; Turnstile secrets encrypted |
| API keys leaking through a browser | Keys refused with an `Origin` header and blocked by CORS |
| Forged bot updates | Secret webhook path, Telegram secret header, update deduplication |
| A stranger linking their chat to your site | Single-use, expiring, 100-bit pairing codes |
| A linked chat reading other sites | Every button and command is checked against the chat's links |

## Browser submissions

A browser submission names the site in its body. The Worker accepts it only when the `Origin` header is one of the site's `allowedOrigins`. Browsers set `Origin` themselves, so other websites cannot post through a visitor's browser.

A script outside a browser can forge `Origin`, so browser submissions also pass these checks, in this order:

1. **Honeypot.** A hidden field that people never see. Submissions that fill it get a success response and are discarded, so bots learn nothing.
2. **Rate limit.** 5 messages a minute for each visitor IP and site, through Cloudflare's rate limiting binding.
3. **Validation.** Length limits; no control characters, bidirectional overrides or zero-width characters; at most five links; an `http` or `https` page address only.
4. **Turnstile**, when the site has a Turnstile secret. The token is verified on the Worker, and verification fails closed: if Cloudflare can't be reached, the message is refused.
5. **Daily cap.** `DAILY_LIMIT_PER_IP` messages per visitor IP and site in 24 hours, 20 by default, counted in D1.

## Server submissions

Server submissions use a per-site API key in the `Authorization` header.

- Keys are 256-bit random values. Only their SHA-256 hash is stored, so the database never holds a usable key.
- A request that carries both an API key and an `Origin` header is refused, and the CORS preflight does not allow the `Authorization` header. Browsers therefore cannot send keys, even by mistake.
- Rotating a key invalidates the old one immediately.

A server holding the key is trusted to do its own checks, so Turnstile does not apply. Rate limits do: per visitor when the server passes `visitorIp`, and per site otherwise.

## Privacy

- Raw IP addresses are never stored. The Worker keeps an HMAC of the IP keyed with `KABOT_SECRET` and truncated to 128 bits, only to count messages per visitor.
- Messages stay in the D1 database in your own Cloudflare account.
- `RETENTION_DAYS` deletes archived messages after a period.
- kabot's own log lines never contain message text, bot tokens or IP addresses.

## The bot

- **Webhook.** The webhook URL contains a secret derived from `KABOT_SECRET`, so it cannot be guessed. Telegram also sends a secret header, which is compared in constant time. Bale relies on the secret path.
- **Replays.** Update ids are recorded, so a retried delivery is processed only once.
- **Formatting.** Text from visitors is HTML-escaped before it is sent to Telegram, so a message cannot inject links or formatting.
- **Pairing.** Chats are linked only with single-use codes that carry 100 bits of entropy, expire after an hour, and are stored as hashes. Pairing attempts are rate-limited per chat.
- **Access.** A chat can only see and change messages of the sites it is linked to. The same chat number on Telegram and on Bale is treated as two different chats.

> [!WARNING]
> Everyone in a linked group can read the messages and press the buttons. Link a group only if all of its members should have that access.

## Secrets at rest

| Value | Stored as |
| --- | --- |
| API keys | SHA-256 hash |
| Pairing codes | SHA-256 hash |
| Visitor IPs | HMAC-SHA-256 with `KABOT_SECRET`, truncated |
| Turnstile secrets | AES-GCM ciphertext, with a key derived from `KABOT_SECRET` |
| Bot tokens, `ADMIN_TOKEN`, `KABOT_SECRET` | Cloudflare Worker secrets, never in D1 |

## The admin API

`ADMIN_TOKEN` controls the whole deployment: it can create sites, issue keys and pairing codes, and delete data. Keep it out of websites and repositories. It must be at least 32 characters and is compared in constant time.

## Trust boundaries

- **Cloudflare** runs the Worker and stores the database. Anyone with access to your Cloudflare account can read the messages and the secrets.
- **Telegram and Bale** carry the notifications, so they see the messages they deliver.
- **Your website** only needs the widget, or the API key if it sends from its server. It never holds bot tokens or the admin token.

## Out of scope

- Abuse that stays within the configured rate limits. Lower the limits or turn on Turnstile if needed.
- Attacks that require `ADMIN_TOKEN`, `KABOT_SECRET` or access to the Cloudflare account.
- Denial of service against Cloudflare, Telegram or Bale.
