CREATE TABLE IF NOT EXISTS app_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL,
  parent_session_id TEXT,
  account_id TEXT NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  device_hash TEXT NOT NULL,
  device_name TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (platform IN ('IOS','ANDROID','WEB','UNKNOWN')),
  app_version TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT NOT NULL DEFAULT '',
  token_version INTEGER NOT NULL CHECK (token_version >= 1),
  FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_session_id) REFERENCES app_sessions(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_sessions_active_device
  ON app_sessions(account_id, device_hash) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_app_sessions_family
  ON app_sessions(family_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_app_sessions_account
  ON app_sessions(account_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_app_sessions_expiry
  ON app_sessions(status, expires_at);
