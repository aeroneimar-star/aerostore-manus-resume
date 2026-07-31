"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const sqlite3 = require("sqlite3");
const {
  applyCustomerIdentityAdminSchema
} = require("../modules/customers/master/admin/customerIdentityAdminSchema");

function openDb(databasePath) {
  const connection = new sqlite3.Database(databasePath);
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    connection.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      return resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
  const get = (sql, params = []) => new Promise((resolve, reject) => {
    connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
  const close = () => new Promise((resolve, reject) => {
    connection.close((error) => error ? reject(error) : resolve());
  });
  return { run, get, all, close };
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function snapshot(db) {
  const caseCounts = await db.all(
    `SELECT queue_type, COUNT(*) AS total
       FROM customer_identity_cases
      GROUP BY queue_type
      ORDER BY queue_type`
  );
  const caseRows = await db.all(
    `SELECT id, fingerprint, status, priority, blocking, conflict_count,
            master_count, source_count, created_at, updated_at
       FROM customer_identity_cases
      ORDER BY id`
  );
  const conflictRows = await db.all(
    `SELECT id, conflict_type, severity, status, rule_version, evidence_json,
            resolution_type, resolution_reason, resolved_by, resolved_at,
            created_at, updated_at, reopened_at
       FROM customer_identity_conflicts
      ORDER BY id`
  );
  const eligibilityRows = await db.all(
    `SELECT id, status, version, eligibility_status, eligibility_reasons_json,
            eligibility_evaluated_at, eligibility_rule_version,
            eligibility_source_version, updated_at, deleted_at
       FROM customer_master_records
      ORDER BY id`
  );
  const eventRows = await db.all(
    `SELECT id, case_id, event_type, actor_user_id, reason,
            before_json, after_json, created_at
       FROM customer_identity_case_events
      ORDER BY id`
  );
  const counts = {
    cases: Number((await db.get("SELECT COUNT(*) AS total FROM customer_identity_cases"))?.total || 0),
    caseCounts: Object.fromEntries(caseCounts.map((row) => [row.queue_type, Number(row.total || 0)])),
    conflictLinks: Number((await db.get("SELECT COUNT(*) AS total FROM customer_identity_case_conflicts"))?.total || 0),
    affectedMasters: Number((await db.get(
      "SELECT COUNT(DISTINCT entity_id) AS total FROM customer_identity_case_entities WHERE entity_type = 'MASTER'"
    ))?.total || 0),
    affectedSources: Number((await db.get(
      "SELECT COUNT(DISTINCT entity_id) AS total FROM customer_identity_case_entities WHERE entity_type = 'SOURCE'"
    ))?.total || 0),
    caseEvents: eventRows.length,
    conflicts: conflictRows.length,
    openConflicts: conflictRows.filter((row) => row.status === "OPEN").length,
    eligibilityReleased: eligibilityRows.filter((row) => (
      ["ELIGIBLE", "APPROVED", "RELEASED", "ACCESS_GRANTED"].includes(
        String(row.eligibility_status || "").toUpperCase()
      )
    )).length
  };
  return {
    counts,
    fingerprints: {
      cases: fingerprint(caseRows),
      conflicts: fingerprint(conflictRows),
      eligibility: fingerprint(eligibilityRows),
      events: fingerprint(eventRows)
    }
  };
}

function assertApprovedBaseline(snapshotValue) {
  const counts = snapshotValue.counts;
  const expected = {
    cases: 17285,
    identity: 7784,
    hygiene: 9428,
    historical: 73,
    conflictLinks: 34051,
    affectedMasters: 41619,
    affectedSources: 52335
  };
  if (
    counts.cases !== expected.cases
    || counts.caseCounts.IDENTITY_ELIGIBILITY !== expected.identity
    || counts.caseCounts.DATA_HYGIENE !== expected.hygiene
    || counts.caseCounts.HISTORICAL !== expected.historical
    || counts.conflictLinks !== expected.conflictLinks
    || counts.affectedMasters !== expected.affectedMasters
    || counts.affectedSources !== expected.affectedSources
  ) {
    throw new Error("CUSTOMER_IDENTITY_ADMIN_BASELINE_MISMATCH");
  }
  if (counts.openConflicts !== counts.conflicts || counts.eligibilityReleased !== 0) {
    throw new Error("CUSTOMER_IDENTITY_ADMIN_IDENTITY_STATE_INVALID");
  }
}

async function main() {
  const configuredPath = String(process.env.CUSTOMER_IDENTITY_ADMIN_DB_PATH || "").trim();
  if (!configuredPath) {
    throw new Error("CUSTOMER_IDENTITY_ADMIN_DB_PATH_REQUIRED");
  }
  const databasePath = path.resolve(configuredPath);
  const db = openDb(databasePath);
  try {
    await db.run("PRAGMA busy_timeout = 5000");
    const quickCheck = await db.get("PRAGMA quick_check");
    if (String(quickCheck?.quick_check || "") !== "ok") {
      throw new Error("CUSTOMER_IDENTITY_ADMIN_QUICK_CHECK_FAILED");
    }
    const before = await snapshot(db);
    assertApprovedBaseline(before);
    const migration = await applyCustomerIdentityAdminSchema(db);
    const after = await snapshot(db);
    assertApprovedBaseline(after);
    if (
      JSON.stringify(before.counts) !== JSON.stringify(after.counts)
      || JSON.stringify(before.fingerprints) !== JSON.stringify(after.fingerprints)
    ) {
      throw new Error("CUSTOMER_IDENTITY_ADMIN_INTEGRITY_MISMATCH");
    }
    process.stdout.write(`${JSON.stringify({
      status: "CUSTOMER_IDENTITY_ADMIN_SCHEMA_OK",
      quickCheck: "ok",
      schemaVersion: migration.schemaVersion,
      columnsAdded: migration.columnsAdded,
      counts: after.counts,
      fingerprintsUnchanged: {
        cases: before.fingerprints.cases === after.fingerprints.cases,
        conflicts: before.fingerprints.conflicts === after.fingerprints.conflicts,
        eligibility: before.fingerprints.eligibility === after.fingerprints.eligibility,
        events: before.fingerprints.events === after.fingerprints.events
      }
    }, null, 2)}\n`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.code || error.message || "CUSTOMER_IDENTITY_ADMIN_MIGRATION_FAILED"}\n`);
  process.exitCode = 1;
});
