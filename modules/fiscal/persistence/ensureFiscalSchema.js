"use strict";

const fs = require("fs");
const path = require("path");

const FISCAL_TABLES = [
  "fiscal_establishments",
  "fiscal_establishment_stores",
  "fiscal_documents",
  "fiscal_document_events",
  "fiscal_tax_profiles",
  "fiscal_product_tax"
];

const ESTABLISHMENT_STAGE2_COLUMNS = [
  ["code", "TEXT NOT NULL DEFAULT ''"],
  ["im", "TEXT NOT NULL DEFAULT ''"],
  ["crt", "TEXT NOT NULL DEFAULT ''"],
  ["cnae_principal", "TEXT NOT NULL DEFAULT ''"],
  ["street", "TEXT NOT NULL DEFAULT ''"],
  ["number", "TEXT NOT NULL DEFAULT ''"],
  ["complement", "TEXT NOT NULL DEFAULT ''"],
  ["district", "TEXT NOT NULL DEFAULT ''"],
  ["city", "TEXT NOT NULL DEFAULT ''"],
  ["city_ibge_code", "TEXT NOT NULL DEFAULT ''"],
  ["zip", "TEXT NOT NULL DEFAULT ''"],
  ["phone", "TEXT NOT NULL DEFAULT ''"],
  ["certificate_configured", "INTEGER NOT NULL DEFAULT 0"],
  ["csc_configured", "INTEGER NOT NULL DEFAULT 0"],
  ["provider_configured", "INTEGER NOT NULL DEFAULT 0"]
];

function getDdlPath() {
  return path.join(__dirname, "fiscal-schema.sql");
}

function getStage2DdlPath() {
  return path.join(__dirname, "fiscal-schema-stage2.sql");
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

async function ensureColumn(dbApi, tableName, columnName, definition) {
  if (typeof dbApi.all !== "function") {
    throw new Error("dbApi.all e obrigatorio para ensureColumn (PRAGMA table_info)");
  }
  const rows = await dbApi.all(`PRAGMA table_info(${tableName})`);
  const exists = (rows || []).some((row) => String(row.name) === columnName);
  if (!exists) {
    await dbApi.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
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

async function applySqlFile(dbApi, ddlPath) {
  if (!fs.existsSync(ddlPath)) {
    throw new Error(`DDL fiscal nao encontrado: ${ddlPath}`);
  }
  const sqlText = fs.readFileSync(ddlPath, "utf8");
  const statements = splitSqlStatements(sqlText);
  const executed = [];
  for (const statement of statements) {
    await dbApi.run(statement);
    executed.push(statement.slice(0, 100).replace(/\s+/g, " "));
  }
  return executed;
}

/**
 * Aplica DDL aditiva do módulo fiscal (Stage 1 + Stage 2). Idempotente.
 * @param {{ run: Function, get: Function, all?: Function }} dbApi
 */
async function ensureFiscalSchema(dbApi) {
  if (!dbApi || typeof dbApi.run !== "function" || typeof dbApi.get !== "function") {
    throw new Error("dbApi.run e dbApi.get sao obrigatorios para ensureFiscalSchema");
  }
  const allFn = typeof dbApi.all === "function"
    ? dbApi.all.bind(dbApi)
    : async (sql, params = []) => {
      // fallback mínimo: PRAGMA via get não lista; exige all
      throw new Error("dbApi.all e obrigatorio para ensureFiscalSchema Stage 2");
    };

  const api = { run: dbApi.run, get: dbApi.get, all: allFn };
  const before = await getFiscalSchemaStatus(api.get);

  const executed = [
    ...(await applySqlFile(api, getDdlPath())),
    ...(await applySqlFile(api, getStage2DdlPath()))
  ];

  if (await tableExists(api.get, "fiscal_establishments")) {
    for (const [columnName, definition] of ESTABLISHMENT_STAGE2_COLUMNS) {
      await ensureColumn(api, "fiscal_establishments", columnName, definition);
    }
  }

  const after = await getFiscalSchemaStatus(api.get);
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
  getStage2DdlPath,
  getFiscalSchemaStatus,
  ensureFiscalSchema
};
