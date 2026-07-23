-- Shop publication layer — DDL aditiva (Fase 2.9 prep)
-- NÃO APLICAR automaticamente. Não ligado a db.js / initializeDatabase.
-- Aplicação futura: node scripts/shop_apply_publication_migration.js
--   com SHOP_APPLY_MIGRATION=true (confirmação explícita).
--
-- Inclui: shop_product_publications, shop_variant_publications,
--         shop_product_images, shop_catalog_settings
-- NÃO inclui: shop_stock_reservations (fase posterior / pedidos)

-- =============================================================================
-- shop_product_publications — gate editorial por produto PDV (espelho)
-- =============================================================================
CREATE TABLE IF NOT EXISTS shop_product_publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL UNIQUE,
  public_slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  public_title TEXT NOT NULL,
  public_short_description TEXT NOT NULL DEFAULT '',
  public_description TEXT NOT NULL DEFAULT '',
  public_category_slug TEXT NOT NULL DEFAULT '',
  public_category_label TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  published_by TEXT NOT NULL DEFAULT '',
  unpublished_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  public_price_cents INTEGER,
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
-- shop_variant_publications — gate por variação PDV (piloto pode ficar vazio)
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
-- shop_product_images — galeria editorial (seed piloto: 0 rows enquanto needs_photo)
-- =============================================================================
CREATE TABLE IF NOT EXISTS shop_product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'gallery'
    CHECK (role IN ('primary', 'gallery', 'detail', 'lifestyle')),
  color_slug TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (publication_id) REFERENCES shop_product_publications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shop_product_images_pub
  ON shop_product_images(publication_id, sort_order);

-- =============================================================================
-- shop_catalog_settings — singleton (espelha política de shop-settings.json)
-- =============================================================================
CREATE TABLE IF NOT EXISTS shop_catalog_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fulfillment_store_ids_json TEXT NOT NULL DEFAULT '[]',
  stock_policy TEXT NOT NULL DEFAULT 'min_across_stores'
    CHECK (stock_policy IN ('min_across_stores', 'sum_selected', 'dedicated_online_store')),
  reservation_ttl_minutes INTEGER NOT NULL DEFAULT 15,
  low_stock_threshold INTEGER NOT NULL DEFAULT 2,
  use_pilot_json_fallback INTEGER NOT NULL DEFAULT 1 CHECK (use_pilot_json_fallback IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);
