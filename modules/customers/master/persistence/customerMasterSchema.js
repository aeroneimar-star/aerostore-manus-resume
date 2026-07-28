"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CUSTOMER_MASTER_SCHEMA_VERSION = "customer-master-schema/v1";

const CUSTOMER_MASTER_TABLES = Object.freeze([
  "customer_master_records",
  "customer_master_sources",
  "customer_master_identifiers",
  "customer_identity_conflicts",
  "customer_identity_conflict_participants",
  "customer_master_merge_history",
  "customer_master_sync_checkpoints",
  "customer_master_jobs"
]);

const ROLLBACK_TABLE_ORDER = Object.freeze([
  "customer_identity_conflict_participants",
  "customer_identity_conflicts",
  "customer_master_sync_checkpoints",
  "customer_master_jobs",
  "customer_master_merge_history",
  "customer_master_identifiers",
  "customer_master_sources",
  "customer_master_records"
]);

function getCustomerMasterDdlPath() {
  return path.join(__dirname, "customer-master-schema-v1.sql");
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

function assertDbApi(dbApi) {
  if (
    !dbApi
    || typeof dbApi.run !== "function"
    || typeof dbApi.get !== "function"
    || typeof dbApi.all !== "function"
  ) {
    throw new Error("dbApi.run, dbApi.get e dbApi.all sao obrigatorios");
  }
}

async function tableExists(get, tableName) {
  const row = await get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  );
  return Boolean(row?.name);
}

async function getCustomerMasterSchemaStatus(dbApi) {
  assertDbApi(dbApi);
  const tables = [];
  for (const table of CUSTOMER_MASTER_TABLES) {
    const exists = await tableExists(dbApi.get, table);
    const count = exists
      ? Number((await dbApi.get(`SELECT COUNT(*) AS total FROM ${table}`))?.total || 0)
      : null;
    tables.push({ table, exists, count });
  }
  return {
    schemaVersion: CUSTOMER_MASTER_SCHEMA_VERSION,
    ready: tables.every((item) => item.exists),
    empty: tables.every((item) => item.count === 0),
    tables
  };
}

async function applyCustomerMasterSchema(dbApi) {
  assertDbApi(dbApi);
  const ddlPath = getCustomerMasterDdlPath();
  if (!fs.existsSync(ddlPath)) {
    throw new Error(`DDL da Camada Mestre nao encontrada: ${ddlPath}`);
  }

  const sqlText = fs.readFileSync(ddlPath, "utf8");
  const statements = splitSqlStatements(sqlText);
  if (!statements.length) {
    throw new Error("DDL da Camada Mestre esta vazia");
  }

  await dbApi.run("PRAGMA foreign_keys = ON");
  const foreignKeys = await dbApi.get("PRAGMA foreign_keys");
  if (Number(foreignKeys?.foreign_keys) !== 1) {
    throw new Error("SQLite foreign_keys nao foi habilitado");
  }

  const before = await getCustomerMasterSchemaStatus(dbApi);
  await dbApi.run("BEGIN IMMEDIATE");
  try {
    for (const statement of statements) {
      await dbApi.run(statement);
    }
    await dbApi.run("COMMIT");
  } catch (error) {
    await dbApi.run("ROLLBACK").catch(() => null);
    throw error;
  }

  const after = await getCustomerMasterSchemaStatus(dbApi);
  return {
    schemaVersion: CUSTOMER_MASTER_SCHEMA_VERSION,
    ddlPath,
    statementsExecuted: statements.length,
    before,
    after
  };
}

async function rollbackEmptyCustomerMasterSchema(dbApi, options = {}) {
  assertDbApi(dbApi);
  if (options.confirmEmptySchema !== true || options.temporaryDatabaseOnly !== true) {
    throw new Error("Rollback exige confirmEmptySchema=true e temporaryDatabaseOnly=true");
  }

  const status = await getCustomerMasterSchemaStatus(dbApi);
  const populated = status.tables.filter((item) => item.exists && item.count !== 0);
  if (populated.length) {
    throw new Error(`Rollback bloqueado: tabelas possuem dados (${populated.map((item) => item.table).join(", ")})`);
  }

  await dbApi.run("PRAGMA foreign_keys = ON");
  await dbApi.run("BEGIN IMMEDIATE");
  try {
    for (const table of ROLLBACK_TABLE_ORDER) {
      await dbApi.run(`DROP TABLE IF EXISTS ${table}`);
    }
    await dbApi.run("COMMIT");
  } catch (error) {
    await dbApi.run("ROLLBACK").catch(() => null);
    throw error;
  }

  return getCustomerMasterSchemaStatus(dbApi);
}

module.exports = {
  CUSTOMER_MASTER_SCHEMA_VERSION,
  CUSTOMER_MASTER_TABLES,
  ROLLBACK_TABLE_ORDER,
  getCustomerMasterDdlPath,
  splitSqlStatements,
  getCustomerMasterSchemaStatus,
  applyCustomerMasterSchema,
  rollbackEmptyCustomerMasterSchema
};
