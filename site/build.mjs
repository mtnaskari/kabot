#!/usr/bin/env node
// Builds the documentation site from docs/*.md into _site/.
//
//   npm run docs:build
//
// The Markdown files stay readable on GitHub; this script adds the layout,
// navigation, syntax highlighting and link rewriting for GitHub Pages.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import GithubSlugger from "github-slugger";
import { Marked } from "marked";
import { createHighlighter } from "shiki";
import { layout, home } from "./layout.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const out = join(root, "_site");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

export const SITE = {
  name: "kabot",
  version: pkg.version,
  url: "https://mtnaskari.github.io/kabot/",
  repo: "https://github.com/mtnaskari/kabot",
  tagline: "A website message box that delivers to Telegram and Bale, running on a single Cloudflare Worker.",
};

/** Sidebar order. Every page in docs/ must appear here. */
export const NAV = [
  { group: "Start", items: [["index", "Overview"], ["getting-started", "Get started"], ["telegram", "Telegram"], ["bale", "Bale"]] },
  { group: "Send messages", items: [["widget", "Widget"], ["react", "React"], ["server", "From a server"]] },
  { group: "Operate", items: [["admin", "Manage sites"], ["configuration", "Configuration"], ["troubleshooting", "Troubleshooting"]] },
  { group: "Reference", items: [["api", "HTTP API"], ["security", "Security model"], ["development", "Local development"]] },
];

const LANG_ALIAS = { sh: "bash", shell: "bash", toml: "toml", ini: "ini", http: "http", tsx: "tsx" };
const LANGS = ["bash", "html", "json", "ts", "tsx", "js", "toml", "ini", "http", "php", "python", "go", "css", "text"];
const highlighter = await createHighlighter({ themes: ["github-light", "github-dark-dimmed"], langs: LANGS.filter((l) => l !== "text") });

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const stripTags = (s) => s.replace(/<[^>]+>/g, "");

function rewriteHref(href) {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return href;
  const [path, hash] = href.split("#");
  const anchor = hash ? `#${hash}` : "";
  if (path.startsWith("../")) return `${SITE.repo}/blob/main/${path.slice(3)}${anchor}`;
  if (path.endsWith(".md")) {
    const name = path.slice(0, -3);
    return `${name === "index" ? "./" : `${name}.html`}${anchor}`;
  }
  return href;
}

const ICONS = {
  note: '<path d="M12 16v-4M12 8h.01"/><circle cx="12" cy="12" r="9"/>',
  tip: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
  important: '<path d="M12 8v5M12 16h.01"/><path d="M4 4h16v12H8l-4 4z"/>',
  warning: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  caution: '<path d="M12 8v5M12 16h.01"/><path d="M8.5 2.5h7l5 5v7l-5 5h-7l-5-5v-7z"/>',
};

function renderPage(markdown) {
  const slugger = new GithubSlugger();
  const headings = [];
  let title = "";
  let description = "";

  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth, text }) {
        const html = this.parser.parseInline(tokens);
        const id = slugger.slug(stripTags(text).replace(/`/g, ""));
        if (depth === 1) {
          title ||= stripTags(html);
          return `<h1 id="${id}">${html}</h1>\n`;
        }
        if (depth <= 3) headings.push({ depth, id, text: stripTags(html) });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${html}</h${depth}>\n`;
      },
      paragraph({ tokens }) {
        const html = this.parser.parseInline(tokens);
        if (!description) description = stripTags(html).replace(/\s+/g, " ").trim();
        return `<p>${html}</p>\n`;
      },
      link({ href, title: t, tokens }) {
        const text = this.parser.parseInline(tokens);
        const target = rewriteHref(href);
        const external = /^https?:/.test(target) && !target.startsWith(SITE.url);
        return `<a href="${escapeHtml(target)}"${t ? ` title="${escapeHtml(t)}"` : ""}${external ? ' rel="noopener"' : ""}>${text}</a>`;
      },
      code({ text, lang }) {
        const language = LANG_ALIAS[lang] ?? lang ?? "text";
        const known = LANGS.includes(language) && language !== "text";
        const html = known
          ? highlighter.codeToHtml(text, { lang: language, themes: { light: "github-light", dark: "github-dark-dimmed" }, defaultColor: false })
          : `<pre class="shiki"><code>${escapeHtml(text)}</code></pre>`;
        const label = { bash: "Terminal", ts: "TypeScript", tsx: "TSX", js: "JavaScript", html: "HTML", json: "JSON", toml: "TOML", ini: "INI", http: "HTTP", php: "PHP", python: "Python", go: "Go", css: "CSS" }[language] ?? "";
        return `<div class="code">${label ? `<div class="code-label">${label}</div>` : ""}<button class="copy" type="button" aria-label="Copy code">Copy</button>${html}</div>\n`;
      },
      table(token) {
        const head = token.header.map((c) => `<th${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</th>`).join("");
        const body = token.rows
          .map((row) => `<tr>${row.map((c) => `<td${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`)
          .join("");
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`;
      },
      blockquote({ tokens }) {
        const html = this.parser.parse(tokens);
        const alert = /^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/.exec(html);
        if (!alert) return `<blockquote>${html}</blockquote>\n`;
        const kind = alert[1].toLowerCase();
        const body = html.slice(alert[0].length).replace(/^\s*<br>\s*/, "");
        const titleText = kind[0].toUpperCase() + kind.slice(1);
        return `<div class="callout callout-${kind}"><div class="callout-title"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[kind]}</svg>${titleText}</div><p>${body}</div>\n`;
      },
    },
  });

  const html = marked.parse(markdown);
  return { html, title, description, headings };
}

/** Reads the "- [Title](page.md): description" lines of index.md for the home page cards. */
function pageSummaries(indexMd) {
  const map = {};
  for (const m of indexMd.matchAll(/^- \[[^\]]+\]\(([\w-]+)\.md\): (.+)$/gm)) {
    const text = m[2].replace(/`/g, "");
    map[m[1]] = text[0].toUpperCase() + text.slice(1);
  }
  return map;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(docs, "assets"), join(out, "assets"), { recursive: true });
cpSync(join(root, "public", "favicon.svg"), join(out, "favicon.svg"));
cpSync(join(root, "public", "favicon.ico"), join(out, "favicon.ico"));
cpSync(join(root, "site", "style.css"), join(out, "assets", "style.css"));
cpSync(join(root, "site", "app.js"), join(out, "assets", "app.js"));

const order = NAV.flatMap((g) => g.items);
const summaries = pageSummaries(readFileSync(join(docs, "index.md"), "utf8"));
const pages = [];

for (const [i, [slug, label]] of order.entries()) {
  const file = join(docs, `${slug}.md`);
  if (!existsSync(file)) throw new Error(`NAV lists ${slug}.md, which does not exist`);
  const page = renderPage(readFileSync(file, "utf8"));
  const prev = order[i - 1];
  const next = order[i + 1];
  const html =
    slug === "index"
      ? home({ site: SITE, nav: NAV, summaries })
      : layout({
          site: SITE,
          nav: NAV,
          slug,
          label,
          page,
          prev: prev && { href: prev[0] === "index" ? "./" : `${prev[0]}.html`, label: prev[1] },
          next: next && { href: `${next[0]}.html`, label: next[1] },
        });
  writeFileSync(join(out, slug === "index" ? "index.html" : `${slug}.html`), html);
  pages.push(slug);
}

writeFileSync(
  join(out, "404.html"),
  layout({
    site: SITE,
    nav: NAV,
    slug: "404",
    label: "Not found",
    page: {
      title: "Page not found",
      description: "This page does not exist.",
      headings: [],
      html: '<h1>Page not found</h1><p>This page does not exist. Start from the <a href="./">overview</a> or <a href="getting-started.html">get started</a>.</p>',
    },
    absolute: true,
  }),
);
writeFileSync(
  join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .map((p) => `  <url><loc>${SITE.url}${p === "index" ? "" : `${p}.html`}</loc></url>`)
    .join("\n")}\n</urlset>\n`,
);
writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE.url}sitemap.xml\n`);
writeFileSync(join(out, ".nojekyll"), "");
console.log(`Built ${pages.length} pages into _site/`);
