"use strict";

const { randomUUID } = require("node:crypto");

const {
  NORMALIZATION_VERSION
} = require("../normalization");
const {
  SOURCE_MODEL_VERSION,
  buildSourceRecord,
  stableStringify,
  sha256
} = require("../backfill/customerMasterSourceModel");
const {
  candidateIdFor,
  sourceKey,
  buildCandidateGraph,
  buildCandidateClusters
} = require("../backfill/customerMasterCandidateBuilder");
const {
  CONFLICT_RULE_VERSION,
  detectCustomerMasterConflicts
} = require("../backfill/customerMasterConflictDetector");
const {
  masterIdFor,
  sourceLinkIdFor,
  identifierLookupHash,
  identifierIdFor,
  conflictIdFor,
  conflictParticipantIdFor,
  checkpointIdFor
} = require("../backfill/customerMasterControlledApply");
const {
  buildCustomerIdentityCasePlan
} = require("../governance/customerIdentityCaseService");

const INCREMENTAL_SYNC_VERSION = "customer-master-incremental-sync/v1";
const INCREMENTAL_JOB_TYPE = "INCREMENTAL_SOURCE_SYNC";
const SOURCE_TYPES = Object.freeze(["contacts", "crm_contacts"]);
const DEFAULT_PAGE_SIZE = 250;
const DEFAULT_MAX_AFFECTED_SOURCES = 50;
const INCREMENTAL_WRITE_TABLES = new Set([
  "customer_master_records",
  "customer_master_sources",
  "customer_master_identifiers",
  "customer_identity_conflicts",
  "customer_identity_conflict_participants",
  "customer_master_jobs",
  "customer_master_sync_checkpoints",
  "customer_identity_cases",
  "customer_identity_case_conflicts",
  "customer_identity_case_entities",
  "customer_identity_case_events"
]);

function assertIncrementalSql(sql) {
  const normalized = String(sql || "").trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(normalized) || /^(SELECT|WITH)\b/i.test(normalized)) {
    return normalized;
  }
  if (/^(DELETE|DROP|ALTER|REPLACE|VACUUM|ATTACH|DETACH|TRUNCATE)\b/i.test(normalized)) {
    throw new Error("CUSTOMER_MASTER_INCREMENTAL_SQL_BLOCKED");
  }
  const match = normalized.match(/^(?:INSERT(?:\s+OR\s+IGNORE)?\s+INTO|UPDATE)\s+([a-z_]+)/i);
  if (!match || !INCREMENTAL_WRITE_TABLES.has(match[1].toLowerCase())) {
    throw new Error("CUSTOMER_MASTER_INCREMENTAL_SQL_BLOCKED");
  }
  return normalized;
}

function createIncrementalRepository(db) {
  if (!db || typeof db.run !== "function" || typeof db.get !== "function" || typeof db.all !== "function") {
    throw new Error("CUSTOMER_MASTER_INCREMENTAL_DB_REQUIRED");
  }
  return Object.freeze({
    run: (sql, params = []) => db.run(assertIncrementalSql(sql), params),
    get: (sql, params = []) => db.get(assertIncrementalSql(sql), params),
    all: (sql, params = []) => db.all(assertIncrementalSql(sql), params)
  });
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function parseSourceKey(value) {
  const text = String(value);
  const separator = text.indexOf(":");
  if (separator <= 0) throw new Error("CUSTOMER_MASTER_INCREMENTAL_SOURCE_KEY_INVALID");
  return [text.slice(0, separator), text.slice(separator + 1)];
}

function statusFor(record) {
  if (record.sourceDeleted) return "DELETED";
  if (record.sourceInactive) return "INACTIVE";
  return "ACTIVE";
}

function desiredIdentifiers(record, sourceLink, masterId, runAt) {
  const primaryTypes = new Set();
  return record.normalizedIdentity.identifiers
    .filter((identifier) => identifier.canonicalValue && identifier.classification !== "EMPTY")
    .map((identifier) => {
      const lookupHash = identifierLookupHash(identifier.type, identifier.canonicalValue);
      const primary = primaryTypes.has(identifier.type) ? 0 : 1;
      primaryTypes.add(identifier.type);
      return {
        id: identifierIdFor(sourceLink, identifier.type, lookupHash),
        masterId,
        sourceLink,
        type: identifier.type,
        lookupHash,
        maskedValue: identifier.maskedValue || "",
        protectedValue: identifier.canonicalValue,
        classification: identifier.classification,
        validationStatus: identifier.valid ? "VALID" : "INVALID",
        isPrimary: primary,
        runAt
      };
    });
}

async function withTransaction(db, operation) {
  await db.run("BEGIN IMMEDIATE");
  try {
    const value = await operation();
    await db.run("COMMIT");
    return value;
  } catch (error) {
    await db.run("ROLLBACK").catch(() => null);
    throw error;
  }
}

async function loadNeighborhood(db, reader, targetRecord, existingSource, options) {
  const targetLink = sourceLinkIdFor(targetRecord.sourceType, targetRecord.sourceId);
  const linkIds = new Set([targetLink]);
  const hashes = new Set(
    desiredIdentifiers(targetRecord, targetLink, existingSource?.master_id || "", options.runAt)
      .map((item) => item.lookupHash)
  );
  const oldIdentifiers = existingSource
    ? await db.all(
      "SELECT lookup_hash FROM customer_master_identifiers WHERE source_link_id = ? AND is_active = 1",
      [targetLink]
    )
    : [];
  oldIdentifiers.forEach((row) => hashes.add(String(row.lookup_hash)));

  if (hashes.size) {
    const rows = await db.all(
      `SELECT DISTINCT source_link_id FROM customer_master_identifiers
       WHERE is_active = 1 AND lookup_hash IN (${placeholders([...hashes])})`,
      [...hashes]
    );
    rows.forEach((row) => linkIds.add(String(row.source_link_id)));
  }
  if (existingSource?.master_id) {
    const rows = await db.all(
      "SELECT id FROM customer_master_sources WHERE master_id = ?",
      [existingSource.master_id]
    );
    rows.forEach((row) => linkIds.add(String(row.id)));
  }

  const directConflictRows = existingSource
    ? await db.all(
      `SELECT conflict_id FROM customer_identity_conflict_participants
       WHERE participant_type = 'SOURCE' AND participant_id = ?`,
      [targetLink]
    )
    : [];
  const directConflictIds = directConflictRows.map((row) => String(row.conflict_id));
  if (directConflictIds.length) {
    const rows = await db.all(
      `SELECT participant_id FROM customer_identity_conflict_participants
       WHERE participant_type = 'SOURCE' AND conflict_id IN (${placeholders(directConflictIds)})`,
      directConflictIds
    );
    rows.forEach((row) => linkIds.add(String(row.participant_id)));
  }

  if (linkIds.size > options.maxAffectedSources) {
    throw new Error(`CUSTOMER_MASTER_INCREMENTAL_AFFECTED_LIMIT:${linkIds.size}`);
  }
  const links = await db.all(
    `SELECT id, master_id, source_type, source_id FROM customer_master_sources
     WHERE id IN (${placeholders([...linkIds])})`,
    [...linkIds]
  );
  const records = [];
  for (const link of links) {
    if (String(link.id) === targetLink) continue;
    const row = await reader.readSourceById(String(link.source_type), String(link.source_id));
    if (row) records.push(buildSourceRecord(String(link.source_type), row));
  }
  records.push(targetRecord);
  records.sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)));
  return { records, links, directConflictIds, targetLink };
}

function chooseMasterId(record, records, links, graph, candidates) {
  const index = records.findIndex((item) => sourceKey(item) === sourceKey(record));
  const candidate = candidates.find((item) => item.recordIndexes.includes(index));
  const linkByKey = new Map(links.map((link) => [
    `${link.source_type}:${link.source_id}`,
    link
  ]));
  const masters = new Set((candidate?.sourceRefs || [])
    .map((key) => String(linkByKey.get(key)?.master_id || ""))
    .filter(Boolean));
  if (candidate && candidate.recordIndexes.length > 1 && masters.size === 1) {
    return [...masters][0];
  }
  return masterIdFor(candidateIdFor(record));
}

async function persistCasePlan(db, plan) {
  for (const row of plan.cases) {
    await db.run(
      `INSERT OR IGNORE INTO customer_identity_cases
        (id, case_type, queue_type, status, priority, blocking, fingerprint,
         grouping_version, conflict_count, master_count, source_count, summary_json,
         created_at, updated_at, resolved_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.case_type, row.queue_type, row.status, row.priority, row.blocking,
        row.fingerprint, row.grouping_version, row.conflict_count, row.master_count,
        row.source_count, row.summary_json, row.created_at, row.updated_at,
        row.resolved_at, row.archived_at]
    );
  }
  for (const row of plan.caseConflicts) {
    await db.run(
      `INSERT OR IGNORE INTO customer_identity_case_conflicts
       (case_id, conflict_id, role, created_at) VALUES (?, ?, ?, ?)`,
      [row.case_id, row.conflict_id, row.role, row.created_at]
    );
  }
  for (const row of plan.caseEntities) {
    await db.run(
      `INSERT OR IGNORE INTO customer_identity_case_entities
       (case_id, entity_type, entity_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
      [row.case_id, row.entity_type, row.entity_id, row.role, row.created_at]
    );
  }
  for (const row of plan.events) {
    await db.run(
      `INSERT OR IGNORE INTO customer_identity_case_events
       (id, case_id, event_type, actor_user_id, reason, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.case_id, row.event_type, row.actor_user_id, "INCREMENTAL_SOURCE_SYNC",
        row.before_json, row.after_json, row.created_at]
    );
  }
}

async function reevaluateCases(db, conflictIds, record, runAt) {
  if (!conflictIds.length) return { affected: 0, reopened: 0 };
  const rows = await db.all(
    `SELECT DISTINCT c.id, c.status, c.review_version
       FROM customer_identity_cases c
       JOIN customer_identity_case_conflicts cc ON cc.case_id = c.id
      WHERE cc.conflict_id IN (${placeholders(conflictIds)})`,
    conflictIds
  );
  let reopened = 0;
  for (const row of rows) {
    const open = Number((await db.get(
      `SELECT COUNT(*) AS total
         FROM customer_identity_case_conflicts cc
         JOIN customer_identity_conflicts c ON c.id = cc.conflict_id
        WHERE cc.case_id = ? AND c.status = 'OPEN'`,
      [row.id]
    ))?.total || 0);
    let next = row.status;
    if (["RESOLVED", "ARCHIVED"].includes(String(row.status))) next = "REOPENED";
    else if (open === 0) next = "RESOLVED";
    if (next === row.status) continue;
    const nextVersion = Number(row.review_version || 0) + 1;
    await db.run(
      `UPDATE customer_identity_cases
          SET status = ?, review_version = ?, reviewer_user_id = NULL,
              review_started_at = NULL, review_updated_at = ?, updated_at = ?,
              resolved_at = CASE WHEN ? = 'RESOLVED' THEN ? ELSE NULL END,
              archived_at = NULL, last_event_at = ?
        WHERE id = ?`,
      [next, nextVersion, runAt, runAt, next, runAt, runAt, row.id]
    );
    if (next === "REOPENED") reopened += 1;
    const eventType = next === "REOPENED"
      ? "REOPENED_SOURCE_CHANGED"
      : "CASE_REEVALUATED_SOURCE_CHANGED";
    const eventId = `cice:${sha256(`${INCREMENTAL_SYNC_VERSION}|${row.id}|${record.sourceHash}|${eventType}`)}`;
    await db.run(
      `INSERT OR IGNORE INTO customer_identity_case_events
        (id, case_id, event_type, actor_user_id, reason, before_json, after_json, created_at)
       VALUES (?, ?, ?, NULL, 'MATERIAL_SOURCE_CHANGE', ?, ?, ?)`,
      [eventId, row.id, eventType,
        stableStringify({ status: row.status, reviewVersion: Number(row.review_version || 0) }),
        stableStringify({ status: next, reviewVersion: nextVersion, sourceType: record.sourceType }), runAt]
    );
  }
  return { affected: rows.length, reopened };
}

async function syncMaterialSource(db, reader, record, existingSource, options) {
  const neighborhood = await loadNeighborhood(db, reader, record, existingSource, options);
  const graph = buildCandidateGraph(neighborhood.records, { maxClusterSize: options.maxAffectedSources });
  if (graph.oversizedBuckets.length) {
    throw new Error("CUSTOMER_MASTER_INCREMENTAL_CLUSTER_LIMIT");
  }
  const candidates = buildCandidateClusters(neighborhood.records, graph);
  const detection = detectCustomerMasterConflicts(neighborhood.records, graph, candidates);
  const targetKey = sourceKey(record);
  const detected = detection.conflicts.filter((conflict) => conflict.participants.includes(targetKey));
  const masterId = existingSource?.master_id
    || chooseMasterId(record, neighborhood.records, neighborhood.links, graph, candidates);
  const targetLink = neighborhood.targetLink;

  if (!existingSource) {
    await db.run(
      `INSERT OR IGNORE INTO customer_master_records
        (id, display_name, status, version, eligibility_status, eligibility_reasons_json,
         eligibility_rule_version, eligibility_source_version, created_at, updated_at)
       VALUES (?, ?, 'PENDING', 1, 'NOT_EVALUATED', '["INCREMENTAL_SOURCE_NOT_EVALUATED"]',
               '', ?, ?, ?)`,
      [masterId, String(record.rawIdentity.name || "").trim(), SOURCE_MODEL_VERSION, options.runAt, options.runAt]
    );
    await db.run(
      `INSERT INTO customer_master_sources
        (id, master_id, source_type, source_id, source_updated_at, imported_at,
         source_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [targetLink, masterId, record.sourceType, record.sourceId, record.sourceUpdatedAt,
        options.runAt, record.sourceHash, statusFor(record), options.runAt, options.runAt]
    );
  } else {
    await db.run(
      `UPDATE customer_master_sources
          SET source_updated_at = ?, imported_at = ?, source_hash = ?, status = ?,
              updated_at = ?, revoked_at = ?
        WHERE id = ?`,
      [record.sourceUpdatedAt, options.runAt, record.sourceHash, statusFor(record), options.runAt,
        record.sourceDeleted ? options.runAt : null, targetLink]
    );
  }

  await db.run(
    `UPDATE customer_master_identifiers
        SET is_active = 0, updated_at = ?, revoked_at = ?
      WHERE source_link_id = ? AND is_active = 1`,
    [options.runAt, options.runAt, targetLink]
  );
  for (const item of desiredIdentifiers(record, targetLink, masterId, options.runAt)) {
    await db.run(
      `INSERT INTO customer_master_identifiers
        (id, master_id, source_link_id, identifier_type, lookup_hash, masked_value,
         protected_value, classification, validation_status, verification_status,
         is_primary, is_active, normalization_version, created_at, updated_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_VERIFIED', ?, 1, ?, ?, ?, NULL)
       ON CONFLICT(source_link_id, identifier_type, lookup_hash) DO UPDATE SET
         master_id = excluded.master_id, masked_value = excluded.masked_value,
         protected_value = excluded.protected_value, classification = excluded.classification,
         validation_status = excluded.validation_status, is_primary = excluded.is_primary,
         is_active = 1, normalization_version = excluded.normalization_version,
         updated_at = excluded.updated_at, revoked_at = NULL`,
      [item.id, item.masterId, item.sourceLink, item.type, item.lookupHash, item.maskedValue,
        item.protectedValue, item.classification, item.validationStatus, item.isPrimary,
        NORMALIZATION_VERSION, item.runAt, item.runAt]
    );
  }

  const expectedIds = [];
  const expectedConflictRows = [];
  const expectedParticipants = [];
  for (const conflict of detected) {
    const id = conflictIdFor(conflict);
    expectedIds.push(id);
    const evidence = stableStringify({
      identifierType: conflict.evidence?.identifierType || null,
      maskedValues: conflict.evidence?.maskedValues || [],
      participantCount: conflict.evidence?.participantCount || conflict.participants.length,
      sourceTypes: conflict.evidence?.sourceTypes || [],
      reasonCodes: [...conflict.reasonCodes].sort(),
      blocking: conflict.blocking === true
    });
    await db.run(
      `INSERT INTO customer_identity_conflicts
        (id, conflict_type, severity, status, rule_version, evidence_json,
         created_at, updated_at)
       VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET conflict_type = excluded.conflict_type,
         severity = excluded.severity, status = 'OPEN', rule_version = excluded.rule_version,
         evidence_json = excluded.evidence_json, resolution_type = NULL,
         resolution_reason = NULL, resolved_by = NULL, resolved_at = NULL,
         updated_at = excluded.updated_at, reopened_at = excluded.updated_at`,
      [id, conflict.type, conflict.severity, CONFLICT_RULE_VERSION, evidence, options.runAt, options.runAt]
    );
    expectedConflictRows.push({
      id, conflict_type: conflict.type, severity: conflict.severity,
      evidence_json: evidence
    });
    for (const participant of conflict.participants) {
      const link = sourceLinkIdFor(...parseSourceKey(participant));
      const participantId = conflictParticipantIdFor(id, "SOURCE", link);
      await db.run(
        `INSERT OR IGNORE INTO customer_identity_conflict_participants
          (id, conflict_id, participant_type, participant_id, role, created_at)
         VALUES (?, ?, 'SOURCE', ?, '', ?)`,
        [participantId, id, link, options.runAt]
      );
      expectedParticipants.push({
        id: participantId, conflict_id: id, participant_type: "SOURCE",
        participant_id: link, role: ""
      });
    }
  }
  const staleIds = neighborhood.directConflictIds.filter((id) => !expectedIds.includes(id));
  if (staleIds.length) {
    await db.run(
      `UPDATE customer_identity_conflicts
          SET status = 'RESOLVED', resolution_type = 'SOURCE_CHANGE_NO_LONGER_REPRODUCIBLE',
              resolution_reason = 'MATERIAL_SOURCE_CHANGE', resolved_by = 'INCREMENTAL_SYNC',
              resolved_at = ?, updated_at = ?
        WHERE id IN (${placeholders(staleIds)})`,
      [options.runAt, options.runAt, ...staleIds]
    );
  }

  if (expectedConflictRows.length) {
    const sourceLinks = await db.all(
      `SELECT id, master_id FROM customer_master_sources
       WHERE id IN (${placeholders([...new Set(expectedParticipants.map((row) => row.participant_id))])})`,
      [...new Set(expectedParticipants.map((row) => row.participant_id))]
    );
    const plan = buildCustomerIdentityCasePlan({
      conflicts: expectedConflictRows,
      participants: expectedParticipants,
      sourceLinks,
      runAt: options.runAt,
      codeVersion: options.codeVersion
    });
    await persistCasePlan(db, plan);
  }
  const cases = await reevaluateCases(
    db,
    [...new Set([...neighborhood.directConflictIds, ...expectedIds])],
    record,
    options.runAt
  );
  return {
    created: !existingSource,
    conflictsDetected: expectedIds.length,
    conflictsResolved: staleIds.length,
    casesAffected: cases.affected,
    casesReopened: cases.reopened,
    affectedSources: neighborhood.records.length
  };
}

function createStats() {
  return {
    scanned: 0, unchanged: 0, materialChanges: 0, sourcesCreated: 0,
    conflictsDetected: 0, conflictsResolved: 0, casesAffected: 0,
    casesReopened: 0, maxAffectedSources: 0, pages: 0
  };
}

async function claimSourceCheckpoint(db, sourceType, jobId, runAt) {
  await withTransaction(db, async () => {
    const current = await db.get(
      `SELECT cp.last_job_id, cp.status, job.status AS job_status
         FROM customer_master_sync_checkpoints cp
         LEFT JOIN customer_master_jobs job ON job.id = cp.last_job_id
        WHERE cp.source_type = ?`,
      [sourceType]
    );
    if (current?.status === "RUNNING"
      && current.last_job_id !== jobId
      && current.job_status === "RUNNING") {
      throw new Error(`CUSTOMER_MASTER_INCREMENTAL_CONCURRENT_RUN:${sourceType}`);
    }
    await db.run(
      `INSERT INTO customer_master_sync_checkpoints
        (id, source_type, cursor_updated_at, cursor_source_id, last_job_id,
         status, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, 'RUNNING', ?, ?)
       ON CONFLICT(source_type) DO UPDATE SET last_job_id = excluded.last_job_id,
         status = 'RUNNING', updated_at = excluded.updated_at`,
      [checkpointIdFor(sourceType), sourceType, jobId, runAt, runAt]
    );
  });
}

async function runCustomerMasterIncrementalSync(input = {}) {
  const rawDb = input.db;
  const reader = input.reader;
  if (!rawDb || !reader || typeof reader.readIncrementalPage !== "function"
    || typeof reader.readLatestCursor !== "function"
    || typeof reader.countInvalidIncrementalCursors !== "function") {
    throw new Error("CUSTOMER_MASTER_INCREMENTAL_DEPENDENCIES_REQUIRED");
  }
  const sourceTypes = input.sourceTypes || SOURCE_TYPES;
  if (!sourceTypes.length || sourceTypes.some((type) => !SOURCE_TYPES.includes(type))) {
    throw new Error("CUSTOMER_MASTER_INCREMENTAL_SOURCE_TYPE_INVALID");
  }
  const options = {
    pageSize: Math.max(1, Math.min(500, Number(input.pageSize) || DEFAULT_PAGE_SIZE)),
    maxPages: input.maxPages == null ? Infinity : Math.max(1, Number(input.maxPages)),
    maxAffectedSources: Math.max(2, Number(input.maxAffectedSources) || DEFAULT_MAX_AFFECTED_SOURCES),
    codeVersion: String(input.codeVersion || "LOCAL_UNCOMMITTED"),
    runAt: String(input.runAt || new Date().toISOString())
  };
  const db = createIncrementalRepository(rawDb);
  const jobId = `cmj:${sha256(stableStringify({
    version: INCREMENTAL_SYNC_VERSION,
    runAt: options.runAt,
    sourceTypes,
    codeVersion: options.codeVersion,
    executionId: randomUUID()
  }))}`;
  const stats = createStats();
  await db.run(
    `INSERT OR IGNORE INTO customer_master_jobs
      (id, job_type, status, code_version, schema_version, fingerprint, counts_json,
       checkpoint_json, started_at, created_by, created_at, updated_at)
     VALUES (?, ?, 'RUNNING', ?, 'customer-master-schema/v1', '', '{}', '{}', ?, ?, ?, ?)`,
    [jobId, INCREMENTAL_JOB_TYPE, options.codeVersion, options.runAt,
      INCREMENTAL_SYNC_VERSION, options.runAt, options.runAt]
  );
  await db.run(
    `UPDATE customer_master_jobs SET status = 'RUNNING', error_code = '',
      error_summary = '', finished_at = NULL, updated_at = ? WHERE id = ?`,
    [options.runAt, jobId]
  );
  try {
    for (const sourceType of sourceTypes) {
      await claimSourceCheckpoint(db, sourceType, jobId, options.runAt);
      if (await reader.countInvalidIncrementalCursors(sourceType) > 0) {
        throw new Error(`CUSTOMER_MASTER_INCREMENTAL_CURSOR_REQUIRED:${sourceType}`);
      }
      const upperCursor = await reader.readLatestCursor(sourceType);
      if (!upperCursor) continue;
      let pageCount = 0;
      while (pageCount < options.maxPages) {
        const checkpoint = await db.get(
          "SELECT cursor_updated_at, cursor_source_id FROM customer_master_sync_checkpoints WHERE source_type = ?",
          [sourceType]
        );
        const rows = await reader.readIncrementalPage(sourceType, {
          updatedAt: checkpoint?.cursor_updated_at || null,
          sourceId: checkpoint?.cursor_source_id || null,
          upperUpdatedAt: String(upperCursor.updated_at),
          upperSourceId: String(upperCursor.id),
          limit: options.pageSize
        });
        if (!rows.length) break;
        await withTransaction(db, async () => {
          for (const row of rows) {
            const record = buildSourceRecord(sourceType, row);
            if (!record.sourceId || !record.sourceUpdatedAt) {
              throw new Error("CUSTOMER_MASTER_INCREMENTAL_CURSOR_REQUIRED");
            }
            stats.scanned += 1;
            const existing = await db.get(
              "SELECT id, master_id, source_hash FROM customer_master_sources WHERE source_type = ? AND source_id = ?",
              [sourceType, record.sourceId]
            );
            if (existing && String(existing.source_hash) === record.sourceHash) {
              stats.unchanged += 1;
            } else {
              const result = await syncMaterialSource(db, reader, record, existing, options);
              stats.materialChanges += 1;
              if (result.created) stats.sourcesCreated += 1;
              stats.conflictsDetected += result.conflictsDetected;
              stats.conflictsResolved += result.conflictsResolved;
              stats.casesAffected += result.casesAffected;
              stats.casesReopened += result.casesReopened;
              stats.maxAffectedSources = Math.max(stats.maxAffectedSources, result.affectedSources);
            }
          }
          const last = rows[rows.length - 1];
          const cursorUpdatedAt = String(last.updated_at || "").trim();
          const cursorSourceId = String(last.id ?? "").trim();
          if (!cursorUpdatedAt || !cursorSourceId) {
            throw new Error("CUSTOMER_MASTER_INCREMENTAL_CURSOR_REQUIRED");
          }
          await db.run(
            `INSERT INTO customer_master_sync_checkpoints
              (id, source_type, cursor_updated_at, cursor_source_id, last_job_id,
               status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?)
             ON CONFLICT(source_type) DO UPDATE SET cursor_updated_at = excluded.cursor_updated_at,
               cursor_source_id = excluded.cursor_source_id, last_job_id = excluded.last_job_id,
               status = 'RUNNING', updated_at = excluded.updated_at`,
            [checkpointIdFor(sourceType), sourceType, cursorUpdatedAt, cursorSourceId,
              jobId, options.runAt, options.runAt]
          );
        });
        pageCount += 1;
        stats.pages += 1;
        if (rows.length < options.pageSize) break;
      }
      await db.run(
        `UPDATE customer_master_sync_checkpoints SET status = 'COMPLETED',
          updated_at = ? WHERE source_type = ? AND last_job_id = ?`,
        [options.runAt, sourceType, jobId]
      );
    }
    const fingerprint = sha256(stableStringify({
      version: INCREMENTAL_SYNC_VERSION,
      codeVersion: options.codeVersion,
      stats
    }));
    await db.run(
      `UPDATE customer_master_jobs SET status = 'COMPLETED', fingerprint = ?,
        counts_json = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
      [fingerprint, stableStringify(stats), options.runAt, options.runAt, jobId]
    );
    return { status: "COMPLETE", jobId, fingerprint, stats };
  } catch (error) {
    await db.run(
      `UPDATE customer_master_sync_checkpoints SET status = 'FAILED', updated_at = ?
        WHERE last_job_id = ? AND status = 'RUNNING'`,
      [options.runAt, jobId]
    ).catch(() => null);
    await db.run(
      `UPDATE customer_master_jobs SET status = 'FAILED', error_code = ?,
        error_summary = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
      [String(error.code || error.message || "INCREMENTAL_SYNC_FAILED").slice(0, 120),
        "INCREMENTAL_SYNC_FAILED", options.runAt, options.runAt, jobId]
    ).catch(() => null);
    throw error;
  }
}

module.exports = {
  INCREMENTAL_SYNC_VERSION,
  INCREMENTAL_JOB_TYPE,
  SOURCE_TYPES,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_AFFECTED_SOURCES,
  assertIncrementalSql,
  createIncrementalRepository,
  runCustomerMasterIncrementalSync
};
