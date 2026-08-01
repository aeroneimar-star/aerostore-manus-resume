"use strict";

const path = require("node:path");
const fs = require("node:fs");
const sqlite3 = require("sqlite3");
const {
  createCustomerMasterSourceReader
} = require("../modules/customers/master/backfill/customerMasterSourceReader");
const {
  runCustomerMasterIncrementalSync,
  SOURCE_TYPES
} = require("../modules/customers/master/incremental/customerMasterIncrementalSyncService");

function openDb(databasePath) {
  const connection = new sqlite3.Database(databasePath, sqlite3.OPEN_READWRITE);
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    connection.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ changes: this.changes, lastID: this.lastID });
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

function readArgument(name) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

async function main() {
  const configuredPath = String(
    readArgument("database") || process.env.CUSTOMER_MASTER_DB_PATH || ""
  ).trim();
  if (!configuredPath) throw new Error("CUSTOMER_MASTER_DB_PATH_REQUIRED");
  const sourceOption = String(readArgument("source") || "all");
  const sourceTypes = sourceOption === "all" ? SOURCE_TYPES : [sourceOption];
  const codeVersion = String(readArgument("code-version") || process.env.CUSTOMER_MASTER_CODE_VERSION || "LOCAL_UNCOMMITTED");
  const databasePath = path.resolve(configuredPath);
  if (!fs.existsSync(databasePath) || !fs.statSync(databasePath).isFile()) {
    throw new Error("CUSTOMER_MASTER_DATABASE_FILE_REQUIRED");
  }
  const db = openDb(databasePath);
  try {
    await db.run("PRAGMA foreign_keys = ON");
    await db.run("PRAGMA busy_timeout = 5000");
    const quickCheck = await db.get("PRAGMA quick_check");
    if (String(quickCheck?.quick_check || "") !== "ok") {
      throw new Error("CUSTOMER_MASTER_INCREMENTAL_QUICK_CHECK_FAILED");
    }
    const reader = createCustomerMasterSourceReader(db);
    const result = await runCustomerMasterIncrementalSync({
      db,
      reader,
      sourceTypes,
      codeVersion,
      pageSize: readArgument("page-size") || undefined,
      maxPages: readArgument("max-pages") || undefined
    });
    process.stdout.write(`${JSON.stringify({ ...result, quickCheck: "ok" }, null, 2)}\n`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.code || error.message || "CUSTOMER_MASTER_INCREMENTAL_SYNC_FAILED"}\n`);
  process.exitCode = 1;
});
