-- kabot schema. All timestamps are ISO-8601 UTC strings.

-- A website that sends messages through this deployment.
CREATE TABLE sites (
  id TEXT PRIMARY KEY,                        -- short public slug, used as data-site
  name TEXT NOT NULL,
  allowed_origins TEXT NOT NULL DEFAULT '[]', -- JSON array of exact origins
  api_key_hash TEXT UNIQUE,                   -- SHA-256 of the server API key; NULL when none was issued
  require_email INTEGER NOT NULL DEFAULT 1,
  turnstile_site_key TEXT,
  turnstile_secret TEXT,                      -- AES-GCM ciphertext; NULL disables Turnstile
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One-time codes that link a chat to a site through /start <code>.
CREATE TABLE pairing_codes (
  code_hash TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- A chat on Telegram or Bale that receives a site's messages.
CREATE TABLE subscriptions (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('telegram', 'bale')),
  chat_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (site_id, platform, chat_id)
);
CREATE INDEX subscriptions_chat ON subscriptions (platform, chat_id);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('browser', 'server')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
  ip_hash TEXT NOT NULL DEFAULT '',           -- keyed hash; raw IPs are never stored
  notify_attempts INTEGER NOT NULL DEFAULT 0,
  notified_at TEXT,
  notify_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX messages_site ON messages (site_id, id DESC);
CREATE INDEX messages_ip ON messages (site_id, ip_hash, created_at);
CREATE INDEX messages_pending ON messages (notified_at, notify_attempts);

-- The bot message each chat received for a message, so buttons can update every copy.
CREATE TABLE deliveries (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  bot_message_id INTEGER NOT NULL,
  PRIMARY KEY (message_id, platform, chat_id)
);

-- Webhook update ids already handled, so retried deliveries are not processed twice.
CREATE TABLE updates (
  platform TEXT NOT NULL,
  update_id INTEGER NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (platform, update_id)
);
