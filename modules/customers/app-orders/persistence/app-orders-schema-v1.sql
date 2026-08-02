-- App Orders Schema v1
-- Migration expansiva, idempotente

CREATE TABLE IF NOT EXISTS app_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  fulfillment_type TEXT NOT NULL CHECK(fulfillment_type IN ('DELIVERY','PICKUP')),
  address_id TEXT,
  pickup_store_id TEXT,
  shipping_provider TEXT NOT NULL DEFAULT '',
  shipping_service_code TEXT NOT NULL DEFAULT '',
  shipping_quote_cents INTEGER NOT NULL DEFAULT 0,
  shipping_quote_currency TEXT NOT NULL DEFAULT 'BRL',
  subtotal_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('AWAITING_PAYMENT','PAID','EXPIRED','CANCELLED')),
  idempotency_key TEXT UNIQUE,
  snapshot_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS app_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES app_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  variant_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  effective_unit_price_cents INTEGER NOT NULL,
  promotion_name TEXT,
  line_total_cents INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_stock_reservations (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES app_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','EXPIRED','CONSUMED','RELEASED')),
  reserved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES app_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);
