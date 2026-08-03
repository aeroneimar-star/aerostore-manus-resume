"use strict";
const initSqlJs = require("sql.js");
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
    run: async (sql, params = []) => {
      await ready;
      const stmt = connection.prepare(sql);
      try {
        stmt.run(params);
        return { changes: connection.getRowsModified(), lastID: connection.getRowsModified() };
      } finally {
        stmt.free();
      }
    },
    get: async (sql, params = []) => {
      await ready;
      const stmt = connection.prepare(sql);
      try {
        if (params.length > 0) stmt.bind(params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          return row;
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
    }
  };
}
module.exports = { memoryDb };
