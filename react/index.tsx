import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createKabotClient, KabotError, type KabotMessage } from "../client/index.js";

export { KabotError };

type TurnstileApi = {
  render(el: HTMLElement, opts: { sitekey: string; theme?: string; size?: string }): string;
  getResponse(id: string): string | undefined;
  reset(id: string): void;
  remove(id: string): void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type KabotStatus = "idle" | "sending" | "sent" | "error";

/** Sends messages from the browser in browser mode. The page's origin must be allowed for the site. */
export function useKabot({ endpoint, site }: { endpoint: string; site: string }) {
  const [status, setStatus] = useState<KabotStatus>("idle");
  const [error, setError] = useState<KabotError | null>(null);
  const client = useRef(createKabotClient({ endpoint, site }));
  useEffect(() => {
    client.current = createKabotClient({ endpoint, site });
  }, [endpoint, site]);

  const send = useCallback(async (message: KabotMessage) => {
    setStatus("sending");
    setError(null);
    try {
      await client.current.send(message);
      setStatus("sent");
      return true;
    } catch (e) {
      setError(e instanceof KabotError ? e : new KabotError(0, "unknown", String(e)));
      setStatus("error");
      return false;
    }
  }, []);
  return { send, status, error };
}

function useTurnstile(siteKey: string | null | undefined) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  useEffect(() => {
    if (!siteKey || !box.current) return;
    const el = box.current;
    const render = () => {
      if (window.turnstile && id.current === null) id.current = window.turnstile.render(el, { sitekey: siteKey, theme: "auto", size: "flexible" });
    };
    if (window.turnstile) render();
    else {
      const src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      let script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
      if (!script) {
        script = document.createElement("script");
        script.src = src;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
    }
    return () => {
      if (id.current !== null) window.turnstile?.remove(id.current);
      id.current = null;
    };
  }, [siteKey]);
  return {
    box,
    token: () => (id.current !== null ? window.turnstile?.getResponse(id.current) : undefined),
    reset: () => id.current !== null && window.turnstile?.reset(id.current),
  };
}

export type KabotFormLabels = Partial<Record<"name" | "email" | "message" | "send" | "sending" | "success", string>>;

export type KabotFormProps = {
  endpoint: string;
  site: string;
  /** Turnstile site key. When omitted, the form reads it from the site's public config. */
  turnstileSiteKey?: string | null;
  requireEmail?: boolean;
  labels?: KabotFormLabels;
  className?: string;
  onSent?: () => void;
  /** Rendered after the fields, before the submit button. */
  children?: ReactNode;
};

/**
 * An unstyled contact form. Elements carry `kabot-*` class names for styling.
 */
export function KabotForm({ endpoint, site, turnstileSiteKey, requireEmail, labels = {}, className, onSent, children }: KabotFormProps) {
  const { send, status, error } = useKabot({ endpoint, site });
  const [config, setConfig] = useState<{ requireEmail: boolean; turnstileSiteKey: string | null } | null>(null);
  useEffect(() => {
    if (turnstileSiteKey !== undefined && requireEmail !== undefined) return;
    let live = true;
    fetch(`${endpoint.replace(/\/+$/, "")}/v1/sites/${encodeURIComponent(site)}/config`)
      .then((r) => r.json() as Promise<{ ok: boolean; site?: { requireEmail: boolean; turnstileSiteKey: string | null } }>)
      .then((body) => live && body.ok && body.site && setConfig(body.site))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [endpoint, site, turnstileSiteKey, requireEmail]);

  const emailRequired = requireEmail ?? config?.requireEmail ?? true;
  const turnstile = useTurnstile(turnstileSiteKey === undefined ? config?.turnstileSiteKey : turnstileSiteKey);
  const t = { name: "Name", email: "Email", message: "Message", send: "Send", sending: "Sending…", success: "Thanks! Your message was sent.", ...labels };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await send({
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      message: String(data.get("message") ?? ""),
      page: window.location.href.slice(0, 500),
      turnstileToken: turnstile.token(),
      website: String(data.get("website") ?? ""),
    });
    turnstile.reset();
    if (ok) {
      form.reset();
      onSent?.();
    }
  }

  return (
    <form className={className ?? "kabot-form"} onSubmit={onSubmit}>
      <label className="kabot-label">
        {t.name}
        <input className="kabot-input" name="name" autoComplete="name" maxLength={100} />
      </label>
      <label className="kabot-label">
        {t.email}
        <input className="kabot-input" name="email" type="email" autoComplete="email" maxLength={254} required={emailRequired} />
      </label>
      <label className="kabot-label">
        {t.message}
        <textarea className="kabot-textarea" name="message" required minLength={2} maxLength={4000} rows={5} />
      </label>
      <div aria-hidden="true" style={{ position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" }}>
        <input name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div ref={turnstile.box} className="kabot-turnstile" />
      {children}
      <button className="kabot-submit" type="submit" disabled={status === "sending"}>
        {status === "sending" ? t.sending : t.send}
      </button>
      <p className="kabot-status" role="status" aria-live="polite">
        {status === "sent" ? t.success : status === "error" ? error?.message : ""}
      </p>
    </form>
  );
}
