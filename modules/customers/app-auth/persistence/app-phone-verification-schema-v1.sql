CREATE TABLE IF NOT EXISTS app_phone_verifications (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT,
  phone_lookup_hash TEXT NOT NULL,
  phone_protected TEXT NOT NULL,
  phone_masked TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('WHATSAPP','SMS')),
  purpose TEXT NOT NULL CHECK (purpose IN ('APP_LOGIN','NEW_REGISTRATION','PHONE_CHANGE','ACCOUNT_RECOVERY')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','SENT','VERIFIED','EXPIRED','LOCKED','CONSUMED','FAILED','CANCELLED')),
  otp_hash TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  resend_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  locked_until TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  request_ip_hash TEXT NOT NULL,
  device_hash TEXT NOT NULL,
  provider_message_id TEXT NOT NULL DEFAULT '',
  provider_status TEXT NOT NULL DEFAULT '',
  last_error_code TEXT NOT NULL DEFAULT '',
  whatsapp_fallback_at TEXT,
  FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_phone_verification_active
  ON app_phone_verifications(phone_lookup_hash, purpose)
  WHERE status IN ('PENDING','SENT');
CREATE INDEX IF NOT EXISTS idx_app_phone_verification_expiry
  ON app_phone_verifications(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_app_phone_verification_rate_phone
  ON app_phone_verifications(phone_lookup_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_app_phone_verification_rate_ip
  ON app_phone_verifications(request_ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_app_phone_verification_rate_device
  ON app_phone_verifications(device_hash, created_at);
