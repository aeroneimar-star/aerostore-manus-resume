"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { splitSqlStatements } = require("../../master/persistence/customerMasterSchema");

const VERSION = "app-fulfillment-schema/v1";

async function getAppFulfillmentSchemaStatus(db) {
  const table = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='app_cart_fulfillment'");
  return {
    schemaVersion: VERSION,
    ready: Boolean(table?.name),
    fulfillmentCount: table?.name ? Number((await db.get("SELECT COUNT(*) total FROM app_cart_fulfillment"))?.total || 0) : null
  };
}

async function applyAppFulfillmentSchema(db) {
  await db.run("PRAGMA foreign_keys=ON");
  const carts = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='app_carts'");
  if (!carts?.name) throw new Error("APP_CART_SCHEMA_REQUIRED");
  const statements = splitSqlStatements(fs.readFileSync(path.join(__dirname, "app-fulfillment-schema-v1.sql"), "utf8"));
  const before = await getAppFulfillmentSchemaStatus(db);
  await db.run("BEGIN IMMEDIATE");
  try {
    for (const statement of statements) await db.run(statement);
    await db.run("COMMIT");
  } catch (error) { await db.run("ROLLBACK").catch(() => null); throw error; }
  const after = await getAppFulfillmentSchemaStatus(db);
  if (!after.ready) throw new Error("APP_FULFILLMENT_SCHEMA_INCOMPLETE");
  return { schemaVersion: VERSION, statementsExecuted: statements.length, before, after };
}

module.exports = { APP_FULFILLMENT_SCHEMA_VERSION: VERSION, getAppFulfillmentSchemaStatus, applyAppFulfillmentSchema };
