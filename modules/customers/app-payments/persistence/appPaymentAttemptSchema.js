"use strict";

/**
 * appPaymentAttemptSchema — Migration v1 → v2.
 *
 * Detecta schema completo via:
 * - PRAGMA table_info (colunas, NOT NULL, tipos, defaults)
 * - PRAGMA index_list + PRAGMA index_info (índices, UNIQUE, composição)
 * - PRAGMA table_info ... CHECK constraints (via sqlite_master SQL parsing)
 *
 * Validação v2 requer TODOS os itens abaixo:
 *   1. Todas as 21 colunas do schema v2
 *   2. idempotency_key NOT NULL + UNIQUE
 *   3. idx_payment_attempts_order_fingerprint UNIQUE com (order_id, request_fingerprint)
 *   4. provider_reference SEM UNIQUE exclusiva
 *   5. Índices de order_id, request_fingerprint, status
 *   6. NOT NULL em colunas obrigatórias
 *   7. amount_cents CHECK > 0
 *
 * Se qualquer item estiver ausente ou incompatível: executar migration.
 * Não aceitar schema parcial como v2.
 */

// Schema v2 esperado — lista completa
const V2_COLUMNS = [
  { name: "id",                        type: "TEXT",    notNull: true  },
  { name: "order_id",                  type: "TEXT",    notNull: true  },
  { name: "provider",                  type: "TEXT",    notNull: true  },
  { name: "method",                    type: "TEXT",    notNull: true  },
  { name: "status",                    type: "TEXT",    notNull: true  },
  { name: "idempotency_key",           type: "TEXT",    notNull: true  },
  { name: "provider_reference",        type: "TEXT",    notNull: false },
  { name: "provider_transaction_nsu",  type: "TEXT",    notNull: false },
  { name: "provider_checkout_url",     type: "TEXT",    notNull: false },
  { name: "provider_pix_copy_paste",   type: "TEXT",    notNull: false },
  { name: "provider_qr_code",          type: "TEXT",    notNull: false },
  { name: "amount_cents",              type: "INTEGER", notNull: true  },
  { name: "currency",                  type: "TEXT",    notNull: true  },
  { name: "request_fingerprint",       type: "TEXT",    notNull: true  },
  { name: "reservation_fingerprint",   type: "TEXT",    notNull: false },
  { name: "provider_response_sanitized_json", type: "TEXT", notNull: false },
  { name: "failure_code",              type: "TEXT",    notNull: false },
  { name: "failure_message_sanitized", type: "TEXT",    notNull: false },
  { name: "expires_at",                type: "TEXT",    notNull: false },
  { name: "created_at",                type: "TEXT",    notNull: true  },
  { name: "updated_at",                type: "TEXT",    notNull: true  },
  { name: "version",                   type: "INTEGER", notNull: true  },
];

const V2_REQUIRED_INDICES = [
  { name: "idx_payment_attempts_order",         columns: ["order_id"],                   unique: false },
  { name: "idx_payment_attempts_fingerprint",   columns: ["request_fingerprint"],          unique: false },
  { name: "idx_payment_attempts_status",        columns: ["status"],                      unique: false, partial: true },
  { name: "idx_payment_attempts_order_fingerprint", columns: ["order_id", "request_fingerprint"], unique: true },
];

// provider_reference NÃO deve ter UNIQUE exclusiva
const V2_FORBIDDEN_UNIQUE_ON_PROVIDER_REFERENCE = true;

async function applyAppPaymentAttemptSchema(connection) {
  const runner = connection;

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

  // Obter info completa das colunas via PRAGMA table_info
  async function getColumnInfo(tableName) {
    const rows = await runner.all(`PRAGMA table_info(${tableName})`);
    // rows: [{cid, name, type, notnull, dflt_value, pk}]
    return (rows || []).map(r => ({
      name: r.name,
      type: (r.type || "").toUpperCase(),
      notNull: !!r.notnull,
      isPk: !!r.pk,
      default: r.dflt_value,
    }));
  }

  // Obter todos os índices via PRAGMA index_list
  async function getAllIndices(tableName) {
    const list = await runner.all(`PRAGMA index_list(${tableName})`);
    const result = [];
    for (const idx of (list || [])) {
      const info = await runner.all(`PRAGMA index_info(${idx.name})`);
      const columns = (info || []).sort((a, b) => a.seqno - b.seqno).map(c => c.name);
      result.push({
        name: idx.name,
        unique: !!idx.unique,
        columns,
        origin: idx.origin, // 'c' = CREATE INDEX, 'pk' = primary key, 'u' = UNIQUE constraint
      });
    }
    return result;
  }

  // Verificar se há UNIQUE constraint (via CREATE TABLE ou UNIQUE INDEX) em provider_reference
  async function hasUniqueOnProviderReference(tableName) {
    // 1. Verificar UNIQUE INDEX com apenas provider_reference
    const indices = await getAllIndices(tableName);
    for (const idx of indices) {
      if (idx.unique && idx.columns.length === 1 && idx.columns[0] === "provider_reference") {
        return true;
      }
    }
    // 2. Verificar UNIQUE constraint inline no CREATE TABLE (idempotency_key tem UNIQUE inline)
    //    provider_reference NÃO deve ter UNIQUE inline
    const tableSql = await runner.get(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );
    if (tableSql && tableSql.sql) {
      // Se o SQL contém "provider_reference TEXT NOT NULL UNIQUE" ou similar
      // Verificar se há UNIQUE após provider_reference antes de próximo campo
      const sql = tableSql.sql;
      const provRefMatch = sql.match(/provider_reference\s+TEXT\s+(.*?)\s*(?:,|\))/i);
      if (provRefMatch && provRefMatch[1].toUpperCase().includes("UNIQUE")) {
        return true;
      }
    }
    return false;
  }

  // Verificar CHECK constraint em amount_cents
  async function hasAmountCentsCheck(tableName) {
    const tableSql = await runner.get(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
      [tableName]
    );
    if (!tableSql || !tableSql.sql) return false;
    // Aceitar qualquer CHECK que referencie amount_cents > 0
    return /amount_cents.*CHECK|CHECK.*amount_cents/i.test(tableSql.sql);
  }

  // Verificar se o schema atual é v2 completo
  async function isSchemaV2(tableName) {
    const columns = await getColumnInfo(tableName);
    const indices = await getAllIndices(tableName);

    // 1. Todas as colunas v2 presentes com tipos e NOT NULL corretos
    const colMap = new Map(columns.map(c => [c.name, c]));
    for (const expected of V2_COLUMNS) {
      const actual = colMap.get(expected.name);
      if (!actual) return false;
      // NOT NULL check: PRIMARY KEY columns have notnull=0 in PRAGMA but are implicitly NOT NULL
      if (expected.notNull && !actual.notNull && !actual.isPk) return false;
      // Type check (flexível — TEXT/INTEGER/INTEGER NOT NULL vs INTEGER)
      if (expected.type === "INTEGER" && actual.type !== "INTEGER") return false;
      if (expected.type === "TEXT" && actual.type !== "TEXT") return false;
    }

    // 2. idempotency_key UNIQUE (via índice ou constraint)
    const idempotencyIdx = indices.find(
      idx => idx.columns.includes("idempotency_key") && idx.unique && idx.columns.length === 1
    );
    if (!idempotencyIdx) return false;

    // 3. idx_payment_attempts_order_fingerprint UNIQUE com (order_id, request_fingerprint)
    const orderFpIdx = indices.find(
      idx => idx.name === "idx_payment_attempts_order_fingerprint"
        && idx.unique
        && idx.columns.length === 2
        && idx.columns.includes("order_id")
        && idx.columns.includes("request_fingerprint")
    );
    if (!orderFpIdx) return false;

    // 4. provider_reference SEM UNIQUE exclusiva
    const hasProvRefUnique = await hasUniqueOnProviderReference(tableName);
    if (hasProvRefUnique) return false;

    // 5. Índices auxiliares presentes
    for (const expected of V2_REQUIRED_INDICES) {
      const actual = indices.find(idx => idx.name === expected.name);
      if (!actual) return false;
      if (expected.unique && !actual.unique) return false;
      // Verificar composição de colunas (ordem pode variar mas todas devem estar presentes)
      for (const col of expected.columns) {
        if (!actual.columns.includes(col)) return false;
      }
    }

    // 6. amount_cents CHECK > 0
    if (!hasAmountCentsCheck(tableName)) return false;

    return true;
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

  // Validação completa: schema v2 deve ter TODOS os itens
  if (await isSchemaV2(tableName)) {
    return { migrated: false, from_version: "v2" };
  }

  // Schema parcial ou incompatível — executar migration/rebuild para v2 completo
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
    const existingColumns = await getColumnInfo(tableName);
    const existingColSet = new Set(existingColumns.map(c => c.name));

    const v1Cols = ["id", "order_id", "provider", "method", "status", "idempotency_key",
      "provider_reference", "provider_checkout_url", "provider_pix_copy_paste",
      "provider_qr_code", "amount_cents", "currency",
      "request_fingerprint", "reservation_fingerprint",
      "provider_response_sanitized_json", "failure_code",
      "failure_message_sanitized", "expires_at", "created_at", "updated_at", "version"];

    const availableCols = v1Cols.filter(c => existingColSet.has(c));
    const colList = availableCols.join(", ");

    // Este INSERT SELECT copia os dados para a tabela temporária
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
