"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { splitSqlStatements } = require("../../master/persistence/customerMasterSchema");

const APP_CUSTOMER_ACCESS_SCHEMA_VERSION = "app-customer-access-schema/v1";
const APP_CUSTOMER_ACCESS_TABLES = Object.freeze([
  "app_customer_accounts",
  "app_access_requests",
  "app_access_decisions",
  "app_customer_links"
]);

function getDdlPath() {
  return path.join(__dirname, "app-customer-access-schema-v1.sql");
}

function assertDb(dbApi, write = false) {
  if (!dbApi || typeof dbApi.get !== "function" || typeof dbApi.all !== "function") {
    throw new Error("APP_CUSTOMER_ACCESS_DB_REQUIRED");
  }
  if (write && typeof dbApi.run !== "function") throw new Error("APP_CUSTOMER_ACCESS_WRITE_DB_REQUIRED");
}

async function getAppCustomerAccessSchemaStatus(dbApi) {
  assertDb(dbApi);
  const tables = [];
  for (const table of APP_CUSTOMER_ACCESS_TABLES) {
    const found = await dbApi.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
    const exists = Boolean(found?.name);
    const count = exists ? Number((await dbApi.get(`SELECT COUNT(*) AS total FROM ${table}`))?.total || 0) : null;
    tables.push({ table, exists, count });
  }
  return {
    schemaVersion: APP_CUSTOMER_ACCESS_SCHEMA_VERSION,
    ready: tables.every((item) => item.exists),
    empty: tables.every((item) => item.count === 0),
    tables
  };
}

async function applyAppCustomerAccessSchema(dbApi) {
  assertDb(dbApi, true);
  const statements = splitSqlStatements(fs.readFileSync(getDdlPath(), "utf8"));
  if (!statements.length) throw new Error("APP_CUSTOMER_ACCESS_DDL_EMPTY");
  await dbApi.run("PRAGMA foreign_keys = ON");
  const fk = await dbApi.get("PRAGMA foreign_keys");
  if (Number(fk?.foreign_keys) !== 1) throw new Error("APP_CUSTOMER_ACCESS_FOREIGN_KEYS_REQUIRED");
  const master = await dbApi.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customer_master_records'");
  if (!master?.name) throw new Error("CUSTOMER_MASTER_SCHEMA_REQUIRED");
  const before = await getAppCustomerAccessSchemaStatus(dbApi);
  await dbApi.run("BEGIN IMMEDIATE");
  try {
    for (const statement of statements) await dbApi.run(statement);
    await dbApi.run("COMMIT");
  } catch (error) {
    await dbApi.run("ROLLBACK").catch(() => null);
    throw error;
  }
  const after = await getAppCustomerAccessSchemaStatus(dbApi);
  if (!after.ready) throw new Error("APP_CUSTOMER_ACCESS_SCHEMA_INCOMPLETE");
  return { schemaVersion: APP_CUSTOMER_ACCESS_SCHEMA_VERSION, statementsExecuted: statements.length, before, after };
}

module.exports = {
  APP_CUSTOMER_ACCESS_SCHEMA_VERSION,
  APP_CUSTOMER_ACCESS_TABLES,
  getDdlPath,
  getAppCustomerAccessSchemaStatus,
  applyAppCustomerAccessSchema
};
