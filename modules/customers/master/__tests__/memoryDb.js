"use strict";
const sqlite3 = require("sqlite3");
function memoryDb() {
  const connection = new sqlite3.Database(":memory:");
  return {
    run: (sql, params = []) => new Promise((resolve, reject) => {
      connection.run(sql, params, function(error) { error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID }); });
    }),
    get: (sql, params = []) => new Promise((resolve, reject) => {
      connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
      connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    }),
    close: () => new Promise((resolve, reject) => {
      connection.close((error) => error ? reject(error) : resolve());
    })
  };
}
module.exports = { memoryDb };
