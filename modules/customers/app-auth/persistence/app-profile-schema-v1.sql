-- Fase 3.5 - perfil editavel e isolado das fontes legadas.
-- Versao logica: app-profile-schema/v1

CREATE TABLE IF NOT EXISTS app_customer_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  email_lookup_hash TEXT NOT NULL DEFAULT '',
  email_protected TEXT NOT NULL DEFAULT '',
  email_masked TEXT NOT NULL DEFAULT '',
  preferences_json TEXT NOT NULL DEFAULT '{}',
  profile_status TEXT NOT NULL DEFAULT 'INCOMPLETE' CHECK (
    profile_status IN ('INCOMPLETE', 'COMPLETE')
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_app_customer_profiles_status
  ON app_customer_profiles(profile_status, updated_at);
