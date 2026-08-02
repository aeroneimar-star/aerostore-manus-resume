-- AEROSTORE SHOP — Order Schema v1
-- Baseado no commit 24f8982, adaptado para integração com estoque PDV real.
-- NOTA: app_stock_reservations removido. Reserva ocorre via pdv_inventory_balances_v2
-- e pdv_inventory_movements_v2 (sistema PDV).

CREATE TABLE IF NOT EXISTS app_orders (
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
  status TEXT NOT NULL CHECK (status IN ('CREATING', 'STOCK_RESERVED', 'READY_FOR_PAYMENT', 'FAILED', 'CANCELLED', 'EXPIRED')),
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

CREATE INDEX IF NOT EXISTS idx_app_orders_account ON app_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_app_orders_status ON app_orders(status);
CREATE INDEX IF NOT EXISTS idx_app_orders_idempotency ON app_orders(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_app_orders_order_number ON app_orders(order_number);

CREATE TABLE IF NOT EXISTS app_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL,
  promotional_price_cents INTEGER,
  effective_unit_price_cents INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL,
  product_snapshot_json TEXT NOT NULL,
  availability_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES app_orders(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_app_order_items_order ON app_order_items(order_id);

CREATE TABLE IF NOT EXISTS app_order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES app_orders(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_app_order_events_order ON app_order_events(order_id);
