"use strict";

const {
  CUSTOMER_IDENTITY_CASE_TABLES
} = require("./customerIdentityCaseSchema");

const CASE_TABLE_SET = new Set(CUSTOMER_IDENTITY_CASE_TABLES);
const READ_PRAGMAS = new Set(["foreign_keys", "quick_check", "schema_version", "user_version"]);

function normalizeSql(sql) {
  return String(sql || "").replace(/^\s+/, "");
}

function assertIdentityCaseSql(sql) {
  const normalized = normalizeSql(sql);
  if (!normalized) throw new Error("CUSTOMER_IDENTITY_CASE_SQL_EMPTY");
  if (/^(DELETE|DROP|ALTER|REPLACE|VACUUM|ATTACH|DETACH|REINDEX|TRUNCATE|UPDATE)\b/i.test(normalized)) {
    throw new Error("CUSTOMER_IDENTITY_CASE_SQL_BLOCKED");
  }
  if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(normalized)) return normalized;
  if (/^(SELECT|WITH)\b/i.test(normalized)) return normalized;

  const pragma = normalized.match(/^PRAGMA\s+([a-z_]+)(?:\s*=\s*([a-z0-9_]+))?\s*;?$/i);
  if (pragma) {
    const name = pragma[1].toLowerCase();
    const value = pragma[2]?.toLowerCase();
    if (READ_PRAGMAS.has(name) && value === undefined) return normalized;
    if (name === "foreign_keys" && value === "on") return normalized;
    if (name === "busy_timeout" && value && /^\d+$/.test(value)) return normalized;
    throw new Error("CUSTOMER_IDENTITY_CASE_SQL_BLOCKED");
  }

  const insert = normalized.match(/^INSERT\s+OR\s+IGNORE\s+INTO\s+([a-z_]+)/i);
  if (insert) {
    if (!CASE_TABLE_SET.has(insert[1].toLowerCase())) {
      throw new Error("CUSTOMER_IDENTITY_CASE_TABLE_BLOCKED");
    }
    return normalized;
  }
  const createTable = normalized.match(/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z_]+)/i);
  if (createTable) {
    if (!CASE_TABLE_SET.has(createTable[1].toLowerCase())) {
      throw new Error("CUSTOMER_IDENTITY_CASE_TABLE_BLOCKED");
    }
    return normalized;
  }
  const createIndex = normalized.match(
    /^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+([a-z_]+)\s+ON\s+([a-z_]+)/i
  );
  if (createIndex) {
    if (!CASE_TABLE_SET.has(createIndex[2].toLowerCase())) {
      throw new Error("CUSTOMER_IDENTITY_CASE_TABLE_BLOCKED");
    }
    return normalized;
  }
  throw new Error("CUSTOMER_IDENTITY_CASE_SQL_BLOCKED");
}

function createCustomerIdentityCaseWriteRepository(dbApi) {
  if (
    !dbApi
    || typeof dbApi.run !== "function"
    || typeof dbApi.get !== "function"
    || typeof dbApi.all !== "function"
  ) {
    throw new Error("CUSTOMER_IDENTITY_CASE_WRITE_DB_REQUIRED");
  }
  const run = (sql, params = []) => dbApi.run(assertIdentityCaseSql(sql), params);
  const get = (sql, params = []) => dbApi.get(assertIdentityCaseSql(sql), params);
  const all = (sql, params = []) => dbApi.all(assertIdentityCaseSql(sql), params);
  const insertOrIgnore = async (sql, params = []) => {
    const result = await run(sql, params);
    return Number(result?.changes || 0) > 0;
  };
  return Object.freeze({ run, get, all, insertOrIgnore });
}

module.exports = {
  assertIdentityCaseSql,
  createCustomerIdentityCaseWriteRepository
};
