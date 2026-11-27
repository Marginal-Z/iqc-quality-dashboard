CREATE TABLE IF NOT EXISTS warehouse_settings (
  id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
  factory_code TEXT NOT NULL DEFAULT 'STTH', recipient_name TEXT NOT NULL DEFAULT '', open_id TEXT NOT NULL DEFAULT '', app_id TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0, enabled_at INTEGER NOT NULL DEFAULT 0, baseline_at INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER NOT NULL DEFAULT 0, last_checked_at INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '',
  lease_owner TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO warehouse_settings(id) VALUES(1);
CREATE TABLE IF NOT EXISTS warehouse_observations (
  order_number TEXT PRIMARY KEY, signature TEXT NOT NULL, version INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS warehouse_deliveries (
  id TEXT PRIMARY KEY, config_revision INTEGER NOT NULL, app_id TEXT NOT NULL, open_id TEXT NOT NULL,
  total INTEGER NOT NULL, scope TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, uncertain INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, sent_at INTEGER NOT NULL DEFAULT 0, first_attempt_at INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, message_id TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS warehouse_delivery_status ON warehouse_deliveries(status,next_attempt_at);
