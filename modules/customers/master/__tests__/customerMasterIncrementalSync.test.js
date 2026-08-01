"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createDryRunDatabase,
  insertContact,
  insertCrmContact
} = require("./customerMasterDryRunTestUtils");
const {
  applyCustomerIdentityCaseSchema
} = require("../persistence/customerIdentityCaseSchema");
const {
  applyCustomerIdentityAdminSchema
} = require("../admin/customerIdentityAdminSchema");
const {
  createCustomerMasterWriteRepository
} = require("../persistence/customerMasterWriteRepository");
const {
  createCustomerIdentityCaseWriteRepository
} = require("../persistence/customerIdentityCaseWriteRepository");
const {
  createCustomerMasterSourceReader
} = require("../backfill/customerMasterSourceReader");
const {
  buildSourceRecord
} = require("../backfill/customerMasterSourceModel");
const {
  buildCandidateGraph,
  buildCandidateClusters
} = require("../backfill/customerMasterCandidateBuilder");
const {
  detectCustomerMasterConflicts
} = require("../backfill/customerMasterConflictDetector");
const {
  buildCustomerMasterPersistencePlan,
  executeCustomerMasterPersistencePlan
} = require("../backfill/customerMasterControlledApply");
const {
  buildCustomerIdentityCasePlan,
  executeCustomerIdentityCasePlan
} = require("../governance/customerIdentityCaseService");
const {
  assertIncrementalSql,
  runCustomerMasterIncrementalSync
} = require("../incremental/customerMasterIncrementalSyncService");

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-02T10:00:00.000Z";

async function prepareDb() {
  const db = await createDryRunDatabase();
  await applyCustomerIdentityCaseSchema(db);
  await applyCustomerIdentityAdminSchema(db);
  return db;
}

async function seedTwoSourceBaseline(db) {
  await insertContact(db, {
    id: "1", name: "Maria Teste", phone: "11988887777", email: "maria@example.invalid", updated_at: T0
  });
  await insertContact(db, {
    id: "2", name: "Maria Teste", phone: "11988887777", email: "maria@example.invalid", updated_at: T0
  });
  const rows = await db.all("SELECT * FROM contacts ORDER BY id");
  const records = rows.map((row) => buildSourceRecord("contacts", row));
  const graph = buildCandidateGraph(records);
  const candidates = buildCandidateClusters(records, graph);
  const conflicts = detectCustomerMasterConflicts(records, graph, candidates).conflicts;
  const plan = buildCustomerMasterPersistencePlan({
    records, candidates, conflicts, runAt: T0, inputFingerprint: "incremental-test-baseline"
  });
  await executeCustomerMasterPersistencePlan(createCustomerMasterWriteRepository(db), plan, {
    runAt: T0, codeVersion: "test-baseline"
  });
  const casePlan = buildCustomerIdentityCasePlan({
    conflicts: plan.conflicts,
    participants: plan.participants,
    sourceLinks: plan.sources,
    runAt: T0,
    codeVersion: "test-baseline"
  });
  await executeCustomerIdentityCasePlan(createCustomerIdentityCaseWriteRepository(db), casePlan);
  return { plan, casePlan };
}

test("cursor incremental usa updated_at e id, pagina sem offset e e idempotente", async () => {
  const db = await prepareDb();
  try {
    await db.run(
      `INSERT INTO customer_master_jobs
       (id, job_type, status, code_version, schema_version, fingerprint, counts_json,
        checkpoint_json, created_at, updated_at)
       VALUES ('job-seed', 'TEST', 'COMPLETED', 'test', 'customer-master-schema/v1', '', '{}', '{}', ?, ?)`,
      [T0, T0]
    );
    await db.run(
      `INSERT INTO customer_master_sync_checkpoints
       (id, source_type, cursor_updated_at, cursor_source_id, last_job_id, status, created_at, updated_at)
       VALUES ('checkpoint-contacts', 'contacts', ?, '2', 'job-seed', 'COMPLETED', ?, ?)`,
      [T0, T0, T0]
    );
    await insertContact(db, { id: "3", name: "Tres", phone: "11910000003", updated_at: T1 });
    await insertContact(db, { id: "4", name: "Quatro", phone: "11910000004", updated_at: T1 });
    const reader = createCustomerMasterSourceReader(db);
    const first = await runCustomerMasterIncrementalSync({
      db, reader, sourceTypes: ["contacts"], pageSize: 1,
      runAt: "2026-07-03T10:00:00.000Z", codeVersion: "test-h"
    });
    assert.equal(first.status, "COMPLETE");
    assert.equal(first.stats.scanned, 2);
    assert.equal(first.stats.pages, 2);
    assert.equal(first.stats.sourcesCreated, 2);
    assert.deepEqual(await db.get(
      "SELECT cursor_updated_at, cursor_source_id FROM customer_master_sync_checkpoints WHERE source_type = 'contacts'"
    ), { cursor_updated_at: T1, cursor_source_id: "4" });

    const second = await runCustomerMasterIncrementalSync({
      db, reader, sourceTypes: ["contacts"], pageSize: 1,
      runAt: "2026-07-04T10:00:00.000Z", codeVersion: "test-h"
    });
    assert.equal(second.stats.scanned, 0);
    assert.equal(Number((await db.get("SELECT COUNT(*) AS total FROM customer_master_sources")).total), 2);
  } finally {
    await db.close();
  }
});

test("mudanca material reavalia apenas conflitos vinculados e reabre caso resolvido", async () => {
  const db = await prepareDb();
  try {
    const baseline = await seedTwoSourceBaseline(db);
    await db.run(
      `UPDATE customer_identity_conflicts SET status = 'RESOLVED', resolution_type = 'KEPT_SEPARATE',
       resolution_reason = 'TEST', resolved_by = 'admin', resolved_at = ?, updated_at = ?`,
      [T0, T0]
    );
    await db.run(
      `UPDATE customer_identity_cases SET status = 'RESOLVED', review_version = 4,
       resolved_at = ?, updated_at = ?`,
      [T0, T0]
    );
    await db.run("UPDATE contacts SET name = 'Maria Nome Alterado', updated_at = ? WHERE id = '1'", [T1]);
    const sourceStateBefore = {
      contacts: await db.all("SELECT * FROM contacts ORDER BY id"),
      crmContacts: await db.all("SELECT * FROM crm_contacts ORDER BY id")
    };

    const result = await runCustomerMasterIncrementalSync({
      db,
      reader: createCustomerMasterSourceReader(db),
      sourceTypes: ["contacts"],
      runAt: "2026-07-03T10:00:00.000Z",
      codeVersion: "test-h"
    });
    assert.equal(result.stats.scanned, 1);
    assert.equal(result.stats.materialChanges, 1);
    assert.equal(result.stats.casesReopened, baseline.casePlan.cases.length);
    const baselineCaseIds = baseline.casePlan.cases.map((row) => row.id);
    const cases = await db.all(
      `SELECT status, review_version FROM customer_identity_cases
       WHERE id IN (${baselineCaseIds.map(() => "?").join(", ")})`,
      baselineCaseIds
    );
    assert.ok(cases.every((row) => row.status === "REOPENED" && row.review_version === 5));
    const conflicts = await db.all("SELECT status, resolution_type FROM customer_identity_conflicts");
    assert.ok(conflicts.every((row) => row.status === "OPEN" && row.resolution_type === null));
    const reopenEvents = await db.get(
      "SELECT COUNT(*) AS total FROM customer_identity_case_events WHERE event_type = 'REOPENED_SOURCE_CHANGED'"
    );
    assert.equal(Number(reopenEvents.total), baseline.casePlan.cases.length);
    assert.equal(Number((await db.get(
      "SELECT COUNT(*) AS total FROM customer_master_records WHERE eligibility_status NOT IN ('NOT_EVALUATED', 'REVIEW_REQUIRED')"
    )).total), 0);
    assert.deepEqual(await db.all("SELECT * FROM contacts ORDER BY id"), sourceStateBefore.contacts);
    assert.deepEqual(await db.all("SELECT * FROM crm_contacts ORDER BY id"), sourceStateBefore.crmContacts);
  } finally {
    await db.close();
  }
});

test("hash igual apenas avanca checkpoint e mudanca removida preserva conflito como historico", async () => {
  const db = await prepareDb();
  try {
    await seedTwoSourceBaseline(db);
    const reader = createCustomerMasterSourceReader(db);
    await db.run("UPDATE contacts SET updated_at = ? WHERE id = '1'", [T1]);
    const unchanged = await runCustomerMasterIncrementalSync({
      db, reader, sourceTypes: ["contacts"],
      runAt: "2026-07-03T10:00:00.000Z", codeVersion: "test-h"
    });
    assert.equal(unchanged.stats.unchanged, 1);
    assert.equal(unchanged.stats.materialChanges, 0);

    await db.run(
      "UPDATE contacts SET phone = '11911112222', mobile = '', mobile_normalized = '', updated_at = ? WHERE id = '1'",
      ["2026-07-04T10:00:00.000Z"]
    );
    const changed = await runCustomerMasterIncrementalSync({
      db, reader, sourceTypes: ["contacts"],
      runAt: "2026-07-05T10:00:00.000Z", codeVersion: "test-h"
    });
    assert.equal(changed.stats.materialChanges, 1);
    assert.ok(changed.stats.conflictsResolved > 0);
    const stale = await db.all(
      "SELECT status, resolution_type FROM customer_identity_conflicts WHERE status = 'RESOLVED'"
    );
    assert.ok(stale.length > 0);
    assert.ok(stale.every((row) => row.resolution_type === "SOURCE_CHANGE_NO_LONGER_REPRODUCIBLE"));
    assert.equal(Number((await db.get("SELECT COUNT(*) AS total FROM contacts")).total), 2);
    assert.equal(Number((await db.get("SELECT COUNT(*) AS total FROM crm_contacts")).total), 0);
  } finally {
    await db.close();
  }
});

test("falha na pagina nao avanca checkpoint", async () => {
  const db = await prepareDb();
  try {
    await insertContact(db, { id: "1", name: "Sem cursor", updated_at: null });
    await assert.rejects(
      runCustomerMasterIncrementalSync({
        db,
        reader: createCustomerMasterSourceReader(db),
        sourceTypes: ["contacts"],
        runAt: T1,
        codeVersion: "test-h"
      }),
      /CUSTOMER_MASTER_INCREMENTAL_CURSOR_REQUIRED/
    );
    assert.deepEqual(await db.get(
      "SELECT cursor_source_id, status FROM customer_master_sync_checkpoints WHERE source_type = 'contacts'"
    ), { cursor_source_id: null, status: "FAILED" });
    assert.equal(Number((await db.get("SELECT COUNT(*) AS total FROM customer_master_sources")).total), 0);
  } finally {
    await db.close();
  }
});

test("processa crm_contacts com checkpoint independente", async () => {
  const db = await prepareDb();
  try {
    await insertCrmContact(db, {
      id: "crm-1", external_id: "external-1", name: "CRM Teste",
      phone: "11922223333", updated_at: T1
    });
    const result = await runCustomerMasterIncrementalSync({
      db,
      reader: createCustomerMasterSourceReader(db),
      sourceTypes: ["crm_contacts"],
      runAt: "2026-07-03T10:00:00.000Z",
      codeVersion: "test-h"
    });
    assert.equal(result.stats.sourcesCreated, 1);
    assert.deepEqual(await db.get(
      "SELECT source_type, cursor_source_id FROM customer_master_sync_checkpoints WHERE source_type = 'crm_contacts'"
    ), { source_type: "crm_contacts", cursor_source_id: "crm-1" });
    assert.equal(Number((await db.get(
      "SELECT COUNT(*) AS total FROM customer_master_sources WHERE source_type = 'crm_contacts'"
    )).total), 1);
  } finally {
    await db.close();
  }
});

test("repositorio incremental bloqueia escrita em origens e SQL destrutivo", () => {
  assert.throws(
    () => assertIncrementalSql("UPDATE contacts SET name = 'x'"),
    /CUSTOMER_MASTER_INCREMENTAL_SQL_BLOCKED/
  );
  assert.throws(
    () => assertIncrementalSql("INSERT INTO crm_contacts (id) VALUES ('x')"),
    /CUSTOMER_MASTER_INCREMENTAL_SQL_BLOCKED/
  );
  assert.throws(
    () => assertIncrementalSql("DELETE FROM customer_master_sources"),
    /CUSTOMER_MASTER_INCREMENTAL_SQL_BLOCKED/
  );
  assert.match(
    assertIncrementalSql("UPDATE customer_master_sources SET source_hash = ? WHERE id = ?"),
    /^UPDATE customer_master_sources/
  );
});

test("checkpoint RUNNING de outro job bloqueia concorrencia", async () => {
  const db = await prepareDb();
  try {
    await insertContact(db, { id: "1", name: "Concorrencia", updated_at: T1 });
    await db.run(
      `INSERT INTO customer_master_jobs
       (id, job_type, status, code_version, schema_version, fingerprint, counts_json,
        checkpoint_json, created_at, updated_at)
       VALUES ('job-running', 'INCREMENTAL_SOURCE_SYNC', 'RUNNING', 'other',
        'customer-master-schema/v1', '', '{}', '{}', ?, ?)`,
      [T0, T0]
    );
    await db.run(
      `INSERT INTO customer_master_sync_checkpoints
       (id, source_type, cursor_updated_at, cursor_source_id, last_job_id, status, created_at, updated_at)
       VALUES ('checkpoint-running', 'contacts', ?, '0', 'job-running', 'RUNNING', ?, ?)`,
      [T0, T0, T0]
    );
    await assert.rejects(
      runCustomerMasterIncrementalSync({
        db,
        reader: createCustomerMasterSourceReader(db),
        sourceTypes: ["contacts"],
        runAt: T1,
        codeVersion: "test-h"
      }),
      /CUSTOMER_MASTER_INCREMENTAL_CONCURRENT_RUN:contacts/
    );
    assert.deepEqual(await db.get(
      "SELECT last_job_id, status FROM customer_master_sync_checkpoints WHERE source_type = 'contacts'"
    ), { last_job_id: "job-running", status: "RUNNING" });
    assert.equal(Number((await db.get("SELECT COUNT(*) AS total FROM customer_master_sources")).total), 0);
  } finally {
    await db.close();
  }
});
