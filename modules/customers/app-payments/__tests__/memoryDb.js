"use strict";
const initSqlJs = require("sql.js");
/**
 * memoryDb — Helper SQLite WASM para testes de integração do módulo payment-attempts.
 *
 * AVISO IMPORTANTE:
 * Este helper NÃO prova locking entre processos ou concorrência real.
 * Ele usa uma única conexão WASM in-memory (sql.js), portanto:
 * - Não simula duas conexões independentes;
 * - No simula bloqueio otimista entre processos;
 * - NÃO deve ser usado para afirmar "duas conexões SQLite" ou concorrência real.
 *
 * Os testes executados com este helper são de integração unitária (WASM), não E2E real.
 * A prova de concorrência real requer sqlite3 nativo com duas conexões independentes.
 *
 * Quando withV2=true, cria a tabela app_payment_events após o db estar pronto.
 */
let SQL = null;
async function getSqlJs() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

function memoryDb() {
  let connection = null;
  let ready = getSqlJs().then((sqlJs) => {
    connection = new sqlJs.Database();
    connection.run("PRAGMA foreign_keys=ON");
  });
  return {
    _ready: () => ready,
    run: async (sql, params = []) => {
      await ready;
      const stmt = connection.prepare(sql);
      try {
        if (params && params.length > 0) {
          stmt.run(params);
        } else {
          stmt.run();
        }
        return { changes: connection.getRowsModified(), lastID: connection.getRowsModified() };
      } finally {
        stmt.free();
      }
    },
    get: async (sql, params = []) => {
      await ready;
      const stmt = connection.prepare(sql);
      try {
        if (params && params.length > 0) {
          stmt.bind(params);
        }
        if (stmt.step()) {
          return stmt.getAsObject();
        }
        return undefined;
      } finally {
        stmt.free();
      }
    },
    all: async (sql, params = []) => {
      await ready;
      const stmt = connection.prepare(sql);
      const rows = [];
      try {
        if (params && params.length > 0) {
          stmt.bind(params);
        }
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        return rows;
      } finally {
        stmt.free();
      }
    },
    close: () => {
      if (connection) {
        connection.close();
        connection = null;
      }
      return Promise.resolve();
    },
  };
}

function createMemoryDb(options = {}) {
  const { withV2 = true } = options;
  let connection = null;
  const ready = getSqlJs().then((sqlJs) => {
    connection = new sqlJs.Database();
    connection.run("PRAGMA foreign_keys=ON");
    if (withV2) {
      // Create app_payment_events table for reconciliation/webhook tests
      connection.run(`
        CREATE TABLE app_payment_events (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          event_type TEXT NOT NULL,
          order_id TEXT,
          payment_attempt_id TEXT,
          provider_reference TEXT,
          provider_transaction_nsu TEXT,
          request_hash TEXT NOT NULL,
          payload_sanitized_json TEXT NOT NULL DEFAULT '{}',
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
        );
        CREATE UNIQUE INDEX idx_payment_events_hash ON app_payment_events(request_hash, provider);
      `);
    }
  });
  return {
    _ready: () => ready,
    run: async (sql, params = []) => {
      await ready;
      const stmt = connection.prepare(sql);
      try {
        if (params && params.length > 0) {
          stmt.run(params);
        } else {
          stmt.run();
        }
        return { changes: connection.getRowsModified(), lastID: connection.getRowsModified() };
      } finally {
        stmt.free();
      }
    },
    get: async (sql, params = []) => {
      await ready;
      const stmt = connection.prepare(sql);
      try {
        if (params && params.length > 0) {
          stmt.bind(params);
        }
        if (stmt.step()) {
          return stmt.getAsObject();
        }
        return undefined;
      } finally {
        stmt.free();
      }
    },
    all: async (sql, params = []) => {
      await ready;
      const stmt = connection.prepare(sql);
      const rows = [];
      try {
        if (params && params.length > 0) {
          stmt.bind(params);
        }
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        return rows;
      } finally {
        stmt.free();
      }
    },
    close: () => {
      if (connection) {
        connection.close();
        connection = null;
      }
      return Promise.resolve();
    },
  };
}

module.exports = { createMemoryDb, memoryDb };
