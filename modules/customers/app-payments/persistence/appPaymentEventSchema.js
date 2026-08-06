"use strict";

/**
 * app_payment_events — Schema e migration para eventos de pagamento.
 *
 * Tabela: app_payment_events
 *
 * Campos:
 *   id                         TEXT PRIMARY KEY
 *   provider                   TEXT NOT NULL
 *   event_type                 TEXT NOT NULL
 *   order_id                   TEXT
 *   payment_attempt_id         TEXT
 *   provider_reference         TEXT
 *   provider_transaction_nsu   TEXT
 *   request_hash               TEXT NOT NULL
 *   payload_sanitized_json     TEXT
 *   processing_status          TEXT NOT NULL DEFAULT 'RECEIVED'
 *   failure_code               TEXT
 *   failure_message_sanitized  TEXT
 *   received_at                TEXT NOT NULL
 *   processed_at               TEXT
 *   retry_count                INTEGER NOT NULL DEFAULT 0
 *   lock_token                 TEXT
 *   locked_at                  TEXT
 *   lock_expires_at            TEXT
 *   created_at                 TEXT NOT NULL
 *   updated_at                 TEXT NOT NULL
 *   version                    INTEGER NOT NULL DEFAULT 1
 *
 * Idempotência determinística:
 *   request_hash = SHA-256(provider + "|" + event_type + "|" + provider_reference + "|" + order_id)
 *   UNIQUE INDEX em (request_hash, provider)
 *
 * Worker columns (claim/lock/retry):
 *   retry_count: incrementado no claim, limita retentativas
 *   lock_token: UUID único, NULL quando livre
 *   locked_at: timestamp do lock
 *   lock_expires_at: timestamp de expiração do lock (2min)
 *
 * Um mesmo evento repetido (mesmo request_hash) nunca:
 *   - cria nova tentativa;
 *   - marca pedido novamente;
 *   - baixa estoque novamente;
 *   - cria segunda movimentação de venda.
 */

const { createHash } = require("crypto");

const COLUMNS = [
  { name: "id", type: "TEXT", primaryKey: true, notNull: true },
  { name: "provider", type: "TEXT", notNull: true },
  { name: "event_type", type: "TEXT", notNull: true },
  { name: "order_id", type: "TEXT" },
  { name: "payment_attempt_id", type: "TEXT" },
  { name: "provider_reference", type: "TEXT" },
  { name: "provider_transaction_nsu", type: "TEXT" },
  { name: "request_hash", type: "TEXT", notNull: true },
  { name: "payload_sanitized_json", type: "TEXT" },
  { name: "processing_status", type: "TEXT", notNull: true },
  { name: "failure_code", type: "TEXT" },
  { name: "failure_message_sanitized", type: "TEXT" },
  { name: "received_at", type: "TEXT", notNull: true },
  { name: "processed_at", type: "TEXT" },
  { name: "retry_count", type: "INTEGER", notNull: true },
  { name: "lock_token", type: "TEXT" },
  { name: "locked_at", type: "TEXT" },
  { name: "lock_expires_at", type: "TEXT" },
  { name: "created_at", type: "TEXT", notNull: true },
  { name: "updated_at", type: "TEXT", notNull: true },
  { name: "version", type: "INTEGER", notNull: true },
];

const INDEXES = [
  {
    name: "idx_app_payment_events_request_hash",
    columns: ["request_hash", "provider"],
    unique: true,
  },
  {
    name: "idx_app_payment_events_order",
    columns: ["order_id"],
    unique: false,
  },
  {
    name: "idx_app_payment_events_attempt",
    columns: ["payment_attempt_id"],
    unique: false,
  },
  {
    name: "idx_app_payment_events_provider_ref",
    columns: ["provider_reference"],
    unique: false,
  },
  {
    name: "idx_app_payment_events_status",
    columns: ["processing_status", "received_at"],
    unique: false,
  },
  {
    name: "idx_app_payment_events_lock",
    columns: ["processing_status", "lock_expires_at"],
    unique: false,
  },
];

/**
 * computeRequestHash — Hash canônico determinístico para idempotência.
 *
 * Inclui: provider, event_type, provider_reference, order_id.
 * NUNCA retorna null.
 */
function computeRequestHash(provider, eventType, providerReference, orderId) {
  const input = `${provider || ""}|${eventType || ""}|${providerReference || ""}|${orderId || ""}`;
  const hash = createHash("sha256").update(input).digest("hex");
  return hash;
}

function createPaymentEventSchema(options = {}) {
  const db = options.db;
  if (!db) {
    throw new Error("DB_REQUIRED for app_payment_events schema");
  }

  function isSchemaReady() {
    const tableInfo = db.prepare ? db.prepare("PRAGMA table_info(app_payment_events)").all() : null;
    if (!tableInfo) {
      return false;
    }
    const existingColumns = new Set(tableInfo.map(c => c.name));
    return COLUMNS.every(col => existingColumns.has(col.name));
  }

  /**
   * ensureSchema — Cria tabela e índices SEM engolir erros.
   * request_hash é NOT NULL.
   * Inclui worker columns: retry_count, lock_token, locked_at, lock_expires_at.
   */
  async function ensureSchema() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS app_payment_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        event_type TEXT NOT NULL,
        order_id TEXT,
        payment_attempt_id TEXT,
        provider_reference TEXT,
        provider_transaction_nsu TEXT,
        request_hash TEXT NOT NULL,
        payload_sanitized_json TEXT,
        processing_status TEXT NOT NULL DEFAULT 'RECEIVED',
        failure_code TEXT,
        failure_message_sanitized TEXT,
        received_at TEXT NOT NULL,
        processed_at TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        lock_token TEXT,
        locked_at TEXT,
        lock_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      )
    `;

    await db.run(createTableSQL);

    const createIndexes = [
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_app_payment_events_request_hash ON app_payment_events(request_hash, provider)`,
      `CREATE INDEX IF NOT EXISTS idx_app_payment_events_order ON app_payment_events(order_id)`,
      `CREATE INDEX IF NOT EXISTS idx_app_payment_events_attempt ON app_payment_events(payment_attempt_id)`,
      `CREATE INDEX IF NOT EXISTS idx_app_payment_events_provider_ref ON app_payment_events(provider_reference)`,
      `CREATE INDEX IF NOT EXISTS idx_app_payment_events_status ON app_payment_events(processing_status, received_at)`,
      `CREATE INDEX IF NOT EXISTS idx_app_payment_events_lock ON app_payment_events(processing_status, lock_expires_at)`,
    ];

    for (const sql of createIndexes) {
      await db.run(sql);
    }

    // Migration: adicionar worker columns se tabela já existia
    await addWorkerColumnsIfNeeded();
  }

  /**
   * addWorkerColumnsIfNeeded — Adiciona retry_count, lock_token, locked_at, lock_expires_at
   * à tabela existente se forem faltar (migration forward).
   */
  async function addWorkerColumnsIfNeeded() {
    const tableInfo = await db.all("PRAGMA table_info(app_payment_events)");
    const existingColumns = new Set(tableInfo.map(c => c.name));
    const workerColumns = ["retry_count", "lock_token", "locked_at", "lock_expires_at"];

    for (const col of workerColumns) {
      if (!existingColumns.has(col)) {
        try {
          let alterSQL = `ALTER TABLE app_payment_events ADD COLUMN ${col} `;
          if (col === "retry_count") {
            alterSQL += "INTEGER NOT NULL DEFAULT 0";
          } else {
            alterSQL += "TEXT";
          }
          await db.run(alterSQL);
        } catch {
          // Coluna pode já existir (race condition) — ignorar
        }
      }
    }
  }

  return {
    COLUMNS,
    INDEXES,
    computeRequestHash,
    isSchemaReady,
    ensureSchema,
    addWorkerColumnsIfNeeded,
  };
}

module.exports = { createPaymentEventSchema, computeRequestHash };
