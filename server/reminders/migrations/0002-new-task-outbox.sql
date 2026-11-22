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
