"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createMemoryDatabase,
  createLegacyTables,
  insertContact,
  insertCrmContact,
  snapshotDatabase,
  rawContact
} = require("./customerMasterDryRunTestUtils");
const {
  applyCustomerMasterSchema,
  CUSTOMER_MASTER_TABLES
} = require("../persistence/customerMasterSchema");
const {
  assertControlledWriteSql,
  createCustomerMasterWriteRepository
} = require("../persistence/customerMasterWriteRepository");
const {
  createCustomerMasterSourceReader
} = require("../backfill/customerMasterSourceReader");
const {
  resolveCalibrationLimits
} = require("../calibration/customerMasterCalibrationLimits");
const {
  APPLY_JOB_TYPE,
  buildCustomerMasterPersistencePlan,
  buildResultFingerprintFromState,
  planToResultState,
  readResultStateFromDatabase,
  computeCustomerMasterApplyInput,
  executeCustomerMasterPersistencePlan,
  finalizeCustomerMasterApplyJob,
  verifyCustomerMasterApplyState
} = require("../backfill/customerMasterControlledApply");
const {
  legacySourcesRemainIntact
} = require("../../../../scripts/customer-master-controlled-backfill");

const RUN_AT = "2026-02-01T00:00:00.000Z";
const CODE_VERSION = "apply-test-v1";

async function createSeededDatabase() {
  const db = createMemoryDatabase();
  await createLegacyTables(db);
  await insertContact(db, rawContact(1, {
    name: "Alice Master",
    phone: "11900000001",
    document: "52998224725",
    email: "alice@example.invalid",
    updated_at: "2026-01-02T00:00:00.000Z"
  }));
  await insertContact(db, rawContact(2, {
    name: "Alice Master",
    phone: "11900000001",
    document: "",
    email: "",
    updated_at: "2026-01-03T00:00:00.000Z"
  }));
  await insertContact(db, rawContact(3, {
    name: "Bruno Solo",
    phone: "11900000003",
    document: "11144477735",
    email: "",
    updated_at: "2026-01-04T00:00:00.000Z"
  }));
  await insertContact(db, rawContact(4, {
    name: "Carla Deleted",
    phone: "11900000004",
    deleted_at: "2026-01-05T00:00:00.000Z",
    updated_at: "2026-01-05T00:00:00.000Z"
  }));
  await insertContact(db, rawContact(5, {
    name: "Daniel InvalidDoc",
    phone: "11900000005",
    document: "123",
    updated_at: "2026-01-06T00:00:00.000Z"
  }));
  await insertCrmContact(db, {
    id: "crm-1",
    external_id: "ext-900",
    name: "Elaine Crm",
    phone: "11900000006",
    status: "active",
    updated_at: "2026-01-07T00:00:00.000Z"
  });
  await applyCustomerMasterSchema(db);
  return db;
}

async function buildPlan(db) {
  const reader = createCustomerMasterSourceReader(db);
  const input = await computeCustomerMasterApplyInput(reader, {
    limits: resolveCalibrationLimits(),
    codeVersion: CODE_VERSION
  });
  const plan = buildCustomerMasterPersistencePlan({
    records: input.records,
    candidates: input.candidates,
    conflicts: input.conflicts,
    runAt: RUN_AT,
    inputFingerprint: input.fingerprint,
    jobType: APPLY_JOB_TYPE
  });
  return { input, plan };
}

async function tableCounts(db) {
  const counts = {};
  for (const table of CUSTOMER_MASTER_TABLES) {
    counts[table] = Number((await db.get(`SELECT COUNT(*) AS total FROM ${table}`)).total);
  }
  return counts;
}

test("controlled apply populates only master tables with conservative eligibility", async () => {
  const db = await createSeededDatabase();
  try {
    const before = await snapshotDatabase(db);
    const { input, plan } = await buildPlan(db);
    const repository = createCustomerMasterWriteRepository(db);
    const stats = await executeCustomerMasterPersistencePlan(repository, plan, {
      runAt: RUN_AT,
      codeVersion: CODE_VERSION
    });
    await finalizeCustomerMasterApplyJob(repository, plan, {
      status: "COMPLETED",
      counts: { recordsRead: input.records.length },
      checkpoint: { phase: "COMPLETED" },
      finishedAt: RUN_AT
    });

    const after = await snapshotDatabase(db);
    assert.deepEqual(after.contacts, before.contacts);
    assert.deepEqual(after.crmContacts, before.crmContacts);

    const counts = await tableCounts(db);
    assert.equal(counts.customer_master_records, plan.masters.length);
    assert.equal(counts.customer_master_sources, input.records.length);
    assert.equal(counts.customer_master_identifiers, plan.identifiers.length);
    assert.equal(counts.customer_identity_conflicts, input.conflicts.length);
    assert.equal(
      counts.customer_identity_conflict_participants,
      input.conflicts.reduce((total, conflict) => total + conflict.participants.length, 0)
    );
    assert.equal(counts.customer_master_merge_history, 0);
    assert.equal(counts.customer_master_sync_checkpoints, 2);
    assert.equal(counts.customer_master_jobs, 1);

    assert.equal(stats.mastersCreated, plan.masters.length);
    assert.equal(stats.sourcesCreated, input.records.length);
    assert.equal(stats.conflictsCreated, input.conflicts.length);
    assert.ok(stats.batches > 0);

    const released = await db.get(
      `SELECT COUNT(*) AS total FROM customer_master_records
       WHERE eligibility_status NOT IN ('NOT_EVALUATED', 'REVIEW_REQUIRED')`
    );
    assert.equal(Number(released.total), 0);
    const evaluatedAt = await db.get(
      "SELECT COUNT(*) AS total FROM customer_master_records WHERE eligibility_evaluated_at IS NOT NULL"
    );
    assert.equal(Number(evaluatedAt.total), 0);

    const eligibleMaster = await db.get(
      `SELECT m.eligibility_status FROM customer_master_records m
       INNER JOIN customer_master_sources s ON s.master_id = m.id
       WHERE s.source_type = 'contacts' AND s.source_id = '3'`
    );
    assert.equal(eligibleMaster.eligibility_status, "NOT_EVALUATED");
    const conflictedMaster = await db.get(
      `SELECT m.eligibility_status FROM customer_master_records m
       INNER JOIN customer_master_sources s ON s.master_id = m.id
       WHERE s.source_type = 'contacts' AND s.source_id = '1'`
    );
    assert.equal(conflictedMaster.eligibility_status, "REVIEW_REQUIRED");
    const deletedMaster = await db.get(
      `SELECT m.eligibility_status FROM customer_master_records m
       INNER JOIN customer_master_sources s ON s.master_id = m.id
       WHERE s.source_type = 'contacts' AND s.source_id = '4'`
    );
    assert.equal(deletedMaster.eligibility_status, "REVIEW_REQUIRED");

    const deletedLink = await db.get(
      "SELECT status FROM customer_master_sources WHERE source_type = 'contacts' AND source_id = '4'"
    );
    assert.equal(deletedLink.status, "DELETED");

    const duplicateLinks = await db.get(
      `SELECT COUNT(*) AS total FROM (
         SELECT source_type, source_id FROM customer_master_sources
         GROUP BY source_type, source_id HAVING COUNT(*) > 1
       )`
    );
    assert.equal(Number(duplicateLinks.total), 0);

    const verification = await verifyCustomerMasterApplyState(repository, plan);
    assert.equal(verification.consistent, true);
    assert.equal(verification.resultFingerprintMatch, true);
  } finally {
    await db.close();
  }
});

test("apply persists protected identifiers and keeps raw PII out of conflict evidence", async () => {
  const db = await createSeededDatabase();
  try {
    const { plan } = await buildPlan(db);
    const repository = createCustomerMasterWriteRepository(db);
    await executeCustomerMasterPersistencePlan(repository, plan, {
      runAt: RUN_AT,
      codeVersion: CODE_VERSION
    });

    const phoneIdentifier = await db.get(
      `SELECT i.lookup_hash, i.masked_value, i.protected_value, i.classification
       FROM customer_master_identifiers i
       INNER JOIN customer_master_sources s ON s.id = i.source_link_id
       WHERE s.source_type = 'contacts' AND s.source_id = '1' AND i.identifier_type = 'PHONE'`
    );
    assert.ok(phoneIdentifier);
    assert.match(phoneIdentifier.lookup_hash, /^[a-f0-9]{64}$/);
    assert.equal(phoneIdentifier.protected_value.includes("*"), false);
    assert.notEqual(phoneIdentifier.masked_value, phoneIdentifier.protected_value);

    const evidenceRows = await db.all("SELECT evidence_json FROM customer_identity_conflicts");
    assert.ok(evidenceRows.length > 0);
    for (const row of evidenceRows) {
      assert.equal(row.evidence_json.includes("11900000001"), false);
      assert.equal(row.evidence_json.includes("52998224725"), false);
      assert.equal(row.evidence_json.includes("alice@example.invalid"), false);
    }
  } finally {
    await db.close();
  }
});

test("second apply execution is fully idempotent with identical result fingerprint", async () => {
  const db = await createSeededDatabase();
  try {
    const { plan } = await buildPlan(db);
    const repository = createCustomerMasterWriteRepository(db);
    const first = await executeCustomerMasterPersistencePlan(repository, plan, {
      runAt: RUN_AT,
      codeVersion: CODE_VERSION
    });
    const firstCounts = await tableCounts(db);
    const firstFingerprint = buildResultFingerprintFromState(
      await readResultStateFromDatabase(repository)
    );

    const second = await executeCustomerMasterPersistencePlan(repository, plan, {
      runAt: "2026-02-02T00:00:00.000Z",
      codeVersion: CODE_VERSION
    });
    const secondCounts = await tableCounts(db);
    const secondFingerprint = buildResultFingerprintFromState(
      await readResultStateFromDatabase(repository)
    );

    assert.deepEqual(secondCounts, firstCounts);
    assert.equal(secondFingerprint, firstFingerprint);
    assert.equal(second.mastersCreated, 0);
    assert.equal(second.sourcesCreated, 0);
    assert.equal(second.sourcesUpdated, 0);
    assert.equal(second.identifiersCreated, 0);
    assert.equal(second.conflictsCreated, 0);
    assert.equal(second.participantsCreated, 0);
    assert.equal(second.mastersUnchanged, first.mastersCreated);
    assert.equal(second.sourcesUnchanged, first.sourcesCreated);
    assert.equal(second.identifiersUnchanged, first.identifiersCreated);
    assert.equal(second.conflictsUnchanged, first.conflictsCreated);
    assert.equal(second.participantsUnchanged, first.participantsCreated);
    assert.equal(second.checkpointsUpdated, 0);
    assert.equal(second.checkpointsUnchanged, 2);

    const expectedFingerprint = buildResultFingerprintFromState(planToResultState(plan));
    assert.equal(firstFingerprint, expectedFingerprint);
  } finally {
    await db.close();
  }
});

test("interrupted apply resumes without duplicating rows", async () => {
  const db = await createSeededDatabase();
  try {
    const { plan } = await buildPlan(db);
    const repository = createCustomerMasterWriteRepository(db);
    await assert.rejects(
      executeCustomerMasterPersistencePlan(repository, plan, {
        runAt: RUN_AT,
        codeVersion: CODE_VERSION,
        failAfterBatches: 1
      }),
      /CUSTOMER_MASTER_APPLY_INJECTED_FAILURE/
    );
    const jobAfterFailure = await db.get(
      "SELECT status, checkpoint_json FROM customer_master_jobs WHERE id = ?",
      [plan.jobId]
    );
    assert.equal(jobAfterFailure.status, "RUNNING");
    assert.ok(JSON.parse(jobAfterFailure.checkpoint_json).phase);

    const stats = await executeCustomerMasterPersistencePlan(repository, plan, {
      runAt: RUN_AT,
      codeVersion: CODE_VERSION
    });
    const counts = await tableCounts(db);
    assert.equal(counts.customer_master_records, plan.masters.length);
    assert.equal(counts.customer_master_sources, plan.sources.length);
    assert.equal(counts.customer_master_identifiers, plan.identifiers.length);
    assert.equal(counts.customer_identity_conflicts, plan.conflicts.length);
    assert.equal(counts.customer_identity_conflict_participants, plan.participants.length);
    assert.equal(counts.customer_master_jobs, 1);
    assert.ok(stats.mastersCreated < plan.masters.length);
    assert.ok(stats.mastersUnchanged > 0);

    const verification = await verifyCustomerMasterApplyState(repository, plan);
    assert.equal(verification.consistent, true);
  } finally {
    await db.close();
  }
});

test("write repository blocks any statement outside the eight master tables", async () => {
  assert.throws(
    () => assertControlledWriteSql("UPDATE contacts SET name = 'x'"),
    /CUSTOMER_MASTER_WRITE_TABLE_BLOCKED|CUSTOMER_MASTER_WRITE_SQL_BLOCKED/
  );
  assert.throws(
    () => assertControlledWriteSql("DELETE FROM customer_master_records"),
    /CUSTOMER_MASTER_WRITE_SQL_BLOCKED/
  );
  assert.throws(
    () => assertControlledWriteSql("CREATE TABLE contacts_copy (id TEXT)"),
    /CUSTOMER_MASTER_WRITE_SQL_BLOCKED/
  );
  assert.throws(
    () => assertControlledWriteSql("DROP TABLE customer_master_records"),
    /CUSTOMER_MASTER_WRITE_SQL_BLOCKED/
  );
  assert.throws(
    () => assertControlledWriteSql("ALTER TABLE customer_master_records ADD COLUMN x TEXT"),
    /CUSTOMER_MASTER_WRITE_SQL_BLOCKED/
  );
  assert.throws(
    () => assertControlledWriteSql("ATTACH DATABASE 'other.sqlite' AS other"),
    /CUSTOMER_MASTER_WRITE_SQL_BLOCKED/
  );
  assert.throws(
    () => assertControlledWriteSql("PRAGMA journal_mode = WAL"),
    /CUSTOMER_MASTER_WRITE_SQL_BLOCKED/
  );
  assert.throws(
    () => assertControlledWriteSql("PRAGMA user_version = 1"),
    /CUSTOMER_MASTER_WRITE_SQL_BLOCKED/
  );
  assert.equal(assertControlledWriteSql("PRAGMA quick_check"), "PRAGMA quick_check");
  assert.equal(assertControlledWriteSql("PRAGMA schema_version"), "PRAGMA schema_version");
  assert.equal(assertControlledWriteSql("PRAGMA user_version"), "PRAGMA user_version");
  assert.equal(
    assertControlledWriteSql("INSERT OR IGNORE INTO customer_master_records (id) VALUES (?)"),
    "INSERT OR IGNORE INTO customer_master_records (id) VALUES (?)"
  );
  assert.equal(
    assertControlledWriteSql("SELECT COUNT(*) FROM contacts"),
    "SELECT COUNT(*) FROM contacts"
  );

  const db = createMemoryDatabase();
  try {
    const repository = createCustomerMasterWriteRepository(db);
    await assert.rejects(
      async () => repository.run("UPDATE contacts SET name = 'x'"),
      /CUSTOMER_MASTER_WRITE/
    );
  } finally {
    await db.close();
  }
});

test("authorized master schema creation does not look like legacy source drift", () => {
  const before = {
    contacts: 36502,
    crm_contacts: 22641,
    legacySchemaHash: "legacy-schema-stable",
    schemaVersion: 332,
    userVersion: 0
  };
  const after = {
    ...before,
    schemaVersion: 361
  };

  assert.equal(legacySourcesRemainIntact(before, after), true);
  assert.equal(legacySourcesRemainIntact(before, {
    ...after,
    contacts: before.contacts + 1
  }), false);
  assert.equal(legacySourcesRemainIntact(before, {
    ...after,
    legacySchemaHash: "legacy-schema-drift"
  }), false);
});

test("restricted write repository accepts the approved master DDL transaction", async () => {
  const db = createMemoryDatabase();
  try {
    const repository = createCustomerMasterWriteRepository(db);
    const result = await applyCustomerMasterSchema(repository);

    assert.equal(result.after.ready, true);
    assert.equal(result.after.empty, true);
  } finally {
    await db.close();
  }
});
