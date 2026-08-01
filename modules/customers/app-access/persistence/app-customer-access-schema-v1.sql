-- Fase 3.2 - contas, vinculos e controle administrativo de acesso ao app.
-- Versao logica: app-customer-access-schema/v1

CREATE TABLE IF NOT EXISTS app_customer_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  phone_lookup_hash TEXT NOT NULL UNIQUE,
  phone_masked TEXT NOT NULL,
  phone_verified_at TEXT,
  email_lookup_hash TEXT NOT NULL DEFAULT '',
  email_masked TEXT NOT NULL DEFAULT '',
  account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (
    account_status IN ('ACTIVE', 'SUSPENDED', 'BLOCKED', 'CLOSED')
  ),
  access_status TEXT NOT NULL DEFAULT 'PENDING_PHONE_VERIFICATION' CHECK (
    access_status IN ('PENDING_PHONE_VERIFICATION', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  suspended_at TEXT,
  blocked_at TEXT,
  closed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_customer_accounts_queue
  ON app_customer_accounts(access_status, account_status, updated_at);

CREATE TABLE IF NOT EXISTS app_access_requests (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (
    request_type IN ('EXISTING_CUSTOMER_LINK', 'NEW_CUSTOMER_REGISTRATION', 'PHONE_CHANGE_RECOVERY', 'MANUAL_REVIEW')
  ),
  status TEXT NOT NULL DEFAULT 'PENDING_PHONE_VERIFICATION' CHECK (
    status IN ('PENDING_PHONE_VERIFICATION', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED')
  ),
  submitted_profile_json TEXT NOT NULL DEFAULT '{}',
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  current_decision_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (current_decision_id) REFERENCES app_access_decisions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_app_access_requests_queue
  ON app_access_requests(status, request_type, submitted_at);
CREATE INDEX IF NOT EXISTS idx_app_access_requests_account
  ON app_access_requests(account_id, updated_at);

CREATE TABLE IF NOT EXISTS app_access_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  decision_type TEXT NOT NULL CHECK (
    decision_type IN (
      'AUTO_APPROVED_EXISTING_CUSTOMER', 'ADMIN_APPROVED', 'ADMIN_REJECTED',
      'SUPERVISOR_APPROVED', 'SUPERVISOR_REJECTED', 'ADMIN_SUSPENDED',
      'ADMIN_REACTIVATED', 'ADMIN_BLOCKED', 'LINK_CONFLICT_DETECTED', 'LINK_REVOKED'
    )
  ),
  actor_user_id TEXT,
  actor_role TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES app_access_requests(id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_app_access_decisions_request
  ON app_access_decisions(request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_app_access_decisions_account
  ON app_access_decisions(account_id, created_at);

CREATE TABLE IF NOT EXISTS app_customer_links (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  master_id TEXT NOT NULL,
  link_status TEXT NOT NULL CHECK (
    link_status IN ('PENDING_REVIEW', 'ACTIVE', 'CONFLICT', 'REVOKED')
  ),
  link_type TEXT NOT NULL,
  reason_code TEXT NOT NULL DEFAULT '',
  confidence INTEGER NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  decided_by TEXT,
  decision_id TEXT,
  FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (master_id) REFERENCES customer_master_records(id) ON DELETE RESTRICT,
  FOREIGN KEY (decision_id) REFERENCES app_access_decisions(id) ON DELETE RESTRICT,
  UNIQUE (account_id, master_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_customer_links_one_active
  ON app_customer_links(account_id) WHERE link_status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_app_customer_links_master
  ON app_customer_links(master_id, link_status);
