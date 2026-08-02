-- app_cart_fulfillment: selecao de modalidade de entrega do carrinho
-- Migration expansiva e idempotente

CREATE TABLE IF NOT EXISTS app_cart_fulfillment (
  id TEXT PRIMARY KEY NOT NULL,
  cart_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('PICKUP','DELIVERY')),
  address_id TEXT,
  pickup_store_id TEXT,
  shipping_provider TEXT NOT NULL DEFAULT '',
  shipping_service_code TEXT NOT NULL DEFAULT '',
  shipping_quote_cents INTEGER NOT NULL DEFAULT 0,
  shipping_quote_currency TEXT NOT NULL DEFAULT 'BRL',
  shipping_quote_expires_at TEXT,
  shipping_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (shipping_status IN ('PENDING','CALCULATED','CONFIRMED','EXPIRED','INCOMPLETE','FAILED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cart_id) REFERENCES app_carts(id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (address_id) REFERENCES app_customer_addresses(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_app_cart_fulfillment_cart
  ON app_cart_fulfillment(cart_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_cart_fulfillment_account
  ON app_cart_fulfillment(account_id, updated_at DESC);
