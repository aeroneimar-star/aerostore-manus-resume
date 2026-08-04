"use strict";

/**
 * applyAppOrderSchemaV3 — Migration para adicionar PAID ao status de app_orders.
 *
 * Padrão: verificar se já migrou, se não, fazer backup + recreate + restore.
 */

const V3_STATUS_VALUES = "PAID,PAYMENT_PENDING";

function isSchemaV3(db) {
  // Verificar se o status CHECK já inclui PAID
  // Usa db.get (async) ou db.prepare (sync) dependendo do tipo
  if (!db.get && !db.prepare) return false;

  if (db.get) {
    // Async dbApi (memoryDb style)
    return db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='app_orders'")
      .then(sql => {
        if (!sql) return false;
        const createSql = sql.sql || "";
        return createSql.includes("'PAID'") && createSql.includes("'PAYMENT_PENDING'");
      });
  }

  // Sync dbApi (better-sqlite3 style)
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='app_orders'").get();
  if (!sql) return false;
  const createSql = sql.sql || "";
  return createSql.includes("'PAID'") && createSql.includes("'PAYMENT_PENDING'");
}

async function applyAppOrderSchemaV3(db) {
  const migrated = { migrated: false, reason: "" };

  // Verificar se já está no v3 (async check)
  const isV3 = isSchemaV3(db);
  if (typeof isV3 === "object" && isV3.then) {
    // Async promise
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

  // Backup e recreate
  const statements = [
    "CREATE TABLE IF NOT EXISTS app_orders_migration_backup AS SELECT * FROM app_orders",
    "DROP TABLE IF EXISTS app_orders",
    `CREATE TABLE app_orders (
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
      status TEXT NOT NULL CHECK (status IN ('CREATING', 'STOCK_RESERVED', 'READY_FOR_PAYMENT', 'FAILED', 'CANCELLED', 'EXPIRED', 'PAID', 'PAYMENT_PENDING')),
      idempotency_key TEXT UNIQUE,
      snapshot_json TEXT NOT NULL,
      reservation_ids_json TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT,
      failed_reason TEXT,
      FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT
    )`,
    "INSERT INTO app_orders SELECT * FROM app_orders_migration_backup",
    "DROP TABLE app_orders_migration_backup",
    "CREATE INDEX IF NOT EXISTS idx_app_orders_account ON app_orders(account_id)",
    "CREATE INDEX IF NOT EXISTS idx_app_orders_status ON app_orders(status)",
    "CREATE INDEX IF NOT EXISTS idx_app_orders_idempotency ON app_orders(idempotency_key)",
    "CREATE INDEX IF NOT EXISTS idx_app_orders_order_number ON app_orders(order_number)",
  ];

  try {
    for (const stmt of statements) {
      await db.run(stmt);
    }
    migrated.migrated = true;
    migrated.reason = "v3_applied";
  } catch (err) {
    // Se falhar, verificar se foi por duplicação
    if (err.message && (err.message.includes("already exists") || err.message.includes("UNIQUE"))) {
      migrated.migrated = false;
      migrated.reason = "v3_already_partial";
    } else {
      // Tentar rollback
      try {
        await db.run("DROP TABLE IF EXISTS app_orders_migration_backup");
      } catch {
        // Ignorar
      }
      throw err;
    }
  }

  return migrated;
}

module.exports = { applyAppOrderSchemaV3, isSchemaV3, V3_STATUS_VALUES };
