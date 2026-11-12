#!/usr/bin/env node
// Local development only: a bot webhook cannot reach localhost, so this script
// long-polls getUpdates and forwards each update to `wrangler dev`.
//
//   npm run dev:poll                 # Telegram
//   npm run dev:poll -- --bale       # Bale
//   npm run dev:poll -- --url http://localhost:8787 --delete-webhook
//
// Use a separate test bot. getUpdates does not work while a webhook is set, and
// --delete-webhook removes it, which stops a deployed kabot from receiving updates.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const platform = args.includes("--bale") ? "bale" : "telegram";
const urlArg = args.indexOf("--url");
const local = ((urlArg >= 0 && args[urlArg + 1]) || "http://localhost:8787").replace(/\/+$/, "");

function readDevVars() {
  try {
    const vars = {};
    for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) vars[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
    }
    return vars;
  } catch {
    return {};
  }
}

const vars = { ...readDevVars(), ...process.env };
const token = platform === "bale" ? vars.BALE_BOT_TOKEN : vars.TELEGRAM_BOT_TOKEN;
const apiBase = (platform === "bale" ? vars.BALE_API_BASE || "https://tapi.bale.ai" : vars.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
const secret = vars.KABOT_SECRET;
if (!token || !secret) {
  console.error(`Set ${platform === "bale" ? "BALE_BOT_TOKEN" : "TELEGRAM_BOT_TOKEN"} and KABOT_SECRET in .dev.vars first.`);
  process.exit(1);
}

const hmac = (label) => createHmac("sha256", secret).update(label).digest("hex");
const webhookUrl = `${local}/bot/${platform}/${hmac(`webhook-path:${platform}`).slice(0, 40)}`;
const headers = { "content-type": "application/json" };
if (platform === "telegram") headers["x-telegram-bot-api-secret-token"] = hmac(`webhook-header:${platform}`);

async function api(method, payload = {}) {
  const res = await fetch(`${apiBase}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(`${method} failed: ${data?.description ?? res.status}`);
  return data.result;
}

const info = await api("getWebhookInfo");
if (info.url) {
  if (!args.includes("--delete-webhook")) {
    console.error(`This bot has a webhook set (${new URL(info.url).host}). Use a separate test bot, or pass --delete-webhook.`);
    process.exit(1);
  }
  await api("deleteWebhook");
}
const me = await api("getMe");
console.log(`Polling ${platform} as @${me.username}, forwarding to ${local}`);

let offset = 0;
for (;;) {
  let updates = [];
  try {
    updates = await api("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
  } catch (error) {
    console.error(String(error));
    await new Promise((r) => setTimeout(r, 3000));
    continue;
  }
  for (const update of updates) {
    offset = update.update_id + 1;
    try {
      const res = await fetch(webhookUrl, { method: "POST", headers, body: JSON.stringify(update) });
      console.log(`update ${update.update_id} -> ${res.status}`);
    } catch (error) {
      console.error(`update ${update.update_id} could not reach ${local}: ${error.message}`);
    }
  }
}
