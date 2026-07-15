-- Fiscal module Stage 2 — DDL aditiva (CREATE IF NOT EXISTS / índices).
-- Sem certificado, CSC secreto, token ou provedor.

CREATE TABLE IF NOT EXISTS fiscal_tax_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  establishment_id INTEGER,
  operation_type TEXT NOT NULL DEFAULT 'sale_internal',
  origin_uf TEXT NOT NULL DEFAULT '',
  destination_uf TEXT NOT NULL DEFAULT '',
  cfop TEXT,
  csosn TEXT,
  cst_icms TEXT,
  pis_cst TEXT,
  cofins_cst TEXT,
  ipi_cst TEXT,
  icms_rate REAL,
  pis_rate REAL,
  cofins_rate REAL,
  ipi_rate REAL,
  base_reduction_rate REAL,
  benefit_code TEXT,
  additional_info TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  is_test_profile INTEGER NOT NULL DEFAULT 0 CHECK (is_test_profile IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (code),
  FOREIGN KEY (establishment_id) REFERENCES fiscal_establishments(id)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_tax_profiles_operation
  ON fiscal_tax_profiles(operation_type, active);
CREATE INDEX IF NOT EXISTS idx_fiscal_tax_profiles_establishment
  ON fiscal_tax_profiles(establishment_id);

CREATE TABLE IF NOT EXISTS fiscal_product_tax (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_ref TEXT NOT NULL,
  product_id INTEGER,
  variant_id TEXT,
  legacy_ai_product_id INTEGER,
  ncm TEXT,
  cest TEXT,
  origin TEXT,
  unit TEXT,
  gtin_ean TEXT,
  fiscal_description TEXT,
  profile_id INTEGER,
  cest_required INTEGER NOT NULL DEFAULT 0 CHECK (cest_required IN (0, 1)),
  inherit_from_parent INTEGER NOT NULL DEFAULT 1 CHECK (inherit_from_parent IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (product_ref),
  FOREIGN KEY (profile_id) REFERENCES fiscal_tax_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_product_tax_product_id
  ON fiscal_product_tax(product_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_product_tax_variant
  ON fiscal_product_tax(variant_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_product_tax_profile
  ON fiscal_product_tax(profile_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_product_tax_legacy
  ON fiscal_product_tax(legacy_ai_product_id);
