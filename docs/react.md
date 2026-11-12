# React

`@mtnaskari/kabot/react` provides a ready-made form, `KabotForm`, and a hook, `useKabot`, for building your own. Both send messages from the visitor's browser, so the page's origin must be in the site's `allowedOrigins`. No API key is involved.

## Installation

```bash
npm install @mtnaskari/kabot
```

React 18 or later is required.

## KabotForm

```tsx
import { KabotForm } from "@mtnaskari/kabot/react";

export function Contact() {
  return (
    <KabotForm
      endpoint="https://kabot.example.workers.dev"
      site="my-site"
      onSent={() => console.log("Message sent")}
    />
  );
}
```

The form has name, email and message fields, a hidden honeypot field, an optional Turnstile challenge, a send button and a status line.

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `endpoint` | `string` | (required) | The Worker's address. |
| `site` | `string` | (required) | The site id. |
| `turnstileSiteKey` | `string \| null` | read from the Worker | Turnstile site key. Pass `null` only when the site has no Turnstile secret, because the Worker still requires a token if it has one. |
| `requireEmail` | `boolean` | read from the Worker | Whether the email field is required. |
| `labels` | object | English | Any of `name`, `email`, `message`, `send`, `sending` and `success`. |
| `className` | `string` | `kabot-form` | Class of the `<form>` element. |
| `onSent` | `() => void` | none | Called after a successful send. The form is cleared first. |
| `children` | `ReactNode` | none | Rendered after the fields and before the send button, for example a consent note. |

When either `turnstileSiteKey` or `requireEmail` is missing, the form reads both from `GET /v1/sites/<site>/config` once. Pass both to avoid that request.

### Styling

The form has no styles of its own. Every element has a class name:

| Element | Class |
| --- | --- |
| `<form>` | `kabot-form`, or your `className` |
| `<label>` (wraps the field) | `kabot-label` |
| `<input>` | `kabot-input` |
| `<textarea>` | `kabot-textarea` |
| Turnstile container | `kabot-turnstile` |
| Send button | `kabot-submit` |
| Status line | `kabot-status` |

A starting point:

```css
.kabot-form { display: grid; gap: 12px; max-width: 28rem; }
.kabot-label { display: grid; gap: 4px; font-size: 0.875rem; }
.kabot-input, .kabot-textarea { padding: 0.6rem 0.75rem; border: 1px solid #d0d5dd; border-radius: 8px; font: inherit; }
.kabot-submit { padding: 0.65rem; border: 0; border-radius: 8px; background: #111827; color: white; font-weight: 600; }
.kabot-submit:disabled { opacity: 0.6; }
.kabot-status:empty { display: none; }
```

With Tailwind CSS, target the classes from a stylesheet with `@apply`, or pass `className` and style the children with arbitrary variants such as `[&_.kabot-input]:rounded-lg`.

### Translations

```tsx
<KabotForm
  endpoint="https://kabot.example.workers.dev"
  site="my-site"
  labels={{ name: "نام", email: "ایمیل", message: "پیام", send: "ارسال", sending: "در حال ارسال…", success: "پیام شما ارسال شد." }}
/>
```

Set `dir="rtl"` on a parent element for right-to-left languages.

## Next.js

`KabotForm` uses state and effects, so render it from a client component:

```tsx
// app/contact/contact-form.tsx
"use client";

import { KabotForm } from "@mtnaskari/kabot/react";

export function ContactForm() {
  return <KabotForm endpoint={process.env.NEXT_PUBLIC_KABOT_URL!} site="my-site" />;
}
```

```tsx
// app/contact/page.tsx
import { ContactForm } from "./contact-form";

export default function ContactPage() {
  return (
    <main>
      <h1>Contact</h1>
      <ContactForm />
    </main>
  );
}
```

If you would rather keep the Worker address off the page, submit to a [route handler](server.md#nextjs-route-handler) that uses the API key.

## useKabot

The hook sends messages and tracks their state. Use it to build a form with your own markup, validation and translations.

```tsx
import { useKabot } from "@mtnaskari/kabot/react";

export function MiniForm() {
  const { send, status, error } = useKabot({ endpoint: "https://kabot.example.workers.dev", site: "my-site" });

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const ok = await send({
          email: String(data.get("email")),
          message: String(data.get("message")),
          page: window.location.href,
          website: String(data.get("website") ?? ""),
        });
        if (ok) form.reset();
      }}
    >
      <input name="email" type="email" required placeholder="you@example.com" />
      <textarea name="message" required />
      {/* Honeypot: hidden from people, filled by bots. */}
      <input name="website" tabIndex={-1} autoComplete="off" style={{ position: "absolute", left: -10000 }} aria-hidden="true" />
      <button disabled={status === "sending"}>Send</button>
      {status === "sent" && <p>Thanks!</p>}
      {status === "error" && <p>{error?.fields?.email ?? error?.fields?.message ?? error?.message}</p>}
    </form>
  );
}
```

`useKabot({ endpoint, site })` returns:

| Value | Type | Description |
| --- | --- | --- |
| `send(message)` | `(KabotMessage) => Promise<boolean>` | Sends a message. Resolves to `true` on success and `false` on failure; it never throws. |
| `status` | `"idle" \| "sending" \| "sent" \| "error"` | State of the last send. |
| `error` | `KabotError \| null` | The last error, with `status`, `code`, `message`, `fields` and `retryAfter`. |

`KabotMessage` and `KabotError` are described in [Sending from a server](server.md#the-message-object). When the site uses Turnstile, render the challenge yourself and pass its token as `turnstileToken`.
