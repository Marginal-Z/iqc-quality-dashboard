CREATE TABLE IF NOT EXISTS qc_recipient_policies (
  factory_code TEXT NOT NULL, open_id TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1, notify_new_tasks INTEGER NOT NULL DEFAULT 1, notify_urgent INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(factory_code,open_id)
);
INSERT OR IGNORE INTO qc_recipient_policies(factory_code,open_id)
SELECT DISTINCT factory_code,open_id FROM reminder_recipients;
CREATE TABLE IF NOT EXISTS warehouse_role_control(id INTEGER PRIMARY KEY CHECK(id=1),write_nonce TEXT NOT NULL DEFAULT '');
INSERT OR IGNORE INTO warehouse_role_control(id) VALUES(1);

CREATE TABLE IF NOT EXISTS warehouse_recipients (
  id TEXT PRIMARY KEY, factory_code TEXT NOT NULL, app_id TEXT NOT NULL, open_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  result_events TEXT NOT NULL DEFAULT '["合格","特采","退货"]', revision INTEGER NOT NULL DEFAULT 1,
  enabled_at INTEGER NOT NULL DEFAULT 0, baseline_at INTEGER NOT NULL DEFAULT 0, last_success_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(factory_code,open_id)
);
INSERT OR IGNORE INTO warehouse_recipients(id,factory_code,app_id,open_id,recipient_name,enabled,enabled_at,baseline_at,last_success_at)
SELECT 'legacy-warehouse',factory_code,app_id,open_id,recipient_name,1,enabled_at,baseline_at,last_success_at
FROM warehouse_settings WHERE open_id<>'';
CREATE TABLE IF NOT EXISTS warehouse_role_observations (
  recipient_id TEXT NOT NULL, order_number TEXT NOT NULL, signature TEXT NOT NULL, version INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(recipient_id,order_number)
);
INSERT OR IGNORE INTO warehouse_role_observations
SELECT 'legacy-warehouse',order_number,signature,version,last_seen_at FROM warehouse_observations
WHERE EXISTS(SELECT 1 FROM warehouse_recipients WHERE id='legacy-warehouse');
CREATE TABLE IF NOT EXISTS warehouse_role_deliveries (
  id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL, recipient_revision INTEGER NOT NULL,
  config_revision INTEGER NOT NULL, app_id TEXT NOT NULL, open_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL,total INTEGER NOT NULL, scope TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, uncertain INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, sent_at INTEGER NOT NULL DEFAULT 0, first_attempt_at INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, message_id TEXT NOT NULL DEFAULT '', error_code TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS warehouse_role_status ON warehouse_role_deliveries(status,next_attempt_at);
INSERT OR IGNORE INTO warehouse_role_deliveries
SELECT id,'legacy-warehouse',1,config_revision,app_id,open_id,(SELECT recipient_name FROM warehouse_settings WHERE id=1),total,scope,payload,status,attempts,uncertain,
created_at,sent_at,first_attempt_at,next_attempt_at,lease_until,message_id,error_code
FROM warehouse_deliveries WHERE EXISTS(SELECT 1 FROM warehouse_recipients WHERE id='legacy-warehouse');
