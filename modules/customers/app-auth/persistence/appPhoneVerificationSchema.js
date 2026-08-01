"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { splitSqlStatements } = require("../../master/persistence/customerMasterSchema");
const VERSION = "app-phone-verification-schema/v1";
const TABLE = "app_phone_verifications";
function ddlPath() { return path.join(__dirname, "app-phone-verification-schema-v1.sql"); }
async function status(db) {
  const found = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [TABLE]);
  return { schemaVersion: VERSION, ready: Boolean(found?.name), count: found ? Number((await db.get(`SELECT COUNT(*) total FROM ${TABLE}`)).total || 0) : null };
}
async function applyAppPhoneVerificationSchema(db) {
  await db.run("PRAGMA foreign_keys=ON");
  const base = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='app_customer_accounts'");
  if (!base) throw new Error("APP_CUSTOMER_ACCESS_SCHEMA_REQUIRED");
  const statements = splitSqlStatements(fs.readFileSync(ddlPath(), "utf8"));
  await db.run("BEGIN IMMEDIATE");
  try { for (const sql of statements) await db.run(sql); await db.run("COMMIT"); }
  catch (error) { await db.run("ROLLBACK").catch(() => null); throw error; }
  return { ...(await status(db)), statementsExecuted: statements.length };
}
module.exports = { APP_PHONE_VERIFICATION_SCHEMA_VERSION: VERSION, getAppPhoneVerificationSchemaStatus: status, applyAppPhoneVerificationSchema };
