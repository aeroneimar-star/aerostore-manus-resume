"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const sqlite3 = require("sqlite3").verbose();
const {
  isPathInside
} = require("../modules/customers/master/calibration/customerMasterReadOnlyCalibration");
const {
  resolveCalibrationLimits
} = require("../modules/customers/master/calibration/customerMasterCalibrationLimits");
const {
  applyCustomerMasterSchema,
  getCustomerMasterSchemaStatus,
  CUSTOMER_MASTER_TABLES
} = require("../modules/customers/master/persistence/customerMasterSchema");
const {
  createCustomerMasterWriteRepository,
  assertControlledWriteSql
} = require("../modules/customers/master/persistence/customerMasterWriteRepository");
const {
  createCustomerMasterSourceReader
} = require("../modules/customers/master/backfill/customerMasterSourceReader");
const {
  APPLY_SERVICE_VERSION,
  APPLY_JOB_TYPE,
  buildCustomerMasterPersistencePlan,
  computeCustomerMasterApplyInput,
  executeCustomerMasterPersistencePlan,
  finalizeCustomerMasterApplyJob,
  verifyCustomerMasterApplyState
} = require("../modules/customers/master/backfill/customerMasterControlledApply");

const BLOCKED = {
  ESTADO: "BLOQUEADO_ESTADO_LOCAL",
  BACKUP: "BLOQUEADO_BACKUP",
  FINGERPRINT: "BLOQUEADO_FINGERPRINT_DIVERGENTE",
  APPLY: "BLOQUEADO_APPLY",
  IDEMPOTENCIA: "BLOQUEADO_IDEMPOTENCIA",
  DADOS_ORIGEM: "BLOQUEADO_DADOS_ORIGEM"
};

function parseArgs(argv) {
  const values = { apply: false, verify: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") values.apply = true;
    else if (token === "--verify") values.verify = true;
    else if ([
      "--database",
      "--allowed-root",
      "--label",
      "--code-version",
      "--limit-profile",
      "--expected-fingerprint",
      "--expected-records",
      "--backup-file",
      "--backup-sha256",
      "--batch-size"
    ].includes(token)) {
      values[token.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error("CUSTOMER_MASTER_APPLY_ARGUMENT_INVALID");
    }
  }
  if (values.apply === values.verify) {
    throw new Error("CUSTOMER_MASTER_APPLY_MODE_REQUIRED");
  }
  return values;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function resolveDatabasePath(options) {
  const databasePath = String(options.database || "").trim();
  if (!databasePath) throw new Error("CUSTOMER_MASTER_APPLY_DATABASE_PATH_REQUIRED");
  const resolved = path.resolve(databasePath);
  const root = String(options["allowed-root"] || "").trim();
  if (!root || !isPathInside(path.resolve(root), resolved)) {
    throw new Error("CUSTOMER_MASTER_APPLY_PATH_NOT_AUTHORIZED");
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("CUSTOMER_MASTER_APPLY_DATABASE_NOT_FOUND");
  }
  return fs.realpathSync.native(resolved);
}

function openWritableDatabase(databasePath) {
  return new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(databasePath, (error) => {
      if (error) reject(error);
      else resolve(connection);
    });
  });
}

function closeDatabase(connection) {
  return new Promise((resolve, reject) => {
    connection.close((error) => (error ? reject(error) : resolve()));
  });
}

function createDbApi(connection) {
  return {
    run: (sql, params = []) => new Promise((resolve, reject) => {
      connection.run(assertControlledWriteSql(sql), params, function onRun(error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    }),
    get: (sql, params = []) => new Promise((resolve, reject) => {
      connection.get(assertControlledWriteSql(sql), params, (error, row) => {
        if (error) reject(error);
        else resolve(row);
      });
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
      connection.all(assertControlledWriteSql(sql), params, (error, rows) => {
        if (error) reject(error);
        else resolve(rows);
      });
    })
  };
}

async function legacySnapshot(dbApi, databasePath) {
  const stat = fs.statSync(databasePath);
  const tables = await dbApi.all(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('contacts', 'crm_contacts') ORDER BY name ASC"
  );
  const contacts = Number((await dbApi.get("SELECT COUNT(*) AS total FROM contacts"))?.total || 0);
  const crmContacts = Number((await dbApi.get("SELECT COUNT(*) AS total FROM crm_contacts"))?.total || 0);
  const quickCheck = await dbApi.all("PRAGMA quick_check");
  const quickCheckValues = quickCheck.flatMap((row) => Object.values(row).map(String));
  const schemaVersion = Number((await dbApi.get("PRAGMA schema_version"))?.schema_version || 0);
  const userVersion = Number((await dbApi.get("PRAGMA user_version"))?.user_version || 0);
  return {
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    quickCheck: quickCheckValues.length === 1 && quickCheckValues[0].toLowerCase() === "ok" ? "ok" : "failed",
    schemaVersion,
    userVersion,
    contacts,
    crm_contacts: crmContacts,
    legacySchemaHash: crypto.createHash("sha256")
      .update(JSON.stringify(tables.map((table) => ({ name: table.name, sql: String(table.sql || "").replace(/\s+/g, " ").trim() }))))
      .digest("hex")
  };
}

async function masterCounts(dbApi) {
  const counts = {};
  for (const table of CUSTOMER_MASTER_TABLES) {
    counts[table] = Number((await dbApi.get(`SELECT COUNT(*) AS total FROM ${table}`))?.total || 0);
  }
  return counts;
}

function blockedOutput(code, details = {}) {
  return { status: code, ...details };
}

function legacySourcesRemainIntact(before, after) {
  return Boolean(before && after)
    && before.contacts === after.contacts
    && before.crm_contacts === after.crm_contacts
    && before.legacySchemaHash === after.legacySchemaHash
    && before.userVersion === after.userVersion;
}

async function main() {
  const startedAt = Date.now();
  const memoryBaseline = process.memoryUsage().rss;
  let memoryPeak = memoryBaseline;
  const memoryTimer = setInterval(() => {
    memoryPeak = Math.max(memoryPeak, process.memoryUsage().rss);
  }, 500);
  try {
    const args = parseArgs(process.argv.slice(2));
    const databasePath = resolveDatabasePath(args);
    const label = String(args.label || "authorized-local-database");
    const codeVersion = String(args["code-version"] || "LOCAL_UNCOMMITTED");
    const limits = resolveCalibrationLimits(args["limit-profile"]);
    const expectedFingerprint = String(args["expected-fingerprint"] || "").trim();
    const expectedRecords = Number(args["expected-records"] || 0);

    const connection = await openWritableDatabase(databasePath);
    const dbApi = createDbApi(connection);
    const db = createCustomerMasterWriteRepository(dbApi);
    try {
      await db.run("PRAGMA busy_timeout = 5000");
      await db.run("PRAGMA foreign_keys = ON");

      const before = await legacySnapshot(db, databasePath);
      if (before.quickCheck !== "ok") {
        process.stdout.write(`${JSON.stringify(blockedOutput(BLOCKED.DADOS_ORIGEM, { database: label, quickCheck: before.quickCheck }), null, 2)}\n`);
        process.exitCode = 5;
        return;
      }
      if (expectedRecords && before.contacts + before.crm_contacts !== expectedRecords) {
        process.stdout.write(`${JSON.stringify(blockedOutput(BLOCKED.DADOS_ORIGEM, {
          database: label,
          observedRecords: before.contacts + before.crm_contacts,
          expectedRecords
        }), null, 2)}\n`);
        process.exitCode = 5;
        return;
      }

      if (args.apply) {
        const backupFile = String(args["backup-file"] || "").trim();
        const backupSha = String(args["backup-sha256"] || "").trim().toLowerCase();
        if (!backupFile || !fs.existsSync(backupFile) || !/^[a-f0-9]{64}$/.test(backupSha)) {
          process.stdout.write(`${JSON.stringify(blockedOutput(BLOCKED.BACKUP, { reason: "BACKUP_FILE_OR_HASH_MISSING" }), null, 2)}\n`);
          process.exitCode = 3;
          return;
        }
        const backupStat = fs.statSync(backupFile);
        const actualBackupSha = sha256File(backupFile);
        if (actualBackupSha !== backupSha || backupStat.size !== before.sizeBytes) {
          process.stdout.write(`${JSON.stringify(blockedOutput(BLOCKED.BACKUP, {
            reason: "BACKUP_HASH_OR_SIZE_MISMATCH",
            backupSizeBytes: backupStat.size,
            backupSha256Matches: actualBackupSha === backupSha
          }), null, 2)}\n`);
          process.exitCode = 3;
          return;
        }
      }

      if (args.apply) {
        const schemaResult = await applyCustomerMasterSchema(db);
        if (!schemaResult.after.ready) {
          process.stdout.write(`${JSON.stringify(blockedOutput(BLOCKED.APPLY, { reason: "MASTER_SCHEMA_NOT_READY" }), null, 2)}\n`);
          process.exitCode = 4;
          return;
        }
      } else {
        const schemaStatus = await getCustomerMasterSchemaStatus(db);
        if (!schemaStatus.ready) {
          process.stdout.write(`${JSON.stringify(blockedOutput(BLOCKED.APPLY, { reason: "MASTER_SCHEMA_NOT_READY" }), null, 2)}\n`);
          process.exitCode = 4;
          return;
        }
      }

      const reader = createCustomerMasterSourceReader(db);
      const input = await computeCustomerMasterApplyInput(reader, {
        limits,
        codeVersion
      });
      const totalRead = input.records.length;

      if (!/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
        process.stdout.write(`${JSON.stringify(blockedOutput(BLOCKED.FINGERPRINT, { reason: "EXPECTED_FINGERPRINT_REQUIRED" }), null, 2)}\n`);
        process.exitCode = 6;
        return;
      }
      if (input.fingerprint !== expectedFingerprint) {
        process.stdout.write(`${JSON.stringify(blockedOutput(BLOCKED.FINGERPRINT, {
          database: label,
          observedFingerprint: input.fingerprint
        }), null, 2)}\n`);
        process.exitCode = 6;
        return;
      }

      const runAt = new Date().toISOString();
      const plan = buildCustomerMasterPersistencePlan({
        records: input.records,
        candidates: input.candidates,
        conflicts: input.conflicts,
        runAt,
        inputFingerprint: input.fingerprint,
        jobType: APPLY_JOB_TYPE
      });

      if (args.verify) {
        const verification = await verifyCustomerMasterApplyState(db, plan);
        const after = await legacySnapshot(db, databasePath);
        const sourcesIntact = legacySourcesRemainIntact(before, after);
        const output = {
          status: verification.consistent && sourcesIntact ? "VERIFY_OK" : BLOCKED.IDEMPOTENCIA,
          mode: "VERIFY",
          database: label,
          codeVersion,
          serviceVersion: APPLY_SERVICE_VERSION,
          inputFingerprint: input.fingerprint,
          recordsRead: totalRead,
          planned: {
            masters: plan.masters.length,
            sources: plan.sources.length,
            identifiers: plan.identifiers.length,
            conflicts: plan.conflicts.length,
            participants: plan.participants.length,
            checkpoints: plan.checkpoints.length
          },
          verification,
          sourcesIntact,
          countsBefore: { contacts: before.contacts, crm_contacts: before.crm_contacts },
          countsAfter: { contacts: after.contacts, crm_contacts: after.crm_contacts },
          performance: {
            durationMs: Date.now() - startedAt,
            memoryPeakBytes: memoryPeak
          }
        };
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        process.exitCode = output.status === "VERIFY_OK" ? 0 : 7;
        return;
      }

      let stats;
      let applyError = null;
      try {
        stats = await executeCustomerMasterPersistencePlan(db, plan, {
          batchSize: Number(args["batch-size"] || 0) || undefined,
          runAt,
          codeVersion,
          schemaVersion: "customer-master-schema/v1"
        });
      } catch (error) {
        applyError = error;
        stats = createFailedStatsNote();
      }
      const finishedAt = new Date().toISOString();
      const after = applyError ? null : await legacySnapshot(db, databasePath);
      const verification = applyError ? null : await verifyCustomerMasterApplyState(db, plan);
      const sourcesIntact = !applyError && legacySourcesRemainIntact(before, after);
      const blockingMatches = !applyError
        && verification.blockingConflictsPersisted === input.conflictSummary.blockingConflictCount;
      const success = !applyError && verification.consistent && sourcesIntact && blockingMatches;

      await finalizeCustomerMasterApplyJob(db, plan, {
        status: success ? "COMPLETED" : "FAILED",
        counts: {
          recordsRead: totalRead,
          batches: stats.batches,
          masters: { created: stats.mastersCreated, unchanged: stats.mastersUnchanged },
          sources: {
            created: stats.sourcesCreated,
            updated: stats.sourcesUpdated,
            unchanged: stats.sourcesUnchanged
          },
          identifiers: { created: stats.identifiersCreated, unchanged: stats.identifiersUnchanged },
          conflicts: { created: stats.conflictsCreated, unchanged: stats.conflictsUnchanged },
          participants: { created: stats.participantsCreated, unchanged: stats.participantsUnchanged },
          conflictsPlanned: plan.conflicts.length,
          blockingConflicts: input.conflictSummary.blockingConflictCount,
          failures: applyError ? 1 : 0
        },
        checkpoint: success ? { phase: "COMPLETED" } : { phase: "FAILED" },
        finishedAt,
        errorCode: applyError ? "CUSTOMER_MASTER_APPLY_EXECUTION_FAILED" : "",
        errorSummary: ""
      });

      const output = {
        status: success ? "APPLY_OK" : BLOCKED.APPLY,
        mode: "APPLY",
        database: label,
        codeVersion,
        serviceVersion: APPLY_SERVICE_VERSION,
        jobId: plan.jobId,
        inputFingerprint: input.fingerprint,
        recordsRead: totalRead,
        stats,
        verification: verification || null,
        blockingConflictsPersistedMatch: blockingMatches,
        sourcesIntact,
        legacy: {
          before,
          after
        },
        masterCountsAfter: applyError ? null : await masterCounts(db),
        performance: {
          durationMs: Date.now() - startedAt,
          memoryBaselineBytes: memoryBaseline,
          memoryPeakBytes: memoryPeak
        }
      };
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      process.exitCode = success ? 0 : 4;
    } finally {
      await closeDatabase(connection);
    }
  } catch (error) {
    const code = /^[A-Z0-9_:.\-]+$/.test(String(error?.message || ""))
      ? String(error.message).split(":")[0]
      : "CUSTOMER_MASTER_APPLY_FAILED_SAFELY";
    process.stderr.write(`${JSON.stringify(blockedOutput(BLOCKED.APPLY, { error: code }), null, 2)}\n`);
    process.exitCode = 2;
  } finally {
    clearInterval(memoryTimer);
  }
}

function createFailedStatsNote() {
  return { failed: true };
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  sha256File,
  resolveDatabasePath,
  legacySnapshot,
  legacySourcesRemainIntact,
  main
};
