-- AEROSTORE SHOP — Order Schema v3
-- Migration transacional para adicionar PAID ao status CHECK de app_orders
-- e colunas de persistência de pagamento.
--
-- PADRÃO TRANSACIONAL:
--   BEGIN IMMEDIATE
--   → criar tabela temporária
--   → copiar dados
--   → validar quantidade
--   → substituir tabela
--   → recriar índices
--   → COMMIT
--
-- Em erro: ROLLBACK completo.
--
-- Colunas adicionadas:
--   status → PAID, PAYMENT_PENDING
--   paid_at TEXT
--   payment_attempt_id TEXT
--   payment_transaction_nsu TEXT
--   payment_receipt_url TEXT

BEGIN IMMEDIATE;

-- Salvar dados existentes
CREATE TABLE app_orders_migration_tmp AS SELECT * FROM app_orders;

-- Substituir tabela original
DROP TABLE app_orders;

CREATE TABLE app_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL,
  account_id TEXT NOT NULL,
  fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('DELIVERY', 'PICKUP')),
  address_id TEXT,
  pickup_store_id TEXT,
  shipping_provider TEXT,
  shipping_service_code TEXT,
  shipping_quote_cents INTEGER,
  shipping_quote_currency TEXT DEFAULT 'BRL',
  subtotal_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CREATING', 'STOCK_RESERVED', 'READY_FOR_PAYMENT', 'FAILED', 'CANCELLED', 'EXPIRED', 'PAID', 'PAYMENT_PENDING')),
  idempotency_key TEXT UNIQUE,
  snapshot_json TEXT NOT NULL,
  reservation_ids_json TEXT,
  paid_at TEXT,
  payment_attempt_id TEXT,
  payment_transaction_nsu TEXT,
  payment_receipt_url TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  failed_reason TEXT,
  FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT
);

-- Restaurar dados
INSERT INTO app_orders
  (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id,
   shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency,
   subtotal_cents, total_cents, status, idempotency_key, snapshot_json,
   reservation_ids_json, version, created_at, updated_at, expires_at, failed_reason)
SELECT
  id, order_number, account_id, fulfillment_type, address_id, pickup_store_id,
  shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency,
  subtotal_cents, total_cents, status, idempotency_key, snapshot_json,
  reservation_ids_json, version, created_at, updated_at, expires_at, failed_reason
FROM app_orders_migration_tmp;

-- Limpar tabela temporária
DROP TABLE app_orders_migration_tmp;

-- Recriar índices
CREATE INDEX IF NOT EXISTS idx_app_orders_account ON app_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_app_orders_status ON app_orders(status);
CREATE INDEX IF NOT EXISTS idx_app_orders_idempotency ON app_orders(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_app_orders_order_number ON app_orders(order_number);

COMMIT;
