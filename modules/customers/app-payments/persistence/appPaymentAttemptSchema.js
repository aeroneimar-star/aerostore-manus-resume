"use strict";

/**
 * appPaymentAttemptSchema — Migration v1 → v2.
 *
 * Detecta colunas via PRAGMA table_info, índices via PRAGMA index_list,
 * SQL original via sqlite_master.
 *
 * A migration deve:
 * - preservar todos os dados;
 * - remover a antiga restrição UNIQUE de provider_reference;
 * - adicionar provider_transaction_nsu;
 * - criar UNIQUE(order_id, request_fingerprint);
 * - manter idempotency_key UNIQUE;
 * - permitir múltiplos provider_reference NULL;
 * - executar dentro de transação;
 * - ser idempotente.
 *
 * Falhas de migration devem abortar e aparecer claramente.
 */

async function applyAppPaymentAttemptSchema(connection) {
  const runner = connection;

  async function getColumnNames(tableName) {
    const rows = await runner.all(`PRAGMA table_info(${tableName})`);
    return (rows || []).map(r => r.name);
  }

  async function getIndexNames(tableName) {
    const rows = await runner.all(`PRAGMA index_list(${tableName})`);
    return (rows || []).map(r => r.name);
  }

  async function tableExists(tableName) {
    const row = await runner.get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );
    return !!row;
  }

  async function indexExists(indexName) {
    const row = await runner.get(
      `SELECT name FROM sqlite_master WHERE type='index' AND name=?`,
      [indexName]
    );
    return !!row;
  }

  const tableName = "app_payment_attempts";

  // Se a tabela não existe, aplicar schema completo v2
  if (!(await tableExists(tableName))) {
    await runner.run(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'INFINITEPAY',
        method TEXT NOT NULL DEFAULT 'PIX',
        status TEXT NOT NULL DEFAULT 'CREATED',
        idempotency_key TEXT NOT NULL UNIQUE,
        provider_reference TEXT,
        provider_transaction_nsu TEXT,
        provider_checkout_url TEXT,
        provider_pix_copy_paste TEXT,
        provider_qr_code TEXT,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        currency TEXT NOT NULL DEFAULT 'BRL',
        request_fingerprint TEXT NOT NULL,
        reservation_fingerprint TEXT,
        provider_response_sanitized_json TEXT,
        failure_code TEXT,
        failure_message_sanitized TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (order_id) REFERENCES app_orders(id) ON DELETE RESTRICT
      )
    `);
    await runner.run(`CREATE INDEX IF NOT EXISTS idx_payment_attempts_order ON ${tableName}(order_id)`);
    await runner.run(`CREATE INDEX IF NOT EXISTS idx_payment_attempts_fingerprint ON ${tableName}(request_fingerprint)`);
    await runner.run(`CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON ${tableName}(status) WHERE status IN ('PENDING', 'REQUESTING')`);
    await runner.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_order_fingerprint ON ${tableName}(order_id, request_fingerprint)`);
    return { migrated: false, from_version: "none" };
  }

  const columns = await getColumnNames(tableName);
  const columnSet = new Set(columns);

  // Já em v2? (provider_transaction_nsu existe)
  if (columnSet.has("provider_transaction_nsu")) {
    // Garantir índices v2
    if (!(await indexExists("idx_payment_attempts_order_fingerprint"))) {
      await runner.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_order_fingerprint ON ${tableName}(order_id, request_fingerprint)`
      );
    }
    return { migrated: false, from_version: "v2" };
  }

  // v1 → v2 migration
  await runner.run("BEGIN IMMEDIATE");
  try {
    // 1. Criar tabela temporária com schema v2
    await runner.run(`
      CREATE TABLE _app_payment_attempts_v2 (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'INFINITEPAY',
        method TEXT NOT NULL DEFAULT 'PIX',
        status TEXT NOT NULL DEFAULT 'CREATED',
        idempotency_key TEXT NOT NULL UNIQUE,
        provider_reference TEXT,
        provider_transaction_nsu TEXT,
        provider_checkout_url TEXT,
        provider_pix_copy_paste TEXT,
        provider_qr_code TEXT,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        currency TEXT NOT NULL DEFAULT 'BRL',
        request_fingerprint TEXT NOT NULL,
        reservation_fingerprint TEXT,
        provider_response_sanitized_json TEXT,
        failure_code TEXT,
        failure_message_sanitized TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (order_id) REFERENCES app_orders(id) ON DELETE RESTRICT
      )
    `);

    // 2. Mapear colunas v1 disponíveis
    const v1Cols = ["id", "order_id", "provider", "method", "status", "idempotency_key",
      "provider_reference", "provider_checkout_url", "provider_pix_copy_paste",
      "provider_qr_code", "amount_cents", "currency",
      "request_fingerprint", "reservation_fingerprint",
      "provider_response_sanitized_json", "failure_code",
      "failure_message_sanitized", "expires_at", "created_at", "updated_at", "version"];

    const availableCols = v1Cols.filter(c => columnSet.has(c));
    const colList = availableCols.join(", ");

    await runner.run(
      `INSERT INTO _app_payment_attempts_v2 (${colList}) SELECT ${colList} FROM ${tableName}`
    );

    // 3. Drop antiga
    await runner.run(`DROP TABLE ${tableName}`);

    // 4. Renomear
    await runner.run(`ALTER TABLE _app_payment_attempts_v2 RENAME TO ${tableName}`);

    // 5. Índices
    await runner.run(`CREATE INDEX IF NOT EXISTS idx_payment_attempts_order ON ${tableName}(order_id)`);
    await runner.run(`CREATE INDEX IF NOT EXISTS idx_payment_attempts_fingerprint ON ${tableName}(request_fingerprint)`);
    await runner.run(`CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON ${tableName}(status) WHERE status IN ('PENDING', 'REQUESTING')`);
    await runner.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_order_fingerprint ON ${tableName}(order_id, request_fingerprint)`);

    await runner.run("COMMIT");
    return { migrated: true, from_version: "v1" };
  } catch (err) {
    try { await runner.run("ROLLBACK"); } catch (_) {}
    throw new Error(`MIGRATION_V1_TO_V2_FAILED: ${err.message}`);
  }
}

module.exports = { applyAppPaymentAttemptSchema };
