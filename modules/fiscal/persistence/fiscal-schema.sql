-- Fiscal module Stage 1 — DDL aditiva (CREATE IF NOT EXISTS).
-- Aplicada via modules/fiscal/persistence/ensureFiscalSchema.js em initializeDatabase.
-- Sem CSC, certificado, tokens ou credenciais de provedor.

CREATE TABLE IF NOT EXISTS fiscal_establishments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legal_name TEXT NOT NULL DEFAULT '',
  trade_name TEXT NOT NULL DEFAULT '',
  cnpj TEXT NOT NULL DEFAULT '',
  ie TEXT NOT NULL DEFAULT '',
  tax_regime TEXT NOT NULL DEFAULT '',
  uf TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT 'homologacao'
    CHECK (environment IN ('homologacao', 'producao')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fiscal_establishment_stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  establishment_id INTEGER NOT NULL,
  store_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (establishment_id) REFERENCES fiscal_establishments(id),
  UNIQUE (establishment_id, store_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_establishment_stores_active_store
  ON fiscal_establishment_stores(store_id)
  WHERE active = 1;

CREATE TABLE IF NOT EXISTS fiscal_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id TEXT NOT NULL,
  establishment_id INTEGER,
  model TEXT NOT NULL DEFAULT '65',
  purpose TEXT NOT NULL DEFAULT 'sale_emit',
  status TEXT NOT NULL DEFAULT 'PENDING',
  idempotency_key TEXT NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL,
  access_key TEXT,
  protocol TEXT,
  rejection_code TEXT,
  rejection_message TEXT,
  provider_ref TEXT,
  authorized_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (sale_id, model, purpose),
  FOREIGN KEY (establishment_id) REFERENCES fiscal_establishments(id)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_sale_id ON fiscal_documents(sale_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_status ON fiscal_documents(status);
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_establishment ON fiscal_documents(establishment_id);

CREATE TABLE IF NOT EXISTS fiscal_document_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_document_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  detail_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (fiscal_document_id) REFERENCES fiscal_documents(id)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_document_events_document
  ON fiscal_document_events(fiscal_document_id);
