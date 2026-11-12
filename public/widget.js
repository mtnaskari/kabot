/*! kabot widget | Apache-2.0 | https://github.com/mtnaskari/kabot */
(() => {
  "use strict";

  const script = document.currentScript;
  if (!script || !script.dataset.site) {
    console.error("[kabot] widget.js needs a data-site attribute.");
    return;
  }

  const d = script.dataset;
  const endpoint = (d.endpoint || new URL(script.src).origin).replace(/\/+$/, "");
  const rtl = d.dir === "rtl";
  const text = {
    title: d.title || "Send a message",
    open: d.openLabel || "Open message box",
    close: d.closeLabel || "Close",
    name: d.nameLabel || "Name",
    email: d.emailLabel || "Email",
    message: d.messageLabel || "Message",
    send: d.sendLabel || "Send",
    sending: d.sendingLabel || "Sending…",
    success: d.successText || "Thanks! Your message was sent.",
    error: d.errorText || "Something went wrong. Please try again.",
  };
  const accent = /^#[0-9a-f]{3,8}$/i.test(d.accent || "") ? d.accent : "#1f6feb";
  const inlineTarget = !!d.target;

  const host = document.createElement("div");
  host.setAttribute("data-kabot", "");
  const root = host.attachShadow({ mode: "open" });
  // Turnstile renders into the light DOM and is projected into the form through a slot.
  const turnstileSlot = document.createElement("div");
  turnstileSlot.slot = "turnstile";
  host.appendChild(turnstileSlot);

  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; }
  .wrap { position: fixed; bottom: 16px; ${d.position === "left" ? "left" : "right"}: 16px; z-index: 2147483000;
    display: flex; flex-direction: column; align-items: ${d.position === "left" ? "flex-start" : "flex-end"}; gap: 12px; }
  .wrap.inline { position: static; display: block; }
  .launcher { width: 56px; height: 56px; border-radius: 50%; border: 0; cursor: pointer; background: ${accent}; color: #fff;
    display: grid; place-items: center; box-shadow: 0 10px 30px -10px rgba(0,0,0,.5); transition: transform .15s; }
  .launcher:hover { transform: scale(1.05); }
  .launcher:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid ${accent}; outline-offset: 2px; }
  .panel { width: min(360px, calc(100vw - 32px)); max-height: calc(100vh - 100px); overflow-y: auto; background: #fff; color: #1a1a1a;
    border-radius: 16px; box-shadow: 0 24px 60px -20px rgba(0,0,0,.45); padding: 16px; }
  .inline .panel { width: 100%; max-height: none; box-shadow: none; border: 1px solid #ddd; }
  .panel[hidden] { display: none; }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  h2 { font-size: 17px; font-weight: 600; margin: 0; }
  .x { background: none; border: 0; font-size: 20px; line-height: 1; cursor: pointer; color: #666; padding: 6px; border-radius: 8px; }
  label { display: block; font-size: 13px; color: #444; margin: 10px 0 4px; }
  input, textarea { width: 100%; padding: 9px 11px; border: 1px solid #ccc; border-radius: 10px; font-size: 15px; color: inherit; background: #fff; }
  textarea { min-height: 110px; resize: vertical; }
  .hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
  .send { margin-top: 12px; width: 100%; padding: 10px; border: 0; border-radius: 10px; background: ${accent}; color: #fff;
    font-size: 15px; font-weight: 600; cursor: pointer; }
  .send[disabled] { opacity: .6; cursor: progress; }
  .status { min-height: 1.2em; font-size: 13px; margin: 8px 0 0; }
  .status.err { color: #b42318; } .status.ok { color: #067647; }
  .ts { margin-top: 10px; }
  @media (prefers-color-scheme: dark) {
    .panel { background: #1c1c1e; color: #f2f2f2; }
    .inline .panel { border-color: #333; }
    label { color: #bbb; } .x { color: #aaa; }
    .status.err { color: #f97066; } .status.ok { color: #47cd89; }
    input, textarea { background: #2c2c2e; border-color: #444; }
  }
</style>
<div class="wrap${inlineTarget ? " inline" : ""}" dir="${rtl ? "rtl" : "ltr"}">
  <div class="panel" role="${inlineTarget ? "region" : "dialog"}" aria-labelledby="kb-title"${inlineTarget ? "" : " hidden"}>
    <div class="head">
      <h2 id="kb-title"></h2>
      ${inlineTarget ? "" : '<button type="button" class="x" data-close>×</button>'}
    </div>
    <form novalidate>
      <label for="kb-name" data-t="name"></label>
      <input id="kb-name" name="name" autocomplete="name" maxlength="100">
      <label for="kb-email" data-t="email"></label>
      <input id="kb-email" name="email" type="email" autocomplete="email" maxlength="254">
      <label for="kb-message" data-t="message"></label>
      <textarea id="kb-message" name="message" required minlength="2" maxlength="4000"></textarea>
      <div class="hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
      <div class="ts"><slot name="turnstile"></slot></div>
      <button type="submit" class="send"></button>
      <p class="status" role="status" aria-live="polite"></p>
    </form>
  </div>
  ${inlineTarget ? "" : '<button type="button" class="launcher" aria-expanded="false"></button>'}
</div>`;

  const $ = (s) => root.querySelector(s);
  const panel = $(".panel");
  const form = $("form");
  const status = $(".status");
  const sendBtn = $(".send");
  const launcher = $(".launcher");
  const closeBtn = $("[data-close]");
  $("#kb-title").textContent = text.title;
  root.querySelectorAll("[data-t]").forEach((el) => (el.textContent = text[el.dataset.t]));
  sendBtn.textContent = text.send;

  const ICON_OPEN =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg>';
  const ICON_CLOSE =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  let config = null;
  let turnstileId = null;

  function setOpen(open) {
    if (!launcher) return;
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-label", open ? text.close : text.open);
    launcher.innerHTML = open ? ICON_CLOSE : ICON_OPEN;
    if (open) {
      ensureConfig();
      $("#kb-name").focus();
    }
  }

  function loadConfig() {
    return fetch(`${endpoint}/v1/sites/${encodeURIComponent(d.site)}/config`)
      .then((r) => r.json())
      .then((body) => {
        if (!body.ok) throw new Error(body.error && body.error.message);
        config = body.site;
        $("#kb-email").required = !!config.requireEmail;
        if (config.turnstileSiteKey) renderTurnstile(config.turnstileSiteKey);
        return config;
      });
  }

  let configPromise = null;
  function ensureConfig() {
    if (!configPromise) configPromise = loadConfig().catch((e) => ((configPromise = null), Promise.reject(e)));
    return configPromise;
  }

  function renderTurnstile(sitekey) {
    const render = () => {
      turnstileId = window.turnstile.render(turnstileSlot, { sitekey, theme: "auto", size: "flexible" });
    };
    if (window.turnstile) return render();
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }

  function show(msg, kind) {
    status.textContent = msg;
    status.className = `status ${kind || ""}`;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    sendBtn.disabled = true;
    sendBtn.textContent = text.sending;
    show("");
    try {
      await ensureConfig();
      const data = new FormData(form);
      const body = {
        site: d.site,
        name: data.get("name"),
        email: data.get("email"),
        message: data.get("message"),
        website: data.get("website"),
        page: location.href.slice(0, 500),
      };
      if (turnstileId !== null) body.turnstileToken = window.turnstile.getResponse(turnstileId);
      const res = await fetch(`${endpoint}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error((out.error && out.error.message) || text.error);
      form.reset();
      show(text.success, "ok");
      host.dispatchEvent(new CustomEvent("kabot:sent", { bubbles: true, composed: true }));
    } catch (error) {
      show(error && error.message ? error.message : text.error, "err");
    } finally {
      if (turnstileId !== null) window.turnstile.reset(turnstileId);
      sendBtn.disabled = false;
      sendBtn.textContent = text.send;
    }
  });

  if (launcher) {
    launcher.addEventListener("click", () => setOpen(panel.hidden));
    closeBtn.setAttribute("aria-label", text.close);
    closeBtn.addEventListener("click", () => {
      setOpen(false);
      launcher.focus();
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !panel.hidden) {
        setOpen(false);
        launcher.focus();
      }
    });
    setOpen(false);
  } else {
    ensureConfig().catch(() => {});
  }

  const mount = () => {
    const target = inlineTarget ? document.querySelector(d.target) : document.body;
    if (!target) return console.error(`[kabot] data-target ${d.target} matched no element.`);
    target.appendChild(host);
  };
  if (document.readyState !== "loading") mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
