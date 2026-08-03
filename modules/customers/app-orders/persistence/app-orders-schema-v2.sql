-- AEROSTORE SHOP — Order Schema v2
-- Migração aditiva: adiciona coluna expired_at para auditoria de expiração.
-- Aplica via ALTER TABLE (safe, idempotente com IF NOT EXISTS pattern via try/catch).
-- v1 já contém: expires_at, EXPIRED no CHECK constraint.

-- Adicionar coluna expired_at (nullable, preenchida apenas quando expira)
ALTER TABLE app_orders ADD COLUMN expired_at TEXT;

-- Índice para query do sweeper (pedidos expiráveis)
CREATE INDEX IF NOT EXISTS idx_app_orders_expirable
  ON app_orders(expires_at)
  WHERE status = 'READY_FOR_PAYMENT';
