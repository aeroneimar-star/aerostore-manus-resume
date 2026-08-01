"use strict";

const MASTER_TABLES = Object.freeze([
  "customer_master_records",
  "customer_master_sources",
  "customer_master_identifiers",
  "customer_identity_conflicts",
  "customer_identity_conflict_participants",
  "customer_master_merge_history",
  "customer_master_jobs",
  "customer_master_sync_checkpoints",
  "customer_identity_cases",
  "customer_identity_case_conflicts",
  "customer_identity_case_entities",
  "customer_identity_case_events"
]);

const REQUIRED_INDEXES = Object.freeze([
  "idx_customer_master_sources_master",
  "idx_customer_master_identifiers_lookup",
  "idx_customer_master_identifiers_master",
  "idx_customer_identity_conflicts_status",
  "idx_customer_conflict_participants_target",
  "idx_customer_identity_cases_queue",
  "idx_customer_identity_case_events_case",
  "idx_customer_master_jobs_status",
  "idx_customer_master_checkpoints_job",
  "idx_customer_master_history_primary"
]);

const CPF_PARTIAL_UNIQUE_INDEX = "idx_customer_master_identifiers_unique_active_valid_cpf";

function columnsMatch(columns, expected) {
  return columns.length === expected.length
    && columns.every((column, index) => column === expected[index]);
}

async function readUniqueIndexes(db, table) {
  const indexes = await db.all(`PRAGMA index_list(${table})`);
  const result = [];
  for (const index of indexes.filter((row) => Number(row.unique) === 1)) {
    const columns = await db.all(`PRAGMA index_info(${String(index.name)})`);
    result.push({
      name: String(index.name),
      partial: Number(index.partial || 0) === 1,
      columns: columns.sort((a, b) => Number(a.seqno) - Number(b.seqno)).map((row) => String(row.name))
    });
  }
  return result;
}

async function count(db, sql, params = []) {
  return Number((await db.get(sql, params))?.total || 0);
}

function sqliteSupportsPartialIndexes(version) {
  const [major, minor] = String(version || "0.0").split(".").map(Number);
  return major > 3 || (major === 3 && minor >= 8);
}

async function auditCustomerMasterIntegrity(db) {
  if (!db || typeof db.get !== "function" || typeof db.all !== "function") {
    throw new Error("CUSTOMER_MASTER_INTEGRITY_DB_REQUIRED");
  }
  const quick = await db.get("PRAGMA quick_check");
  const sqlite = await db.get("SELECT sqlite_version() AS version");
  const foreignKeyRows = await db.all("PRAGMA foreign_key_check");
  const masterSet = new Set(MASTER_TABLES);
  const masterForeignKeyViolations = foreignKeyRows.filter((row) => masterSet.has(String(row.table))).length;
  const externalForeignKeyViolations = foreignKeyRows.length - masterForeignKeyViolations;

  const unique = {
    sources: await readUniqueIndexes(db, "customer_master_sources"),
    identifiers: await readUniqueIndexes(db, "customer_master_identifiers"),
    participants: await readUniqueIndexes(db, "customer_identity_conflict_participants"),
    caseConflicts: await readUniqueIndexes(db, "customer_identity_case_conflicts"),
    caseEntities: await readUniqueIndexes(db, "customer_identity_case_entities"),
    checkpoints: await readUniqueIndexes(db, "customer_master_sync_checkpoints")
  };
  const constraints = {
    sourceTypeAndId: unique.sources.some((row) => columnsMatch(row.columns, ["source_type", "source_id"])),
    identifierWithinSource: unique.identifiers.some((row) => columnsMatch(
      row.columns, ["source_link_id", "identifier_type", "lookup_hash"]
    )),
    participantWithinConflict: unique.participants.some((row) => columnsMatch(
      row.columns, ["conflict_id", "participant_type", "participant_id"]
    )),
    conflictWithinCase: unique.caseConflicts.some((row) => (
      columnsMatch(row.columns, ["case_id", "conflict_id"])
      || columnsMatch(row.columns, ["conflict_id"])
    )),
    entityWithinCase: unique.caseEntities.some((row) => columnsMatch(
      row.columns, ["case_id", "entity_type", "entity_id"]
    )),
    checkpointPerSource: unique.checkpoints.some((row) => columnsMatch(row.columns, ["source_type"]))
  };

  const indexRows = await db.all(
    `SELECT name FROM sqlite_master
      WHERE type = 'index' AND name IS NOT NULL
        AND (tbl_name LIKE 'customer_master_%' OR tbl_name LIKE 'customer_identity_%')`
  );
  const indexNames = new Set(indexRows.map((row) => String(row.name)));
  const missingIndexes = REQUIRED_INDEXES.filter((name) => !indexNames.has(name));

  let cascadeForeignKeys = 0;
  for (const table of MASTER_TABLES) {
    const keys = await db.all(`PRAGMA foreign_key_list(${table})`);
    cascadeForeignKeys += keys.filter((key) => (
      String(key.on_delete || "").toUpperCase() === "CASCADE"
      || String(key.on_update || "").toUpperCase() === "CASCADE"
    )).length;
  }

  const duplicates = {
    sources: await count(db, `SELECT COUNT(*) AS total FROM (
      SELECT source_type, source_id FROM customer_master_sources
      GROUP BY source_type, source_id HAVING COUNT(*) > 1)`),
    identifiers: await count(db, `SELECT COUNT(*) AS total FROM (
      SELECT source_link_id, identifier_type, lookup_hash FROM customer_master_identifiers
      GROUP BY source_link_id, identifier_type, lookup_hash HAVING COUNT(*) > 1)`),
    participants: await count(db, `SELECT COUNT(*) AS total FROM (
      SELECT conflict_id, participant_type, participant_id FROM customer_identity_conflict_participants
      GROUP BY conflict_id, participant_type, participant_id HAVING COUNT(*) > 1)`),
    caseConflicts: await count(db, `SELECT COUNT(*) AS total FROM (
      SELECT case_id, conflict_id FROM customer_identity_case_conflicts
      GROUP BY case_id, conflict_id HAVING COUNT(*) > 1)`),
    caseEntities: await count(db, `SELECT COUNT(*) AS total FROM (
      SELECT case_id, entity_type, entity_id FROM customer_identity_case_entities
      GROUP BY case_id, entity_type, entity_id HAVING COUNT(*) > 1)`),
    checkpoints: await count(db, `SELECT COUNT(*) AS total FROM (
      SELECT source_type FROM customer_master_sync_checkpoints
      GROUP BY source_type HAVING COUNT(*) > 1)`)
  };

  const orphans = {
    sources: await count(db, `SELECT COUNT(*) AS total FROM customer_master_sources s
      LEFT JOIN customer_master_records m ON m.id = s.master_id WHERE m.id IS NULL`),
    identifiers: await count(db, `SELECT COUNT(*) AS total FROM customer_master_identifiers i
      LEFT JOIN customer_master_records m ON m.id = i.master_id
      LEFT JOIN customer_master_sources s ON s.id = i.source_link_id
      WHERE m.id IS NULL OR (i.source_link_id IS NOT NULL AND s.id IS NULL)`),
    conflictsWithoutParticipants: await count(db, `SELECT COUNT(*) AS total
      FROM customer_identity_conflicts c LEFT JOIN customer_identity_conflict_participants p
      ON p.conflict_id = c.id WHERE p.id IS NULL`),
    casesWithoutConflicts: await count(db, `SELECT COUNT(*) AS total
      FROM customer_identity_cases c LEFT JOIN customer_identity_case_conflicts cc
      ON cc.case_id = c.id WHERE cc.case_id IS NULL`),
    caseConflictLinks: await count(db, `SELECT COUNT(*) AS total
      FROM customer_identity_case_conflicts cc
      LEFT JOIN customer_identity_cases c ON c.id = cc.case_id
      LEFT JOIN customer_identity_conflicts f ON f.id = cc.conflict_id
      WHERE c.id IS NULL OR f.id IS NULL`),
    events: await count(db, `SELECT COUNT(*) AS total FROM customer_identity_case_events e
      LEFT JOIN customer_identity_cases c ON c.id = e.case_id WHERE c.id IS NULL`),
    checkpoints: await count(db, `SELECT COUNT(*) AS total FROM customer_master_sync_checkpoints cp
      LEFT JOIN customer_master_jobs j ON j.id = cp.last_job_id
      WHERE cp.last_job_id IS NOT NULL AND j.id IS NULL`),
    mastersWithoutSources: await count(db, `SELECT COUNT(*) AS total FROM customer_master_records m
      LEFT JOIN customer_master_sources s ON s.master_id = m.id WHERE s.id IS NULL`)
  };

  const cpfDuplicateGroups = await count(db, `SELECT COUNT(*) AS total FROM (
    SELECT lookup_hash FROM customer_master_identifiers
    WHERE identifier_type = 'CPF' AND is_active = 1 AND validation_status = 'VALID'
    GROUP BY lookup_hash HAVING COUNT(DISTINCT master_id) > 1)`);
  const cpfPartialIndexApplied = indexNames.has(CPF_PARTIAL_UNIQUE_INDEX);
  const cpfPartialUnique = {
    sqliteCompatible: sqliteSupportsPartialIndexes(sqlite?.version),
    violationGroups: cpfDuplicateGroups,
    applied: cpfPartialIndexApplied,
    status: cpfDuplicateGroups === 0 ? (cpfPartialIndexApplied ? "APPLIED" : "SAFE_NOT_APPLIED") : "PENDING_VIOLATIONS"
  };
  const releasedEligibility = await count(db, `SELECT COUNT(*) AS total
    FROM customer_master_records
    WHERE eligibility_status NOT IN ('NOT_EVALUATED', 'REVIEW_REQUIRED')`);
  const invalidVersions = await count(db, `SELECT COUNT(*) AS total
    FROM customer_master_records WHERE version < 1`);

  const cleanConstraintSet = Object.values(constraints).every(Boolean);
  const cleanDuplicates = Object.values(duplicates).every((value) => value === 0);
  const cleanOrphans = Object.values(orphans).every((value) => value === 0);
  const integrityOk = String(quick?.quick_check || "").toLowerCase() === "ok"
    && masterForeignKeyViolations === 0
    && cascadeForeignKeys === 0
    && cleanConstraintSet
    && cleanDuplicates
    && cleanOrphans
    && missingIndexes.length === 0
    && invalidVersions === 0
    && releasedEligibility === 0
    && !(cpfPartialIndexApplied && cpfDuplicateGroups > 0);

  return {
    status: integrityOk ? "INTEGRITY_OK" : "INTEGRITY_FAILED",
    quickCheck: String(quick?.quick_check || ""),
    sqliteVersion: String(sqlite?.version || ""),
    foreignKeys: {
      masterViolations: masterForeignKeyViolations,
      preExistingExternalViolations: externalForeignKeyViolations,
      cascadeActions: cascadeForeignKeys
    },
    constraints,
    missingIndexes,
    duplicates,
    orphans,
    cpfPartialUnique,
    invalidVersions,
    releasedEligibility,
    integrityOk
  };
}

module.exports = {
  MASTER_TABLES,
  REQUIRED_INDEXES,
  CPF_PARTIAL_UNIQUE_INDEX,
  sqliteSupportsPartialIndexes,
  auditCustomerMasterIntegrity
};
