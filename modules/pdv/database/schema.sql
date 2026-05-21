-- PDV AEROSTORE — STAGE 0
-- Blueprint somente de fundação.
-- Não aplicar automaticamente nesta fase.

CREATE TABLE IF NOT EXISTS pdv_cash_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_code TEXT NOT NULL,
  terminal_code TEXT,
  opened_by_user_id INTEGER,
  opened_by_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  opening_amount NUMERIC NOT NULL DEFAULT 0,
  expected_closing_amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  opened_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pdv_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_code TEXT NOT NULL UNIQUE,
  cash_session_id INTEGER,
  customer_contact_id INTEGER,
  customer_key TEXT,
  sale_status TEXT NOT NULL DEFAULT 'draft',
  subtotal_amount NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  cashback_redeemed_amount NUMERIC NOT NULL DEFAULT 0,
  exchange_credit_amount NUMERIC NOT NULL DEFAULT 0,
  gift_card_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  seller_user_id INTEGER,
  seller_name TEXT,
  notes TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at TEXT,
  cancelled_by_user_id INTEGER
);

CREATE TABLE IF NOT EXISTS pdv_sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  product_sku TEXT,
  product_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  line_discount_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'catalog',
  source_product_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pdv_sale_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  installments INTEGER NOT NULL DEFAULT 1,
  amount NUMERIC NOT NULL DEFAULT 0,
  reference_code TEXT,
  external_reference TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pdv_exchange_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_key TEXT,
  source_sale_id INTEGER,
  status TEXT NOT NULL DEFAULT 'available',
  original_amount NUMERIC NOT NULL DEFAULT 0,
  available_amount NUMERIC NOT NULL DEFAULT 0,
  expires_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pdv_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  actor_user_id INTEGER,
  actor_name TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
