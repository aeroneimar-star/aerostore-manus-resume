"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const sqlite3 = require("sqlite3").verbose();
const {
  resolveAuthorizedDatabasePath,
  normalizeDatabaseLabel,
  assertCalibrationReadSql,
  createReadOnlyDatabase,
  evaluateCalibrationCompletion,
  runRealReadOnlyCalibration
} = require("../calibration/customerMasterReadOnlyCalibration");
const {
  parseArgs,
  sanitizeError,
  exitCodeForStatus
} = require("../../../../scripts/customer-master-real-readonly-calibration");

function createDatabase(filePath) {
  const connection = new sqlite3.Database(filePath);
  const run = (sql) => new Promise((resolve, reject) => {
    connection.run(sql, (error) => error ? reject(error) : resolve());
  });
  const close = () => new Promise((resolve, reject) => {
    connection.close((error) => error ? reject(error) : resolve());
  });
  return { run, close };
}

async function withSyntheticDatabase(callback, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "customer-master-calibration-"));
  const databasePath = path.join(directory, "synthetic.sqlite");
  const db = createDatabase(databasePath);
  try {
    await db.run(`
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY, name TEXT, phone TEXT, mobile TEXT, mobile_normalized TEXT,
        phone_fixed TEXT, document TEXT, email TEXT, birth_date TEXT, address TEXT,
        neighborhood TEXT, zipcode TEXT, city TEXT, state TEXT, status TEXT, source TEXT,
        deleted_at TEXT, created_at TEXT, updated_at TEXT
      )
    `);
    await db.run(`
      CREATE TABLE crm_contacts (
        id TEXT PRIMARY KEY, external_id TEXT, external_code TEXT, name TEXT,
        fantasy_name TEXT, document TEXT, person_type TEXT, phone TEXT, mobile TEXT,
        email TEXT, address TEXT, number TEXT, complement TEXT, neighborhood TEXT,
        zipcode TEXT, city TEXT, state TEXT, status TEXT, birth_date TEXT,
        source_file TEXT, source_row TEXT, import_hash TEXT, created_at TEXT, updated_at TEXT
      )
    `);
    for (let index = 0; index < Number(options.rows || 0); index += 1) {
      await new Promise((resolve, reject) => {
        const connection = new sqlite3.Database(databasePath);
        connection.run(
          `INSERT INTO contacts
            (id, name, phone, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
          [String(index + 1), `Synthetic ${index + 1}`, `119${String(index + 1).padStart(8, "0")}`],
          (error) => connection.close(() => error ? reject(error) : resolve())
        );
      });
    }
  } finally {
    await db.close();
  }
  try {
    return await callback({ directory, databasePath });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("requires explicit path, read-only flag, existing file and authorized root", async () => {
  assert.throws(
    () => resolveAuthorizedDatabasePath({ readOnly: true, allowedRoots: [os.tmpdir()] }),
    /DATABASE_PATH_REQUIRED/
  );
  assert.throws(
    () => resolveAuthorizedDatabasePath({
      databasePath: path.join(os.tmpdir(), "missing.sqlite"),
      readOnly: false,
      allowedRoots: [os.tmpdir()]
    }),
    /READ_ONLY_FLAG_REQUIRED/
  );
  assert.throws(
    () => resolveAuthorizedDatabasePath({
      databasePath: path.join(os.tmpdir(), "missing.sqlite"),
      readOnly: true,
      allowedRoots: [process.cwd()]
    }),
    /PATH_NOT_AUTHORIZED/
  );
  const missing = path.join(os.tmpdir(), "customer-master-calibration-missing.sqlite");
  assert.equal(fs.existsSync(missing), false);
  assert.throws(
    () => resolveAuthorizedDatabasePath({
      databasePath: missing,
      readOnly: true,
      allowedRoots: [os.tmpdir()]
    }),
    /DATABASE_NOT_FOUND/
  );
  assert.equal(fs.existsSync(missing), false);
  await withSyntheticDatabase(async ({ directory, databasePath }) => {
    assert.equal(resolveAuthorizedDatabasePath({
      databasePath,
      readOnly: true,
      allowedRoots: [directory]
    }), databasePath);
  });
});

test("opens with OPEN_READONLY, enables query_only and blocks every write category", async () => {
  await withSyntheticDatabase(async ({ directory, databasePath }) => {
    const before = fs.statSync(databasePath);
    const database = await createReadOnlyDatabase({
      databasePath,
      readOnly: true,
      allowedRoots: [directory]
    });
    try {
      assert.equal(database.openMode, "OPEN_READONLY");
      assert.equal((await database.get("PRAGMA query_only")).query_only, 1);
      assert.equal((await database.get("SELECT COUNT(*) AS total FROM contacts")).total, 0);
      for (const sql of [
        "INSERT INTO contacts (id) VALUES ('x')",
        "UPDATE contacts SET name = 'x'",
        "DELETE FROM contacts",
        "REPLACE INTO contacts (id) VALUES ('x')",
        "CREATE TABLE forbidden (id INTEGER)",
        "DROP TABLE contacts",
        "ALTER TABLE contacts ADD COLUMN forbidden TEXT",
        "VACUUM",
        "ATTACH DATABASE 'x' AS other",
        "DETACH DATABASE other"
      ]) {
        assert.throws(() => database.rejectSql(sql), /SQL_BLOCKED/);
      }
    } finally {
      await database.close();
    }
    const after = fs.statSync(databasePath);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  });
});

test("complete synthetic calibration is deterministic, sanitized and leaves file unchanged", async () => {
  await withSyntheticDatabase(async ({ directory, databasePath }) => {
    const before = fs.statSync(databasePath);
    const options = {
      databasePath,
      allowedRoots: [directory],
      databaseLabel: "synthetic/data/<database>",
      codeVersion: "synthetic-calibration-v1",
      readOnly: true
    };
    const first = await runRealReadOnlyCalibration(options);
    const second = await runRealReadOnlyCalibration(options);
    const after = fs.statSync(databasePath);
    assert.equal(first.status, "COMPLETE");
    assert.equal(first.openMode, "OPEN_READONLY");
    assert.equal(first.before.queryOnly, 1);
    assert.equal(first.integrity.status, "ok");
    assert.equal(first.invariantsUnchanged, true);
    assert.equal(first.fingerprint, second.fingerprint);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.doesNotMatch(
      JSON.stringify(first),
      /Synthetic \d|119\d{8}|canonicalValue|rawIdentity|sourceRefs|"participants"\s*:/
    );
  }, { rows: 3 });
});

test("limit excess aborts before paging and returns no fingerprint", async () => {
  await withSyntheticDatabase(async ({ directory, databasePath }) => {
    const result = await runRealReadOnlyCalibration({
      databasePath,
      allowedRoots: [directory],
      databaseLabel: "synthetic/data/<database>",
      codeVersion: "synthetic-calibration-v1",
      readOnly: true,
      limits: { maxRecords: 2 }
    });
    assert.equal(result.status, "CALIBRATION_LIMIT_EXCEEDED");
    assert.equal(result.observedRecords, 3);
    assert.equal(result.fingerprint, null);
    assert.equal(result.invariantsUnchanged, true);
  }, { rows: 3 });
});

test("CLI parser and errors remain explicit and sanitized", () => {
  assert.deepEqual(parseArgs([
    "--read-only",
    "--database", "synthetic.sqlite",
    "--allowed-root", "synthetic-root",
    "--label", "synthetic-label",
    "--code-version", "synthetic-version"
  ]), {
    readOnly: true,
    database: "synthetic.sqlite",
    "allowed-root": "synthetic-root",
    label: "synthetic-label",
    "code-version": "synthetic-version"
  });
  assert.throws(() => parseArgs(["--write"]), /ARGUMENT_INVALID/);
  assert.throws(() => parseArgs(["--output", "report.json"]), /ARGUMENT_INVALID/);
  assert.equal(
    normalizeDatabaseLabel("official-main-worktree/data/<database>"),
    "official-main-worktree/data/<database>"
  );
  assert.throws(
    () => normalizeDatabaseLabel("C:\\Users\\private\\database.sqlite"),
    /DATABASE_LABEL_INVALID/
  );
  assert.equal(
    sanitizeError(new Error("private path C:\\sensitive\\database.sqlite")),
    "CUSTOMER_MASTER_CALIBRATION_FAILED_SAFELY"
  );
  assert.equal(exitCodeForStatus("COMPLETE"), 0);
  assert.equal(exitCodeForStatus("CALIBRATION_LIMIT_EXCEEDED"), 3);
  assert.equal(exitCodeForStatus("BLOCKED_DATA_QUALITY"), 2);
});

test("concurrent snapshot or incomplete read invalidates fingerprint without retry", () => {
  const snapshot = {
    mainFile: { sizeBytes: 10, lastWriteTimeMs: 20 },
    schemaVersion: 3,
    sourceCounts: { contacts: 2, crm_contacts: 1 }
  };
  const dryRun = {
    status: "COMPLETE",
    counts: { sourceRows: 3 },
    fingerprint: "synthetic-fingerprint"
  };
  assert.deepEqual(evaluateCalibrationCompletion(dryRun, snapshot, snapshot, 3), {
    complete: true,
    invariantsUnchanged: true,
    fingerprint: "synthetic-fingerprint",
    reason: null
  });
  const changed = {
    ...snapshot,
    sourceCounts: { contacts: 3, crm_contacts: 1 }
  };
  const invalidated = evaluateCalibrationCompletion(dryRun, snapshot, changed, 3);
  assert.equal(invalidated.complete, false);
  assert.equal(invalidated.invariantsUnchanged, false);
  assert.equal(invalidated.fingerprint, null);
  assert.equal(invalidated.reason, "SOURCE_CHANGED_DURING_READ_OR_INCOMPLETE");
});

test("read SQL allow-list accepts only SELECT, WITH and approved read pragmas", () => {
  assert.equal(assertCalibrationReadSql("SELECT 1"), "SELECT 1");
  assert.equal(assertCalibrationReadSql("WITH value AS (SELECT 1) SELECT * FROM value").startsWith("WITH"), true);
  for (const pragma of [
    "foreign_keys",
    "journal_mode",
    "query_only",
    "quick_check",
    "schema_version",
    "user_version"
  ]) {
    assert.equal(assertCalibrationReadSql(`PRAGMA ${pragma}`), `PRAGMA ${pragma}`);
  }
  assert.throws(() => assertCalibrationReadSql("PRAGMA writable_schema = ON"), /SQL_BLOCKED/);
});
