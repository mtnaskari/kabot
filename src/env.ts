export type Platform = "telegram" | "bale";
export const PLATFORMS: readonly Platform[] = ["telegram", "bale"];

export type Env = {
  DB: D1Database;
  /** Per visitor IP, for browser submissions. */
  RATE_LIMITER: RateLimit;
  /** Per site, for API-key submissions that do not forward a visitor IP. */
  SERVER_RATE_LIMITER: RateLimit;

  /** Bearer token for the /admin endpoints. */
  ADMIN_TOKEN?: string;
  /** Master secret: webhook paths, IP hashing and Turnstile secret encryption are derived from it. */
  KABOT_SECRET?: string;

  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_API_BASE?: string;
  BALE_BOT_TOKEN?: string;
  BALE_API_BASE?: string;

  /** Messages per visitor IP per site in 24 hours. Default 20. */
  DAILY_LIMIT_PER_IP?: string;
  /** Delete archived messages older than this many days. 0 or unset keeps them. */
  RETENTION_DAYS?: string;
};

export const DEFAULT_API_BASE: Record<Platform, string> = {
  telegram: "https://api.telegram.org",
  bale: "https://tapi.bale.ai",
};

export type BotConfig = { platform: Platform; token: string; apiBase: string };

/** The bots this deployment has a token for. */
export function configuredBots(env: Env): BotConfig[] {
  const bots: BotConfig[] = [];
  for (const platform of PLATFORMS) {
    const bot = botConfig(env, platform);
    if (bot) bots.push(bot);
  }
  return bots;
}

export function botConfig(env: Env, platform: Platform): BotConfig | null {
  const token = (platform === "telegram" ? env.TELEGRAM_BOT_TOKEN : env.BALE_BOT_TOKEN)?.trim();
  if (!token) return null;
  const base = (platform === "telegram" ? env.TELEGRAM_API_BASE : env.BALE_API_BASE)?.trim() || DEFAULT_API_BASE[platform];
  return { platform, token, apiBase: base.replace(/\/+$/, "") };
}

export function intVar(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function requireSecret(env: Env): string {
  const secret = env.KABOT_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("KABOT_SECRET must be set to at least 32 characters.");
  return secret;
}
