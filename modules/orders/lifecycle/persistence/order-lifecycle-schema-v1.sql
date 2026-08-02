-- Order Lifecycle Schema v1
-- Idempotent: uses IF NOT EXISTS
-- Migration: expansiva, idempotente

CREATE TABLE IF NOT EXISTS app_order_timeline (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL,
  event TEXT NOT NULL,
  from_status TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'INTERNAL'
    CHECK(type IN ('CUSTOMER', 'INTERNAL')),
  visible_to_customer INTEGER NOT NULL DEFAULT 0,
  visible_internally INTEGER NOT NULL DEFAULT 1,
  icon TEXT NOT NULL DEFAULT 'info',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES app_orders(id)
);
CREATE INDEX IF NOT EXISTS idx_order_timeline_order_id ON app_order_timeline(order_id);
CREATE INDEX IF NOT EXISTS idx_order_timeline_event ON app_order_timeline(event);
CREATE INDEX IF NOT EXISTS idx_order_timeline_created_at ON app_order_timeline(created_at);
CREATE INDEX IF NOT EXISTS idx_order_timeline_visible_customer ON app_order_timeline(visible_to_customer);

CREATE TABLE IF NOT EXISTS app_order_lifecycle_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_state TEXT NOT NULL DEFAULT '',
  to_state TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES app_orders(id)
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_order_id ON app_order_lifecycle_events(order_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_event_type ON app_order_lifecycle_events(event_type);
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_created_at ON app_order_lifecycle_events(created_at);

-- Returns table
CREATE TABLE IF NOT EXISTS app_order_returns (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL DEFAULT 'OTHER'
    CHECK(reason IN ('DEFECTIVE', 'WRONG_ITEM', 'DID_NOT_LIKE', 'WRONG_SIZE', 'OTHER')),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'REQUESTED'
    CHECK(status IN ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'ITEM_RECEIVED', 'REFUND_PENDING', 'REFUND_COMPLETED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  received_at TEXT,
  refunded_at TEXT,
  FOREIGN KEY (order_id) REFERENCES app_orders(id)
);
CREATE INDEX IF NOT EXISTS idx_order_returns_order_id ON app_order_returns(order_id);
CREATE INDEX IF NOT EXISTS idx_order_returns_status ON app_order_returns(status);
