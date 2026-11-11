CREATE TABLE IF NOT EXISTS reminder_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1), enabled INTEGER NOT NULL DEFAULT 0,
  app_id TEXT NOT NULL DEFAULT '', app_secret TEXT NOT NULL DEFAULT '', verified_key TEXT NOT NULL DEFAULT '',
  factories TEXT NOT NULL DEFAULT '[]', daily_start TEXT NOT NULL DEFAULT '00:00',
  updated_at INTEGER NOT NULL DEFAULT 0, updated_by TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0, write_nonce TEXT NOT NULL DEFAULT '',
  last_checked_at INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO reminder_settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS reminder_recipients (
  factory_code TEXT NOT NULL, inspector_name TEXT NOT NULL, open_id TEXT NOT NULL,
  PRIMARY KEY(factory_code, inspector_name)
);
CREATE TABLE IF NOT EXISTS reminder_deliveries (
  id TEXT PRIMARY KEY, thai_day TEXT NOT NULL, app_id TEXT NOT NULL, open_id TEXT NOT NULL,
  inspector_names TEXT NOT NULL, total INTEGER NOT NULL, urgent INTEGER NOT NULL, overdue INTEGER NOT NULL,
  payload TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', send_uuid TEXT NOT NULL DEFAULT '', config_revision INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, uncertain INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0,
  first_attempt_at INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, sent_at INTEGER NOT NULL DEFAULT 0,
  message_id TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS reminder_day ON reminder_deliveries(thai_day, status);
