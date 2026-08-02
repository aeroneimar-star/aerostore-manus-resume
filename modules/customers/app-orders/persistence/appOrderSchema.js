"use strict";

const fs = require("fs");
const path = require("path");

const SCHEMA_SQL_PATH = path.join(__dirname, "app-orders-schema-v1.sql");

async function applyAppOrderSchema(connection) {
  const sql = fs.readFileSync(SCHEMA_SQL_PATH, "utf8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await connection.run(stmt);
  }
}

module.exports = { applyAppOrderSchema };
