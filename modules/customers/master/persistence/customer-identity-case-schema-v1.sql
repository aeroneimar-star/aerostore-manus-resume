-- Fase 3.1-F.2 - schema expansivo de casos administrativos de identidade.
-- Versao logica: customer-identity-case-schema/v1
-- Migration isolada: sem rota, consumidor, resolucao, merge ou elegibilidade.

CREATE TABLE IF NOT EXISTS customer_identity_cases (
  id TEXT PRIMARY KEY NOT NULL,
  case_type TEXT NOT NULL,
  queue_type TEXT NOT NULL CHECK (
    queue_type IN ('IDENTITY_ELIGIBILITY', 'DATA_HYGIENE', 'HISTORICAL')
  ),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (
    status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'ARCHIVED', 'REOPENED')
  ),
  priority TEXT NOT NULL CHECK (
    priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')
  ),
  blocking INTEGER NOT NULL DEFAULT 0 CHECK (blocking IN (0, 1)),
  fingerprint TEXT NOT NULL UNIQUE,
  grouping_version TEXT NOT NULL,
  conflict_count INTEGER NOT NULL CHECK (conflict_count >= 1),
  master_count INTEGER NOT NULL DEFAULT 0 CHECK (master_count >= 0),
  source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_customer_identity_cases_queue
  ON customer_identity_cases(queue_type, status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_customer_identity_cases_status
  ON customer_identity_cases(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_customer_identity_cases_blocking
  ON customer_identity_cases(blocking, priority);

CREATE TABLE IF NOT EXISTS customer_identity_case_conflicts (
  case_id TEXT NOT NULL,
  conflict_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'EVIDENCE',
  created_at TEXT NOT NULL,
  PRIMARY KEY (case_id, conflict_id),
  FOREIGN KEY (case_id) REFERENCES customer_identity_cases(id) ON DELETE RESTRICT,
  FOREIGN KEY (conflict_id) REFERENCES customer_identity_conflicts(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_customer_identity_case_conflicts_conflict
  ON customer_identity_case_conflicts(conflict_id);

CREATE TABLE IF NOT EXISTS customer_identity_case_entities (
  case_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('MASTER', 'SOURCE')),
  entity_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (case_id, entity_type, entity_id),
  FOREIGN KEY (case_id) REFERENCES customer_identity_cases(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_customer_identity_case_entities_target
  ON customer_identity_case_entities(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS customer_identity_case_events (
  id TEXT PRIMARY KEY NOT NULL,
  case_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_user_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES customer_identity_cases(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_customer_identity_case_events_case
  ON customer_identity_case_events(case_id, created_at);
