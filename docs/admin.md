# Managing sites

Sites, keys and pairing codes are managed through the admin API with `curl` or any HTTP client. Every request needs the admin token:

```bash
export KABOT=https://kabot.example.workers.dev
export ADMIN_TOKEN=...   # the value you stored with `wrangler secret put ADMIN_TOKEN`
```

The examples below use these two variables. The full endpoint list is in the [HTTP API reference](api.md#admin-endpoints).

## Add a site

```bash
curl -X POST "$KABOT/admin/sites" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "id": "shop",
    "name": "Example Shop",
    "allowedOrigins": ["https://shop.example.com"],
    "requireEmail": true
  }'
```

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | 1 to 40 lowercase letters, digits and hyphens, starting and ending with a letter or digit. It is public: it appears in the widget tag. It can't be changed later. |
| `name` | yes | Shown in notifications. Up to 80 characters. |
| `allowedOrigins` | no | Up to 20 origins allowed to use the widget. Default: none, which allows only server submissions. |
| `requireEmail` | no | Default `true`. |
| `turnstileSiteKey`, `turnstileSecret` | no | See [Turn on Turnstile](#turn-on-turnstile). |
| `apiKey` | no | `false` skips issuing an API key, for sites that only use the widget. |

The response has the site, the API key (shown once, or `null`), and a pairing code to [link a chat](telegram.md#linking-chats).

## List and inspect sites

```bash
curl "$KABOT/admin/sites" -H "Authorization: Bearer $ADMIN_TOKEN"
curl "$KABOT/admin/sites/shop" -H "Authorization: Bearer $ADMIN_TOKEN"
```

A single site also lists its linked chats:

```json
{
  "ok": true,
  "site": {
    "id": "shop",
    "name": "Example Shop",
    "allowedOrigins": ["https://shop.example.com"],
    "hasApiKey": true,
    "requireEmail": true,
    "turnstileSiteKey": null,
    "turnstileEnabled": false,
    "createdAt": "2026-11-12T08:00:00.000Z"
  },
  "subscriptions": [
    { "platform": "telegram", "chatId": "123456789", "createdAt": "2026-11-12T08:05:00.000Z" }
  ]
}
```

Secrets are never returned: not the API key, not the Turnstile secret.

## Change the allowed origins

`PATCH` replaces the whole list, so include every origin you want to keep:

```bash
curl -X PATCH "$KABOT/admin/sites/shop" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"allowedOrigins": ["https://shop.example.com", "https://www.shop.example.com", "http://localhost:3000"]}'
```

An origin is the scheme, host and port, without a path:

| Value | Accepted |
| --- | --- |
| `https://example.com` | yes |
| `https://example.com/` | yes, stored as `https://example.com` |
| `https://www.example.com` | yes, and it is a different origin from `https://example.com` |
| `http://localhost:3000` | yes: plain `http` is allowed for `localhost` and `127.0.0.1` only |
| `http://example.com` | no: use `https` |
| `https://example.com/contact` | no: no paths |
| `https://*.example.com` | no: wildcards are not supported; list each origin |

Remove local development origins before you go live, or keep them in a separate site.

## Make the email field optional

```bash
curl -X PATCH "$KABOT/admin/sites/shop" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"requireEmail": false}'
```

The widget and `KabotForm` pick up the change within five minutes, because the public config is cached for that long. Without an email address, you have no way to reply to a visitor unless they write one in the message.

## Turn on Turnstile

[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) blocks automated submissions, usually without asking visitors to do anything. It is free.

1. In the Cloudflare dashboard, open **Turnstile** and choose **Add widget**.
2. Enter a name and add every hostname the message box runs on, such as `shop.example.com`.
3. Choose the **Managed** mode and create the widget.
4. Copy the **site key** and the **secret key**, then store them on the site:

```bash
curl -X PATCH "$KABOT/admin/sites/shop" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"turnstileSiteKey": "0x4AAAAAAA…", "turnstileSecret": "0x4AAAAAAA…"}'
```

From then on, every browser submission must carry a valid token. The widget and `KabotForm` handle this for you. Server submissions with the API key are not affected.

The secret is encrypted before it is stored and is never returned. To turn Turnstile off:

```bash
curl -X PATCH "$KABOT/admin/sites/shop" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"turnstileSiteKey": null, "turnstileSecret": null}'
```

## Link another chat

```bash
curl -X POST "$KABOT/admin/sites/shop/pairing-codes" -H "Authorization: Bearer $ADMIN_TOKEN"
```

Send the link or the command to the person who should receive messages. Each code works once, on Telegram or Bale, within an hour. See [Linking chats](telegram.md#linking-chats).

## Rotate or revoke the API key

```bash
# Issue a new key. The old one stops working immediately.
curl -X POST "$KABOT/admin/sites/shop/api-key" -H "Authorization: Bearer $ADMIN_TOKEN"

# Remove the key. Server submissions are refused until a new key is issued.
curl -X DELETE "$KABOT/admin/sites/shop/api-key" -H "Authorization: Bearer $ADMIN_TOKEN"
```

To rotate without downtime, issue the new key, then update your backend right away: the moment between the two is the only time submissions fail.

## Rename a site

```bash
curl -X PATCH "$KABOT/admin/sites/shop" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "Example Store"}'
```

The new name appears in new notifications and in messages whose buttons are pressed afterwards. The id can't change.

## Delete a site

```bash
curl -X DELETE "$KABOT/admin/sites/shop" -H "Authorization: Bearer $ADMIN_TOKEN"
```

> [!CAUTION]
> This permanently deletes the site, all its messages, its linked chats and its pairing codes. It cannot be undone.

Notifications already in chats stay there, but their buttons stop working.

## Check the bots

```bash
curl "$KABOT/admin/webhooks" -H "Authorization: Bearer $ADMIN_TOKEN"
```

Shows each configured bot's webhook address, the number of updates waiting, and the last delivery error reported by Telegram or Bale. `POST` to the same path registers the webhooks again.

## Read messages in the database

The bot is the inbox, but every message is also in your D1 database. Wrangler can query it:

```bash
npx wrangler d1 execute DB --remote --command \
  "SELECT id, site_id, name, email, status, created_at FROM messages ORDER BY id DESC LIMIT 20"
```

Messages whose notification failed:

```bash
npx wrangler d1 execute DB --remote --command \
  "SELECT id, site_id, notify_attempts, notify_error FROM messages WHERE notified_at IS NULL ORDER BY id DESC"
```

The tables are described in [`migrations/0001_init.sql`](../migrations/0001_init.sql).
