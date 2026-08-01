"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const sqlite3 = require("sqlite3");
const {
  isPathInside
} = require("../modules/customers/master/calibration/customerMasterReadOnlyCalibration");
const {
  createCustomerMasterSourceReader
} = require("../modules/customers/master/backfill/customerMasterSourceReader");
const {
  stableStringify
} = require("../modules/customers/master/backfill/customerMasterSourceModel");
const {
  previewCustomerMasterIncrementalSync,
  runCustomerMasterIncrementalSync,
  SOURCE_TYPES
} = require("../modules/customers/master/incremental/customerMasterIncrementalSyncService");
const {
  MASTER_TABLES,
  auditCustomerMasterIntegrity
} = require("../modules/customers/master/hardening/customerMasterIntegrityAudit");

const MODES = Object.freeze(["dry-run", "apply", "verify"]);

function parseArgs(argv) {
  const args = {};
  const valueOptions = new Set([
    "database", "allowed-root", "backup-file", "backup-sha256", "code-version",
    "source", "page-size", "max-pages", "label"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (["--dry-run", "--apply", "--verify"].includes(token)) {
      args[token.slice(2)] = true;
    } else if (token.startsWith("--") && valueOptions.has(token.slice(2))) {
      if (argv[index + 1] == null) throw new Error("CUSTOMER_MASTER_INCREMENTAL_ARGUMENT_INVALID");
      args[token.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      throw new Error("CUSTOMER_MASTER_INCREMENTAL_ARGUMENT_INVALID");
    }
  }
  const selected = MODES.filter((mode) => args[mode]);
  if (selected.length !== 1) throw new Error("CUSTOMER_MASTER_INCREMENTAL_MODE_REQUIRED");
  return { ...args, mode: selected[0] };
}

function resolveAuthorizedFile(fileValue, rootValue, errorCode) {
  const configured = String(fileValue || "").trim();
  const root = String(rootValue || "").trim();
  if (!configured || !root) throw new Error(errorCode);
  const resolved = path.resolve(configured);
  const allowedRoot = path.resolve(root);
  if (!isPathInside(allowedRoot, resolved) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(errorCode);
  }
  return fs.realpathSync.native(resolved);
}

function openDb(databasePath, readOnly) {
  const flags = readOnly ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE;
  return new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(databasePath, flags, (error) => {
      if (error) reject(error);
      else resolve(connection);
    });
  });
}

function createDbApi(connection) {
  return {
    run: (sql, params = []) => new Promise((resolve, reject) => {
      connection.run(sql, params, function onRun(error) {
        if (error) reject(error);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    }),
    get: (sql, params = []) => new Promise((resolve, reject) => {
      connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
      connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    }),
    close: () => new Promise((resolve, reject) => {
      connection.close((error) => error ? reject(error) : resolve());
    })
  };
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function sidecarState(databasePath) {
  return ["-wal", "-shm", "-journal"].map((suffix) => {
    const candidate = `${databasePath}${suffix}`;
    return {
      type: suffix.slice(1),
      exists: fs.existsSync(candidate),
      sizeBytes: fs.existsSync(candidate) ? fs.statSync(candidate).size : 0
    };
  });
}

async function sourceFingerprint(db, table) {
  const columns = await db.all(`PRAGMA table_info(${table})`);
  const names = columns.map((column) => String(column.name));
  if (!names.length || !names.includes("id")) {
    throw new Error("CUSTOMER_MASTER_INCREMENTAL_SOURCE_SCHEMA_INVALID");
  }
  const quoted = names.map((name) => `"${name.replace(/"/g, "\"\"")}"`).join(", ");
  const rows = await db.all(`SELECT ${quoted} FROM ${table} ORDER BY id ASC`);
  const hash = crypto.createHash("sha256");
  for (const row of rows) hash.update(stableStringify(row));
  return { count: rows.length, fingerprint: hash.digest("hex") };
}

async function captureSnapshot(db, databasePath) {
  const [contacts, crmContacts] = await Promise.all([
    sourceFingerprint(db, "contacts"),
    sourceFingerprint(db, "crm_contacts")
  ]);
  const legacySchema = await db.all(
    `SELECT name, sql FROM sqlite_master
      WHERE type = 'table' AND name IN ('contacts', 'crm_contacts') ORDER BY name ASC`
  );
  const schemaVersion = Number((await db.get("PRAGMA schema_version"))?.schema_version || 0);
  const userVersion = Number((await db.get("PRAGMA user_version"))?.user_version || 0);
  const checkpoints = await db.all(
    `SELECT source_type, cursor_updated_at, cursor_source_id, status
       FROM customer_master_sync_checkpoints ORDER BY source_type ASC`
  );
  const counts = {};
  for (const table of MASTER_TABLES) {
    counts[table] = Number((await db.get(`SELECT COUNT(*) AS total FROM ${table}`))?.total || 0);
  }
  return {
    sizeBytes: fs.statSync(databasePath).size,
    schemaVersion,
    userVersion,
    sourceCounts: { contacts: contacts.count, crm_contacts: crmContacts.count },
    sourceFingerprints: {
      contacts: contacts.fingerprint,
      crm_contacts: crmContacts.fingerprint
    },
    legacySchemaFingerprint: crypto.createHash("sha256").update(stableStringify(legacySchema)).digest("hex"),
    checkpoints,
    counts,
    integrity: await auditCustomerMasterIntegrity(db),
    sidecars: sidecarState(databasePath)
  };
}

function sourcesIntact(before, after) {
  return stableStringify(before.sourceCounts) === stableStringify(after.sourceCounts)
    && stableStringify(before.sourceFingerprints) === stableStringify(after.sourceFingerprints)
    && before.legacySchemaFingerprint === after.legacySchemaFingerprint
    && before.userVersion === after.userVersion;
}

async function openConfigured(databasePath, readOnly) {
  const connection = await openDb(databasePath, readOnly);
  const db = createDbApi(connection);
  await db.run("PRAGMA busy_timeout = 5000");
  await db.run("PRAGMA foreign_keys = ON");
  if (readOnly) {
    await db.run("PRAGMA query_only = ON");
    const queryOnly = await db.get("PRAGMA query_only");
    if (Number(queryOnly?.query_only) !== 1) {
      await db.close();
      throw new Error("CUSTOMER_MASTER_INCREMENTAL_READONLY_REQUIRED");
    }
  }
  return db;
}

async function validateBackup(args, databasePath, before) {
  const backupPath = resolveAuthorizedFile(
    args["backup-file"], args["allowed-root"], "CUSTOMER_MASTER_INCREMENTAL_BACKUP_REQUIRED"
  );
  if (backupPath === databasePath) throw new Error("CUSTOMER_MASTER_INCREMENTAL_BACKUP_REQUIRED");
  const expectedSha = String(args["backup-sha256"] || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha)) {
    throw new Error("CUSTOMER_MASTER_INCREMENTAL_BACKUP_REQUIRED");
  }
  const actualSha = await sha256File(backupPath);
  if (actualSha !== expectedSha || fs.statSync(backupPath).size !== before.sizeBytes) {
    throw new Error("CUSTOMER_MASTER_INCREMENTAL_BACKUP_INVALID");
  }
  const backupDb = await openConfigured(backupPath, true);
  try {
    const backupSnapshot = await captureSnapshot(backupDb, backupPath);
    if (backupSnapshot.integrity.quickCheck !== "ok"
      || !sourcesIntact(before, backupSnapshot)
      || stableStringify(before.counts) !== stableStringify(backupSnapshot.counts)) {
      throw new Error("CUSTOMER_MASTER_INCREMENTAL_BACKUP_INVALID");
    }
  } finally {
    await backupDb.close();
  }
  return {
    file: path.basename(backupPath),
    sizeBytes: fs.statSync(backupPath).size,
    sha256: actualSha,
    quickCheck: "ok"
  };
}

function syncOptions(args, db) {
  const sourceOption = String(args.source || "all");
  return {
    db,
    reader: createCustomerMasterSourceReader(db),
    sourceTypes: sourceOption === "all" ? SOURCE_TYPES : [sourceOption],
    codeVersion: String(args["code-version"] || "LOCAL_UNCOMMITTED"),
    pageSize: args["page-size"] || undefined,
    maxPages: args["max-pages"] || undefined
  };
}

async function runReadOnlyMode(args, databasePath) {
  const db = await openConfigured(databasePath, true);
  try {
    const before = await captureSnapshot(db, databasePath);
    const preview = await previewCustomerMasterIncrementalSync(syncOptions(args, db));
    const after = await captureSnapshot(db, databasePath);
    const intact = sourcesIntact(before, after)
      && stableStringify(before.counts) === stableStringify(after.counts)
      && stableStringify(before.checkpoints) === stableStringify(after.checkpoints);
    const verified = args.mode === "dry-run"
      ? preview.status === "COMPLETE" && intact && before.integrity.integrityOk
      : preview.status === "COMPLETE" && preview.stats.scanned === 0
        && intact && before.integrity.integrityOk;
    return {
      status: verified ? (args.mode === "dry-run" ? "DRY_RUN_OK" : "VERIFY_OK") : "BLOQUEADO_SYNC_REAL",
      mode: args.mode.toUpperCase().replace("-", "_"),
      database: String(args.label || "authorized-local-database"),
      preview,
      checkpointsBefore: before.checkpoints,
      checkpointsAfter: after.checkpoints,
      sourcesIntact: intact,
      sourceCountsBefore: before.sourceCounts,
      sourceCountsAfter: after.sourceCounts,
      integrity: before.integrity,
      schemaVersion: before.schemaVersion,
      userVersion: before.userVersion,
      sidecars: before.sidecars
    };
  } finally {
    await db.close();
  }
}

async function runApplyMode(args, databasePath) {
  if (sidecarState(databasePath).some((item) => item.exists && item.sizeBytes > 0)) {
    throw new Error("CUSTOMER_MASTER_INCREMENTAL_SIDECAR_ACTIVE");
  }
  const preflightDb = await openConfigured(databasePath, true);
  let preflight;
  try {
    preflight = await captureSnapshot(preflightDb, databasePath);
  } finally {
    await preflightDb.close();
  }
  if (!preflight.integrity.integrityOk) throw new Error("CUSTOMER_MASTER_INCREMENTAL_INTEGRITY_FAILED");
  const backup = await validateBackup(args, databasePath, preflight);
  const db = await openConfigured(databasePath, false);
  try {
    const before = await captureSnapshot(db, databasePath);
    if (!sourcesIntact(preflight, before)
      || stableStringify(preflight.counts) !== stableStringify(before.counts)) {
      throw new Error("CUSTOMER_MASTER_INCREMENTAL_CONCURRENT_CHANGE");
    }
    const result = await runCustomerMasterIncrementalSync(syncOptions(args, db));
    const after = await captureSnapshot(db, databasePath);
    const intact = sourcesIntact(before, after);
    const success = result.status === "COMPLETE"
      && intact
      && after.integrity.integrityOk
      && after.integrity.releasedEligibility === 0;
    return {
      status: success ? "APPLY_OK" : "BLOQUEADO_SYNC_REAL",
      mode: "APPLY",
      database: String(args.label || "authorized-local-database"),
      backup,
      result,
      checkpointsBefore: before.checkpoints,
      checkpointsAfter: after.checkpoints,
      sourcesIntact: intact,
      sourceCountsBefore: before.sourceCounts,
      sourceCountsAfter: after.sourceCounts,
      countsBefore: before.counts,
      countsAfter: after.counts,
      integrityBefore: before.integrity,
      integrityAfter: after.integrity,
      schemaVersionBefore: before.schemaVersion,
      schemaVersionAfter: after.schemaVersion,
      userVersionBefore: before.userVersion,
      userVersionAfter: after.userVersion,
      sidecarsBefore: before.sidecars,
      sidecarsAfter: after.sidecars
    };
  } finally {
    await db.close();
  }
}

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const databasePath = resolveAuthorizedFile(
    args.database, args["allowed-root"], "CUSTOMER_MASTER_INCREMENTAL_DATABASE_NOT_AUTHORIZED"
  );
  const output = args.mode === "apply"
    ? await runApplyMode(args, databasePath)
    : await runReadOnlyMode(args, databasePath);
  output.durationMs = Date.now() - startedAt;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!["DRY_RUN_OK", "APPLY_OK", "VERIFY_OK"].includes(output.status)) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${String(error.code || error.message || "CUSTOMER_MASTER_INCREMENTAL_SYNC_FAILED").slice(0, 160)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  resolveAuthorizedFile,
  sidecarState,
  sourcesIntact
};
