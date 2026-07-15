"use strict";

const fs = require("fs");
const path = require("path");

const FISCAL_TABLES = [
  "fiscal_establishments",
  "fiscal_establishment_stores",
  "fiscal_documents",
  "fiscal_document_events"
];

function getDdlPath() {
  return path.join(__dirname, "fiscal-schema.sql");
}

function splitSqlStatements(sqlText = "") {
  return String(sqlText || "")
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n")
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

async function tableExists(get, tableName) {
  const row = await get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  );
  return Boolean(row?.name);
}

async function getFiscalSchemaStatus(get) {
  const checks = [];
  for (const table of FISCAL_TABLES) {
    checks.push({
      table,
      ready: await tableExists(get, table)
    });
  }
  return {
    ready: checks.every((item) => item.ready),
    tables: checks
  };
}

/**
 * Aplica DDL aditiva do módulo fiscal. Idempotente.
 * @param {{ run: Function, get: Function }} dbApi
 */
async function ensureFiscalSchema(dbApi) {
  if (!dbApi || typeof dbApi.run !== "function" || typeof dbApi.get !== "function") {
    throw new Error("dbApi.run e dbApi.get sao obrigatorios para ensureFiscalSchema");
  }

  const ddlPath = getDdlPath();
  if (!fs.existsSync(ddlPath)) {
    throw new Error(`DDL fiscal nao encontrado: ${ddlPath}`);
  }

  const before = await getFiscalSchemaStatus(dbApi.get);
  const sqlText = fs.readFileSync(ddlPath, "utf8");
  const statements = splitSqlStatements(sqlText);
  const executed = [];

  for (const statement of statements) {
    await dbApi.run(statement);
    executed.push(statement.slice(0, 100).replace(/\s+/g, " "));
  }

  const after = await getFiscalSchemaStatus(dbApi.get);
  return {
    before,
    after,
    executed_count: executed.length,
    ready: after.ready
  };
}

module.exports = {
  FISCAL_TABLES,
  getDdlPath,
  getFiscalSchemaStatus,
  ensureFiscalSchema
};
