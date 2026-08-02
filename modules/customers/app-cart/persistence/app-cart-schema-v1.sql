-- Fase 3.7 - carrinho privado do app AEROSTORE.
-- Versao logica: app-cart-schema/v1

CREATE TABLE IF NOT EXISTS app_carts (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (
    status IN ('ACTIVE', 'CONVERTED', 'ABANDONED', 'CLOSED')
  ),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_carts_active_per_account
  ON app_carts(account_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_app_carts_account_status
  ON app_carts(account_id, status, updated_at);

CREATE TABLE IF NOT EXISTS app_cart_items (
  id TEXT PRIMARY KEY NOT NULL,
  cart_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  promotional_price_cents INTEGER,
  effective_unit_price_cents INTEGER NOT NULL CHECK (effective_unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  product_snapshot_json TEXT NOT NULL DEFAULT '{}',
  availability_status TEXT NOT NULL DEFAULT 'in_stock' CHECK (
    availability_status IN ('in_stock', 'low_stock', 'out_of_stock')
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  removed_at TEXT,
  FOREIGN KEY (cart_id) REFERENCES app_carts(id) ON DELETE RESTRICT,
  UNIQUE (cart_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_app_cart_items_cart
  ON app_cart_items(cart_id, removed_at);
