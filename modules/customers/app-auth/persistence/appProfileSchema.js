"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { splitSqlStatements } = require("../../master/persistence/customerMasterSchema");

const VERSION = "app-profile-schema/v1";

async function getAppProfileSchemaStatus(db) {
  const table = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='app_customer_profiles'");
  return {
    schemaVersion: VERSION,
    ready: Boolean(table?.name),
    profiles: table?.name ? Number((await db.get("SELECT COUNT(*) AS total FROM app_customer_profiles"))?.total || 0) : null
  };
}

async function applyAppProfileSchema(db) {
  await db.run("PRAGMA foreign_keys=ON");
  const accounts = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='app_customer_accounts'");
  if (!accounts?.name) throw new Error("APP_CUSTOMER_ACCESS_SCHEMA_REQUIRED");
  const statements = splitSqlStatements(fs.readFileSync(path.join(__dirname, "app-profile-schema-v1.sql"), "utf8"));
  const before = await getAppProfileSchemaStatus(db);
  await db.run("BEGIN IMMEDIATE");
  try {
    for (const statement of statements) await db.run(statement);
    await db.run("COMMIT");
  } catch (error) {
    await db.run("ROLLBACK").catch(() => null);
    throw error;
  }
  const after = await getAppProfileSchemaStatus(db);
  if (!after.ready) throw new Error("APP_PROFILE_SCHEMA_INCOMPLETE");
  return { schemaVersion: VERSION, statementsExecuted: statements.length, before, after };
}

module.exports = { APP_PROFILE_SCHEMA_VERSION: VERSION, getAppProfileSchemaStatus, applyAppProfileSchema };
