-- Shop publication layer — DDL proposto (Fase 2.7)
-- NÃO APLICAR automaticamente. Revisar e aplicar manualmente após aprovação + backup.
-- Integração: pdv_products_v2 + pdv_product_variants + pdv_inventory_balances_v2 (fonte de verdade)
-- Camada editorial: shop_product_publications + shop_variant_publications + shop_product_images

-- =============================================================================
-- shop_product_publications — gate de publicação web por produto PDV
-- =============================================================================
CREATE TABLE IF NOT EXISTS shop_product_publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  public_slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  public_title TEXT NOT NULL,
  public_short_description TEXT NOT NULL DEFAULT '',
  public_description TEXT NOT NULL DEFAULT '',
  public_description_full TEXT NOT NULL DEFAULT '',
  public_category_slug TEXT NOT NULL DEFAULT '',
  public_category_label TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  published_by TEXT NOT NULL DEFAULT '',
  unpublished_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  badge_label TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES pdv_products_v2(id)
);

CREATE INDEX IF NOT EXISTS idx_shop_publications_status
  ON shop_product_publications(status, sort_order);

CREATE INDEX IF NOT EXISTS idx_shop_publications_category
  ON shop_product_publications(public_category_slug, status);

CREATE INDEX IF NOT EXISTS idx_shop_publications_product
  ON shop_product_publications(product_id);

-- =============================================================================
-- shop_variant_publications — gate por variação PDV
-- =============================================================================
CREATE TABLE IF NOT EXISTS shop_variant_publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id INTEGER NOT NULL,
  variant_id TEXT NOT NULL,
  public_variant_slug TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'hidden')),
  public_price_cents INTEGER,
  compare_at_price_cents INTEGER,
  max_online_qty INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (publication_id) REFERENCES shop_product_publications(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES pdv_product_variants(id),
  UNIQUE (publication_id, variant_id),
  UNIQUE (publication_id, public_variant_slug)
);

CREATE INDEX IF NOT EXISTS idx_shop_variant_publications_pub
  ON shop_variant_publications(publication_id, status);

-- =============================================================================
-- shop_product_images — fotos públicas editoriais (separadas da mídia CRM)
-- =============================================================================
CREATE TABLE IF NOT EXISTS shop_product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'primary'
    CHECK (role IN ('primary', 'gallery', 'detail', 'lifestyle')),
  color_slug TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (publication_id) REFERENCES shop_product_publications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shop_product_images_pub
  ON shop_product_images(publication_id, sort_order);

-- =============================================================================
-- shop_catalog_settings — singleton (opcional; espelha shop-settings.json)
-- =============================================================================
CREATE TABLE IF NOT EXISTS shop_catalog_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fulfillment_store_ids_json TEXT NOT NULL DEFAULT '[]',
  stock_policy TEXT NOT NULL DEFAULT 'min_across_stores'
    CHECK (stock_policy IN ('min_across_stores', 'sum_selected', 'dedicated_online_store')),
  reservation_ttl_minutes INTEGER NOT NULL DEFAULT 30,
  low_stock_threshold INTEGER NOT NULL DEFAULT 2,
  use_pilot_json_fallback INTEGER NOT NULL DEFAULT 1 CHECK (use_pilot_json_fallback IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

-- Seed singleton (executar manualmente após CREATE):
-- INSERT INTO shop_catalog_settings (id, fulfillment_store_ids_json, stock_policy, low_stock_threshold, reservation_ttl_minutes, use_pilot_json_fallback, updated_at, updated_by)
-- VALUES (1, '["vila_masc","botanico","sul"]', 'min_across_stores', 2, 30, 1, datetime('now'), 'migration');
