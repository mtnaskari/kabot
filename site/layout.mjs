const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const ICON = {
  github:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true" class="i-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true" class="i-moon"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  arrowL: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  arrowR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
};

// Applied before paint so the page never flashes the wrong theme.
const THEME_BOOT = `<script>try{var t=localStorage.getItem("kabot-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>`;

function head({ site, title, description, path, base }) {
  const full = title === site.name ? `${site.name} documentation` : `${title} · ${site.name}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${site.url}${path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${site.name}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${site.url}${path}">
<meta property="og:image" content="${site.url}assets/banner-light.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f6f4f0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#131211" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">
<link rel="icon" href="${base}favicon.ico" sizes="any">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&family=Vazirmatn:wght@400;600&display=swap">
<link rel="stylesheet" href="${base}assets/style.css">
${THEME_BOOT}
</head>`;
}

function topbar({ site, base, withMenu }) {
  return `<header class="topbar">
  <div class="topbar-inner">
    ${withMenu ? `<button class="icon-btn menu-btn" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">${ICON.menu}</button>` : ""}
    <a class="brand" href="${base}./">
      <img class="logo-light" src="${base}assets/logo.svg" alt="" width="28" height="28">
      <img class="logo-dark" src="${base}assets/logo-white.svg" alt="" width="28" height="28">
      <span>kabot</span>
    </a>
    <span class="version">v${site.version}</span>
    <nav class="top-links" aria-label="Main">
      <a href="${base}getting-started.html">Get started</a>
      <a href="${base}api.html">API</a>
    </nav>
    <div class="top-actions">
      <a class="icon-btn" href="${site.repo}" aria-label="kabot on GitHub">${ICON.github}</a>
      <button class="icon-btn theme-btn" type="button" aria-label="Switch colour theme">${ICON.sun}${ICON.moon}</button>
    </div>
  </div>
</header>`;
}

function sidebar({ nav, slug, base }) {
  return `<aside class="sidebar" id="sidebar">
  <nav aria-label="Documentation">
${nav
  .map(
    (g) => `    <div class="nav-group">
      <p class="nav-title">${esc(g.group)}</p>
      <ul>
${g.items
  .map(([s, label]) => {
    const href = s === "index" ? `${base}./` : `${base}${s}.html`;
    return `        <li><a href="${href}"${s === slug ? ' aria-current="page"' : ""}>${esc(label)}</a></li>`;
  })
  .join("\n")}
      </ul>
    </div>`,
  )
  .join("\n")}
  </nav>
</aside>`;
}

function footer({ site }) {
  return `<footer class="site-footer">
  <p>kabot is open source under the <a href="${site.repo}/blob/main/LICENSE">Apache-2.0 license</a>. Copyright 2026 Matin Askari.</p>
  <p><a href="${site.repo}">GitHub</a> · <a href="https://www.npmjs.com/package/@mtnaskari/kabot">npm</a> · <a href="${site.repo}/issues">Issues</a> · <a href="${site.repo}/blob/main/SECURITY.md">Security</a></p>
  <p class="made-by">Made with <svg class="heart" role="img" aria-label="love" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> by <a href="https://www.askari.pro" rel="author">Matin Askari</a></p>
</footer>`;
}

export function layout({ site, nav, slug, page, prev, next, absolute = false }) {
  const base = absolute ? "/kabot/" : "";
  const path = slug === "404" ? "404.html" : `${slug}.html`;
  const toc = page.headings.filter((h) => h.depth === 2 || h.depth === 3);
  return `${head({ site, title: page.title, description: page.description, path, base })}
<body>
<a class="skip" href="#content">Skip to content</a>
${topbar({ site, base, withMenu: true })}
<div class="shell">
${sidebar({ nav, slug, base })}
<div class="scrim" hidden></div>
<main id="content" class="main">
  <article class="prose">
${page.html}
  </article>
  ${
    prev || next
      ? `<nav class="pager" aria-label="Previous and next pages">
    ${prev ? `<a class="pager-prev" href="${prev.href}"><span>${ICON.arrowL}Previous</span><strong>${esc(prev.label)}</strong></a>` : "<span></span>"}
    ${next ? `<a class="pager-next" href="${next.href}"><span>Next${ICON.arrowR}</span><strong>${esc(next.label)}</strong></a>` : "<span></span>"}
  </nav>`
      : ""
  }
  ${slug === "404" ? "" : `<p class="edit"><a href="${site.repo}/edit/main/docs/${slug}.md">${ICON.edit}Edit this page on GitHub</a></p>`}
  ${footer({ site })}
</main>
${
  toc.length > 1
    ? `<aside class="toc" aria-label="On this page">
  <p class="toc-title">On this page</p>
  <ul>
${toc.map((h) => `    <li class="toc-${h.depth}"><a href="#${h.id}">${esc(h.text)}</a></li>`).join("\n")}
  </ul>
</aside>`
    : ""
}
</div>
<script src="${base}assets/app.js" defer></script>
</body>
</html>
`;
}

const FEATURES = [
  ["One script tag", "A floating button or an inline form, in any language and direction, isolated from your page's CSS.", '<path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12"/>'],
  ["Nothing on your server", "The Worker validates, stores and delivers. Your server embeds a script or makes one HTTPS call.", '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>'],
  ["Telegram and Bale", "Deliver to private chats and groups on either platform, or both at once.", '<path d="M21 4 3 11l6 2 2 6 3-4 5 4z"/><path d="m9 13 7-5"/>'],
  ["An inbox in the chat", "Mark read, archive and list unread messages without leaving Telegram.", '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>'],
  ["Spam protection", "Turnstile, a honeypot, per-IP rate limits, a daily cap and an allow list per site.", '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>'],
  ["Many sites, one deployment", "Each site has its own origins, API key, Turnstile settings and recipients.", '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'],
];

const GROUP_INTRO = {
  Start: "Deploy kabot and connect your bot.",
  "Send messages": "Put the message box on your site.",
  Operate: "Look after a running deployment.",
  Reference: "Every detail, in one place.",
};

export function home({ site, nav, summaries }) {
  return `${head({ site, title: site.name, description: site.tagline, path: "", base: "" })}
<body class="home">
<a class="skip" href="#content">Skip to content</a>
${topbar({ site, base: "", withMenu: false })}
<main id="content">
  <section class="hero">
    <div class="hero-text">
      <p class="eyebrow"><span class="spark" aria-hidden="true">✦</span> <span lang="fa">کبوتر</span> (carrier pigeon) + bot</p>
      <h1>Messages from your website, <em>delivered to your chat.</em></h1>
      <p class="lead">${esc(site.tagline)} Your own server never stores a message or talks to a messaging API.</p>
      <div class="cta">
        <a class="btn btn-primary" href="getting-started.html">Get started</a>
        <a class="btn btn-ghost" href="${site.repo}">${ICON.github}View on GitHub</a>
      </div>
    </div>
    <div class="hero-demo" aria-hidden="true">
      <div class="window">
        <div class="window-bar"><i></i><i></i><i></i><span>index.html</span></div>
        <pre><code><span class="t-tag">&lt;script</span>
  <span class="t-attr">src</span>=<span class="t-str">"https://kabot.example.workers.dev/widget.js"</span>
  <span class="t-attr">data-site</span>=<span class="t-str">"my-site"</span>
  <span class="t-attr">async</span><span class="t-tag">&gt;&lt;/script&gt;</span></code></pre>
      </div>
      <div class="chat">
        <div class="chat-head"><img class="logo-light" src="assets/logo.svg" alt="" width="22" height="22"><img class="logo-dark" src="assets/logo-white.svg" alt="" width="22" height="22"> kabot</div>
        <div class="bubble">
          <p><strong>📬 My site</strong> · #12 · 🔵 New</p>
          <p>From: <strong>Sara</strong> &lt;sara@example.org&gt;</p>
          <p class="muted">Page: example.com/pricing</p>
          <p>Hello! Do you offer a yearly plan?</p>
        </div>
        <div class="chat-buttons"><span>✅ Mark read</span><span>🗄 Archive</span></div>
      </div>
    </div>
  </section>

  <section class="flow" aria-label="How it works">
    <div class="flow-step"><span class="num">1</span><h3>A visitor writes</h3><p>The widget, your React form or your backend sends the message to your Worker.</p></div>
    <div class="flow-arrow" aria-hidden="true"></div>
    <div class="flow-step"><span class="num">2</span><h3>The Worker checks and stores</h3><p>Origin, Turnstile, rate limits and validation, then the message is saved in D1.</p></div>
    <div class="flow-arrow" aria-hidden="true"></div>
    <div class="flow-step"><span class="num">3</span><h3>You get it in your chat</h3><p>Telegram or Bale, with buttons to mark it read or archive it.</p></div>
  </section>

  <section class="features" aria-label="Features">
${FEATURES.map(
  ([t, d, icon]) => `    <div class="feature"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`,
).join("\n")}
  </section>

  <section class="doc-map" aria-labelledby="docs-title">
    <h2 id="docs-title">Documentation</h2>
    <div class="doc-grid">
${nav
  .map(
    (g) => `      <div class="doc-card">
        <h3>${esc(g.group)}</h3>
        <p class="doc-card-intro">${esc(GROUP_INTRO[g.group] ?? "")}</p>
        <ul>
${g.items
  .filter(([s]) => s !== "index")
  .map(([s, label]) => `          <li><a href="${s}.html"><strong>${esc(label)}</strong><span>${esc(summaries[s] ?? "")}</span></a></li>`)
  .join("\n")}
        </ul>
      </div>`,
  )
  .join("\n")}
    </div>
  </section>
  ${footer({ site })}
</main>
<script src="assets/app.js" defer></script>
</body>
</html>
`;
}
