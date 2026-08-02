"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { splitSqlStatements } = require("../../master/persistence/customerMasterSchema");

const VERSION = "app-cart-schema/v1";
const CART_TABLES = ["app_carts", "app_cart_items"];

function assertDb(dbApi) {
  if (!dbApi || ["run", "get", "all"].some((method) => typeof dbApi[method] !== "function")) {
    throw new Error("APP_CART_DB_API_REQUIRED");
  }
}

async function getAppCartSchemaStatus(dbApi) {
  assertDb(dbApi);
  const tables = await dbApi.all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('app_carts','app_cart_items')"
  );
  const tableNames = new Set(tables.map((row) => row.name));
  const ready = CART_TABLES.every((table) => tableNames.has(table));
  const carts = ready
    ? Number((await dbApi.get("SELECT COUNT(*) AS total FROM app_carts"))?.total || 0)
    : null;
  const items = ready
    ? Number((await dbApi.get("SELECT COUNT(*) AS total FROM app_cart_items WHERE removed_at IS NULL"))?.total || 0)
    : null;
  const activeCarts = ready
    ? Number((await dbApi.get("SELECT COUNT(*) AS total FROM app_carts WHERE status='ACTIVE'"))?.total || 0)
    : null;
  return {
    schemaVersion: VERSION,
    ready,
    tables: { app_carts: tableNames.has("app_carts"), app_cart_items: tableNames.has("app_cart_items") },
    carts,
    items,
    activeCarts
  };
}

async function applyAppCartSchema(dbApi) {
  assertDb(dbApi);
  const accounts = await dbApi.get("SELECT name FROM sqlite_master WHERE type='table' AND name='app_customer_accounts'");
  if (!accounts?.name) throw new Error("APP_CUSTOMER_ACCESS_SCHEMA_REQUIRED");
  const statements = splitSqlStatements(
    fs.readFileSync(path.join(__dirname, "app-cart-schema-v1.sql"), "utf8")
  );
  const before = await getAppCartSchemaStatus(dbApi);
  await dbApi.run("PRAGMA foreign_keys=ON");
  await dbApi.run("BEGIN IMMEDIATE");
  try {
    for (const statement of statements) await dbApi.run(statement);
    await dbApi.run("COMMIT");
  } catch (error) {
    await dbApi.run("ROLLBACK").catch(() => null);
    throw error;
  }
  const after = await getAppCartSchemaStatus(dbApi);
  if (!after.ready) throw new Error("APP_CART_SCHEMA_INCOMPLETE");
  return {
    schemaVersion: VERSION,
    statementsExecuted: statements.length,
    before,
    after
  };
}

module.exports = {
  APP_CART_SCHEMA_VERSION: VERSION,
  getAppCartSchemaStatus,
  applyAppCartSchema
};
