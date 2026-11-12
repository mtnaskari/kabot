# Sending from a server

Your backend can send messages with the site's API key instead of, or as well as, the widget. Use this when:

- the form is already handled by your backend and you only want the notification;
- you want your own checks, such as a logged-in user or a CAPTCHA you already use;
- you want the visitor's browser to talk only to your own domain.

> [!IMPORTANT]
> The API key replaces the origin check and Turnstile, so it must stay on the server.

kabot refuses a key that arrives with an `Origin` header, which every browser sends, and browsers cannot send the `Authorization` header to the Worker at all.

## The API key

`POST /admin/sites` returns the key once, as `apiKey`. It starts with `kb_`. Store it as a secret in your backend's environment, for example `KABOT_API_KEY`. Never commit it or send it to a browser.

The Worker stores only a hash of the key, so a lost key cannot be recovered. Issue a new one:

```bash
curl -X POST "$KABOT/admin/sites/my-site/api-key" -H "Authorization: Bearer $ADMIN_TOKEN"
```

The old key stops working at once. To disable server submissions entirely, revoke the key with `DELETE /admin/sites/my-site/api-key`.

## kabot/client

```bash
npm install kabot
```

```ts
import { createKabotClient, KabotError } from "kabot/client";

const kabot = createKabotClient({
  endpoint: "https://kabot.example.workers.dev",
  apiKey: process.env.KABOT_API_KEY!,
});

const { id } = await kabot.send({
  name: "Sara",
  email: "sara@example.org",
  message: "Hello!",
  page: "https://example.com/contact",
  visitorIp: "203.0.113.7",
});
```

The client depends only on the standard `fetch`, so it runs in Node.js 18 and later, Cloudflare Workers, Deno, Bun and browsers.

### Options

| Option | Type | Description |
| --- | --- | --- |
| `endpoint` | `string` | The Worker's address. Required. |
| `apiKey` | `string` | Server mode: the site's API key. |
| `site` | `string` | Browser mode: the site id. Use instead of `apiKey`, never together. |
| `fetch` | `typeof fetch` | A custom `fetch`, for example one with a proxy or for tests. |
| `timeoutMs` | `number` | Request timeout. Default `10000`. |

`send()` resolves to `{ ok: true, id }` in server mode, where `id` is the message's number as shown in the chat (`#12`). In browser mode it resolves to `{ ok: true }`.

## The message object

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `message` | `string` | yes | 2 to 4000 characters after trimming. At most five links. |
| `name` | `string` | no | Up to 100 characters, on one line. |
| `email` | `string` | depends | Required when the site's `requireEmail` is `true`, which is the default. |
| `page` | `string` | no | An `http` or `https` URL, up to 500 characters. Shown in the notification. |
| `visitorIp` | `string` | no | Server mode. The visitor's IP address, used for rate limits. |
| `turnstileToken` | `string` | no | Browser mode, when the site uses Turnstile. |
| `website` | `string` | no | Honeypot. Leave it empty; a value makes kabot discard the message while reporting success. |

All text fields reject control characters, bidirectional overrides and zero-width characters. Persian, Arabic and other scripts are accepted.

### Why pass `visitorIp`

Rate limits count requests per visitor IP: 5 per minute and `DAILY_LIMIT_PER_IP` per day for each site. With `visitorIp`, each visitor of your site gets their own limit. Without it, every request from your server shares one limit of 60 per minute for the site, and the daily cap doesn't apply.

Take the IP from your platform's trusted source, not from a header the visitor can set:

| Platform | Source |
| --- | --- |
| Behind Cloudflare | `CF-Connecting-IP` header |
| Express with `trust proxy` configured | `req.ip` |
| Vercel | `x-real-ip` header |
| Nginx in front of your app | the header your Nginx sets, such as `X-Real-IP` |

The Worker stores only a keyed hash of the IP, never the address itself.

## Errors

`send()` throws a `KabotError` for any failure:

```ts
try {
  await kabot.send({ email, message });
} catch (error) {
  if (error instanceof KabotError) {
    error.status;     // HTTP status, or 0 for network errors and timeouts
    error.code;       // stable code, see below
    error.message;    // English description
    error.fields;     // per-field messages for validation errors
    error.retryAfter; // seconds, for rate_limited
  }
}
```

| `code` | Status | Meaning | What to do |
| --- | --- | --- | --- |
| `validation` | 400 | A field is invalid. `fields` names each one. | Show the field messages to the visitor. |
| `bad_request` | 400 | The body isn't a JSON object, or a key was sent with an `Origin` header. | Fix the request. |
| `unauthorized` | 401 | The API key is wrong or was rotated. | Update the key. |
| `turnstile_failed` | 403 | Browser mode: the Turnstile token is missing or invalid. | Let the visitor try again. |
| `origin_not_allowed` | 403 | Browser mode: the page's origin isn't allowed. | Add the origin to the site. |
| `unknown_site` | 404 | Browser mode: no site has this id. | Check `site`. |
| `too_large` | 413 | The body is over 16 KiB. | Shorten the message. |
| `rate_limited` | 429 | Too many messages. | Wait `retryAfter` seconds. |
| `internal` | 500 | An unexpected error in the Worker. | Retry later and check the Worker's logs. |
| `network` | 0 | The Worker couldn't be reached. | Retry later. |
| `timeout` | 0 | No response within `timeoutMs`. | Retry later. |

A `201` response means the message is stored. Delivery to the chat happens afterwards and is retried automatically, so you never need to resend a message that was accepted.

## Examples by platform

### Next.js route handler

```ts
// app/api/contact/route.ts
import { createKabotClient, KabotError } from "kabot/client";

const kabot = createKabotClient({ endpoint: process.env.KABOT_URL!, apiKey: process.env.KABOT_API_KEY! });

export async function POST(request: Request) {
  const body = await request.json();
  try {
    await kabot.send({
      name: body.name,
      email: body.email,
      message: body.message,
      page: request.headers.get("referer") ?? undefined,
      visitorIp: request.headers.get("x-real-ip") ?? undefined,
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof KabotError && error.status > 0 && error.status < 500) {
      return Response.json({ ok: false, code: error.code, fields: error.fields }, { status: error.status });
    }
    return Response.json({ ok: false }, { status: 502 });
  }
}
```

Only pass fields you expect. Don't forward the whole request body, so a visitor can't set `visitorIp` themselves.

### Express

```js
import express from "express";
import { createKabotClient, KabotError } from "kabot/client";

const app = express();
app.set("trust proxy", 1); // so req.ip is the visitor's address behind one proxy
app.use(express.json({ limit: "16kb" }));

const kabot = createKabotClient({ endpoint: process.env.KABOT_URL, apiKey: process.env.KABOT_API_KEY });

app.post("/contact", async (req, res) => {
  try {
    await kabot.send({ name: req.body.name, email: req.body.email, message: req.body.message, visitorIp: req.ip });
    res.json({ ok: true });
  } catch (error) {
    const status = error instanceof KabotError && error.status ? error.status : 502;
    res.status(status).json({ ok: false, fields: error.fields });
  }
});
```

### Cloudflare Workers

```ts
import { createKabotClient } from "kabot/client";

export default {
  async fetch(request: Request, env: { KABOT_URL: string; KABOT_API_KEY: string }) {
    const kabot = createKabotClient({ endpoint: env.KABOT_URL, apiKey: env.KABOT_API_KEY });
    const form = await request.formData();
    await kabot.send({
      email: String(form.get("email")),
      message: String(form.get("message")),
      visitorIp: request.headers.get("cf-connecting-ip") ?? undefined,
    });
    return new Response("Thanks!");
  },
};
```

### Deno

```ts
import { createKabotClient } from "npm:kabot/client";

const kabot = createKabotClient({ endpoint: Deno.env.get("KABOT_URL")!, apiKey: Deno.env.get("KABOT_API_KEY")! });
await kabot.send({ email: "sara@example.org", message: "Hello from Deno" });
```

### Bun

```ts
import { createKabotClient } from "kabot/client";

const kabot = createKabotClient({ endpoint: Bun.env.KABOT_URL!, apiKey: Bun.env.KABOT_API_KEY! });
await kabot.send({ email: "sara@example.org", message: "Hello from Bun" });
```

## Without the client

Any language that can make an HTTPS request works.

### curl

```bash
curl -X POST "https://kabot.example.workers.dev/v1/messages" \
  -H "Authorization: Bearer $KABOT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Sara", "email": "sara@example.org", "message": "Hello!"}'
# {"ok":true,"id":12}
```

### PHP

```php
<?php
$response = file_get_contents(getenv('KABOT_URL') . '/v1/messages', false, stream_context_create([
    'http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\nAuthorization: Bearer " . getenv('KABOT_API_KEY'),
        'content' => json_encode([
            'name' => $_POST['name'] ?? '',
            'email' => $_POST['email'] ?? '',
            'message' => $_POST['message'] ?? '',
            'visitorIp' => $_SERVER['REMOTE_ADDR'],
        ]),
        'ignore_errors' => true,
        'timeout' => 10,
    ],
]));
$result = json_decode($response, true);
```

### Python

```python
import os
import requests

response = requests.post(
    f"{os.environ['KABOT_URL']}/v1/messages",
    headers={"Authorization": f"Bearer {os.environ['KABOT_API_KEY']}"},
    json={"email": "sara@example.org", "message": "Hello from Python", "visitorIp": visitor_ip},
    timeout=10,
)
data = response.json()
if not data["ok"]:
    print(data["error"]["code"], data["error"].get("fields"))
```

### Go

```go
body, _ := json.Marshal(map[string]string{"email": email, "message": message, "visitorIp": ip})
req, _ := http.NewRequest("POST", os.Getenv("KABOT_URL")+"/v1/messages", bytes.NewReader(body))
req.Header.Set("Content-Type", "application/json")
req.Header.Set("Authorization", "Bearer "+os.Getenv("KABOT_API_KEY"))
resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
```

The full request and response format is in the [HTTP API reference](api.md#post-v1messages).

## From your own browser form

To use your own HTML form in the browser without an API key, use browser mode. The page's origin must be allowed for the site.

```html
<form id="contact">
  <input name="email" type="email" required>
  <textarea name="message" required></textarea>
  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-10000px" aria-hidden="true">
  <button>Send</button>
  <p id="status" role="status"></p>
</form>

<script type="module">
  import { createKabotClient } from "https://cdn.jsdelivr.net/npm/kabot@0.1.0/dist/client/index.js";

  const kabot = createKabotClient({ endpoint: "https://kabot.example.workers.dev", site: "my-site" });
  const form = document.getElementById("contact");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      await kabot.send({
        email: data.get("email"),
        message: data.get("message"),
        website: data.get("website"),
        page: location.href,
      });
      form.reset();
      document.getElementById("status").textContent = "Thanks!";
    } catch (error) {
      document.getElementById("status").textContent = error.fields?.email ?? error.fields?.message ?? error.message;
    }
  });
</script>
```

If the site uses Turnstile, render the challenge yourself and pass its token as `turnstileToken`.
