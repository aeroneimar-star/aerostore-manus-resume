"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const sqlite3 = require("sqlite3");
const {
  applyAppCustomerAccessSchema,
  getAppCustomerAccessSchemaStatus
} = require("../modules/customers/app-access/persistence/appCustomerAccessSchema");

function parseArgs(argv) {
  const args = {};
  const values = new Set(["database", "allowed-root", "backup-file", "backup-sha256"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (["--preflight", "--apply", "--verify"].includes(token)) args[token.slice(2)] = true;
    else if (token.startsWith("--") && values.has(token.slice(2)) && argv[index + 1]) args[token.slice(2)] = argv[++index];
    else throw new Error("APP_CUSTOMER_ACCESS_ARGUMENT_INVALID");
  }
  if (Number(Boolean(args.preflight)) + Number(Boolean(args.apply)) + Number(Boolean(args.verify)) !== 1) throw new Error("APP_CUSTOMER_ACCESS_MODE_REQUIRED");
  return { ...args, mode: args.apply ? "apply" : (args.verify ? "verify" : "preflight") };
}

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function openDb(databasePath, readOnly) {
  const flags = readOnly ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE;
  return new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(databasePath, flags, (error) => error ? reject(error) : resolve(connection));
  });
}

function api(connection) {
  return {
    run: (sql, params = []) => new Promise((resolve, reject) => connection.run(sql, params, function done(error) {
      if (error) reject(error); else resolve({ changes: this.changes, lastID: this.lastID });
    })),
    get: (sql, params = []) => new Promise((resolve, reject) => connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row))),
    all: (sql, params = []) => new Promise((resolve, reject) => connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))),
    close: () => new Promise((resolve, reject) => connection.close((error) => error ? reject(error) : resolve()))
  };
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function tableFingerprint(db, table, columns) {
  const rows = await db.all(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY id ASC`);
  const hash = crypto.createHash("sha256");
  for (const row of rows) hash.update(JSON.stringify(row));
  return { count: rows.length, fingerprint: hash.digest("hex") };
}

async function masterSnapshot(db) {
  const [masters, sources, identifiers, conflicts, cases] = await Promise.all([
    tableFingerprint(db, "customer_master_records", ["id", "status", "version", "eligibility_status", "updated_at", "deleted_at"]),
    tableFingerprint(db, "customer_master_sources", ["id", "master_id", "source_type", "source_id", "source_hash", "status", "updated_at"]),
    tableFingerprint(db, "customer_master_identifiers", ["id", "master_id", "source_link_id", "identifier_type", "lookup_hash", "validation_status", "verification_status", "is_active", "updated_at"]),
    tableFingerprint(db, "customer_identity_conflicts", ["id", "conflict_type", "severity", "status", "rule_version", "updated_at"]),
    tableFingerprint(db, "customer_identity_cases", ["id", "status", "fingerprint", "conflict_count", "master_count", "source_count", "updated_at"])
  ]);
  return { masters, sources, identifiers, conflicts, cases };
}

function sidecars(databasePath) {
  return ["-wal", "-shm", "-journal"].map((suffix) => {
    const file = `${databasePath}${suffix}`;
    return { suffix, exists: fs.existsSync(file), size: fs.existsSync(file) ? fs.statSync(file).size : 0 };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.database || !args["allowed-root"]) throw new Error("APP_CUSTOMER_ACCESS_DATABASE_REQUIRED");
  const databasePath = path.resolve(args.database);
  const allowedRoot = path.resolve(args["allowed-root"]);
  if (!inside(allowedRoot, databasePath) || !fs.existsSync(databasePath)) throw new Error("APP_CUSTOMER_ACCESS_DATABASE_NOT_ALLOWED");
  if (args.mode === "apply") {
    const backup = path.resolve(String(args["backup-file"] || ""));
    const expectedSha = String(args["backup-sha256"] || "").toLowerCase();
    if (!inside(allowedRoot, backup) || !fs.existsSync(backup) || !expectedSha) throw new Error("APP_CUSTOMER_ACCESS_BACKUP_REQUIRED");
    if ((await sha256File(backup)) !== expectedSha) throw new Error("APP_CUSTOMER_ACCESS_BACKUP_SHA_MISMATCH");
  }
  const db = api(await openDb(databasePath, args.mode !== "apply"));
  try {
    if (args.mode !== "apply") await db.run("PRAGMA query_only = ON");
    else await db.run("PRAGMA busy_timeout = 10000");
    const quick = await db.get("PRAGMA quick_check");
    if (quick?.quick_check !== "ok") throw new Error("APP_CUSTOMER_ACCESS_QUICK_CHECK_FAILED");
    const before = await masterSnapshot(db);
    const migration = args.mode === "apply" ? await applyAppCustomerAccessSchema(db) : null;
    const status = await getAppCustomerAccessSchemaStatus(db);
    if (args.mode !== "preflight" && !status.ready) throw new Error("APP_CUSTOMER_ACCESS_SCHEMA_INCOMPLETE");
    const after = await masterSnapshot(db);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("APP_CUSTOMER_ACCESS_MASTER_CHANGED");
    const approved = status.ready
      ? Number((await db.get("SELECT COUNT(*) AS total FROM app_customer_accounts WHERE access_status = 'APPROVED'"))?.total || 0)
      : 0;
    const queryOnly = Number((await db.get("PRAGMA query_only"))?.query_only || 0);
    process.stdout.write(`${JSON.stringify({
      status: "APP_CUSTOMER_ACCESS_MIGRATION_OK", mode: args.mode, quickCheck: "ok",
      queryOnly,
      schemaVersion: status.schemaVersion, statementsExecuted: migration?.statementsExecuted || 0,
      tables: status.tables, empty: status.empty, approved, master: after, sidecars: sidecars(databasePath)
    }, null, 2)}\n`);
  } finally { await db.close(); }
}

main().catch((error) => {
  process.stderr.write(`${error.code || error.message || "APP_CUSTOMER_ACCESS_MIGRATION_FAILED"}\n`);
  process.exitCode = 1;
});
