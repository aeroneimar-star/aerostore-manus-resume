"use strict";

const fs = require("fs");
const path = require("path");

const SCHEMA_SQL_PATH = path.join(__dirname, "app-orders-schema-v2.sql");

/**
 * Aplica a migração v2 do schema de orders.
 *
 * A migração é aditiva e segura:
 * - Adiciona coluna expired_at TEXT (nullable)
 * - Cria índice idx_app_orders_expirable
 *
 * É idempotente: se a coluna já existir, o ALTER TABLE falha silenciosamente.
 * Pode ser chamado múltiplas vezes sem efeitos colaterais.
 */
async function applyAppOrderSchemaV2(connection) {
  const sql = fs.readFileSync(SCHEMA_SQL_PATH, "utf8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      await connection.run(stmt);
    } catch (err) {
      // SQLite: ALTER TABLE ADD COLUMN falha se a coluna já existe
      // É um erro esperado e seguro — significa que a migração já foi aplicada
      if (
        err.message &&
        (err.message.includes("duplicate column") ||
         err.message.includes("already exists"))
      ) {
        continue;
      }
      // Re-lançar erros inesperados
      throw err;
    }
  }
}

module.exports = { applyAppOrderSchemaV2 };
