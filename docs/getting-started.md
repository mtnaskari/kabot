# Getting started

This guide takes you from nothing to a working message box. When you finish, a visitor can write a message on your website and it arrives in your Telegram chat a moment later. It takes about fifteen minutes.

You need:

- A [Cloudflare account](https://dash.cloudflare.com/sign-up). The free plan is enough.
- A Telegram account. If you prefer Bale, follow [the Bale guide](bale.md) for step 1 and come back for the rest.
- A website you can add a `<script>` tag to, or a backend that can make an HTTPS request.
- For the command-line steps, [Node.js](https://nodejs.org/) 18 or later and `curl`.

## 1. Create a Telegram bot

1. In Telegram, open [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Send a display name, for example `My Site Messages`.
3. Send a username. It must end in `bot`, for example `mysite_messages_bot`.
4. BotFather replies with a token like `7012345678:AAH…`.

> [!IMPORTANT]
> Keep the token private. Anyone who has it controls the bot.

The bot only talks to chats you link with a pairing code, so it is safe for other people to find it. The [Telegram guide](telegram.md#optional-botfather-settings) lists optional settings such as a description and a profile picture.

## 2. Deploy the Worker

### Option A: the Deploy button

Open the [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/mtnaskari/kabot) link. Cloudflare copies the repository to your GitHub account, creates the D1 database and deploys the Worker. When it asks for secrets, fill them in as described in [step 3](#3-set-the-secrets) and skip that step.

### Option B: the command line

```bash
git clone https://github.com/mtnaskari/kabot
cd kabot
npm ci
npx wrangler login
npm run deploy
```

`npm run deploy` deploys the Worker, which creates the D1 database on the first run, and then creates the tables. Wrangler prints the Worker's URL, for example `https://kabot.your-name.workers.dev`. You will use it in every later step, so save it in your shell:

```bash
export KABOT=https://kabot.your-name.workers.dev
```

To use your own domain instead, see [Configuration](configuration.md#using-your-own-domain).

## 3. Set the secrets

kabot needs two random secrets and the bot token:

```bash
openssl rand -hex 32 | tee admin-token.txt | npx wrangler secret put ADMIN_TOKEN
openssl rand -hex 32 | npx wrangler secret put KABOT_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN      # paste the token from BotFather
```

- `ADMIN_TOKEN` lets you manage the deployment through the [admin API](admin.md). The first command also saves it to `admin-token.txt` so you can use it below. Move it to a password manager when you are done, and delete the file.
- `KABOT_SECRET` protects the webhook URL and hashes visitor IP addresses. You never need to type it again.

Load the admin token into your shell:

```bash
export ADMIN_TOKEN=$(cat admin-token.txt)
```

Check that the Worker responds:

```bash
curl "$KABOT/health"
# {"ok":true,"name":"kabot","version":"0.1.0"}
```

## 4. Connect the bot to the Worker

```bash
curl -X POST "$KABOT/admin/webhooks" -H "Authorization: Bearer $ADMIN_TOKEN"
```

The response shows the webhook for each configured bot:

```json
{ "ok": true, "webhooks": { "telegram": { "ok": true, "url": "https://kabot.your-name.workers.dev/bot/telegram/…", "pendingUpdates": 0, "lastError": null } } }
```

Telegram now sends the bot's messages to the Worker, and the bot shows a command menu with `/inbox`, `/sites` and `/help`.

## 5. Add your website

Choose a short id for the site, made of lowercase letters, digits and hyphens. List every origin the message box will run on, with the scheme and without a path.

```bash
curl -X POST "$KABOT/admin/sites" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-site",
    "name": "My site",
    "allowedOrigins": ["https://example.com", "https://www.example.com"]
  }'
```

The response contains two things you need:

```json
{
  "ok": true,
  "site": { "id": "my-site", "name": "My site", "…": "…" },
  "apiKey": "kb_X1y2…",
  "pairing": {
    "code": "k3m9q2…",
    "expiresAt": "2026-11-12T10:00:00.000Z",
    "command": "/start k3m9q2…",
    "links": { "telegram": "https://t.me/mysite_messages_bot?start=k3m9q2…" }
  }
}
```

- `apiKey` is only needed if your backend sends messages. It is shown once. Store it as a secret on your server, or ignore it if you only use the widget. You can issue a new one at any time.
- `pairing` links your chat to the site. The code works once and expires after an hour.

## 6. Link your chat

Open `pairing.links.telegram` on a device where you are signed in to Telegram. Telegram opens the bot with a **Start** button. Press it. The bot replies:

> ✅ This chat now receives messages from **My site** (`my-site`).

If the link doesn't open, open the bot yourself and send the `pairing.command` text, for example `/start k3m9q2…`.

To receive messages in a group, or in more than one chat, see [Linking chats](telegram.md#linking-chats).

## 7. Add the message box to your website

Add this line before `</body>` on every page that should show the message box:

```html
<script src="https://kabot.your-name.workers.dev/widget.js" data-site="my-site" async></script>
```

A round button appears in the bottom-right corner. Clicking it opens a form with name, email and message fields.

Other ways to send messages:

- [Customize the widget](widget.md): an inline form, colours, translations and right-to-left layouts.
- [Use the React component](react.md).
- [Send from your backend](server.md) with the API key.

## 8. Send a test message

Open your website, click the button, fill in the form and press **Send**. The message arrives in Telegram:

```
📬 My site · #1 · 🔵 New
From: Sara <sara@example.org>
Page: https://example.com/contact
At: 2026-11-12 09:14 UTC

Hello! I'd like to ask about your services.

[ ✅ Mark read ]  [ 🗄 Archive ]
```

Press **Mark read** or **Archive** to change its status. [Using the bot](telegram.md#using-the-bot) describes the rest.

If nothing arrives, see [Troubleshooting](troubleshooting.md).

## Next steps

- [Turn on Turnstile](admin.md#turn-on-turnstile) to stop automated spam.
- Add another site with a second `POST /admin/sites`. One deployment serves any number of sites.
- Read the [security model](security.md) to see what each protection covers.
