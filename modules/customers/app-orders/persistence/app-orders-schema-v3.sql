-- AEROSTORE SHOP — Order Schema v3
-- Migration para adicionar PAID e PAYMENT_PENDING ao status CHECK de app_orders
--
-- Esta migration:
-- 1. Recria app_orders com PAID e PAYMENT_PENDING adicionados ao CHECK
-- 2. Preserva todos os dados existentes
-- 3. Preserva todos os índices
--
-- NOTA: SQLite não suporta ALTER COLUMN. Usamos o padrão de recreate.

-- Salvar dados existentes
CREATE TABLE IF NOT EXISTS app_orders_migration_backup AS SELECT * FROM app_orders;

-- Recriar tabela com novos status
DROP TABLE IF EXISTS app_orders;

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
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  failed_reason TEXT,
  FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT
);

-- Restaurar dados
INSERT INTO app_orders SELECT * FROM app_orders_migration_backup;
DROP TABLE app_orders_migration_backup;

-- Recriar índices
CREATE INDEX IF NOT EXISTS idx_app_orders_account ON app_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_app_orders_status ON app_orders(status);
CREATE INDEX IF NOT EXISTS idx_app_orders_idempotency ON app_orders(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_app_orders_order_number ON app_orders(order_number);
