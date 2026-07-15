-- Fiscal module Stage 3 — DDL aditiva.
-- Prontidão / cobertura / mapeamento de pagamentos.
-- Sem certificado, CSC secreto, série, numeração, XML ou provedor.

CREATE TABLE IF NOT EXISTS fiscal_readiness_rules (
  code TEXT PRIMARY KEY COLLATE NOCASE,
  severity TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('blocking', 'warning', 'informational')),
  entity_scope TEXT NOT NULL DEFAULT 'product',
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fiscal_payment_mapping (
  method TEXT PRIMARY KEY COLLATE NOCASE,
  label TEXT NOT NULL DEFAULT '',
  mapping_status TEXT NOT NULL DEFAULT 'pending_accounting'
    CHECK (mapping_status IN ('pending_accounting', 'confirmed', 'ambiguous', 'blocked_for_emit')),
  nfce_tpag TEXT,
  brand TEXT,
  acquirer_cnpj TEXT,
  integration TEXT,
  notes TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fiscal_payment_mapping_status
  ON fiscal_payment_mapping(mapping_status);
