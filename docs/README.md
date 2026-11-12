# kabot documentation

Start with **[Getting started](getting-started.md)**: it takes you from nothing to a working message box in about fifteen minutes.

## Set up

| Guide | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | Create a bot, deploy the Worker, add a site, link your chat, embed the widget. |
| [Telegram](telegram.md) | Creating and configuring the bot, linking private chats and groups, buttons and commands, changing the token. |
| [Bale](bale.md) | Using a Bale bot instead of, or alongside, Telegram. |

## Send messages

| Guide | What it covers |
| --- | --- |
| [The widget](widget.md) | One script tag: floating or inline, translations, right-to-left layouts, Turnstile, CSP, platform notes. |
| [React](react.md) | `KabotForm` and the `useKabot` hook. |
| [Sending from a server](server.md) | `kabot/client`, the API key, errors, and examples for Next.js, Express, Workers, Deno, Bun, PHP, Python and Go. |

## Run it

| Guide | What it covers |
| --- | --- |
| [Managing sites](admin.md) | Origins, Turnstile, pairing codes, API keys, deleting sites, reading the database. |
| [Configuration and operations](configuration.md) | Secrets, variables, rate limits, custom domains, updates, backups, logs, costs. |
| [Troubleshooting and FAQ](troubleshooting.md) | What to check when something doesn't work. |

## Reference

| Document | What it covers |
| --- | --- |
| [HTTP API](api.md) | Every endpoint, field, error code and object. |
| [Security model](../README.md#security-model) | What each protection covers and where the trust boundaries are. |
| [Local development](development.md) | Running kabot locally, receiving bot updates, tests, project layout. |
