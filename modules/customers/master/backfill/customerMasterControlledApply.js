"use strict";

const {
  NORMALIZATION_VERSION
} = require("../normalization");
const {
  SOURCE_MODEL_VERSION,
  buildSourceRecord,
  stableStringify,
  sha256
} = require("./customerMasterSourceModel");
const {
  CANDIDATE_RULE_VERSION,
  sourceKey,
  buildCandidateGraph,
  buildCandidateClusters
} = require("./customerMasterCandidateBuilder");
const {
  CONFLICT_RULE_VERSION,
  detectCustomerMasterConflicts
} = require("./customerMasterConflictDetector");
const {
  ELIGIBILITY_RULE_VERSION,
  simulateEligibility
} = require("./customerMasterDryRunService");
const {
  buildCounts,
  buildConflictSummary
} = require("./customerMasterDryRunReport");
const {
  buildDryRunFingerprint
} = require("./customerMasterDryRunFingerprint");

const APPLY_SERVICE_VERSION = "customer-master-controlled-apply/v1";
const APPLY_JOB_TYPE = "CONTROLLED_BACKFILL_APPLY";
const RESULT_FINGERPRINT_VERSION = "customer-master-apply-result-fingerprint/v1";
const DEFAULT_BATCH_SIZE = 500;

const MASTER_ELIGIBILITY_STATUSES = Object.freeze(["NOT_EVALUATED", "REVIEW_REQUIRED"]);

function masterIdFor(candidateId) {
  return `cmr:${sha256(`customer-master-record/v1|${candidateId}`)}`;
}

function sourceLinkIdFor(sourceType, sourceId) {
  return `cms:${sha256(`customer-master-source/v1|${sourceType}:${sourceId}`)}`;
}

function identifierLookupHash(identifierType, canonicalValue) {
  return sha256(`customer-master-identifier-lookup/v1|${identifierType}|${canonicalValue}`);
}

function identifierIdFor(sourceLinkId, identifierType, lookupHash) {
  return `cmi:${sha256(`customer-master-identifier/v1|${sourceLinkId}|${identifierType}|${lookupHash}`)}`;
}

function conflictIdFor(conflict) {
  return `cic:${sha256(stableStringify({
    v: "customer-identity-conflict/v1",
    type: conflict.type,
    severity: conflict.severity,
    participants: conflict.participants,
    identifierType: conflict.evidence?.identifierType || null,
    maskedValues: conflict.evidence?.maskedValues || [],
    reasonCodes: conflict.reasonCodes,
    blocking: conflict.blocking === true,
    ruleVersion: conflict.ruleVersion
  }))}`;
}

function conflictParticipantIdFor(conflictId, participantType, participantId) {
  return `cip:${sha256(`customer-identity-conflict-participant/v1|${conflictId}|${participantType}|${participantId}`)}`;
}

function jobIdFor(jobType, inputFingerprint) {
  return `cmj:${sha256(`customer-master-job/v1|${jobType}|${inputFingerprint}`)}`;
}

function checkpointIdFor(sourceType) {
  return `cmk:${sha256(`customer-master-checkpoint/v1|${sourceType}`)}`;
}

function pickDisplayName(records, candidate) {
  const sourceRecords = candidate.recordIndexes
    .map((index) => records[index])
    .filter((record) => String(record.rawIdentity?.name || "").trim());
  if (!sourceRecords.length) return "";
  const sorted = [...sourceRecords].sort((a, b) => {
    const aTime = Date.parse(a.sourceUpdatedAt || "") || 0;
    const bTime = Date.parse(b.sourceUpdatedAt || "") || 0;
    if (aTime !== bTime) return bTime - aTime;
    return sourceKey(a).localeCompare(sourceKey(b));
  });
  return String(sorted[0].rawIdentity.name || "").trim();
}

function mapEligibility(candidate, records) {
  const simulated = candidate.simulatedEligibility || {};
  const reviewRequired = simulated.simulatedStatus !== "SIMULATED_ELIGIBLE_SUBJECT_TO_PHONE_VERIFICATION";
  const reasonCodes = new Set(simulated.reasonCodes || []);
  (simulated.blockingConflicts || []).forEach((type) => reasonCodes.add(`CONFLICT:${type}`));
  if (!reviewRequired) reasonCodes.add("NOT_EVALUATED_IN_PHASE_3_1_E");
  return {
    eligibility_status: reviewRequired ? "REVIEW_REQUIRED" : "NOT_EVALUATED",
    eligibility_reasons_json: stableStringify(Array.from(reasonCodes).sort())
  };
}

function buildCustomerMasterPersistencePlan(input = {}) {
  const records = input.records || [];
  const candidates = input.candidates || [];
  const conflicts = input.conflicts || [];
  const runAt = String(input.runAt || "");
  const inputFingerprint = String(input.inputFingerprint || "");
  const jobType = String(input.jobType || APPLY_JOB_TYPE);

  const sourceLinkIdByKey = new Map();
  const sources = records.map((record) => {
    if (!record.sourceId) {
      throw new Error("CUSTOMER_MASTER_APPLY_SOURCE_ID_MISSING");
    }
    const id = sourceLinkIdFor(record.sourceType, record.sourceId);
    sourceLinkIdByKey.set(sourceKey(record), id);
    return {
      id,
      master_id: null,
      source_type: record.sourceType,
      source_id: record.sourceId,
      source_updated_at: record.sourceUpdatedAt,
      imported_at: runAt,
      source_hash: record.sourceHash,
      status: record.sourceDeleted ? "DELETED" : record.sourceInactive ? "INACTIVE" : "ACTIVE",
      created_at: runAt,
      updated_at: runAt,
      revoked_at: null
    };
  });

  const masters = [];
  const masterIdByCandidateId = new Map();
  const sortedCandidates = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  for (const candidate of sortedCandidates) {
    const masterId = masterIdFor(candidate.id);
    masterIdByCandidateId.set(candidate.id, masterId);
    const eligibility = mapEligibility(candidate, records);
    masters.push({
      id: masterId,
      display_name: pickDisplayName(records, candidate),
      status: "PENDING",
      version: 1,
      eligibility_status: eligibility.eligibility_status,
      eligibility_reasons_json: eligibility.eligibility_reasons_json,
      eligibility_evaluated_at: null,
      eligibility_rule_version: ELIGIBILITY_RULE_VERSION,
      eligibility_source_version: SOURCE_MODEL_VERSION,
      created_at: runAt,
      updated_at: runAt,
      deleted_at: null
    });
    candidate.recordIndexes.forEach((recordIndex) => {
      const source = sources[recordIndex];
      source.master_id = masterId;
    });
  }

  const identifiers = [];
  records.forEach((record, recordIndex) => {
    const sourceLinkId = sources[recordIndex].id;
    const masterId = sources[recordIndex].master_id;
    const seenTypes = new Set();
    for (const identifier of record.normalizedIdentity.identifiers) {
      if (!identifier.canonicalValue) continue;
      if (identifier.classification === "EMPTY") continue;
      const lookupHash = identifierLookupHash(identifier.type, identifier.canonicalValue);
      const isPrimary = seenTypes.has(identifier.type) ? 0 : 1;
      seenTypes.add(identifier.type);
      identifiers.push({
        id: identifierIdFor(sourceLinkId, identifier.type, lookupHash),
        master_id: masterId,
        source_link_id: sourceLinkId,
        identifier_type: identifier.type,
        lookup_hash: lookupHash,
        masked_value: identifier.maskedValue || "",
        protected_value: identifier.canonicalValue,
        classification: identifier.classification,
        validation_status: identifier.valid ? "VALID" : "INVALID",
        verification_status: "NOT_VERIFIED",
        is_primary: isPrimary,
        is_active: 1,
        normalization_version: NORMALIZATION_VERSION,
        created_at: runAt,
        updated_at: runAt,
        revoked_at: null
      });
    }
  });

  const planConflicts = [];
  const participants = [];
  const seenConflictIds = new Set();
  const sortedConflicts = [...conflicts].sort((a, b) => (
    a.type.localeCompare(b.type) || a.participants.join("|").localeCompare(b.participants.join("|"))
  ));
  for (const conflict of sortedConflicts) {
    const id = conflictIdFor(conflict);
    if (seenConflictIds.has(id)) {
      throw new Error("CUSTOMER_MASTER_APPLY_CONFLICT_ID_COLLISION");
    }
    seenConflictIds.add(id);
    planConflicts.push({
      id,
      conflict_type: conflict.type,
      severity: conflict.severity,
      status: "OPEN",
      rule_version: CONFLICT_RULE_VERSION,
      evidence_json: stableStringify({
        identifierType: conflict.evidence?.identifierType || null,
        maskedValues: conflict.evidence?.maskedValues || [],
        participantCount: conflict.evidence?.participantCount || conflict.participants.length,
        sourceTypes: conflict.evidence?.sourceTypes || [],
        reasonCodes: [...conflict.reasonCodes].sort(),
        blocking: conflict.blocking === true
      }),
      resolution_type: null,
      resolution_reason: null,
      resolved_by: null,
      resolved_at: null,
      created_at: runAt,
      updated_at: runAt,
      reopened_at: null
    });
    for (const participant of conflict.participants) {
      const sourceLinkId = sourceLinkIdByKey.get(participant);
      if (!sourceLinkId) {
        throw new Error("CUSTOMER_MASTER_APPLY_CONFLICT_PARTICIPANT_UNKNOWN");
      }
      participants.push({
        id: conflictParticipantIdFor(id, "SOURCE", sourceLinkId),
        conflict_id: id,
        participant_type: "SOURCE",
        participant_id: sourceLinkId,
        role: "",
        created_at: runAt
      });
    }
  }

  const cursors = {};
  for (const record of records) {
    const current = cursors[record.sourceType] || { cursor_updated_at: null, cursor_source_id: null };
    const updatedAt = record.sourceUpdatedAt;
    const isNewer = updatedAt && (
      !current.cursor_updated_at
      || Date.parse(updatedAt) > Date.parse(current.cursor_updated_at)
      || (Date.parse(updatedAt) === Date.parse(current.cursor_updated_at)
        && String(record.sourceId) > String(current.cursor_source_id || ""))
    );
    if (isNewer) {
      cursors[record.sourceType] = {
        cursor_updated_at: updatedAt,
        cursor_source_id: String(record.sourceId)
      };
    } else if (!cursors[record.sourceType]) {
      cursors[record.sourceType] = current;
    }
  }

  const jobId = jobIdFor(jobType, inputFingerprint);
  const checkpoints = Object.keys(cursors).sort().map((sourceType) => ({
    id: checkpointIdFor(sourceType),
    source_type: sourceType,
    cursor_updated_at: cursors[sourceType].cursor_updated_at,
    cursor_source_id: cursors[sourceType].cursor_source_id,
    last_job_id: jobId,
    status: "COMPLETED",
    created_at: runAt,
    updated_at: runAt
  }));

  return {
    jobId,
    jobType,
    inputFingerprint,
    masters,
    sources,
    identifiers,
    conflicts: planConflicts,
    participants,
    checkpoints
  };
}

function buildResultFingerprintFromState(state) {
  const sort = (rows, map) => rows.map(map).sort((a, b) => a[0].localeCompare(b[0]));
  const payload = {
    resultFingerprintVersion: RESULT_FINGERPRINT_VERSION,
    masters: sort(state.masters || [], (row) => [
      row.id, row.status, row.eligibility_status, row.eligibility_reasons_json, row.display_name
    ]),
    sources: sort(state.sources || [], (row) => [
      row.id, row.master_id, row.source_type, row.source_id, row.source_hash, row.status
    ]),
    identifiers: sort(state.identifiers || [], (row) => [
      row.id, row.master_id, row.source_link_id, row.identifier_type, row.lookup_hash,
      row.classification, row.validation_status, String(row.is_primary), String(row.is_active)
    ]),
    conflicts: sort(state.conflicts || [], (row) => [
      row.id, row.conflict_type, row.severity, row.status, row.rule_version, row.evidence_json
    ]),
    participants: sort(state.participants || [], (row) => [
      row.id, row.conflict_id, row.participant_type, row.participant_id, row.role
    ]),
    checkpoints: sort(state.checkpoints || [], (row) => [
      row.id, row.source_type, row.cursor_updated_at, row.cursor_source_id, row.status
    ])
  };
  return sha256(stableStringify(payload));
}

function planToResultState(plan) {
  return {
    masters: plan.masters,
    sources: plan.sources,
    identifiers: plan.identifiers,
    conflicts: plan.conflicts,
    participants: plan.participants,
    checkpoints: plan.checkpoints
  };
}

async function readResultStateFromDatabase(db) {
  return {
    masters: await db.all(
      `SELECT id, status, eligibility_status, eligibility_reasons_json, display_name
       FROM customer_master_records`
    ),
    sources: await db.all(
      `SELECT id, master_id, source_type, source_id, source_hash, status
       FROM customer_master_sources`
    ),
    identifiers: await db.all(
      `SELECT id, master_id, source_link_id, identifier_type, lookup_hash,
              classification, validation_status, is_primary, is_active
       FROM customer_master_identifiers`
    ),
    conflicts: await db.all(
      `SELECT id, conflict_type, severity, status, rule_version, evidence_json
       FROM customer_identity_conflicts`
    ),
    participants: await db.all(
      `SELECT id, conflict_id, participant_type, participant_id, role
       FROM customer_identity_conflict_participants`
    ),
    checkpoints: await db.all(
      `SELECT id, source_type, cursor_updated_at, cursor_source_id, status
       FROM customer_master_sync_checkpoints`
    )
  };
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function runInTransaction(db, statements) {
  await db.run("BEGIN IMMEDIATE");
  try {
    for (const statement of statements) {
      await statement();
    }
    await db.run("COMMIT");
  } catch (error) {
    await db.run("ROLLBACK").catch(() => null);
    throw error;
  }
}

function createEmptyApplyStats() {
  return {
    batches: 0,
    mastersCreated: 0,
    mastersUnchanged: 0,
    sourcesCreated: 0,
    sourcesUpdated: 0,
    sourcesUnchanged: 0,
    identifiersCreated: 0,
    identifiersUnchanged: 0,
    conflictsCreated: 0,
    conflictsUnchanged: 0,
    participantsCreated: 0,
    participantsUnchanged: 0,
    checkpointsCreated: 0,
    checkpointsUpdated: 0,
    checkpointsUnchanged: 0,
    failures: 0
  };
}

async function executeCustomerMasterPersistencePlan(db, plan, options = {}) {
  const batchSize = Math.max(1, Math.trunc(Number(options.batchSize) || DEFAULT_BATCH_SIZE));
  const stats = createEmptyApplyStats();
  const runAt = String(options.runAt || new Date().toISOString());
  const failAfterBatches = Number.isFinite(Number(options.failAfterBatches))
    ? Number(options.failAfterBatches)
    : null;

  async function updateCheckpoint(phase, batchIndex) {
    await db.run(
      `UPDATE customer_master_jobs
       SET checkpoint_json = ?, updated_at = ?
       WHERE id = ?`,
      [stableStringify({ phase, batchIndex }), runAt, plan.jobId]
    );
  }

  function guardPoint(phase, batchIndex) {
    if (failAfterBatches !== null && stats.batches >= failAfterBatches) {
      throw new Error(`CUSTOMER_MASTER_APPLY_INJECTED_FAILURE:${phase}:${batchIndex}`);
    }
  }

  await runInTransaction(db, [async () => {
    await db.run(
      `INSERT OR IGNORE INTO customer_master_jobs
        (id, job_type, status, code_version, schema_version, fingerprint,
         counts_json, checkpoint_json, started_at, finished_at, created_by,
         error_code, error_summary, created_at, updated_at)
       VALUES (?, ?, 'RUNNING', ?, ?, ?, '{}', '{}', ?, NULL, ?, '', '', ?, ?)`,
      [
        plan.jobId, plan.jobType, String(options.codeVersion || "LOCAL_UNCOMMITTED"),
        String(options.schemaVersion || "customer-master-schema/v1"), plan.inputFingerprint,
        runAt, APPLY_SERVICE_VERSION, runAt, runAt
      ]
    );
    await db.run(
      `UPDATE customer_master_jobs
       SET status = 'RUNNING', started_at = COALESCE(started_at, ?), updated_at = ?
       WHERE id = ?`,
      [runAt, runAt, plan.jobId]
    );
  }]);

  const masterBatches = chunk(plan.masters, batchSize);
  for (let batchIndex = 0; batchIndex < masterBatches.length; batchIndex += 1) {
    guardPoint("MASTERS", batchIndex);
    const batch = masterBatches[batchIndex];
    await runInTransaction(db, batch.map((row) => async () => {
      const created = await db.insertOrIgnore(
        `INSERT OR IGNORE INTO customer_master_records
          (id, display_name, status, version, eligibility_status, eligibility_reasons_json,
           eligibility_evaluated_at, eligibility_rule_version, eligibility_source_version,
           created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, row.display_name, row.status, row.version, row.eligibility_status,
          row.eligibility_reasons_json, row.eligibility_evaluated_at,
          row.eligibility_rule_version, row.eligibility_source_version,
          row.created_at, row.updated_at, row.deleted_at
        ]
      );
      if (created) stats.mastersCreated += 1;
      else stats.mastersUnchanged += 1;
    }).concat([async () => {
      stats.batches += 1;
      await updateCheckpoint("MASTERS", batchIndex);
    }]));
  }

  const sourceBatches = chunk(plan.sources, batchSize);
  for (let batchIndex = 0; batchIndex < sourceBatches.length; batchIndex += 1) {
    guardPoint("SOURCES", batchIndex);
    const batch = sourceBatches[batchIndex];
    await runInTransaction(db, batch.map((row) => async () => {
      const created = await db.insertOrIgnore(
        `INSERT OR IGNORE INTO customer_master_sources
          (id, master_id, source_type, source_id, source_updated_at, imported_at,
           source_hash, status, created_at, updated_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, row.master_id, row.source_type, row.source_id, row.source_updated_at,
          row.imported_at, row.source_hash, row.status, row.created_at, row.updated_at,
          row.revoked_at
        ]
      );
      if (created) {
        stats.sourcesCreated += 1;
        return;
      }
      const updated = await db.run(
        `UPDATE customer_master_sources
         SET source_updated_at = ?, source_hash = ?, status = ?, updated_at = ?
         WHERE id = ? AND (source_hash <> ? OR status <> ?)`,
        [
          row.source_updated_at, row.source_hash, row.status, runAt,
          row.id, row.source_hash, row.status
        ]
      );
      if (Number(updated?.changes || 0) > 0) stats.sourcesUpdated += 1;
      else stats.sourcesUnchanged += 1;
    }).concat([async () => {
      stats.batches += 1;
      await updateCheckpoint("SOURCES", batchIndex);
    }]));
  }

  const identifierBatches = chunk(plan.identifiers, batchSize);
  for (let batchIndex = 0; batchIndex < identifierBatches.length; batchIndex += 1) {
    guardPoint("IDENTIFIERS", batchIndex);
    const batch = identifierBatches[batchIndex];
    await runInTransaction(db, batch.map((row) => async () => {
      const created = await db.insertOrIgnore(
        `INSERT OR IGNORE INTO customer_master_identifiers
          (id, master_id, source_link_id, identifier_type, lookup_hash, masked_value,
           protected_value, classification, validation_status, verification_status,
           is_primary, is_active, normalization_version, created_at, updated_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, row.master_id, row.source_link_id, row.identifier_type, row.lookup_hash,
          row.masked_value, row.protected_value, row.classification, row.validation_status,
          row.verification_status, row.is_primary, row.is_active, row.normalization_version,
          row.created_at, row.updated_at, row.revoked_at
        ]
      );
      if (created) stats.identifiersCreated += 1;
      else stats.identifiersUnchanged += 1;
    }).concat([async () => {
      stats.batches += 1;
      await updateCheckpoint("IDENTIFIERS", batchIndex);
    }]));
  }

  const conflictBatches = chunk(plan.conflicts, batchSize);
  for (let batchIndex = 0; batchIndex < conflictBatches.length; batchIndex += 1) {
    guardPoint("CONFLICTS", batchIndex);
    const batch = conflictBatches[batchIndex];
    await runInTransaction(db, batch.map((row) => async () => {
      const created = await db.insertOrIgnore(
        `INSERT OR IGNORE INTO customer_identity_conflicts
          (id, conflict_type, severity, status, rule_version, evidence_json,
           resolution_type, resolution_reason, resolved_by, resolved_at,
           created_at, updated_at, reopened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, row.conflict_type, row.severity, row.status, row.rule_version,
          row.evidence_json, row.resolution_type, row.resolution_reason, row.resolved_by,
          row.resolved_at, row.created_at, row.updated_at, row.reopened_at
        ]
      );
      if (created) stats.conflictsCreated += 1;
      else stats.conflictsUnchanged += 1;
    }).concat([async () => {
      stats.batches += 1;
      await updateCheckpoint("CONFLICTS", batchIndex);
    }]));
  }

  const participantBatches = chunk(plan.participants, batchSize);
  for (let batchIndex = 0; batchIndex < participantBatches.length; batchIndex += 1) {
    guardPoint("PARTICIPANTS", batchIndex);
    const batch = participantBatches[batchIndex];
    await runInTransaction(db, batch.map((row) => async () => {
      const created = await db.insertOrIgnore(
        `INSERT OR IGNORE INTO customer_identity_conflict_participants
          (id, conflict_id, participant_type, participant_id, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [row.id, row.conflict_id, row.participant_type, row.participant_id, row.role, row.created_at]
      );
      if (created) stats.participantsCreated += 1;
      else stats.participantsUnchanged += 1;
    }).concat([async () => {
      stats.batches += 1;
      await updateCheckpoint("PARTICIPANTS", batchIndex);
    }]));
  }

  await runInTransaction(db, plan.checkpoints.map((row) => async () => {
    const created = await db.insertOrIgnore(
      `INSERT OR IGNORE INTO customer_master_sync_checkpoints
        (id, source_type, cursor_updated_at, cursor_source_id, last_job_id,
         status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.source_type, row.cursor_updated_at, row.cursor_source_id,
        row.last_job_id, row.status, row.created_at, row.updated_at
      ]
    );
    if (created) {
      stats.checkpointsCreated += 1;
      return;
    }
    const updated = await db.run(
      `UPDATE customer_master_sync_checkpoints
       SET cursor_updated_at = ?, cursor_source_id = ?, last_job_id = ?, status = ?, updated_at = ?
       WHERE id = ?
         AND (cursor_updated_at IS NOT ? OR cursor_source_id IS NOT ?
              OR last_job_id <> ? OR status <> ?)`,
      [
        row.cursor_updated_at, row.cursor_source_id, row.last_job_id, row.status, runAt,
        row.id, row.cursor_updated_at, row.cursor_source_id, row.last_job_id, row.status
      ]
    );
    if (Number(updated?.changes || 0) > 0) stats.checkpointsUpdated += 1;
    else stats.checkpointsUnchanged += 1;
  }));

  return stats;
}

async function finalizeCustomerMasterApplyJob(db, plan, finalize) {
  await runInTransaction(db, [async () => {
    await db.run(
      `UPDATE customer_master_jobs
       SET status = ?, counts_json = ?, checkpoint_json = ?, finished_at = ?,
           error_code = ?, error_summary = ?, updated_at = ?
       WHERE id = ?`,
      [
        String(finalize.status || "COMPLETED"),
        stableStringify(finalize.counts || {}),
        stableStringify(finalize.checkpoint || {}),
        String(finalize.finishedAt || new Date().toISOString()),
        String(finalize.errorCode || ""),
        String(finalize.errorSummary || ""),
        String(finalize.finishedAt || new Date().toISOString()),
        plan.jobId
      ]
    );
  }]);
}

async function computeCustomerMasterApplyInput(reader, options = {}) {
  const limits = options.limits;
  if (!limits) throw new Error("CUSTOMER_MASTER_APPLY_LIMITS_REQUIRED");
  const schema = await reader.getSourceSchemaSummary();
  if (!schema?.contacts?.exists || !schema?.crm_contacts?.exists) {
    throw new Error("SOURCE_SCHEMA_UNAVAILABLE");
  }
  const sourceCounts = {
    contacts: Number(await reader.countContacts() || 0),
    crm_contacts: Number(await reader.countCrmContacts() || 0)
  };
  const total = sourceCounts.contacts + sourceCounts.crm_contacts;
  if (total > limits.maxRecords) {
    throw new Error("SOURCE_RECORD_LIMIT_EXCEEDED");
  }
  const pageCounts = { contacts: 0, crm_contacts: 0 };
  async function readAll(sourceType, count) {
    const rows = [];
    const method = sourceType === "contacts" ? "readContactsPage" : "readCrmContactsPage";
    for (let offset = 0; offset < count; offset += limits.pageSize) {
      const page = await reader[method]({ limit: limits.pageSize, offset });
      pageCounts[sourceType] += 1;
      rows.push(...page);
      if (page.length === 0) break;
    }
    return rows;
  }
  const contactRows = await readAll("contacts", sourceCounts.contacts);
  const crmContactRows = await readAll("crm_contacts", sourceCounts.crm_contacts);
  if (contactRows.length !== sourceCounts.contacts || crmContactRows.length !== sourceCounts.crm_contacts) {
    throw new Error("SOURCE_COUNT_CHANGED_DURING_READ");
  }
  const records = [
    ...contactRows.map((row) => buildSourceRecord("contacts", row)),
    ...crmContactRows.map((row) => buildSourceRecord("crm_contacts", row))
  ];
  const graph = buildCandidateGraph(records, { maxClusterSize: limits.maxClusterSize });
  if (graph.oversizedBuckets.length) {
    throw new Error("CLUSTER_SIZE_LIMIT_EXCEEDED");
  }
  const candidates = buildCandidateClusters(records, graph);
  const oversizedCandidate = candidates.find((candidate) => (
    candidate.recordIndexes.length > limits.maxClusterSize
  ));
  if (oversizedCandidate) {
    throw new Error("CLUSTER_SIZE_LIMIT_EXCEEDED");
  }
  const detection = detectCustomerMasterConflicts(records, graph, candidates, options.conflictOptions);
  const conflicts = detection.conflicts;
  const conflictSummary = buildConflictSummary(conflicts, limits.maxConflicts);
  simulateEligibility(records, candidates, conflicts);
  const counts = buildCounts(records, candidates, conflicts, sourceCounts, pageCounts);
  const fingerprint = buildDryRunFingerprint({
    codeVersion: String(options.codeVersion || "LOCAL_UNCOMMITTED"),
    normalizationVersion: NORMALIZATION_VERSION,
    candidateRuleVersion: CANDIDATE_RULE_VERSION,
    conflictRuleVersion: CONFLICT_RULE_VERSION,
    eligibilityRuleVersion: ELIGIBILITY_RULE_VERSION,
    sources: records,
    candidates,
    conflictSummary,
    counts
  });
  return {
    records,
    candidates,
    conflicts,
    counts,
    sourceCounts,
    pageCounts,
    conflictSummary,
    fingerprint,
    versions: {
      applyService: APPLY_SERVICE_VERSION,
      normalization: NORMALIZATION_VERSION,
      candidates: CANDIDATE_RULE_VERSION,
      conflicts: CONFLICT_RULE_VERSION,
      eligibility: ELIGIBILITY_RULE_VERSION,
      resultFingerprint: RESULT_FINGERPRINT_VERSION
    }
  };
}

async function verifyCustomerMasterApplyState(db, plan) {
  const state = await readResultStateFromDatabase(db);
  const resultFingerprint = buildResultFingerprintFromState(state);
  const expectedFingerprint = buildResultFingerprintFromState(planToResultState(plan));
  const ids = (rows) => new Set(rows.map((row) => row.id));
  const compare = (name, planned, persisted) => {
    const plannedIds = ids(planned);
    const persistedIds = ids(persisted);
    const missing = [...plannedIds].filter((id) => !persistedIds.has(id));
    const unexpected = [...persistedIds].filter((id) => !plannedIds.has(id));
    return {
      table: name,
      planned: planned.length,
      persisted: persisted.length,
      missing: missing.length,
      unexpected: unexpected.length
    };
  };
  const tables = [
    compare("customer_master_records", plan.masters, state.masters),
    compare("customer_master_sources", plan.sources, state.sources),
    compare("customer_master_identifiers", plan.identifiers, state.identifiers),
    compare("customer_identity_conflicts", plan.conflicts, state.conflicts),
    compare("customer_identity_conflict_participants", plan.participants, state.participants),
    compare("customer_master_sync_checkpoints", plan.checkpoints, state.checkpoints)
  ];
  const hashById = new Map(state.sources.map((row) => [row.id, row.source_hash]));
  const sourceHashMismatches = plan.sources.filter((row) => (
    hashById.has(row.id) && hashById.get(row.id) !== row.source_hash
  )).length;
  const duplicateSourceLinks = Number((await db.get(
    `SELECT COUNT(*) AS total FROM (
       SELECT source_type, source_id FROM customer_master_sources
       GROUP BY source_type, source_id HAVING COUNT(*) > 1
     )`
  ))?.total || 0);
  const releasedCustomers = Number((await db.get(
    `SELECT COUNT(*) AS total FROM customer_master_records
     WHERE eligibility_status NOT IN ('NOT_EVALUATED', 'REVIEW_REQUIRED')`
  ))?.total || 0);
  const mergeHistoryRows = Number((await db.get(
    "SELECT COUNT(*) AS total FROM customer_master_merge_history"
  ))?.total || 0);
  const blockingPersisted = Number((await db.get(
    `SELECT COUNT(*) AS total FROM customer_identity_conflicts
     WHERE json_extract(evidence_json, '$.blocking') = 1`
  ))?.total || 0);
  return {
    tables,
    sourceHashMismatches,
    duplicateSourceLinks,
    releasedCustomers,
    mergeHistoryRows,
    blockingConflictsPersisted: blockingPersisted,
    resultFingerprint,
    expectedResultFingerprint: expectedFingerprint,
    resultFingerprintMatch: resultFingerprint === expectedFingerprint,
    consistent: tables.every((table) => table.missing === 0 && table.unexpected === 0)
      && sourceHashMismatches === 0
      && duplicateSourceLinks === 0
      && releasedCustomers === 0
      && mergeHistoryRows === 0
      && resultFingerprint === expectedFingerprint
  };
}

module.exports = {
  APPLY_SERVICE_VERSION,
  APPLY_JOB_TYPE,
  RESULT_FINGERPRINT_VERSION,
  DEFAULT_BATCH_SIZE,
  MASTER_ELIGIBILITY_STATUSES,
  masterIdFor,
  sourceLinkIdFor,
  identifierLookupHash,
  conflictIdFor,
  jobIdFor,
  checkpointIdFor,
  buildCustomerMasterPersistencePlan,
  buildResultFingerprintFromState,
  planToResultState,
  readResultStateFromDatabase,
  executeCustomerMasterPersistencePlan,
  finalizeCustomerMasterApplyJob,
  computeCustomerMasterApplyInput,
  verifyCustomerMasterApplyState
};
