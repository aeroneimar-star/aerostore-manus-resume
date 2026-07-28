-- Fase 3.1-B - schema expansivo e vazio da Camada Mestre de Clientes.
-- Versao logica: customer-master-schema/v1
-- Migration isolada: nao ligada ao bootstrap, sem backfill e sem consumidores.

CREATE TABLE IF NOT EXISTS customer_master_records (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  eligibility_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED',
  eligibility_reasons_json TEXT NOT NULL DEFAULT '[]',
  eligibility_evaluated_at TEXT,
  eligibility_rule_version TEXT NOT NULL DEFAULT '',
  eligibility_source_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_customer_master_records_status
  ON customer_master_records(status);

CREATE INDEX IF NOT EXISTS idx_customer_master_records_eligibility
  ON customer_master_records(eligibility_status);

CREATE INDEX IF NOT EXISTS idx_customer_master_records_updated
  ON customer_master_records(updated_at);

CREATE INDEX IF NOT EXISTS idx_customer_master_records_deleted
  ON customer_master_records(deleted_at);

CREATE TABLE IF NOT EXISTS customer_master_sources (
  id TEXT PRIMARY KEY NOT NULL,
  master_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_updated_at TEXT,
  imported_at TEXT,
  source_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (master_id) REFERENCES customer_master_records(id) ON DELETE RESTRICT,
  UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_master_sources_master
  ON customer_master_sources(master_id);

CREATE INDEX IF NOT EXISTS idx_customer_master_sources_hash
  ON customer_master_sources(source_hash);

CREATE INDEX IF NOT EXISTS idx_customer_master_sources_status
  ON customer_master_sources(status);

CREATE INDEX IF NOT EXISTS idx_customer_master_sources_updated
  ON customer_master_sources(updated_at);

CREATE TABLE IF NOT EXISTS customer_master_identifiers (
  id TEXT PRIMARY KEY NOT NULL,
  master_id TEXT NOT NULL,
  source_link_id TEXT,
  identifier_type TEXT NOT NULL,
  lookup_hash TEXT NOT NULL,
  masked_value TEXT NOT NULL DEFAULT '',
  protected_value TEXT,
  classification TEXT NOT NULL DEFAULT '',
  validation_status TEXT NOT NULL DEFAULT 'NOT_VALIDATED',
  verification_status TEXT NOT NULL DEFAULT 'NOT_VERIFIED',
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  normalization_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (master_id) REFERENCES customer_master_records(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_link_id) REFERENCES customer_master_sources(id) ON DELETE RESTRICT,
  UNIQUE (source_link_id, identifier_type, lookup_hash)
);

CREATE INDEX IF NOT EXISTS idx_customer_master_identifiers_master
  ON customer_master_identifiers(master_id);

CREATE INDEX IF NOT EXISTS idx_customer_master_identifiers_source
  ON customer_master_identifiers(source_link_id);

CREATE INDEX IF NOT EXISTS idx_customer_master_identifiers_lookup
  ON customer_master_identifiers(identifier_type, lookup_hash);

CREATE INDEX IF NOT EXISTS idx_customer_master_identifiers_active
  ON customer_master_identifiers(is_active, identifier_type);

CREATE TABLE IF NOT EXISTS customer_identity_conflicts (
  id TEXT PRIMARY KEY NOT NULL,
  conflict_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'OPEN',
  rule_version TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  resolution_type TEXT,
  resolution_reason TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reopened_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_customer_identity_conflicts_status
  ON customer_identity_conflicts(status, severity, created_at);

CREATE INDEX IF NOT EXISTS idx_customer_identity_conflicts_updated
  ON customer_identity_conflicts(updated_at);

CREATE TABLE IF NOT EXISTS customer_identity_conflict_participants (
  id TEXT PRIMARY KEY NOT NULL,
  conflict_id TEXT NOT NULL,
  participant_type TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (conflict_id) REFERENCES customer_identity_conflicts(id) ON DELETE RESTRICT,
  UNIQUE (conflict_id, participant_type, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_conflict_participants_target
  ON customer_identity_conflict_participants(participant_type, participant_id);

CREATE TABLE IF NOT EXISTS customer_master_merge_history (
  id TEXT PRIMARY KEY NOT NULL,
  operation_type TEXT NOT NULL,
  primary_master_id TEXT,
  secondary_master_id TEXT,
  source_link_id TEXT,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT,
  correlation_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  reverted_by_event_id TEXT,
  reverted_at TEXT,
  FOREIGN KEY (primary_master_id) REFERENCES customer_master_records(id) ON DELETE RESTRICT,
  FOREIGN KEY (secondary_master_id) REFERENCES customer_master_records(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_link_id) REFERENCES customer_master_sources(id) ON DELETE RESTRICT,
  FOREIGN KEY (reverted_by_event_id) REFERENCES customer_master_merge_history(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_customer_master_history_primary
  ON customer_master_merge_history(primary_master_id, created_at);

CREATE INDEX IF NOT EXISTS idx_customer_master_history_secondary
  ON customer_master_merge_history(secondary_master_id, created_at);

CREATE INDEX IF NOT EXISTS idx_customer_master_history_source
  ON customer_master_merge_history(source_link_id, created_at);

CREATE INDEX IF NOT EXISTS idx_customer_master_history_correlation
  ON customer_master_merge_history(correlation_id);

CREATE TABLE IF NOT EXISTS customer_master_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  code_version TEXT NOT NULL DEFAULT '',
  schema_version TEXT NOT NULL DEFAULT 'customer-master-schema/v1',
  fingerprint TEXT NOT NULL DEFAULT '',
  counts_json TEXT NOT NULL DEFAULT '{}',
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  finished_at TEXT,
  created_by TEXT,
  error_code TEXT NOT NULL DEFAULT '',
  error_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_master_jobs_status
  ON customer_master_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_customer_master_jobs_type
  ON customer_master_jobs(job_type, created_at);

CREATE INDEX IF NOT EXISTS idx_customer_master_jobs_fingerprint
  ON customer_master_jobs(fingerprint);

CREATE TABLE IF NOT EXISTS customer_master_sync_checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  source_type TEXT NOT NULL UNIQUE,
  cursor_updated_at TEXT,
  cursor_source_id TEXT,
  last_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (last_job_id) REFERENCES customer_master_jobs(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_customer_master_checkpoints_job
  ON customer_master_sync_checkpoints(last_job_id);

CREATE INDEX IF NOT EXISTS idx_customer_master_checkpoints_updated
  ON customer_master_sync_checkpoints(updated_at);
