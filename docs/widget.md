# The widget

`widget.js` adds a message box to any website with one script tag. It has no dependencies and works with any framework or none.

## Basic use

```html
<script src="https://kabot.example.workers.dev/widget.js" data-site="my-site" async></script>
```

- `src` is your Worker's address followed by `/widget.js`.
- `data-site` is the site id you chose in `POST /admin/sites`.

The page's origin must be in the site's `allowedOrigins`, for example `https://example.com`. Otherwise the Worker refuses the messages. During local development, add `http://localhost:3000` or whichever address you use; see [Managing sites](admin.md#change-the-allowed-origins).

## Floating button or inline form

**Floating button (default).** A round button in the bottom corner opens a small panel. Use this for a "message me" box that is available on every page.

**Inline form.** Set `data-target` to a CSS selector. The form is rendered inside that element and is always visible. Use this on a contact page.

```html
<section>
  <h2>Contact</h2>
  <div id="contact-form"></div>
</section>

<script
  src="https://kabot.example.workers.dev/widget.js"
  data-site="my-site"
  data-target="#contact-form"
  async
></script>
```

A page can have both: add two script tags, one with `data-target` and one without.

## All attributes

| Attribute | Default | Description |
| --- | --- | --- |
| `data-site` | (required) | The site id. |
| `data-target` | none | CSS selector of the element to render an inline form into. Without it, the widget shows a floating button. |
| `data-position` | `right` | `left` or `right`: the corner of the floating button. |
| `data-dir` | `ltr` | `rtl` for Persian, Arabic, Hebrew and other right-to-left languages. |
| `data-accent` | `#1f6feb` | Colour of the button and the send button, as a hex value such as `#0f766e`. |
| `data-endpoint` | origin of `src` | Worker address. Only needed if you serve `widget.js` from somewhere other than the Worker. |
| `data-title` | `Send a message` | Heading of the form. |
| `data-open-label` | `Open message box` | Screen reader label of the floating button. |
| `data-close-label` | `Close` | Screen reader label of the close buttons. |
| `data-name-label` | `Name` | Label of the name field. |
| `data-email-label` | `Email` | Label of the email field. |
| `data-message-label` | `Message` | Label of the message field. |
| `data-send-label` | `Send` | Text of the send button. |
| `data-sending-label` | `Sending…` | Text of the send button while sending. |
| `data-success-text` | `Thanks! Your message was sent.` | Shown after a successful send. |
| `data-error-text` | `Something went wrong. Please try again.` | Shown when the error has no message of its own. |

Whether the email field is required comes from the site's `requireEmail` setting, not from an attribute. The name field is always optional.

## Translations and right-to-left languages

Every visible text is an attribute, so a translated widget needs no code. A Persian example:

```html
<script
  src="https://kabot.example.workers.dev/widget.js"
  data-site="my-site"
  data-dir="rtl"
  data-position="left"
  data-title="پیام بگذارید"
  data-open-label="باز کردن جعبه‌ی پیام"
  data-close-label="بستن"
  data-name-label="نام"
  data-email-label="ایمیل"
  data-message-label="پیام"
  data-send-label="ارسال"
  data-sending-label="در حال ارسال…"
  data-success-text="پیام شما ارسال شد. ممنون!"
  data-error-text="ارسال نشد. لطفاً دوباره تلاش کنید."
  async
></script>
```

Validation messages from the Worker, such as "Email must be a valid address.", are in English. If you need them translated, use the [React component](react.md) or [your own form](server.md#from-your-own-browser-form) and map the error `code` and `fields` to your own text.

On a multilingual site, render the script tag with the labels of the page's language.

## Appearance

The widget renders inside a [Shadow DOM](https://developer.mozilla.org/docs/Web/API/Web_components/Using_shadow_DOM), so your page's CSS cannot break it and its CSS cannot leak into your page. As a consequence, you can't restyle its inside with your stylesheet. You can change:

- the accent colour with `data-accent`;
- the corner with `data-position`;
- the width of the inline form, by sizing the `data-target` element.

The widget follows the visitor's light or dark system setting. It uses the system font.

For complete control over the markup and styles, use the [React component](react.md), which is unstyled, or build your own form with [`@mtnaskari/kabot/client`](server.md#from-your-own-browser-form).

## Events

After a successful send, the widget dispatches a `kabot:sent` event that bubbles to `document`:

```js
document.addEventListener("kabot:sent", () => {
  // for example, record a conversion in your analytics
  plausible?.("Message sent");
});
```

## Turnstile

When the site has [Turnstile turned on](admin.md#turn-on-turnstile), the widget loads Cloudflare's Turnstile script and shows the challenge above the send button. In most cases it passes without the visitor doing anything. The widget sends the token with the message and resets the challenge after each attempt.

Turnstile only accepts the hostnames you list for the widget in the Cloudflare dashboard. Add every domain the message box runs on.

## Content Security Policy

If your site sends a `Content-Security-Policy` header, allow the Worker, and Turnstile if you use it:

```
script-src  'self' https://kabot.example.workers.dev https://challenges.cloudflare.com;
connect-src 'self' https://kabot.example.workers.dev;
frame-src   https://challenges.cloudflare.com;
```

The widget writes its styles inside its Shadow DOM with a `<style>` element. If your policy blocks inline styles, use the React component instead.

## Platform notes

**Plain HTML.** Put the tag before `</body>`, or anywhere with `async`.

**WordPress.** Add the tag with a "header and footer scripts" plugin or your theme's footer. Don't paste it into a post, because the editor may strip `data-` attributes.

**Next.js.** Use `next/script`:

```tsx
import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script src="https://kabot.example.workers.dev/widget.js" data-site="my-site" strategy="lazyOnload" />
      </body>
    </html>
  );
}
```

For an inline form in React, the [React component](react.md) is a better fit than `data-target`, because React may replace the target element.

**Single-page apps.** The widget mounts once, when the script runs. The floating button stays across client-side navigation. An inline form mounts into the target that exists at load time, so on single-page apps prefer the floating button or the React component.

## Accessibility

- The floating panel is a non-modal dialog: the page stays usable behind it.
- Opening the panel moves focus to the first field; **Escape** and the close button return focus to the floating button.
- Fields have labels, the status line is announced by screen readers, and focus outlines are always visible.
