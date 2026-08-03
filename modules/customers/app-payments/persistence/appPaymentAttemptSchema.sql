-- AEROSTORE SHOP — Payment Attempt Schema v1
-- Persistência local de tentativas de pagamento PIX via InfinitePay.
-- Sem credenciais, sem dados sensíveis, sem respostas brutas.

CREATE TABLE IF NOT EXISTS app_payment_attempts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'INFINITEPAY',
  method TEXT NOT NULL DEFAULT 'PIX',
  status TEXT NOT NULL DEFAULT 'CREATED',
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_reference TEXT UNIQUE,
  provider_checkout_url TEXT,
  provider_pix_copy_paste TEXT,
  provider_qr_code TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BRL',
  request_fingerprint TEXT NOT NULL,
  provider_response_sanitized_json TEXT,
  failure_code TEXT,
  failure_message_sanitized TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (order_id) REFERENCES app_orders(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_order ON app_payment_attempts(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_fingerprint ON app_payment_attempts(request_fingerprint);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON app_payment_attempts(status) WHERE status IN ('PENDING', 'REQUESTING');
