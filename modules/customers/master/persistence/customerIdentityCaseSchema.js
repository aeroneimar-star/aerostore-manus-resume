"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CUSTOMER_IDENTITY_CASE_SCHEMA_VERSION = "customer-identity-case-schema/v1";

const CUSTOMER_IDENTITY_CASE_TABLES = Object.freeze([
  "customer_identity_cases",
  "customer_identity_case_conflicts",
  "customer_identity_case_entities",
  "customer_identity_case_events"
]);

function getCustomerIdentityCaseDdlPath() {
  return path.join(__dirname, "customer-identity-case-schema-v1.sql");
}

function splitSqlStatements(sqlText = "") {
  return String(sqlText || "")
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function assertReadDbApi(dbApi) {
  if (
    !dbApi
    || typeof dbApi.get !== "function"
    || typeof dbApi.all !== "function"
  ) {
    throw new Error("CUSTOMER_IDENTITY_CASE_DB_REQUIRED");
  }
}

function assertWriteDbApi(dbApi) {
  assertReadDbApi(dbApi);
  if (typeof dbApi.run !== "function") {
    throw new Error("CUSTOMER_IDENTITY_CASE_WRITE_DB_REQUIRED");
  }
}

async function getCustomerIdentityCaseSchemaStatus(dbApi) {
  assertReadDbApi(dbApi);
  const tables = [];
  for (const table of CUSTOMER_IDENTITY_CASE_TABLES) {
    const found = await dbApi.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table]
    );
    const exists = Boolean(found?.name);
    const count = exists
      ? Number((await dbApi.get(`SELECT COUNT(*) AS total FROM ${table}`))?.total || 0)
      : null;
    tables.push({ table, exists, count });
  }
  return {
    schemaVersion: CUSTOMER_IDENTITY_CASE_SCHEMA_VERSION,
    ready: tables.every((item) => item.exists),
    empty: tables.every((item) => item.count === 0),
    tables
  };
}

async function applyCustomerIdentityCaseSchema(dbApi) {
  assertWriteDbApi(dbApi);
  const ddlPath = getCustomerIdentityCaseDdlPath();
  const statements = splitSqlStatements(fs.readFileSync(ddlPath, "utf8"));
  if (!statements.length) throw new Error("CUSTOMER_IDENTITY_CASE_DDL_EMPTY");

  await dbApi.run("PRAGMA foreign_keys = ON");
  const foreignKeys = await dbApi.get("PRAGMA foreign_keys");
  if (Number(foreignKeys?.foreign_keys) !== 1) {
    throw new Error("CUSTOMER_IDENTITY_CASE_FOREIGN_KEYS_REQUIRED");
  }

  const before = await getCustomerIdentityCaseSchemaStatus(dbApi);
  await dbApi.run("BEGIN IMMEDIATE");
  try {
    for (const statement of statements) await dbApi.run(statement);
    await dbApi.run("COMMIT");
  } catch (error) {
    await dbApi.run("ROLLBACK").catch(() => null);
    throw error;
  }
  const after = await getCustomerIdentityCaseSchemaStatus(dbApi);
  return {
    schemaVersion: CUSTOMER_IDENTITY_CASE_SCHEMA_VERSION,
    statementsExecuted: statements.length,
    before,
    after
  };
}

module.exports = {
  CUSTOMER_IDENTITY_CASE_SCHEMA_VERSION,
  CUSTOMER_IDENTITY_CASE_TABLES,
  getCustomerIdentityCaseDdlPath,
  splitSqlStatements,
  getCustomerIdentityCaseSchemaStatus,
  applyCustomerIdentityCaseSchema
};
