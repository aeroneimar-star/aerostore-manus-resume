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

async function applyAppOrderSchema(db) {
  const schemaPath = path.join(__dirname, "app-orders-schema-v1.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");
  const statements = splitSqlStatements(sql);

  // Verificar pre-condições
  try {
    await db.get(`SELECT 1 FROM app_customer_accounts LIMIT 1`);
  } catch (err) {
    throw new Error("APP_ORDER_SCHEMA_MISSING_PREREQ:app_customer_accounts");
  }

  for (const stmt of statements) {
    await db.run(stmt);
  }

  return { ready: true, statements: statements.length };
}

module.exports = { applyAppOrderSchema, splitSqlStatements };
