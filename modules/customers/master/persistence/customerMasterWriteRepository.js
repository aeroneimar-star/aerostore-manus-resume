"use strict";

const {
  CUSTOMER_MASTER_TABLES
} = require("./customerMasterSchema");

const MASTER_TABLE_SET = new Set(CUSTOMER_MASTER_TABLES);

function normalizeSql(sql) {
  return String(sql || "").replace(/^\s+/, "");
}

function assertControlledWriteSql(sql) {
  const normalized = normalizeSql(sql);
  if (!normalized) {
    throw new Error("CUSTOMER_MASTER_WRITE_SQL_EMPTY");
  }
  if (/^(DELETE|DROP|ALTER|REPLACE|VACUUM|ATTACH|DETACH|REINDEX|TRUNCATE)\b/i.test(normalized)) {
    throw new Error("CUSTOMER_MASTER_WRITE_SQL_BLOCKED");
  }
  if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(normalized)) {
    return normalized;
  }
  if (/^(SELECT|WITH)\b/i.test(normalized)) {
    return normalized;
  }
  const pragma = normalized.match(/^PRAGMA\s+([a-z_]+)(?:\s*=\s*([a-z0-9_]+))?\s*;?$/i);
  if (pragma) {
    const name = pragma[1].toLowerCase();
    const value = pragma[2]?.toLowerCase();
    if (["quick_check", "schema_version", "user_version"].includes(name) && value === undefined) {
      return normalized;
    }
    if (name === "foreign_keys" && (value === undefined || value === "on")) {
      return normalized;
    }
    if (name === "busy_timeout" && (value === undefined || /^\d+$/.test(value))) {
      return normalized;
    }
    throw new Error("CUSTOMER_MASTER_WRITE_SQL_BLOCKED");
  }
  const insert = normalized.match(/^INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+([a-z_]+)/i);
  if (insert) {
    if (!MASTER_TABLE_SET.has(insert[1].toLowerCase())) {
      throw new Error("CUSTOMER_MASTER_WRITE_TABLE_BLOCKED");
    }
    return normalized;
  }
  const update = normalized.match(/^UPDATE\s+([a-z_]+)/i);
  if (update) {
    if (!MASTER_TABLE_SET.has(update[1].toLowerCase())) {
      throw new Error("CUSTOMER_MASTER_WRITE_TABLE_BLOCKED");
    }
    return normalized;
  }
  const createTable = normalized.match(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z_]+)/i);
  if (createTable) {
    if (!MASTER_TABLE_SET.has(createTable[1].toLowerCase())) {
      throw new Error("CUSTOMER_MASTER_WRITE_TABLE_BLOCKED");
    }
    return normalized;
  }
  const createIndex = normalized.match(/^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+([a-z_]+)\s+ON\s+([a-z_]+)/i);
  if (createIndex) {
    if (!MASTER_TABLE_SET.has(createIndex[2].toLowerCase())) {
      throw new Error("CUSTOMER_MASTER_WRITE_TABLE_BLOCKED");
    }
    return normalized;
  }
  throw new Error("CUSTOMER_MASTER_WRITE_SQL_BLOCKED");
}

function createCustomerMasterWriteRepository(dbApi) {
  if (
    !dbApi
    || typeof dbApi.run !== "function"
    || typeof dbApi.get !== "function"
    || typeof dbApi.all !== "function"
  ) {
    throw new Error("CUSTOMER_MASTER_WRITE_REPOSITORY_DB_REQUIRED");
  }

  const run = (sql, params = []) => dbApi.run(assertControlledWriteSql(sql), params);
  const get = (sql, params = []) => dbApi.get(assertControlledWriteSql(sql), params);
  const all = (sql, params = []) => dbApi.all(assertControlledWriteSql(sql), params);

  async function insertOrIgnore(sql, params = []) {
    const result = await run(sql, params);
    return Number(result?.changes || 0) > 0;
  }

  return Object.freeze({
    run,
    get,
    all,
    insertOrIgnore
  });
}

module.exports = {
  assertControlledWriteSql,
  createCustomerMasterWriteRepository
};
