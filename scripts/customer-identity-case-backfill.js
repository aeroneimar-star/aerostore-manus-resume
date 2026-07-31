"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const sqlite3 = require("sqlite3").verbose();
const {
  createReadOnlyDatabase,
  captureSnapshot,
  readIntegrity,
  isPathInside
} = require("../modules/customers/master/calibration/customerMasterReadOnlyCalibration");
const {
  stableStringify,
  sha256
} = require("../modules/customers/master/backfill/customerMasterSourceModel");
const {
  applyCustomerIdentityCaseSchema,
  getCustomerIdentityCaseSchemaStatus
} = require("../modules/customers/master/persistence/customerIdentityCaseSchema");
const {
  assertIdentityCaseSql,
  createCustomerIdentityCaseWriteRepository
} = require("../modules/customers/master/persistence/customerIdentityCaseWriteRepository");
const {
  CASE_GROUPING_VERSION,
  CASE_SERVICE_VERSION,
  buildCustomerIdentityCasePlan,
  conflictStateFingerprint,
  executeCustomerIdentityCasePlan,
  verifyCustomerIdentityCasePlan
} = require("../modules/customers/master/governance/customerIdentityCaseService");

const EXPECTED = Object.freeze({
  conflicts: 34051,
  totalCases: 17285,
  byQueue: {
    IDENTITY_ELIGIBILITY: 7777,
    DATA_HYGIENE: 9428,
    HISTORICAL: 80
  }
});

function parseArgs(argv) {
  const values = { dryRun: false, apply: false, verify: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") values.dryRun = true;
    else if (token === "--apply") values.apply = true;
    else if (token === "--verify") values.verify = true;
    else if ([
      "--database", "--allowed-root", "--label", "--code-version",
      "--expected-plan-fingerprint", "--expected-conflict-fingerprint",
      "--backup-file", "--backup-sha256", "--batch-size"
    ].includes(token)) {
      values[token.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error("CUSTOMER_IDENTITY_CASE_ARGUMENT_INVALID");
    }
  }
  if ([values.dryRun, values.apply, values.verify].filter(Boolean).length !== 1) {
    throw new Error("CUSTOMER_IDENTITY_CASE_MODE_REQUIRED");
  }
  return values;
}

function resolveDatabasePath(args) {
  const databasePath = path.resolve(String(args.database || ""));
  const allowedRoot = path.resolve(String(args["allowed-root"] || ""));
  if (!args.database || !args["allowed-root"] || !isPathInside(allowedRoot, databasePath)) {
    throw new Error("CUSTOMER_IDENTITY_CASE_PATH_NOT_AUTHORIZED");
  }
  if (!fs.existsSync(databasePath) || !fs.statSync(databasePath).isFile()) {
    throw new Error("CUSTOMER_IDENTITY_CASE_DATABASE_NOT_FOUND");
  }
  return fs.realpathSync.native(databasePath);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function openWritableDatabase(databasePath) {
  return new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(databasePath, (error) => (
      error ? reject(error) : resolve(connection)
    ));
  });
}

function closeDatabase(connection) {
  return new Promise((resolve, reject) => {
    connection.close((error) => error ? reject(error) : resolve());
  });
}

function createRawDbApi(connection) {
  return {
    run: (sql, params = []) => new Promise((resolve, reject) => {
      connection.run(assertIdentityCaseSql(sql), params, function onRun(error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    }),
    get: (sql, params = []) => new Promise((resolve, reject) => {
      connection.get(assertIdentityCaseSql(sql), params, (error, row) => (
        error ? reject(error) : resolve(row)
      ));
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
      connection.all(assertIdentityCaseSql(sql), params, (error, rows) => (
        error ? reject(error) : resolve(rows)
      ));
    })
  };
}

async function loadInputs(db) {
  const conflicts = await db.all(
    `SELECT id, conflict_type, severity, status, rule_version, evidence_json,
            resolution_type, resolution_reason, resolved_by, resolved_at,
            created_at, updated_at, reopened_at
     FROM customer_identity_conflicts`
  );
  const participants = await db.all(
    `SELECT id, conflict_id, participant_type, participant_id, role, created_at
     FROM customer_identity_conflict_participants`
  );
  const sourceLinks = await db.all(
    "SELECT id, master_id, source_type, status, source_hash FROM customer_master_sources"
  );
  return { conflicts, participants, sourceLinks };
}

async function protectedState(db, loaded) {
  const sourceCounts = {
    contacts: Number((await db.get("SELECT COUNT(*) AS total FROM contacts"))?.total || 0),
    crm_contacts: Number((await db.get("SELECT COUNT(*) AS total FROM crm_contacts"))?.total || 0)
  };
  const masterState = await db.all(
    `SELECT id, status, eligibility_status, eligibility_reasons_json,
            eligibility_evaluated_at, deleted_at
     FROM customer_master_records ORDER BY id`
  );
  const sourceState = [...loaded.sourceLinks].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const conflictStatus = await db.all(
    "SELECT status, COUNT(*) AS total FROM customer_identity_conflicts GROUP BY status ORDER BY status"
  );
  const mergeHistory = Number((await db.get(
    "SELECT COUNT(*) AS total FROM customer_master_merge_history"
  ))?.total || 0);
  return {
    sourceCounts,
    conflicts: loaded.conflicts.length,
    participants: loaded.participants.length,
    conflictFingerprint: conflictStateFingerprint(loaded.conflicts, loaded.participants),
    masterFingerprint: sha256(stableStringify(masterState)),
    sourceLinkFingerprint: sha256(stableStringify(sourceState)),
    conflictStatus,
    mergeHistory
  };
}

function evaluateEstimate(stats) {
  const queueDeltas = Object.fromEntries(
    Object.entries(EXPECTED.byQueue).map(([queue, expected]) => [
      queue,
      {
        expected,
        observed: Number(stats.byQueue[queue] || 0),
        delta: Number(stats.byQueue[queue] || 0) - expected
      }
    ])
  );
  const totalDelta = stats.totalCases - EXPECTED.totalCases;
  const material = Math.abs(totalDelta) > Math.max(100, EXPECTED.totalCases * 0.02)
    || Object.values(queueDeltas).some(({ expected, delta }) => (
      Math.abs(delta) > Math.max(100, expected * 0.02)
    ));
  return {
    expectedTotalCases: EXPECTED.totalCases,
    observedTotalCases: stats.totalCases,
    totalDelta,
    queueDeltas,
    material
  };
}

function assertSanitizedPlan(plan) {
  const values = [
    ...plan.cases.map((row) => row.summary_json),
    ...plan.events.map((row) => `${row.before_json}|${row.after_json}|${row.reason}`)
  ].join("\n");
  const findings = [];
  if (/\b(cmr|cms|cmi|cic|cip|cicase|cice):/i.test(values)) findings.push("INTERNAL_ID");
  if (/[a-f0-9]{64}/i.test(values)) findings.push("HASH");
  if (/\b\d{11}\b/.test(values)) findings.push("CPF_LIKE");
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+/i.test(values)) findings.push("EMAIL_LIKE");
  if (findings.length) throw new Error(`CUSTOMER_IDENTITY_CASE_PII:${findings.join(",")}`);
  return { sanitized: true, findings: [] };
}

function buildPlan(loaded, args, runAt) {
  return buildCustomerIdentityCasePlan({
    ...loaded,
    runAt,
    codeVersion: String(args["code-version"] || "LOCAL_UNCOMMITTED")
  });
}

function validateExpectedFingerprints(plan, args) {
  const expectedPlan = String(args["expected-plan-fingerprint"] || "");
  const expectedConflict = String(args["expected-conflict-fingerprint"] || "");
  if (!/^[a-f0-9]{64}$/.test(expectedPlan) || plan.planFingerprint !== expectedPlan) {
    throw new Error("CUSTOMER_IDENTITY_CASE_PLAN_FINGERPRINT_MISMATCH");
  }
  if (!/^[a-f0-9]{64}$/.test(expectedConflict)
    || plan.originalConflictFingerprint !== expectedConflict) {
    throw new Error("CUSTOMER_IDENTITY_CASE_CONFLICT_FINGERPRINT_MISMATCH");
  }
}

function validateBackup(databasePath, args) {
  const backupFile = String(args["backup-file"] || "");
  const backupSha = String(args["backup-sha256"] || "").toLowerCase();
  if (!backupFile || !fs.existsSync(backupFile) || !/^[a-f0-9]{64}$/.test(backupSha)) {
    throw new Error("CUSTOMER_IDENTITY_CASE_BACKUP_REQUIRED");
  }
  const sourceStat = fs.statSync(databasePath);
  const backupStat = fs.statSync(backupFile);
  if (sourceStat.size !== backupStat.size || sha256File(backupFile) !== backupSha) {
    throw new Error("CUSTOMER_IDENTITY_CASE_BACKUP_INVALID");
  }
}

function safeOutputBase(args, mode, startedAt) {
  return {
    mode,
    database: String(args.label || "authorized-local-database"),
    codeVersion: String(args["code-version"] || "LOCAL_UNCOMMITTED"),
    serviceVersion: CASE_SERVICE_VERSION,
    groupingVersion: CASE_GROUPING_VERSION,
    performance: { durationMs: Date.now() - startedAt }
  };
}

async function runDryRun(args, databasePath, startedAt) {
  const database = await createReadOnlyDatabase({
    databasePath,
    allowedRoots: [path.resolve(args["allowed-root"])],
    readOnly: true
  });
  try {
    const before = await captureSnapshot(database, database.databasePath);
    const integrity = await readIntegrity(database);
    const loaded = await loadInputs(database);
    const protectedBefore = await protectedState(database, loaded);
    const plan = buildPlan(loaded, args, "DRY_RUN_NOT_PERSISTED");
    const estimate = evaluateEstimate(plan.stats);
    const sanitization = assertSanitizedPlan(plan);
    const after = await captureSnapshot(database, database.databasePath);
    const invariantsUnchanged = stableStringify(before) === stableStringify(after);
    const valid = integrity.status === "ok"
      && invariantsUnchanged
      && loaded.conflicts.length === EXPECTED.conflicts
      && plan.stats.linkedConflicts === loaded.conflicts.length
      && !estimate.material;
    return {
      status: valid ? "DRY_RUN_OK" : "BLOQUEADO_AGRUPAMENTO_INCONSISTENTE",
      ...safeOutputBase(args, "DRY_RUN", startedAt),
      openMode: database.openMode,
      queryOnly: before.queryOnly,
      integrity,
      invariantsUnchanged,
      planFingerprint: plan.planFingerprint,
      originalConflictFingerprint: plan.originalConflictFingerprint,
      protectedState: protectedBefore,
      stats: plan.stats,
      estimate,
      sanitization,
      sqlCategories: { ...database.sqlCategories }
    };
  } finally {
    await database.close();
  }
}

async function runVerify(args, databasePath, startedAt) {
  const database = await createReadOnlyDatabase({
    databasePath,
    allowedRoots: [path.resolve(args["allowed-root"])],
    readOnly: true
  });
  try {
    const integrity = await readIntegrity(database);
    const schema = await getCustomerIdentityCaseSchemaStatus(database);
    if (!schema.ready) throw new Error("CUSTOMER_IDENTITY_CASE_SCHEMA_NOT_READY");
    const loaded = await loadInputs(database);
    const plan = buildPlan(loaded, args, "VERIFY_NOT_PERSISTED");
    validateExpectedFingerprints(plan, args);
    const verification = await verifyCustomerIdentityCasePlan(database, plan);
    const protectedNow = await protectedState(database, loaded);
    const valid = integrity.status === "ok"
      && verification.consistent
      && protectedNow.conflictFingerprint === plan.originalConflictFingerprint;
    return {
      status: valid ? "VERIFY_OK" : "BLOQUEADO_DADOS_ORIGINAIS",
      ...safeOutputBase(args, "VERIFY", startedAt),
      openMode: database.openMode,
      integrity,
      planFingerprint: plan.planFingerprint,
      originalConflictFingerprint: plan.originalConflictFingerprint,
      stats: plan.stats,
      verification,
      protectedState: protectedNow
    };
  } finally {
    await database.close();
  }
}

async function runApply(args, databasePath, startedAt) {
  validateBackup(databasePath, args);
  const connection = await openWritableDatabase(databasePath);
  try {
    const db = createCustomerIdentityCaseWriteRepository(createRawDbApi(connection));
    await db.run("PRAGMA busy_timeout = 5000");
    await db.run("PRAGMA foreign_keys = ON");
    const loadedBefore = await loadInputs(db);
    const protectedBefore = await protectedState(db, loadedBefore);
    if (protectedBefore.conflicts !== EXPECTED.conflicts) {
      throw new Error("CUSTOMER_IDENTITY_CASE_CONFLICT_COUNT_MISMATCH");
    }
    const plan = buildPlan(loadedBefore, args, new Date().toISOString());
    validateExpectedFingerprints(plan, args);
    assertSanitizedPlan(plan);
    const estimate = evaluateEstimate(plan.stats);
    if (estimate.material) {
      throw new Error("CUSTOMER_IDENTITY_CASE_GROUPING_MATERIAL_DIVERGENCE");
    }

    const schema = await applyCustomerIdentityCaseSchema(db);
    if (!schema.after.ready) throw new Error("CUSTOMER_IDENTITY_CASE_SCHEMA_NOT_READY");
    const stats = await executeCustomerIdentityCasePlan(db, plan, {
      batchSize: Number(args["batch-size"] || 0) || undefined
    });
    const verification = await verifyCustomerIdentityCasePlan(db, plan);
    const loadedAfter = await loadInputs(db);
    const protectedAfter = await protectedState(db, loadedAfter);
    const originalsIntact = stableStringify(protectedBefore) === stableStringify(protectedAfter);
    const valid = verification.consistent && originalsIntact;
    return {
      status: valid ? "APPLY_OK" : "BLOQUEADO_DADOS_ORIGINAIS",
      ...safeOutputBase(args, "APPLY", startedAt),
      planFingerprint: plan.planFingerprint,
      originalConflictFingerprint: plan.originalConflictFingerprint,
      planStats: plan.stats,
      applyStats: stats,
      verification,
      originalsIntact,
      protectedBefore,
      protectedAfter,
      schema: {
        version: schema.schemaVersion,
        statementsExecuted: schema.statementsExecuted,
        ready: schema.after.ready
      }
    };
  } finally {
    await closeDatabase(connection);
  }
}

async function main() {
  const startedAt = Date.now();
  try {
    const args = parseArgs(process.argv.slice(2));
    const databasePath = resolveDatabasePath(args);
    const output = args.dryRun
      ? await runDryRun(args, databasePath, startedAt)
      : args.verify
        ? await runVerify(args, databasePath, startedAt)
        : await runApply(args, databasePath, startedAt);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = ["DRY_RUN_OK", "VERIFY_OK", "APPLY_OK"].includes(output.status) ? 0 : 4;
  } catch (error) {
    const message = String(error?.message || "");
    const code = /^CUSTOMER_IDENTITY_CASE_[A-Z0-9_:,]+$/.test(message)
      ? message.split(":")[0]
      : "CUSTOMER_IDENTITY_CASE_FAILED_SAFELY";
    process.stderr.write(`${JSON.stringify({ status: "BLOCKED", error: code })}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  EXPECTED,
  parseArgs,
  resolveDatabasePath,
  loadInputs,
  protectedState,
  evaluateEstimate,
  assertSanitizedPlan,
  validateExpectedFingerprints,
  main
};
