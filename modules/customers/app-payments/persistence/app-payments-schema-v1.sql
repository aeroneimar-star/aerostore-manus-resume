-- App Payments Schema v1
-- Idempotent: uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS app_payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT'
    CHECK(status IN ('AWAITING_PAYMENT','PAYMENT_PROCESSING','PAID','PAYMENT_FAILED','PAYMENT_CANCELLED','PAYMENT_EXPIRED','REFUNDED','PARTIALLY_REFUNDED')),
  payment_method TEXT NOT NULL DEFAULT 'PIX',
  gateway_payment_id TEXT,
  gateway_data_json TEXT,
  pix_payload TEXT,
  pix_code TEXT,
  expires_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES app_orders(id)
);

CREATE INDEX IF NOT EXISTS idx_app_payments_order_id ON app_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_app_payments_status ON app_payments(status);
CREATE INDEX IF NOT EXISTS idx_app_payments_gateway_id ON app_payments(gateway_payment_id);
CREATE INDEX IF NOT EXISTS idx_app_payments_created_at ON app_payments(created_at);

CREATE TABLE IF NOT EXISTS app_payment_attempts (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK(attempt_number >= 1),
  provider TEXT NOT NULL DEFAULT 'unknown',
  provider_payment_id TEXT,
  gateway_data_json TEXT,
  gateway_error TEXT,
  status TEXT NOT NULL DEFAULT 'SUBMITTED'
    CHECK(status IN ('SUBMITTED','PROCESSING','APPROVED','FAILED','CANCELLED','EXPIRED')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (payment_id) REFERENCES app_payments(id)
);

CREATE INDEX IF NOT EXISTS idx_app_attempts_payment_id ON app_payment_attempts(payment_id);
CREATE INDEX IF NOT EXISTS idx_app_attempts_provider_payment_id ON app_payment_attempts(provider_payment_id);

CREATE TABLE IF NOT EXISTS app_payment_events (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (payment_id) REFERENCES app_payments(id)
);

CREATE INDEX IF NOT EXISTS idx_app_events_payment_id ON app_payment_events(payment_id);
CREATE INDEX IF NOT EXISTS idx_app_events_type ON app_payment_events(event_type);
CREATE INDEX IF NOT EXISTS idx_app_events_created_at ON app_payment_events(created_at);
