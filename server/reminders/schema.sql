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
CREATE INDEX IF NOT EXISTS reminder_retention ON reminder_deliveries(created_at);

-- Additive and repeatable: never replace credentials or existing deliveries.
CREATE TABLE IF NOT EXISTS reminder_runtime (
  id INTEGER PRIMARY KEY CHECK(id=1), lease_owner TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0,
  legacy_seeded INTEGER NOT NULL DEFAULT 0, diagnostics TEXT NOT NULL DEFAULT '{}'
);
INSERT OR IGNORE INTO reminder_runtime(id) VALUES(1);
CREATE TABLE IF NOT EXISTS reminder_jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('new_tasks','urgent')), actor TEXT NOT NULL DEFAULT '', request_id TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS reminder_task_receipts (task_key TEXT PRIMARY KEY, job_id TEXT NOT NULL, last_seen_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS reminder_receipt_job ON reminder_task_receipts(job_id);
CREATE INDEX IF NOT EXISTS reminder_receipt_retention ON reminder_task_receipts(last_seen_at);
CREATE TABLE IF NOT EXISTS reminder_urgent_requests (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, factory_code TEXT NOT NULL, config_revision INTEGER NOT NULL,
  fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', write_nonce TEXT NOT NULL DEFAULT ''
);
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
