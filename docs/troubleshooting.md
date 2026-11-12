# Troubleshooting and FAQ

## Messages don't arrive in the chat

First, check whether the message was stored and what happened to its notification:

```bash
npx wrangler d1 execute DB --remote --command \
  "SELECT id, site_id, notified_at, notify_attempts, notify_error FROM messages ORDER BY id DESC LIMIT 5"
```

- **No row.** The submission was refused. Look at the response in the browser's developer tools (Network tab, the `messages` request) or at the error from `kabot/client`, and see the sections below.
- **`notify_error` is `No chat is paired with this site.`** Link a chat; see [Linking chats](telegram.md#linking-chats).
- **`notify_error` mentions `bot token is not configured`.** The chat is on a platform without a token. Set `TELEGRAM_BOT_TOKEN` or `BALE_BOT_TOKEN`.
- **`Forbidden: bot was blocked by the user`.** Unblock the bot in that chat.
- **`chat not found` or `group chat was upgraded to a supergroup`.** The chat no longer exists under that id. Link it again with a new code.
- **`Unauthorized`.** The bot token is wrong or was revoked. Set the current one.

Failed notifications are retried every ten minutes, up to five times within two days, so after you fix the cause the message usually arrives without anything else to do.

## The widget doesn't appear

Open the browser's developer tools and check the console.

- **`[kabot] widget.js needs a data-site attribute.`** Add `data-site="your-site-id"` to the script tag.
- **`[kabot] data-target … matched no element.`** The inline target doesn't exist when the page loads. Check the selector.
- **The script fails to load.** Check the `src` address, and your [Content Security Policy](widget.md#content-security-policy).
- **No error, no button.** Some ad blockers hide floating chat buttons. Try a private window without extensions.

## The form says the origin isn't allowed

The page's origin must exactly match an entry in the site's `allowedOrigins`. Common mismatches:

- `https://example.com` and `https://www.example.com` are different origins. Add both if both are used.
- Local development addresses such as `http://localhost:3000` must be added too.
- Preview deployments get their own hostnames. Add them, or use a separate site for previews.

See [Change the allowed origins](admin.md#change-the-allowed-origins).

## The form says verification failed

The site has Turnstile enabled and the token was missing or rejected.

- In the Cloudflare dashboard, make sure the Turnstile widget lists the page's hostname.
- Make sure the site key and secret stored on the site belong to the same Turnstile widget.
- If you changed `KABOT_SECRET`, store the Turnstile secret again.
- If you use your own form, render the Turnstile challenge and send its token as `turnstileToken`.

## The bot does not answer

```bash
curl "$KABOT/admin/webhooks" -H "Authorization: Bearer $ADMIN_TOKEN"
```

- **`url` is `null`.** The webhook isn't registered. Run `POST /admin/webhooks`.
- **`lastError` is set and `pendingUpdates` is growing.** The platform can't deliver to the Worker. Register the webhook again on the address the Worker actually serves, for example after moving to a custom domain or changing `KABOT_SECRET`.
- **`ok` is `false`.** The bot token is wrong.
- **In a group,** send the command with the bot's username, such as `/start@your_bot <code>`, because of Telegram's privacy mode.

## The pairing code is invalid or has expired

Codes work once and expire one hour after they are created. Create a new one with `POST /admin/sites/:id/pairing-codes`. Make sure the whole code was sent; it has 20 characters. After five attempts in a minute from one chat, the bot asks you to wait.

## Too many messages

Visitors are limited to 5 messages a minute and `DAILY_LIMIT_PER_IP` (20 by default) a day for each site. People who share an IP address, for example in an office, share these limits. Raise `DAILY_LIMIT_PER_IP` or the `RATE_LIMITER` limit in `wrangler.toml` if needed; see [Rate limits](configuration.md#rate-limits).

For server submissions without `visitorIp`, all requests share 60 a minute for the site. Pass [`visitorIp`](server.md#why-pass-visitorip).

## The API key is refused

- **`401 unauthorized`.** The key is wrong, or it was rotated or revoked. Issue a new one with `POST /admin/sites/:id/api-key`.
- **`400 bad_request: API keys must not be used from a browser.`** The request has an `Origin` header. API keys only work from servers. In browsers, use browser mode with `site` instead.

## FAQ

**Can I reply to visitors from the chat?**
No. kabot delivers messages to you; it doesn't send anything back to visitors. Reply by email to the address in the message.

**Does my website's server need to reach Telegram?**
No. Only the Cloudflare Worker talks to Telegram or Bale. Your server either does nothing (the widget talks to the Worker directly) or makes one HTTPS request to the Worker.

**Can one deployment serve several websites?**
Yes. Create a site for each one. Each has its own origins, API key, Turnstile settings and linked chats.

**Can several people receive the same site's messages?**
Yes. Link each person's chat with its own pairing code, or link a group. Status changes appear in every chat.

**Can I use Telegram and Bale together?**
Yes. Set both tokens. Each chat is on one platform, and a site can have chats on both.

**Where are messages stored, and for how long?**
In the D1 database in your Cloudflare account, until you delete them. Set `RETENTION_DAYS` to delete archived messages automatically.

**Are visitors' IP addresses stored?**
No. Only a keyed hash, used to count messages per visitor.

**Can visitors attach files?**
No. Messages are text only.

**Does kabot work without JavaScript on the page?**
The widget needs JavaScript. A plain HTML form can post to your own backend, which then calls kabot with the API key.
