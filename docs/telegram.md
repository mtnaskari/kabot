# Telegram

This guide covers everything about the Telegram side of kabot: creating and configuring the bot, linking private chats and groups, using the bot, and maintaining it.

## How kabot uses Telegram

kabot talks to the [Telegram Bot API](https://core.telegram.org/bots/api) in both directions, always from the Worker:

- **Outgoing.** When a message is submitted, the Worker sends it with `sendMessage` to every chat linked to the site. Button presses update messages with `editMessageText`.
- **Incoming.** Telegram delivers the bot's updates (commands and button presses) to a webhook on the same Worker.

Your website's server never contacts Telegram. This is what makes kabot work for servers that cannot reach `api.telegram.org`, such as servers in Iran: Cloudflare runs the Worker outside that network.

One bot serves every site in a deployment. A chat can be linked to several sites, and a site can have several chats.

## Creating the bot

1. Open [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Send a display name. Visitors never see it, so choose something you recognize, such as `Example.com Inbox`.
3. Send a username ending in `bot`, such as `example_inbox_bot`.
4. Copy the token from BotFather's reply. It looks like `7012345678:AAH9…`.

Store the token in the Worker:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```

> [!IMPORTANT]
> The token gives full control of the bot. Don't put it in a repository, a website or a chat message. If it leaks, [change it](#changing-the-bot-token).

Use a separate bot for each kabot deployment. A bot can have only one webhook, so two deployments cannot share a bot.

## Optional BotFather settings

None of these are required. Send the command to BotFather and pick your bot.

| Command | What it does |
| --- | --- |
| `/setdescription` | Text shown in an empty chat before someone presses **Start**. For example: "Delivers messages from example.com. Only linked chats receive anything." |
| `/setabouttext` | Short text on the bot's profile. |
| `/setuserpic` | Profile picture. |
| `/setjoingroups` | Set to **Disable** if the bot should never be added to groups. Leave it enabled if you want [group delivery](#a-group). |
| `/setprivacy` | Leave privacy mode **enabled**. kabot only needs commands, and privacy mode keeps ordinary group messages away from the bot. |

You don't need `/setcommands`: `POST /admin/webhooks` sets the command menu.

## Connecting the bot to kabot

After the token is stored, register the webhook:

```bash
curl -X POST "$KABOT/admin/webhooks" -H "Authorization: Bearer $ADMIN_TOKEN"
```

This does three things:

- It points the bot's webhook at `https://<your worker>/bot/telegram/<secret>`. The last part is derived from `KABOT_SECRET`, so nobody can guess the URL.
- It sets a secret token that Telegram sends with every update in the `X-Telegram-Bot-API-Secret-Token` header. The Worker rejects updates without it.
- It sets the command menu: `/inbox`, `/sites` and `/help`.

The webhook URL uses the host you call. If you call `/admin/webhooks` on `kabot.example.com`, Telegram delivers to `kabot.example.com`. Call it again whenever you change the domain, the token or `KABOT_SECRET`.

To check the webhook later:

```bash
curl "$KABOT/admin/webhooks" -H "Authorization: Bearer $ADMIN_TOKEN"
```

```json
{ "ok": true, "webhooks": { "telegram": { "ok": true, "url": "https://kabot.example.com/bot/telegram/…", "pendingUpdates": 0, "lastError": null } } }
```

`pendingUpdates` above zero together with a `lastError` means Telegram cannot reach the Worker. See [Troubleshooting](troubleshooting.md#the-bot-does-not-answer).

## Linking chats

A chat receives a site's messages only after it is linked with a pairing code. Codes are single-use, expire after one hour, and are created by the admin API:

- `POST /admin/sites` returns a code together with the new site.
- `POST /admin/sites/<site id>/pairing-codes` returns a new code for an existing site.

```bash
curl -X POST "$KABOT/admin/sites/my-site/pairing-codes" -H "Authorization: Bearer $ADMIN_TOKEN"
```

```json
{
  "ok": true,
  "pairing": {
    "code": "k3m9q2wxp7…",
    "expiresAt": "2026-11-12T10:00:00.000Z",
    "command": "/start k3m9q2wxp7…",
    "links": { "telegram": "https://t.me/example_inbox_bot?start=k3m9q2wxp7…" }
  }
}
```

### A private chat

Open the `links.telegram` URL and press **Start**. Telegram sends `/start <code>` for you. Alternatively, open the bot and send the `command` text yourself.

The bot confirms:

> ✅ This chat now receives messages from **My site** (`my-site`).

To give another person their own copy of the messages, create another code and send them the link. Each person links their own chat.

### A group

Messages can go to a group so that a team sees them together.

**With a link.** Replace `?start=` with `?startgroup=` in the pairing link:

```
https://t.me/example_inbox_bot?startgroup=k3m9q2wxp7…
```

Telegram asks which group to add the bot to, adds it, and sends the code to the group.

**By hand.** Add the bot to the group, then send the command with the bot's username, so that the bot receives it even in privacy mode:

```
/start@example_inbox_bot k3m9q2wxp7…
```

> [!WARNING]
> Everyone in a linked group can see the messages and press the buttons. Link a group only if all its members should have that access.

If a group is upgraded to a supergroup, Telegram gives it a new chat id and deliveries to the old id fail. Create a new code and link the group again.

### Channels

Channels are not supported. Link a private chat or a group instead.

## Using the bot

### New messages

Every new message arrives like this:

```
📬 My site · #12 · 🔵 New
From: Sara <sara@example.org>
Page: https://example.com/pricing
At: 2026-11-12 09:14 UTC

Hello! Do you offer a yearly plan?

[ ✅ Mark read ]  [ 🗄 Archive ]
```

- **From** shows the name and email the visitor entered, or "Anonymous".
- **Page** is the address of the page the message was sent from, when known.
- `· via API` after the time means a server sent the message with the [API key](server.md).

To reply, write to the visitor's email address. kabot doesn't send replies to visitors.

### Buttons

| Status | Buttons |
| --- | --- |
| 🔵 New | ✅ Mark read · 🗄 Archive |
| ✅ Read | 🔵 Mark unread · 🗄 Archive |
| 🗄 Archived | 📥 Unarchive (back to Read) |

Pressing a button changes the status in the database and updates the message in every linked chat, so a team in different chats always sees the same status.

### Commands

| Command | What it does |
| --- | --- |
| `/inbox` | Lists the ten newest unread messages from all sites linked to this chat. Tap one to see it again with its buttons. |
| `/sites` | Lists the sites linked to this chat with their unread counts, with a button to unlink each one. |
| `/help` | Explains how to link a site and lists the commands. |
| `/start <code>` | Links this chat to a site. `/pair <code>` does the same. |

## Unlinking a chat

**From the chat.** Send `/sites`, press **Unlink** next to the site, and confirm with **Yes, unlink**.

**From the admin API.** List the linked chats with `GET /admin/sites/<site id>/subscriptions`. To remove every chat at once, delete and recreate the site, or rotate the bot token. The admin API has no endpoint to remove a single chat; use `/sites` in that chat.

Blocking the bot or leaving the group also stops delivery, but the link stays in the database and each new message records a delivery error.

## Changing the bot token

If the token leaks or you want to start fresh:

1. In BotFather, send `/revoke`, pick the bot, and copy the new token. The old one stops working at once.
2. Store it: `npx wrangler secret put TELEGRAM_BOT_TOKEN`.
3. Register the webhook again: `curl -X POST "$KABOT/admin/webhooks" -H "Authorization: Bearer $ADMIN_TOKEN"`.

Linked chats stay linked, because the bot and its chats are the same.

To move to a **different bot**, chats must be linked again: a new bot cannot message people who haven't started it.

## Using a different Bot API server

`TELEGRAM_API_BASE` changes the API address, for example to use a self-hosted [Telegram Bot API server](https://github.com/tdlib/telegram-bot-api). Set it in `wrangler.toml`:

```toml
[vars]
TELEGRAM_API_BASE = "https://bot-api.example.com"
```

The server must be reachable from Cloudflare over HTTPS and implement the standard methods.

## Limitations

- Telegram messages are limited to 4096 characters. kabot shortens a notification to 4000 characters and ends it with `…`. Visitor messages are already limited to 4000 characters, so only a very long message with a long name, email and page address is shortened.
- Forum topics in groups are not supported. Messages go to the group's general topic.
- If delivery fails, for example because the bot was blocked, the message stays in the database and the cron trigger retries it up to five times within two days.
