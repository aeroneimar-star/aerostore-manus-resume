"use strict";

const fs = require("fs");
const path = require("path");

function splitSqlStatements(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("--") && line.trim().length > 0)
    .join("\n")
    .split(/;\s*(?=\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applyAppPaymentSchema(db) {
  const schemaPath = path.join(__dirname, "app-payments-schema-v1.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");
  const statements = splitSqlStatements(sql);

  try {
    await db.get(`SELECT 1 FROM app_customer_accounts LIMIT 1`);
  } catch (err) {
    throw new Error("APP_PAYMENT_SCHEMA_MISSING_PREREQ:app_customer_accounts");
  }

  try {
    await db.get(`SELECT 1 FROM app_orders LIMIT 1`);
  } catch (err) {
    throw new Error("APP_PAYMENT_SCHEMA_MISSING_PREREQ:app_orders");
  }

  for (const stmt of statements) {
    await db.run(stmt);
  }

  return { ready: true, statements: statements.length };
}

module.exports = { applyAppPaymentSchema, splitSqlStatements };
