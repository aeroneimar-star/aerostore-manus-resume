-- app_customer_addresses: enderecos da conta do app privado
-- Migration expansiva e idempotente (CREATE TABLE IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS app_customer_addresses (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL DEFAULT '',
  postal_code_protected TEXT NOT NULL,
  postal_code_masked TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  number TEXT NOT NULL DEFAULT '',
  complement TEXT NOT NULL DEFAULT '',
  neighborhood TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  delivery_instructions TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  validation_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (validation_status IN ('PENDING','VALID','INVALID','MANUAL')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_app_customer_addresses_account
  ON app_customer_addresses(account_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_app_customer_addresses_default
  ON app_customer_addresses(account_id, is_default) WHERE archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_customer_addresses_unique_default
  ON app_customer_addresses(account_id) WHERE is_default = 1 AND archived_at IS NULL;
