# Bale

[Bale](https://bale.ai) is a messenger that is widely used in Iran and reachable there without restrictions. Its [Bot API](https://docs.bale.ai) follows Telegram's: the same methods, the same payloads, and a different address, `https://tapi.bale.ai`. kabot uses the same code for both, so everything in the [Telegram guide](telegram.md) applies to Bale, apart from the differences listed below.

A deployment can run a Telegram bot, a Bale bot, or both. A site can deliver to Telegram chats and Bale chats at the same time, for example to you on Telegram and to a colleague on Bale.

## Creating the bot

1. In Bale, open the official bot father bot, `@botfather`, and start it.
2. Follow its steps to create a new bot and choose a username.
3. Copy the token it gives you.

Store the token in the Worker and register the webhook:

```bash
npx wrangler secret put BALE_BOT_TOKEN
curl -X POST "$KABOT/admin/webhooks" -H "Authorization: Bearer $ADMIN_TOKEN"
```

The webhook call configures every bot that has a token, so it also refreshes Telegram's webhook if you use both.

## Linking a chat

Create a pairing code as usual:

```bash
curl -X POST "$KABOT/admin/sites/my-site/pairing-codes" -H "Authorization: Bearer $ADMIN_TOKEN"
```

```json
{
  "ok": true,
  "pairing": {
    "code": "k3m9q2wxp7…",
    "command": "/start k3m9q2wxp7…",
    "links": { "telegram": "https://t.me/example_inbox_bot?start=k3m9q2wxp7…", "bale": "https://ble.ir/example_inbox_bot" }
  }
}
```

The same code works on either platform, once. On Bale:

1. Open `links.bale`, or search for the bot in Bale.
2. Send the `command` text, for example `/start k3m9q2wxp7…`.

The Bale link only opens the bot, because Bale does not document a way to pass a start code in a link. Send the command yourself.

## Differences from Telegram

| | Telegram | Bale |
| --- | --- | --- |
| API address | `https://api.telegram.org` | `https://tapi.bale.ai` |
| Formatting | Bold names and code, through HTML | Plain text, because Bale does not document HTML formatting |
| Pairing link | Carries the code | Opens the bot; send the command yourself |
| Webhook protection | Secret URL and a secret header | Secret URL |

Commands, buttons, `/inbox`, `/sites` and status updates work the same way.

The same chat number on Telegram and on Bale refers to two different chats. Links, permissions and button presses are always checked per platform.

## Changing the API address

If Bale's API moves, or you use a proxy, set `BALE_API_BASE` in `wrangler.toml`:

```toml
[vars]
BALE_API_BASE = "https://tapi.bale.ai"
```

## Turning Bale off

Delete the secret:

```bash
npx wrangler secret delete BALE_BOT_TOKEN
```

Linked Bale chats stay in the database but receive nothing, and each new message records a delivery error for them. Unlink them first with `/sites` in each chat if you want a clean state.
