"use strict";

/**
 * Shop publication schema — migration helper (Fase 2.9 prep).
 *
 * NÃO é chamado por db.js / initializeDatabase / server boot.
 * Aplicar somente via scripts/shop_apply_publication_migration.js
 * com confirmação explícita (SHOP_APPLY_MIGRATION=true).
 *
 * Sem shop_stock_reservations.
 */

const fs = require("fs");
const path = require("path");

const SHOP_PUBLICATION_TABLES = [
  "shop_product_publications",
  "shop_variant_publications",
  "shop_product_images",
  "shop_catalog_settings"
];

function getDdlPath() {
  return path.join(__dirname, "shop-publication-ddl.sql");
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

async function getShopPublicationSchemaStatus(get) {
  const checks = [];
  for (const table of SHOP_PUBLICATION_TABLES) {
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
 * Aplica DDL aditiva (CREATE IF NOT EXISTS). Idempotente.
 * @param {{ run: Function, get: Function }} dbApi
 */
async function applyShopPublicationMigration(dbApi) {
  if (!dbApi || typeof dbApi.run !== "function" || typeof dbApi.get !== "function") {
    throw new Error("dbApi.run e dbApi.get são obrigatórios");
  }

  const ddlPath = getDdlPath();
  if (!fs.existsSync(ddlPath)) {
    throw new Error(`DDL não encontrado: ${ddlPath}`);
  }

  const before = await getShopPublicationSchemaStatus(dbApi.get);
  const sqlText = fs.readFileSync(ddlPath, "utf8");
  const statements = splitSqlStatements(sqlText);
  const executed = [];

  for (const statement of statements) {
    await dbApi.run(statement);
    executed.push(statement.slice(0, 80).replace(/\s+/g, " "));
  }

  const after = await getShopPublicationSchemaStatus(dbApi.get);
  return {
    success: true,
    ddl_path: ddlPath,
    statements_executed: executed.length,
    before,
    after,
    tables: SHOP_PUBLICATION_TABLES.slice(),
    note: "DDL aditiva aplicada (IF NOT EXISTS). Sem reservas. Sem alteração em pdv_*."
  };
}

module.exports = {
  SHOP_PUBLICATION_TABLES,
  getDdlPath,
  splitSqlStatements,
  getShopPublicationSchemaStatus,
  applyShopPublicationMigration
};
