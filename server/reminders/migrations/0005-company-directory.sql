CREATE TABLE IF NOT EXISTS feishu_directory_state (
  id INTEGER PRIMARY KEY CHECK(id=1), app_id TEXT NOT NULL DEFAULT '', credential_key TEXT NOT NULL DEFAULT '',
  active_generation TEXT NOT NULL DEFAULT '', generation TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'idle',
  scope_cursor TEXT NOT NULL DEFAULT '', last_success_at INTEGER NOT NULL DEFAULT 0, last_checked_at INTEGER NOT NULL DEFAULT 0,
  next_refresh_at INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '',
  lease_owner TEXT NOT NULL DEFAULT '', lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO feishu_directory_state(id) VALUES(1);
CREATE TABLE IF NOT EXISTS feishu_directory_departments (
  generation TEXT NOT NULL, department_id TEXT NOT NULL, is_root INTEGER NOT NULL DEFAULT 0,
  children_done INTEGER NOT NULL DEFAULT 0, children_cursor TEXT NOT NULL DEFAULT '',
  users_done INTEGER NOT NULL DEFAULT 0, users_cursor TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(generation,department_id)
);
CREATE TABLE IF NOT EXISTS feishu_directory_members (
  generation TEXT NOT NULL, open_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', english_name TEXT NOT NULL DEFAULT '',
  search_name TEXT NOT NULL DEFAULT '', resolved INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(generation,open_id)
);
CREATE INDEX IF NOT EXISTS directory_unresolved ON feishu_directory_members(generation,resolved,open_id);
