"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { splitSqlStatements } = require("../../master/persistence/customerMasterSchema");

const VERSION = "app-session-schema/v1";

async function hasTokenVersion(db) {
  const columns = await db.all("PRAGMA table_info(app_customer_accounts)");
  return columns.some((column) => column.name === "token_version");
}

async function getAppSessionSchemaStatus(db) {
  const table = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='app_sessions'");
  const tokenVersion = await hasTokenVersion(db);
  return {
    schemaVersion: VERSION,
    ready: Boolean(table?.name && tokenVersion),
    tokenVersion,
    sessions: table?.name ? Number((await db.get("SELECT COUNT(*) total FROM app_sessions"))?.total || 0) : null,
    activeSessions: table?.name ? Number((await db.get("SELECT COUNT(*) total FROM app_sessions WHERE status='ACTIVE'"))?.total || 0) : null
  };
}

async function applyAppSessionSchema(db) {
  await db.run("PRAGMA foreign_keys=ON");
  const accounts = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='app_customer_accounts'");
  if (!accounts?.name) throw new Error("APP_CUSTOMER_ACCESS_SCHEMA_REQUIRED");
  const statements = splitSqlStatements(fs.readFileSync(path.join(__dirname, "app-session-schema-v1.sql"), "utf8"));
  const before = await getAppSessionSchemaStatus(db);
  await db.run("BEGIN IMMEDIATE");
  try {
    if (!before.tokenVersion) await db.run("ALTER TABLE app_customer_accounts ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1 CHECK (token_version >= 1)");
    for (const statement of statements) await db.run(statement);
    await db.run("COMMIT");
  } catch (error) { await db.run("ROLLBACK").catch(() => null); throw error; }
  const after = await getAppSessionSchemaStatus(db);
  if (!after.ready) throw new Error("APP_SESSION_SCHEMA_INCOMPLETE");
  return { schemaVersion: VERSION, statementsExecuted: statements.length + Number(!before.tokenVersion), before, after };
}

module.exports = { APP_SESSION_SCHEMA_VERSION: VERSION, getAppSessionSchemaStatus, applyAppSessionSchema };
