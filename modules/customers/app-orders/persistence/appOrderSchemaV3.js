"use strict";

/**
 * applyAppOrderSchemaV3 — Migration transacional para adicionar PAID ao status
 * de app_orders, incluindo colunas de persistência de pagamento.
 *
 * PADRÃO TRANSACIONAL:
 *   BEGIN IMMEDIATE
 *   → criar tabela temporária
 *   → copiar dados
 *   → validar quantidade
 *   → substituir tabela
 *   → recriar índices
 *   → COMMIT
 *
 * Em erro: ROLLBACK completo.
 *
 * NÃO usar backup persistente com CREATE TABLE IF NOT EXISTS.
 *
 * Colunas adicionadas:
 *   status → PAID, PAYMENT_PENDING
 *   paid_at TEXT
 *   payment_attempt_id TEXT
 *   payment_transaction_nsu TEXT
 *   payment_receipt_url TEXT
 */

const V3_STATUS_VALUES = "PAID,PAYMENT_PENDING";

function isSchemaV3(db) {
  if (!db.get && !db.prepare) return false;

  if (db.get) {
    // Async dbApi (memoryDb style)
    return db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='app_orders'")
      .then(sql => {
        if (!sql) return false;
        const createSql = sql.sql || "";
        return createSql.includes("'PAID'") && createSql.includes("'PAYMENT_PENDING'")
          && createSql.includes("paid_at")
          && createSql.includes("payment_attempt_id");
      });
  }

  // Sync dbApi (better-sqlite3 style)
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='app_orders'").get();
  if (!sql) return false;
  const createSql = sql.sql || "";
  return createSql.includes("'PAID'") && createSql.includes("'PAYMENT_PENDING'")
    && createSql.includes("paid_at")
    && createSql.includes("payment_attempt_id");
}

async function applyAppOrderSchemaV3(db) {
  const migrated = { migrated: false, reason: "" };

  // Verificar se já está no v3
  const isV3 = isSchemaV3(db);
  if (typeof isV3 === "object" && isV3.then) {
    const v3 = await isV3;
    if (v3) {
      migrated.migrated = false;
      migrated.reason = "already_v3";
      return migrated;
    }
  } else if (isV3 === true) {
    migrated.migrated = false;
    migrated.reason = "already_v3";
    return migrated;
  }

  // Verificar se app_orders existe
  const tableCheck = db.get
    ? await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='app_orders'")
    : null;

  if (!tableCheck) {
    migrated.migrated = false;
    migrated.reason = "table_not_exists";
    return migrated;
  }

  // Migration transacional: BEGIN IMMEDIATE
  // Desabilitar foreign_keys para permitir DROP/CREATE da tabela referenciada
  await db.run("PRAGMA foreign_keys=OFF");
  await db.run("BEGIN IMMEDIATE");

  try {
    // 1. Criar tabela temporária
    await db.run("CREATE TABLE app_orders_migration_tmp AS SELECT * FROM app_orders");

    // 2. Validar quantidade de dados copiados
    const originalCount = await db.get("SELECT COUNT(*) as cnt FROM app_orders_migration_tmp");
    const sourceCount = await db.get("SELECT COUNT(*) as cnt FROM app_orders");
    if (originalCount.cnt !== sourceCount.cnt) {
      throw new Error("DATA_INTEGRITY: row count mismatch after copy");
    }

    // 3. Substituir tabela original
    await db.run("DROP TABLE app_orders");

    await db.run(`
      CREATE TABLE app_orders (
        id TEXT PRIMARY KEY,
        order_number TEXT NOT NULL,
        account_id TEXT NOT NULL,
        fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('DELIVERY', 'PICKUP')),
        address_id TEXT,
        pickup_store_id TEXT,
        shipping_provider TEXT,
        shipping_service_code TEXT,
        shipping_quote_cents INTEGER,
        shipping_quote_currency TEXT DEFAULT 'BRL',
        subtotal_cents INTEGER NOT NULL,
        total_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'BRL',
        status TEXT NOT NULL CHECK (status IN ('CREATING', 'STOCK_RESERVED', 'READY_FOR_PAYMENT', 'FAILED', 'CANCELLED', 'EXPIRED', 'PAID', 'PAYMENT_PENDING')),
        idempotency_key TEXT UNIQUE,
        snapshot_json TEXT NOT NULL,
        reservation_ids_json TEXT,
        paid_at TEXT,
        payment_attempt_id TEXT,
        payment_transaction_nsu TEXT,
        payment_receipt_url TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        failed_reason TEXT,
        FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT
      )
    `);

    // 4. Copiar dados de volta (apenas colunas existentes na nova tabela)
    await db.run(`
      INSERT INTO app_orders
        (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id,
         shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency,
         subtotal_cents, total_cents, currency, status, idempotency_key, snapshot_json,
         reservation_ids_json, version, created_at, updated_at, expires_at, failed_reason)
      SELECT
        id, order_number, account_id, fulfillment_type, address_id, pickup_store_id,
        shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency,
        subtotal_cents, total_cents, currency, status, idempotency_key, snapshot_json,
        reservation_ids_json, version, created_at, updated_at, expires_at, failed_reason
      FROM app_orders_migration_tmp
    `);

    // 5. Validar quantidade restaurada
    const restoredCount = await db.get("SELECT COUNT(*) as cnt FROM app_orders");
    if (restoredCount.cnt !== sourceCount.cnt) {
      throw new Error("DATA_INTEGRITY: row count mismatch after restore");
    }

    // 6. Limpar tabela temporária
    await db.run("DROP TABLE app_orders_migration_tmp");

    // 7. Recriar índices
    await db.run("CREATE INDEX IF NOT EXISTS idx_app_orders_account ON app_orders(account_id)");
    await db.run("CREATE INDEX IF NOT EXISTS idx_app_orders_status ON app_orders(status)");
    await db.run("CREATE INDEX IF NOT EXISTS idx_app_orders_idempotency ON app_orders(idempotency_key)");
    await db.run("CREATE INDEX IF NOT EXISTS idx_app_orders_order_number ON app_orders(order_number)");

    // COMMIT
    await db.run("COMMIT");
    // Reabilitar foreign_keys
    await db.run("PRAGMA foreign_keys=ON");

    migrated.migrated = true;
    migrated.reason = "v3_applied";
  } catch (err) {
    // ROLLBACK completo
    try {
      await db.run("ROLLBACK");
    } catch (rollbackErr) {
      // Ignorar erro de rollback
    }
    await db.run("PRAGMA foreign_keys=ON");
    throw err;
  }

  return migrated;
}

module.exports = { applyAppOrderSchemaV3, isSchemaV3, V3_STATUS_VALUES };
