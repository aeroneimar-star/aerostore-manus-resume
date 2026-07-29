"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const sqlite3 = require("sqlite3").verbose();
const {
  createCustomerMasterSourceReader
} = require("../backfill/customerMasterSourceReader");
const {
  buildSourceRecord,
  stableStringify
} = require("../backfill/customerMasterSourceModel");
const {
  runCustomerMasterBackfillDryRun
} = require("../backfill/customerMasterDryRunService");
const {
  resolveCalibrationLimits
} = require("./customerMasterCalibrationLimits");

const CALIBRATION_VERSION = "customer-master-real-readonly-calibration/v2";
const MASTER_TABLES = Object.freeze([
  "customer_master_records",
  "customer_master_sources",
  "customer_master_identifiers",
  "customer_identity_conflicts",
  "customer_identity_conflict_participants",
  "customer_master_merge_history",
  "customer_master_sync_checkpoints",
  "customer_master_jobs"
]);
const READ_PRAGMAS = new Set([
  "foreign_keys",
  "journal_mode",
  "query_only",
  "quick_check",
  "schema_version",
  "user_version"
]);

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveAuthorizedDatabasePath(options = {}) {
  if (options.readOnly !== true) {
    throw new Error("CUSTOMER_MASTER_CALIBRATION_READ_ONLY_FLAG_REQUIRED");
  }
  const databasePath = String(options.databasePath || "").trim();
  if (!databasePath) throw new Error("CUSTOMER_MASTER_CALIBRATION_DATABASE_PATH_REQUIRED");
  const resolved = path.resolve(databasePath);
  const roots = Array.isArray(options.allowedRoots)
    ? options.allowedRoots.map((root) => String(root || "").trim()).filter(Boolean)
    : [];
  if (!roots.length || !roots.some((root) => isPathInside(root, resolved))) {
    throw new Error("CUSTOMER_MASTER_CALIBRATION_PATH_NOT_AUTHORIZED");
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error("CUSTOMER_MASTER_CALIBRATION_DATABASE_NOT_FOUND");
  }
  const realDatabasePath = fs.realpathSync.native(resolved);
  const realRoots = roots
    .filter((root) => fs.existsSync(path.resolve(root)))
    .map((root) => fs.realpathSync.native(path.resolve(root)));
  if (!realRoots.some((root) => isPathInside(root, realDatabasePath))) {
    throw new Error("CUSTOMER_MASTER_CALIBRATION_PATH_NOT_AUTHORIZED");
  }
  if (![".sqlite", ".sqlite3", ".db"].includes(path.extname(resolved).toLowerCase())) {
    throw new Error("CUSTOMER_MASTER_CALIBRATION_DATABASE_EXTENSION_INVALID");
  }
  return realDatabasePath;
}

function normalizeDatabaseLabel(value) {
  const label = String(value || "authorized-local-database").trim();
  if (
    !label
    || label.length > 120
    || label.startsWith("/")
    || label.includes("\\")
    || label.includes(":")
    || label.split("/").includes("..")
    || !/^[a-zA-Z0-9._<>/-]+$/.test(label)
  ) {
    throw new Error("CUSTOMER_MASTER_CALIBRATION_DATABASE_LABEL_INVALID");
  }
  return label;
}

function assertCalibrationReadSql(sql) {
  const normalized = String(sql || "").trim();
  if (normalized.replace(/;\s*$/, "").includes(";")) {
    throw new Error("CUSTOMER_MASTER_CALIBRATION_SQL_BLOCKED");
  }
  if (/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|ATTACH|DETACH)\b/i.test(normalized)) {
    throw new Error("CUSTOMER_MASTER_CALIBRATION_SQL_BLOCKED");
  }
  if (/^(SELECT|WITH)\b/i.test(normalized)) return normalized;
  const pragma = normalized.match(/^PRAGMA\s+([a-z_]+)\s*;?$/i);
  if (pragma && READ_PRAGMAS.has(pragma[1].toLowerCase())) return normalized;
  throw new Error("CUSTOMER_MASTER_CALIBRATION_SQL_BLOCKED");
}

function metadataForFile(filePath) {
  const stat = fs.statSync(filePath);
  return {
    exists: true,
    sizeBytes: stat.size,
    lastWriteTimeMs: stat.mtimeMs
  };
}

function sidecarMetadata(databasePath) {
  return Object.fromEntries(["-wal", "-shm", "-journal"].map((suffix) => {
    const sidecarPath = `${databasePath}${suffix}`;
    return [
      suffix.slice(1),
      fs.existsSync(sidecarPath)
        ? metadataForFile(sidecarPath)
        : { exists: false, sizeBytes: 0, lastWriteTimeMs: null }
    ];
  }));
}

function openSqliteReadOnly(databasePath) {
  return new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(
      databasePath,
      sqlite3.OPEN_READONLY,
      (error) => error ? reject(error) : resolve(connection)
    );
  });
}

function rawRun(connection, sql) {
  return new Promise((resolve, reject) => {
    connection.run(sql, (error) => error ? reject(error) : resolve());
  });
}

function rawGet(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

function rawAll(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function closeConnection(connection) {
  return new Promise((resolve, reject) => {
    connection.close((error) => error ? reject(error) : resolve());
  });
}

async function createReadOnlyDatabase(options = {}) {
  const databasePath = resolveAuthorizedDatabasePath(options);
  const connection = await openSqliteReadOnly(databasePath);
  try {
    await rawRun(connection, "PRAGMA query_only = ON");
    const queryOnly = await rawGet(connection, "PRAGMA query_only");
    if (Number(queryOnly?.query_only) !== 1) {
      throw new Error("CUSTOMER_MASTER_CALIBRATION_QUERY_ONLY_NOT_ACTIVE");
    }
  } catch (error) {
    await closeConnection(connection);
    throw error;
  }
  const sqlCategories = { select: 0, readPragma: 1, blocked: 0 };
  const get = async (sql, params = []) => {
    const safeSql = assertCalibrationReadSql(sql);
    if (/^PRAGMA\b/i.test(safeSql)) sqlCategories.readPragma += 1;
    else sqlCategories.select += 1;
    return rawGet(connection, safeSql, params);
  };
  const all = async (sql, params = []) => {
    const safeSql = assertCalibrationReadSql(sql);
    if (/^PRAGMA\b/i.test(safeSql)) sqlCategories.readPragma += 1;
    else sqlCategories.select += 1;
    return rawAll(connection, safeSql, params);
  };
  const rejectSql = (sql) => {
    try {
      return assertCalibrationReadSql(sql);
    } catch (error) {
      sqlCategories.blocked += 1;
      throw error;
    }
  };
  return Object.freeze({
    databasePath,
    openMode: "OPEN_READONLY",
    get,
    all,
    rejectSql,
    sqlCategories,
    close: () => closeConnection(connection)
  });
}

function normalizeSchemaSql(sql) {
  return String(sql || "").replace(/\s+/g, " ").trim();
}

function hashStable(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

async function captureSnapshot(db, databasePath) {
  const pragmaRows = await Promise.all([
    db.get("PRAGMA query_only"),
    db.get("PRAGMA foreign_keys"),
    db.get("PRAGMA journal_mode"),
    db.get("PRAGMA schema_version"),
    db.get("PRAGMA user_version")
  ]);
  const tables = await db.all(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name ASC"
  );
  const tableNames = new Set(tables.map((table) => table.name));
  const sourceCounts = {};
  for (const source of ["contacts", "crm_contacts"]) {
    sourceCounts[source] = tableNames.has(source)
      ? Number((await db.get(`SELECT COUNT(*) AS total FROM ${source}`))?.total || 0)
      : null;
  }
  const masterCounts = {};
  for (const table of MASTER_TABLES) {
    masterCounts[table] = tableNames.has(table)
      ? Number((await db.get(`SELECT COUNT(*) AS total FROM ${table}`))?.total || 0)
      : null;
  }
  const normalizedSchema = tables
    .filter((table) => ["contacts", "crm_contacts", ...MASTER_TABLES].includes(table.name))
    .map((table) => ({ name: table.name, sql: normalizeSchemaSql(table.sql) }));
  return {
    mainFile: metadataForFile(databasePath),
    sidecars: sidecarMetadata(databasePath),
    queryOnly: Number(pragmaRows[0]?.query_only || 0),
    foreignKeys: Number(pragmaRows[1]?.foreign_keys || 0),
    journalMode: String(pragmaRows[2]?.journal_mode || ""),
    schemaVersion: Number(pragmaRows[3]?.schema_version || 0),
    userVersion: Number(pragmaRows[4]?.user_version || 0),
    totalTables: tables.length,
    sourceTablesPresent: {
      contacts: tableNames.has("contacts"),
      crm_contacts: tableNames.has("crm_contacts")
    },
    sourceCounts,
    masterCounts,
    schemaHash: hashStable(normalizedSchema)
  };
}

async function readIntegrity(db) {
  const startedAt = Date.now();
  const rows = await db.all("PRAGMA quick_check");
  const values = rows.flatMap((row) => Object.values(row).map(String));
  return {
    status: values.length === 1 && values[0].toLowerCase() === "ok" ? "ok" : "failed",
    durationMs: Date.now() - startedAt
  };
}

async function readAggregatedSourceStates(db) {
  const inactive = ["inativo", "inactive", "deleted", "suspended", "suspenso", "bloqueado"];
  const placeholders = inactive.map(() => "?").join(", ");
  const contacts = await db.get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN deleted_at IS NOT NULL AND TRIM(deleted_at) <> '' THEN 1 ELSE 0 END) AS deleted,
            SUM(CASE WHEN (deleted_at IS NULL OR TRIM(deleted_at) = '')
                      AND LOWER(TRIM(COALESCE(status, ''))) IN (${placeholders})
                     THEN 1 ELSE 0 END) AS inactive,
            SUM(CASE WHEN TRIM(COALESCE(status, '')) = '' THEN 1 ELSE 0 END) AS unknown_status,
            SUM(CASE WHEN datetime(updated_at) IS NULL THEN 1 ELSE 0 END) AS invalid_timestamp
     FROM contacts`,
    inactive
  );
  const crmContacts = await db.get(
    `SELECT COUNT(*) AS total,
            0 AS deleted,
            SUM(CASE WHEN LOWER(TRIM(COALESCE(status, ''))) IN (${placeholders})
                     THEN 1 ELSE 0 END) AS inactive,
            SUM(CASE WHEN TRIM(COALESCE(status, '')) = '' THEN 1 ELSE 0 END) AS unknown_status,
            SUM(CASE WHEN datetime(updated_at) IS NULL THEN 1 ELSE 0 END) AS invalid_timestamp
     FROM crm_contacts`,
    inactive
  );
  const sanitize = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => (
    [key, Number(value || 0)]
  )));
  return {
    contacts: sanitize(contacts),
    crm_contacts: sanitize(crmContacts)
  };
}

function createTelemetry() {
  return {
    normalizationMs: 0,
    rows: 0,
    identifiers: {},
    names: {},
    addresses: {
      present: 0,
      absent: 0,
      complete: 0,
      incomplete: 0,
      bySource: { contacts: 0, crm_contacts: 0 }
    }
  };
}

function increment(target, key) {
  target[key] = Number(target[key] || 0) + 1;
}

function observeRows(sourceType, rows, telemetry) {
  const startedAt = Date.now();
  rows.forEach((row) => {
    const record = buildSourceRecord(sourceType, row);
    telemetry.rows += 1;
    record.normalizedIdentity.identifiers.forEach((identifier) => {
      increment(telemetry.identifiers, `${identifier.type}:${identifier.classification}`);
    });
    increment(telemetry.names, record.normalizedIdentity.name.classification);
    const address = record.normalizedIdentity.address;
    const present = Object.values(address.fields || {}).some(Boolean);
    if (!present) telemetry.addresses.absent += 1;
    else {
      telemetry.addresses.present += 1;
      telemetry.addresses.bySource[sourceType] += 1;
      if (address.isValid) telemetry.addresses.complete += 1;
      else telemetry.addresses.incomplete += 1;
    }
  });
  telemetry.normalizationMs += Date.now() - startedAt;
}

function createInstrumentedReader(reader, telemetry, timing) {
  const wrap = (method, sourceType) => async (options) => {
    const startedAt = Date.now();
    const rows = await reader[method](options);
    timing.readMs += Date.now() - startedAt;
    observeRows(sourceType, rows, telemetry);
    return rows;
  };
  return {
    getSourceSchemaSummary: () => reader.getSourceSchemaSummary(),
    countContacts: () => reader.countContacts(),
    countCrmContacts: () => reader.countCrmContacts(),
    readContactsPage: wrap("readContactsPage", "contacts"),
    readCrmContactsPage: wrap("readCrmContactsPage", "crm_contacts")
  };
}

function aggregateCompletedReport(report, telemetry, timing) {
  const clusterHistogram = {};
  let largestCluster = 0;
  (report.candidates || []).forEach((candidate) => {
    increment(clusterHistogram, String(candidate.sourceCount));
    largestCluster = Math.max(largestCluster, Number(candidate.sourceCount || 0));
  });
  return {
    status: report.status,
    codeVersion: report.codeVersion,
    counts: report.counts,
    identifierQuality: telemetry.identifiers,
    nameQuality: telemetry.names,
    addresses: telemetry.addresses,
    clusters: {
      histogram: clusterHistogram,
      largest: largestCluster,
      aboveBudget: 0
    },
    performance: {
      ...report.performance,
      readMs: timing.readMs,
      normalizationObservationMs: telemetry.normalizationMs
    },
    fingerprint: report.fingerprint,
    totalConflicts: report.totalConflicts,
    conflictCountsByType: report.conflictCountsByType,
    conflictCountsBySeverity: report.conflictCountsBySeverity,
    blockingConflictCount: report.blockingConflictCount,
    sampledConflictCount: report.sampledConflictCount,
    conflictsTruncated: report.conflictsTruncated,
    conflicts: report.conflicts || [],
    errors: report.errors || [],
    warnings: report.warnings
  };
}

function snapshotsMatch(before, after) {
  return stableStringify(before) === stableStringify(after);
}

function evaluateCalibrationCompletion(dryRun, before, after, expectedRecords) {
  const invariantsUnchanged = snapshotsMatch(before, after);
  const complete = dryRun?.status === "COMPLETE"
    && invariantsUnchanged
    && Number(dryRun.counts?.sourceRows) === Number(expectedRecords);
  return {
    complete,
    invariantsUnchanged,
    fingerprint: complete ? dryRun.fingerprint : null,
    reason: complete ? null : "SOURCE_CHANGED_DURING_READ_OR_INCOMPLETE"
  };
}

async function runRealReadOnlyCalibration(options = {}) {
  const databaseLabel = normalizeDatabaseLabel(options.databaseLabel);
  const database = await createReadOnlyDatabase(options);
  const startedAt = Date.now();
  try {
    const before = await captureSnapshot(database, database.databasePath);
    if (!before.sourceTablesPresent.contacts || !before.sourceTablesPresent.crm_contacts) {
      return {
        version: CALIBRATION_VERSION,
        status: "BLOCKED_DATA_QUALITY",
        reason: "OFFICIAL_SOURCE_TABLE_MISSING",
        database: databaseLabel,
        before,
        fingerprint: null
      };
    }
    const integrity = await readIntegrity(database);
    if (integrity.status !== "ok") {
      return {
        version: CALIBRATION_VERSION,
        status: "BLOQUEADO_INTEGRIDADE_BANCO",
        database: databaseLabel,
        integrity,
        before,
        fingerprint: null
      };
    }
    const sourceStates = await readAggregatedSourceStates(database);
    const total = before.sourceCounts.contacts + before.sourceCounts.crm_contacts;
    const limits = resolveCalibrationLimits(options.limitProfile, options.limits);
    if (total > limits.maxRecords) {
      const after = await captureSnapshot(database, database.databasePath);
      const invariantsUnchanged = snapshotsMatch(before, after);
      return {
        version: CALIBRATION_VERSION,
        status: invariantsUnchanged
          ? "CALIBRATION_LIMIT_EXCEEDED"
          : "BLOQUEADO_CONCORRENCIA_OU_INSTABILIDADE",
        reason: invariantsUnchanged ? "REAL_VOLUME_EXCEEDS_CONFIGURED_LIMIT" : "SNAPSHOT_CHANGED",
        database: databaseLabel,
        openMode: database.openMode,
        integrity,
        sourceStates,
        limits,
        observedRecords: total,
        estimatedMinimumOperations: total * 2,
        before,
        after,
        invariantsUnchanged,
        fingerprint: null,
        performance: { durationMs: Date.now() - startedAt },
        sqlCategories: { ...database.sqlCategories }
      };
    }
    const telemetry = createTelemetry();
    const timing = { readMs: 0 };
    const reader = createInstrumentedReader(
      createCustomerMasterSourceReader(database),
      telemetry,
      timing
    );
    const dryRun = await runCustomerMasterBackfillDryRun(reader, {
      codeVersion: options.codeVersion,
      limits
    });
    const after = await captureSnapshot(database, database.databasePath);
    const completion = evaluateCalibrationCompletion(dryRun, before, after, total);
    return {
      version: CALIBRATION_VERSION,
      status: completion.complete
        ? "COMPLETE"
        : completion.invariantsUnchanged
          ? "INCOMPLETE"
          : "BLOQUEADO_CONCORRENCIA_OU_INSTABILIDADE",
      reason: completion.reason,
      database: databaseLabel,
      openMode: database.openMode,
      integrity,
      sourceStates,
      limits,
      observedRecords: total,
      before,
      after,
      invariantsUnchanged: completion.invariantsUnchanged,
      dryRun: aggregateCompletedReport(dryRun, telemetry, timing),
      fingerprint: completion.fingerprint,
      performance: { durationMs: Date.now() - startedAt },
      sqlCategories: { ...database.sqlCategories }
    };
  } finally {
    await database.close();
  }
}

module.exports = {
  CALIBRATION_VERSION,
  MASTER_TABLES,
  READ_PRAGMAS,
  isPathInside,
  resolveAuthorizedDatabasePath,
  normalizeDatabaseLabel,
  assertCalibrationReadSql,
  createReadOnlyDatabase,
  captureSnapshot,
  readIntegrity,
  readAggregatedSourceStates,
  evaluateCalibrationCompletion,
  runRealReadOnlyCalibration
};
