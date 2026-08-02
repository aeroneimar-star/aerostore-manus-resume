"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { splitSqlStatements } = require("../../master/persistence/customerMasterSchema");

const VERSION = "app-address-schema/v1";

async function getAppAddressSchemaStatus(db) {
  const table = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='app_customer_addresses'");
  return {
    schemaVersion: VERSION,
    ready: Boolean(table?.name),
    addressCount: table?.name ? Number((await db.get("SELECT COUNT(*) total FROM app_customer_addresses"))?.total || 0) : null,
    activeCount: table?.name ? Number((await db.get("SELECT COUNT(*) total FROM app_customer_addresses WHERE archived_at IS NULL"))?.total || 0) : null
  };
}

async function applyAppAddressSchema(db) {
  await db.run("PRAGMA foreign_keys=ON");
  const accounts = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='app_customer_accounts'");
  if (!accounts?.name) throw new Error("APP_CUSTOMER_ACCESS_SCHEMA_REQUIRED");
  const statements = splitSqlStatements(fs.readFileSync(path.join(__dirname, "app-address-schema-v1.sql"), "utf8"));
  const before = await getAppAddressSchemaStatus(db);
  await db.run("BEGIN IMMEDIATE");
  try {
    for (const statement of statements) await db.run(statement);
    await db.run("COMMIT");
  } catch (error) { await db.run("ROLLBACK").catch(() => null); throw error; }
  const after = await getAppAddressSchemaStatus(db);
  if (!after.ready) throw new Error("APP_ADDRESS_SCHEMA_INCOMPLETE");
  return { schemaVersion: VERSION, statementsExecuted: statements.length, before, after };
}

module.exports = { APP_ADDRESS_SCHEMA_VERSION: VERSION, getAppAddressSchemaStatus, applyAppAddressSchema };
