"use strict";
const fs = require("fs");
const path = require("path");
const SCHEMA_SQL_PATH = path.join(__dirname, "appPaymentAttemptSchema.sql");

/**
 * Aplica a migração do schema de payment attempts.
 *
 * É idempotente: CREATE TABLE IF NOT EXISTS não falha se a tabela já existe.
 * Pode ser chamado múltiplas vezes sem efeitos colaterais.
 *
 * Compatível com banco novo e legado (não altera tabelas existentes).
 */
async function applyAppPaymentAttemptSchema(connection) {
  const sql = fs.readFileSync(SCHEMA_SQL_PATH, "utf8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    try {
      await connection.run(stmt);
    } catch (err) {
      // SQLite: CREATE TABLE IF NOT EXISTS não deve falhar,
      // mas protege contra erros inesperados
      if (
        err.message &&
        (err.message.includes("duplicate column") ||
         err.message.includes("already exists") ||
         err.message.includes("UNIQUE constraint") ||
         err.message.includes("UNIQUE index"))
      ) {
        continue;
      }
      throw err;
    }
  }
}

module.exports = { applyAppPaymentAttemptSchema };
