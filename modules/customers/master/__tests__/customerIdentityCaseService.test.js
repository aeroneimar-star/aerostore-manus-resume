"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createMemoryDatabase
} = require("./customerMasterDryRunTestUtils");
const {
  applyCustomerMasterSchema
} = require("../persistence/customerMasterSchema");
const {
  CUSTOMER_IDENTITY_CASE_TABLES,
  getCustomerIdentityCaseSchemaStatus,
  applyCustomerIdentityCaseSchema
} = require("../persistence/customerIdentityCaseSchema");
const {
  assertIdentityCaseSql,
  createCustomerIdentityCaseWriteRepository
} = require("../persistence/customerIdentityCaseWriteRepository");
const {
  CASE_GROUPING_VERSION,
  buildCustomerIdentityCasePlan,
  conflictStateFingerprint,
  executeCustomerIdentityCasePlan,
  verifyCustomerIdentityCasePlan
} = require("../governance/customerIdentityCaseService");

const RUN_AT = "2026-07-30T00:00:00.000Z";
const CODE_VERSION = "synthetic-case-test-v1";

function evidence(blocking, participantCount) {
  return JSON.stringify({
    blocking,
    participantCount,
    identifierType: null,
    maskedValues: [],
    reasonCodes: []
  });
}

function fixture() {
  const sourceLinks = [
    { id: "cms:a", master_id: "cmr:1", source_type: "contacts", status: "ACTIVE" },
    { id: "cms:b", master_id: "cmr:1", source_type: "crm_contacts", status: "ACTIVE" },
    { id: "cms:c", master_id: "cmr:2", source_type: "crm_contacts", status: "ACTIVE" },
    { id: "cms:d", master_id: "cmr:3", source_type: "contacts", status: "DELETED" }
  ];
  const conflicts = [
    { id: "cic:phone-1", conflict_type: "PHONE_DUPLICATE", severity: "HIGH", status: "OPEN", rule_version: "v1", evidence_json: evidence(true, 2) },
    { id: "cic:phone-2", conflict_type: "PHONE_SHARED", severity: "CRITICAL", status: "OPEN", rule_version: "v1", evidence_json: evidence(true, 2) },
    { id: "cic:phone-3", conflict_type: "MULTIPLE_ELIGIBLE_CUSTOMERS", severity: "CRITICAL", status: "OPEN", rule_version: "v1", evidence_json: evidence(true, 2) },
    { id: "cic:cpf-1", conflict_type: "CPF_INVALID", severity: "MEDIUM", status: "OPEN", rule_version: "v1", evidence_json: evidence(false, 1) },
    { id: "cic:cpf-2", conflict_type: "CPF_DUPLICATE", severity: "MEDIUM", status: "OPEN", rule_version: "v1", evidence_json: evidence(false, 1) },
    { id: "cic:history", conflict_type: "DELETED_SOURCE", severity: "HIGH", status: "OPEN", rule_version: "v1", evidence_json: evidence(true, 1) },
    { id: "cic:fallback", conflict_type: "MANUAL_REVIEW_REQUIRED", severity: "MEDIUM", status: "OPEN", rule_version: "v1", evidence_json: evidence(false, 0) }
  ];
  const participants = [
    ["cic:phone-1", "cms:a"], ["cic:phone-1", "cms:b"],
    ["cic:phone-2", "cms:a"], ["cic:phone-2", "cms:b"],
    ["cic:phone-3", "cms:a"], ["cic:phone-3", "cms:b"],
    ["cic:cpf-1", "cms:c"], ["cic:cpf-2", "cms:c"],
    ["cic:history", "cms:d"]
  ].map(([conflictId, sourceId], index) => ({
    id: `cip:${index}`,
    conflict_id: conflictId,
    participant_type: "SOURCE",
    participant_id: sourceId,
    role: "",
    created_at: RUN_AT
  }));
  return { conflicts, participants, sourceLinks };
}

function buildPlan(data = fixture()) {
  return buildCustomerIdentityCasePlan({
    ...data,
    runAt: RUN_AT,
    codeVersion: CODE_VERSION
  });
}

async function createPersistableDatabase(data) {
  const db = createMemoryDatabase();
  await applyCustomerMasterSchema(db);
  for (const masterId of ["cmr:1", "cmr:2", "cmr:3"]) {
    await db.run(
      `INSERT INTO customer_master_records
        (id, display_name, status, version, eligibility_status, created_at, updated_at)
       VALUES (?, '', 'PENDING', 1, 'NOT_EVALUATED', ?, ?)`,
      [masterId, RUN_AT, RUN_AT]
    );
  }
  for (const [index, source] of data.sourceLinks.entries()) {
    await db.run(
      `INSERT INTO customer_master_sources
        (id, master_id, source_type, source_id, source_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        source.id, source.master_id, source.source_type, `synthetic-source-${index}`,
        `synthetic-hash-${index}`, source.status, RUN_AT, RUN_AT
      ]
    );
  }
  for (const conflict of data.conflicts) {
    await db.run(
      `INSERT INTO customer_identity_conflicts
        (id, conflict_type, severity, status, rule_version, evidence_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        conflict.id, conflict.conflict_type, conflict.severity, conflict.status,
        conflict.rule_version, conflict.evidence_json, RUN_AT, RUN_AT
      ]
    );
  }
  for (const participant of data.participants) {
    await db.run(
      `INSERT INTO customer_identity_conflict_participants
        (id, conflict_id, participant_type, participant_id, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        participant.id, participant.conflict_id, participant.participant_type,
        participant.participant_id, participant.role, participant.created_at
      ]
    );
  }
  return db;
}

test("deterministic compound buckets create the three governance queues", () => {
  const plan = buildPlan();
  assert.equal(plan.groupingVersion, CASE_GROUPING_VERSION);
  assert.deepEqual(plan.stats.byQueue, {
    IDENTITY_ELIGIBILITY: 1,
    DATA_HYGIENE: 2,
    HISTORICAL: 1
  });
  assert.deepEqual(plan.stats.byPriority, {
    CRITICAL: 1,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 0
  });
  assert.equal(plan.stats.totalCases, 4);
  assert.equal(plan.stats.linkedConflicts, 7);
  assert.equal(plan.stats.compositeCases, 2);
  assert.equal(plan.stats.individualCases, 2);
  assert.equal(plan.stats.affectedMasters, 3);
  assert.equal(plan.stats.affectedSources, 4);

  const phoneCase = plan.cases.find((row) => row.case_type === "PHONE_IDENTITY_COMPOSITE");
  assert.equal(phoneCase.conflict_count, 3);
  assert.equal(phoneCase.queue_type, "IDENTITY_ELIGIBILITY");
  const cpfCase = plan.cases.find((row) => row.case_type === "CPF_DATA_HYGIENE");
  assert.equal(cpfCase.conflict_count, 2);
  assert.equal(cpfCase.queue_type, "DATA_HYGIENE");
});

test("case plan and fingerprints ignore incidental input order", () => {
  const data = fixture();
  const first = buildPlan(data);
  const reversed = buildPlan({
    conflicts: [...data.conflicts].reverse(),
    participants: [...data.participants].reverse(),
    sourceLinks: [...data.sourceLinks].reverse()
  });
  assert.equal(reversed.planFingerprint, first.planFingerprint);
  assert.equal(reversed.originalConflictFingerprint, first.originalConflictFingerprint);
  assert.deepEqual(
    reversed.cases.map((row) => row.id).sort(),
    first.cases.map((row) => row.id).sort()
  );
});

test("summaries and creation events contain no entity ids or integral PII", () => {
  const plan = buildPlan();
  for (const row of plan.cases) {
    assert.doesNotMatch(row.summary_json, /\b(?:cmr|cms|cic|cip):/i);
    assert.doesNotMatch(row.summary_json, /[a-f0-9]{64}/i);
    assert.doesNotMatch(row.summary_json, /\b\d{11}\b/);
    assert.doesNotMatch(row.summary_json, /[a-z0-9._%+-]+@[a-z0-9.-]+/i);
  }
  for (const event of plan.events) {
    assert.equal(event.event_type, "CREATED");
    assert.equal(event.actor_user_id, null);
    assert.equal(event.before_json, "{}");
    assert.doesNotMatch(event.after_json, /\b(?:cmr|cms|cic|cip):/i);
  }
});

test("schema is expansive, idempotent and exposes every required state", async () => {
  const db = createMemoryDatabase();
  try {
    const repository = createCustomerIdentityCaseWriteRepository(db);
    const first = await applyCustomerIdentityCaseSchema(repository);
    const second = await applyCustomerIdentityCaseSchema(repository);
    const readOnlyStatus = await getCustomerIdentityCaseSchemaStatus({
      get: db.get.bind(db),
      all: db.all.bind(db)
    });
    assert.equal(first.after.ready, true);
    assert.equal(first.after.empty, true);
    assert.equal(second.after.ready, true);
    assert.equal(readOnlyStatus.ready, true);
    assert.deepEqual(
      first.after.tables.map((item) => item.table),
      CUSTOMER_IDENTITY_CASE_TABLES
    );
    const ddl = (await repository.get(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'customer_identity_cases'"
    )).sql;
    for (const token of [
      "OPEN", "UNDER_REVIEW", "RESOLVED", "ARCHIVED", "REOPENED",
      "CRITICAL", "HIGH", "MEDIUM", "LOW",
      "IDENTITY_ELIGIBILITY", "DATA_HYGIENE", "HISTORICAL"
    ]) {
      assert.match(ddl, new RegExp(token));
    }
  } finally {
    await db.close();
  }
});

test("controlled persistence is idempotent and leaves original conflicts untouched", async () => {
  const data = fixture();
  const db = await createPersistableDatabase(data);
  try {
    const repository = createCustomerIdentityCaseWriteRepository(db);
    await applyCustomerIdentityCaseSchema(repository);
    const plan = buildPlan(data);
    const originalBefore = conflictStateFingerprint(data.conflicts, data.participants);
    const first = await executeCustomerIdentityCasePlan(repository, plan, { batchSize: 2 });
    const firstVerification = await verifyCustomerIdentityCasePlan(repository, plan);
    const second = await executeCustomerIdentityCasePlan(repository, plan, { batchSize: 2 });
    const secondVerification = await verifyCustomerIdentityCasePlan(repository, plan);

    assert.equal(first.casesCreated, plan.stats.totalCases);
    assert.equal(first.conflictLinksCreated, plan.stats.linkedConflicts);
    assert.equal(first.eventsCreated, plan.stats.creationEvents);
    assert.equal(second.casesCreated, 0);
    assert.equal(second.conflictLinksCreated, 0);
    assert.equal(second.entityLinksCreated, 0);
    assert.equal(second.eventsCreated, 0);
    assert.equal(second.casesUnchanged, plan.stats.totalCases);
    assert.equal(second.conflictLinksUnchanged, plan.stats.linkedConflicts);
    assert.equal(firstVerification.consistent, true);
    assert.equal(secondVerification.consistent, true);
    assert.equal(
      secondVerification.observedFingerprint,
      firstVerification.observedFingerprint
    );

    const persistedConflicts = await db.all(
      `SELECT id, conflict_type, severity, status, rule_version, evidence_json
       FROM customer_identity_conflicts`
    );
    const persistedParticipants = await db.all(
      `SELECT id, conflict_id, participant_type, participant_id, role, created_at
       FROM customer_identity_conflict_participants`
    );
    assert.equal(
      conflictStateFingerprint(persistedConflicts, persistedParticipants),
      originalBefore
    );
    const statuses = await db.all(
      "SELECT status, COUNT(*) AS total FROM customer_identity_cases GROUP BY status"
    );
    assert.deepEqual(statuses, [{ status: "OPEN", total: 4 }]);
    const eligibility = await db.all(
      "SELECT eligibility_status, COUNT(*) AS total FROM customer_master_records GROUP BY eligibility_status"
    );
    assert.deepEqual(eligibility, [{ eligibility_status: "NOT_EVALUATED", total: 3 }]);
  } finally {
    await db.close();
  }
});

test("case write repository blocks original tables, updates and destructive SQL", () => {
  for (const sql of [
    "UPDATE customer_identity_conflicts SET status = 'RESOLVED'",
    "UPDATE customer_identity_cases SET status = 'RESOLVED'",
    "INSERT OR IGNORE INTO contacts (id) VALUES ('x')",
    "DELETE FROM customer_identity_cases",
    "ALTER TABLE customer_identity_cases ADD COLUMN leaked TEXT",
    "PRAGMA user_version = 1"
  ]) {
    assert.throws(() => assertIdentityCaseSql(sql), /CUSTOMER_IDENTITY_CASE_/);
  }
  assert.equal(
    assertIdentityCaseSql(
      "INSERT OR IGNORE INTO customer_identity_cases (id) VALUES (?)"
    ),
    "INSERT OR IGNORE INTO customer_identity_cases (id) VALUES (?)"
  );
});
