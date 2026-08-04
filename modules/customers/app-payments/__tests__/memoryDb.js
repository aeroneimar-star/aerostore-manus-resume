"use strict";
const initSqlJs = require("sql.js");

/**
 * memoryDb — Helper SQLite WASM para testes de integração do módulo payment-attempts.
 *
 * AVISO IMPORTANTE:
 * Este helper NÃO prova locking entre processos ou concorrência real.
 * Ele usa uma única conexão WASM in-memory (sql.js), portanto:
 * - Não simula duas conexões independentes;
 * - Não testa bloqueio otimista entre processos;
 * - NÃO deve ser usado para afirmar "duas conexões SQLite" ou concorrência real.
 *
 * Os testes executados com este helper são de integração unitária (WASM), não E2E real.
 * A prova de concorrência real requer sqlite3 nativo com duas conexões independentes.
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

module.exports = { memoryDb };
