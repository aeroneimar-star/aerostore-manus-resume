"use strict";

const {
  stableStringify,
  sha256
} = require("../backfill/customerMasterSourceModel");

const CASE_GROUPING_VERSION = "customer-identity-case-grouping/v1";
const CASE_SERVICE_VERSION = "customer-identity-case-service/v1";
const CASE_RESULT_FINGERPRINT_VERSION = "customer-identity-case-result/v1";
const DEFAULT_BATCH_SIZE = 500;

const QUEUES = Object.freeze([
  "IDENTITY_ELIGIBILITY",
  "DATA_HYGIENE",
  "HISTORICAL"
]);
const STATUSES = Object.freeze(["OPEN", "UNDER_REVIEW", "RESOLVED", "ARCHIVED", "REOPENED"]);
const PRIORITIES = Object.freeze(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
const HISTORICAL_TYPES = new Set(["DELETED_SOURCE", "INACTIVE_SOURCE"]);
const PHONE_COMPOSITE_TYPES = new Set([
  "PHONE_DUPLICATE",
  "PHONE_SHARED",
  "MULTIPLE_ELIGIBLE_CUSTOMERS"
]);
const CPF_HYGIENE_TYPES = new Set(["CPF_INVALID", "CPF_DUPLICATE"]);
const PRIORITY_RANK = new Map(PRIORITIES.map((priority, index) => [priority, index]));

function parseBlocking(evidenceJson) {
  try {
    return JSON.parse(String(evidenceJson || "{}")).blocking === true;
  } catch {
    return false;
  }
}

function increment(target, key) {
  target[key] = Number(target[key] || 0) + 1;
}

function sortedObject(input) {
  return Object.fromEntries(
    Object.entries(input).sort((a, b) => a[0].localeCompare(b[0]))
  );
}

function highestPriority(conflicts) {
  return conflicts
    .map((conflict) => String(conflict.severity || "LOW"))
    .filter((severity) => PRIORITY_RANK.has(severity))
    .sort((a, b) => PRIORITY_RANK.get(a) - PRIORITY_RANK.get(b))[0] || "LOW";
}

function chooseQueue(conflicts) {
  const types = conflicts.map((conflict) => String(conflict.conflict_type || ""));
  if (types.length > 0 && types.every((type) => HISTORICAL_TYPES.has(type))) {
    return "HISTORICAL";
  }
  if (conflicts.some((conflict) => parseBlocking(conflict.evidence_json))) {
    return "IDENTITY_ELIGIBILITY";
  }
  return "DATA_HYGIENE";
}

function chooseCaseType(conflicts, queueType) {
  const types = new Set(conflicts.map((conflict) => String(conflict.conflict_type || "")));
  if (queueType === "HISTORICAL") return "HISTORICAL_SOURCE_STATE";
  if ([...PHONE_COMPOSITE_TYPES].every((type) => types.has(type))) {
    return "PHONE_IDENTITY_COMPOSITE";
  }
  if (queueType === "IDENTITY_ELIGIBILITY") return "IDENTITY_ELIGIBILITY";
  if ([...types].every((type) => CPF_HYGIENE_TYPES.has(type))) return "CPF_DATA_HYGIENE";
  return "DATA_HYGIENE";
}

function conflictStateFingerprint(conflicts, participants) {
  const conflictRows = [...conflicts]
    .map((row) => ({ ...row }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const participantRows = [...participants]
    .map((row) => ({ ...row }))
    .sort((a, b) => (
      String(a.conflict_id).localeCompare(String(b.conflict_id))
      || String(a.participant_type).localeCompare(String(b.participant_type))
      || String(a.participant_id).localeCompare(String(b.participant_id))
      || String(a.id || "").localeCompare(String(b.id || ""))
    ));
  return sha256(stableStringify({
    version: "customer-identity-conflict-state/v1",
    conflicts: conflictRows,
    participants: participantRows
  }));
}

function buildCustomerIdentityCasePlan(input = {}) {
  const conflicts = Array.isArray(input.conflicts) ? input.conflicts : [];
  const participants = Array.isArray(input.participants) ? input.participants : [];
  const sourceLinks = Array.isArray(input.sourceLinks) ? input.sourceLinks : [];
  const runAt = String(input.runAt || "");

  const conflictsById = new Map();
  for (const conflict of conflicts) {
    const id = String(conflict.id || "");
    if (!id || conflictsById.has(id)) {
      throw new Error("CUSTOMER_IDENTITY_CASE_CONFLICT_ID_INVALID");
    }
    conflictsById.set(id, conflict);
  }

  const participantsByConflict = new Map();
  for (const participant of participants) {
    const conflictId = String(participant.conflict_id || "");
    if (!conflictsById.has(conflictId)) {
      throw new Error("CUSTOMER_IDENTITY_CASE_PARTICIPANT_ORPHAN");
    }
    if (!participantsByConflict.has(conflictId)) participantsByConflict.set(conflictId, []);
    participantsByConflict.get(conflictId).push(participant);
  }

  const sourceLinkById = new Map(
    sourceLinks.map((link) => [String(link.id || ""), link])
  );
  const buckets = new Map();

  for (const conflict of conflicts) {
    const conflictId = String(conflict.id);
    const participantKeys = (participantsByConflict.get(conflictId) || [])
      .map((row) => `${String(row.participant_type || "")}:${String(row.participant_id || "")}`)
      .sort();
    const bucketKey = participantKeys.length
      ? `PARTICIPANTS|${participantKeys.join("|")}`
      : `CONSERVATIVE_SINGLE|${conflictId}`;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, { bucketKey, participantKeys, conflicts: [] });
    }
    buckets.get(bucketKey).conflicts.push(conflict);
  }

  const cases = [];
  const caseConflicts = [];
  const caseEntities = [];
  const events = [];
  const affectedMasterIds = new Set();
  const affectedSourceIds = new Set();

  for (const bucket of [...buckets.values()].sort((a, b) => a.bucketKey.localeCompare(b.bucketKey))) {
    const bucketConflicts = [...bucket.conflicts].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const conflictTypes = {};
    const severities = {};
    const sourceIds = new Set();
    const masterIds = new Set();

    for (const conflict of bucketConflicts) {
      increment(conflictTypes, String(conflict.conflict_type || "UNKNOWN"));
      increment(severities, String(conflict.severity || "LOW"));
      for (const participant of participantsByConflict.get(String(conflict.id)) || []) {
        if (String(participant.participant_type) !== "SOURCE") continue;
        const sourceId = String(participant.participant_id || "");
        if (!sourceId) continue;
        sourceIds.add(sourceId);
        const masterId = String(sourceLinkById.get(sourceId)?.master_id || "");
        if (masterId) masterIds.add(masterId);
      }
    }

    const queueType = chooseQueue(bucketConflicts);
    const caseType = chooseCaseType(bucketConflicts, queueType);
    const priority = highestPriority(bucketConflicts);
    const blocking = bucketConflicts.some((conflict) => parseBlocking(conflict.evidence_json));
    const fingerprint = sha256(stableStringify({
      groupingVersion: CASE_GROUPING_VERSION,
      participantKeys: bucket.participantKeys,
      conflicts: bucketConflicts.map((conflict) => ({
        id: String(conflict.id),
        type: String(conflict.conflict_type || ""),
        severity: String(conflict.severity || ""),
        blocking: parseBlocking(conflict.evidence_json)
      })),
      queueType,
      caseType
    }));
    const caseId = `cicase:${fingerprint}`;
    const summary = {
      summaryVersion: "customer-identity-case-summary/v1",
      queueType,
      caseType,
      priority,
      blocking,
      conflictCount: bucketConflicts.length,
      masterCount: masterIds.size,
      sourceCount: sourceIds.size,
      conflictTypes: sortedObject(conflictTypes),
      severities: sortedObject(severities),
      composite: bucketConflicts.length > 1
    };

    cases.push({
      id: caseId,
      case_type: caseType,
      queue_type: queueType,
      status: "OPEN",
      priority,
      blocking: blocking ? 1 : 0,
      fingerprint,
      grouping_version: CASE_GROUPING_VERSION,
      conflict_count: bucketConflicts.length,
      master_count: masterIds.size,
      source_count: sourceIds.size,
      summary_json: stableStringify(summary),
      created_at: runAt,
      updated_at: runAt,
      resolved_at: null,
      archived_at: null
    });

    for (const conflict of bucketConflicts) {
      caseConflicts.push({
        case_id: caseId,
        conflict_id: String(conflict.id),
        role: "EVIDENCE",
        created_at: runAt
      });
    }
    for (const masterId of [...masterIds].sort()) {
      affectedMasterIds.add(masterId);
      caseEntities.push({
        case_id: caseId,
        entity_type: "MASTER",
        entity_id: masterId,
        role: "AFFECTED_MASTER",
        created_at: runAt
      });
    }
    for (const sourceId of [...sourceIds].sort()) {
      affectedSourceIds.add(sourceId);
      caseEntities.push({
        case_id: caseId,
        entity_type: "SOURCE",
        entity_id: sourceId,
        role: "AFFECTED_SOURCE",
        created_at: runAt
      });
    }
    events.push({
      id: `cice:${sha256(`${CASE_GROUPING_VERSION}|${caseId}|CREATED`)}`,
      case_id: caseId,
      event_type: "CREATED",
      actor_user_id: null,
      reason: "CONTROLLED_BACKFILL_PHASE_3_1_F_2",
      before_json: "{}",
      after_json: stableStringify({
        status: "OPEN",
        queueType,
        priority,
        blocking,
        conflictCount: bucketConflicts.length
      }),
      created_at: runAt
    });
  }

  const byQueue = {};
  const byPriority = {};
  let compositeCases = 0;
  for (const row of cases) {
    increment(byQueue, row.queue_type);
    increment(byPriority, row.priority);
    if (row.conflict_count > 1) compositeCases += 1;
  }
  const stats = {
    totalCases: cases.length,
    byQueue: Object.fromEntries(QUEUES.map((queue) => [queue, Number(byQueue[queue] || 0)])),
    byPriority: Object.fromEntries(PRIORITIES.map((priority) => [priority, Number(byPriority[priority] || 0)])),
    linkedConflicts: caseConflicts.length,
    affectedMasters: affectedMasterIds.size,
    affectedSources: affectedSourceIds.size,
    compositeCases,
    individualCases: cases.length - compositeCases,
    caseEntityLinks: caseEntities.length,
    creationEvents: events.length
  };
  const planFingerprint = sha256(stableStringify({
    version: "customer-identity-case-plan/v1",
    codeVersion: String(input.codeVersion || "LOCAL_UNCOMMITTED"),
    groupingVersion: CASE_GROUPING_VERSION,
    cases: cases.map((row) => [
      row.id, row.case_type, row.queue_type, row.status, row.priority, row.blocking,
      row.fingerprint, row.conflict_count, row.master_count, row.source_count, row.summary_json
    ]),
    conflictLinks: caseConflicts.map((row) => [row.case_id, row.conflict_id, row.role]),
    entityLinks: caseEntities.map((row) => [row.case_id, row.entity_type, row.entity_id, row.role])
  }));

  return {
    version: CASE_SERVICE_VERSION,
    groupingVersion: CASE_GROUPING_VERSION,
    codeVersion: String(input.codeVersion || "LOCAL_UNCOMMITTED"),
    planFingerprint,
    originalConflictFingerprint: conflictStateFingerprint(conflicts, participants),
    cases,
    caseConflicts,
    caseEntities,
    events,
    stats
  };
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function runInTransaction(db, operations) {
  await db.run("BEGIN IMMEDIATE");
  try {
    for (const operation of operations) await operation();
    await db.run("COMMIT");
  } catch (error) {
    await db.run("ROLLBACK").catch(() => null);
    throw error;
  }
}

async function executeCustomerIdentityCasePlan(db, plan, options = {}) {
  const batchSize = Math.max(1, Math.trunc(Number(options.batchSize) || DEFAULT_BATCH_SIZE));
  const stats = {
    batches: 0,
    casesCreated: 0,
    casesUnchanged: 0,
    conflictLinksCreated: 0,
    conflictLinksUnchanged: 0,
    entityLinksCreated: 0,
    entityLinksUnchanged: 0,
    eventsCreated: 0,
    eventsUnchanged: 0
  };

  const groups = [
    {
      rows: plan.cases,
      insert: (row) => db.insertOrIgnore(
        `INSERT OR IGNORE INTO customer_identity_cases
          (id, case_type, queue_type, status, priority, blocking, fingerprint,
           grouping_version, conflict_count, master_count, source_count, summary_json,
           created_at, updated_at, resolved_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, row.case_type, row.queue_type, row.status, row.priority, row.blocking,
          row.fingerprint, row.grouping_version, row.conflict_count, row.master_count,
          row.source_count, row.summary_json, row.created_at, row.updated_at,
          row.resolved_at, row.archived_at
        ]
      ),
      created: "casesCreated",
      unchanged: "casesUnchanged"
    },
    {
      rows: plan.caseConflicts,
      insert: (row) => db.insertOrIgnore(
        `INSERT OR IGNORE INTO customer_identity_case_conflicts
          (case_id, conflict_id, role, created_at) VALUES (?, ?, ?, ?)`,
        [row.case_id, row.conflict_id, row.role, row.created_at]
      ),
      created: "conflictLinksCreated",
      unchanged: "conflictLinksUnchanged"
    },
    {
      rows: plan.caseEntities,
      insert: (row) => db.insertOrIgnore(
        `INSERT OR IGNORE INTO customer_identity_case_entities
          (case_id, entity_type, entity_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
        [row.case_id, row.entity_type, row.entity_id, row.role, row.created_at]
      ),
      created: "entityLinksCreated",
      unchanged: "entityLinksUnchanged"
    },
    {
      rows: plan.events,
      insert: (row) => db.insertOrIgnore(
        `INSERT OR IGNORE INTO customer_identity_case_events
          (id, case_id, event_type, actor_user_id, reason, before_json, after_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, row.case_id, row.event_type, row.actor_user_id, row.reason,
          row.before_json, row.after_json, row.created_at
        ]
      ),
      created: "eventsCreated",
      unchanged: "eventsUnchanged"
    }
  ];

  for (const group of groups) {
    for (const batch of chunk(group.rows, batchSize)) {
      await runInTransaction(db, batch.map((row) => async () => {
        const created = await group.insert(row);
        stats[created ? group.created : group.unchanged] += 1;
      }));
      stats.batches += 1;
    }
  }
  return stats;
}

async function readCustomerIdentityCaseState(db) {
  return {
    cases: await db.all(
      `SELECT id, case_type, queue_type, status, priority, blocking, fingerprint,
              grouping_version, conflict_count, master_count, source_count, summary_json
       FROM customer_identity_cases`
    ),
    conflictLinks: await db.all(
      "SELECT case_id, conflict_id, role FROM customer_identity_case_conflicts"
    ),
    entityLinks: await db.all(
      "SELECT case_id, entity_type, entity_id, role FROM customer_identity_case_entities"
    ),
    events: await db.all(
      "SELECT id, case_id, event_type, actor_user_id, reason, before_json, after_json FROM customer_identity_case_events"
    )
  };
}

function resultFingerprint(state) {
  const sort = (rows, mapper) => rows.map(mapper).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  return sha256(stableStringify({
    version: CASE_RESULT_FINGERPRINT_VERSION,
    cases: sort(state.cases || [], (row) => [
      row.id, row.case_type, row.queue_type, row.status, row.priority, Number(row.blocking),
      row.fingerprint, row.grouping_version, Number(row.conflict_count),
      Number(row.master_count), Number(row.source_count), row.summary_json
    ]),
    conflictLinks: sort(state.conflictLinks || [], (row) => [row.case_id, row.conflict_id, row.role]),
    entityLinks: sort(state.entityLinks || [], (row) => [
      row.case_id, row.entity_type, row.entity_id, row.role
    ]),
    events: sort(state.events || [], (row) => [
      row.id, row.case_id, row.event_type, row.actor_user_id, row.reason,
      row.before_json, row.after_json
    ])
  }));
}

function planAsResultState(plan) {
  return {
    cases: plan.cases,
    conflictLinks: plan.caseConflicts,
    entityLinks: plan.caseEntities,
    events: plan.events
  };
}

async function verifyCustomerIdentityCasePlan(db, plan) {
  const state = await readCustomerIdentityCaseState(db);
  const compareIds = (planned, persisted, key) => {
    const expected = new Set(planned.map(key));
    const actual = new Set(persisted.map(key));
    return {
      planned: expected.size,
      persisted: actual.size,
      missing: [...expected].filter((id) => !actual.has(id)).length,
      unexpected: [...actual].filter((id) => !expected.has(id)).length
    };
  };
  const tables = {
    cases: compareIds(plan.cases, state.cases, (row) => row.id),
    conflictLinks: compareIds(
      plan.caseConflicts,
      state.conflictLinks,
      (row) => `${row.case_id}|${row.conflict_id}`
    ),
    entityLinks: compareIds(
      plan.caseEntities,
      state.entityLinks,
      (row) => `${row.case_id}|${row.entity_type}|${row.entity_id}`
    ),
    events: compareIds(plan.events, state.events, (row) => row.id)
  };
  const observedFingerprint = resultFingerprint(state);
  const expectedFingerprint = resultFingerprint(planAsResultState(plan));
  const consistent = Object.values(tables).every((table) => (
    table.missing === 0 && table.unexpected === 0
  )) && observedFingerprint === expectedFingerprint;
  return {
    tables,
    observedFingerprint,
    expectedFingerprint,
    fingerprintMatch: observedFingerprint === expectedFingerprint,
    consistent
  };
}

module.exports = {
  CASE_GROUPING_VERSION,
  CASE_SERVICE_VERSION,
  CASE_RESULT_FINGERPRINT_VERSION,
  DEFAULT_BATCH_SIZE,
  QUEUES,
  STATUSES,
  PRIORITIES,
  parseBlocking,
  chooseQueue,
  chooseCaseType,
  conflictStateFingerprint,
  buildCustomerIdentityCasePlan,
  executeCustomerIdentityCasePlan,
  readCustomerIdentityCaseState,
  resultFingerprint,
  verifyCustomerIdentityCasePlan
};
