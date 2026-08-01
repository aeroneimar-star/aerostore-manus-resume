"use strict";

const {
  assertReadOnlySql
} = require("../persistence/customerMasterReadRepository");

const DEFAULT_PAGE_SIZE = 250;
const MAX_PAGE_SIZE = 500;

const CONTACT_COLUMNS = `
  id, name, phone, mobile, mobile_normalized, phone_fixed, document, email,
  birth_date, address, neighborhood, zipcode, city, state, status, source,
  deleted_at, created_at, updated_at
`;

const CRM_CONTACT_COLUMNS = `
  id, external_id, external_code, name, fantasy_name, document, person_type,
  phone, mobile, email, address, number, complement, neighborhood, zipcode,
  city, state, status, birth_date, source_file, source_row, import_hash,
  created_at, updated_at
`;

function normalizePageOptions(options = {}) {
  const requested = Number(options.limit);
  const limit = Number.isFinite(requested)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(requested)))
    : DEFAULT_PAGE_SIZE;
  const offsetValue = Number(options.offset);
  const offset = Number.isFinite(offsetValue) ? Math.max(0, Math.trunc(offsetValue)) : 0;
  return { limit, offset };
}

function normalizeCursorOptions(options = {}) {
  const { limit } = normalizePageOptions(options);
  return {
    limit,
    updatedAt: options.updatedAt == null ? null : String(options.updatedAt),
    sourceId: options.sourceId == null ? null : String(options.sourceId),
    upperUpdatedAt: options.upperUpdatedAt == null ? null : String(options.upperUpdatedAt),
    upperSourceId: options.upperSourceId == null ? null : String(options.upperSourceId)
  };
}

function createCustomerMasterSourceReader(dbApi) {
  if (!dbApi || typeof dbApi.get !== "function" || typeof dbApi.all !== "function") {
    throw new Error("CUSTOMER_MASTER_SOURCE_READER_DB_REQUIRED");
  }

  const get = (sql, params = []) => dbApi.get(assertReadOnlySql(sql), params);
  const all = (sql, params = []) => dbApi.all(assertReadOnlySql(sql), params);

  async function tableExists(tableName) {
    const row = await get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [tableName]
    );
    return Boolean(row?.name);
  }

  async function countContacts() {
    const row = await get("SELECT COUNT(*) AS total FROM contacts");
    return Number(row?.total || 0);
  }

  async function countCrmContacts() {
    const row = await get("SELECT COUNT(*) AS total FROM crm_contacts");
    return Number(row?.total || 0);
  }

  async function readContactsPage(options = {}) {
    const { limit, offset } = normalizePageOptions(options);
    return all(
      `SELECT ${CONTACT_COLUMNS}
       FROM contacts
       ORDER BY
         CASE WHEN datetime(updated_at) IS NULL THEN 1 ELSE 0 END ASC,
         datetime(updated_at) ASC,
         CAST(id AS TEXT) ASC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
  }

  async function readCrmContactsPage(options = {}) {
    const { limit, offset } = normalizePageOptions(options);
    return all(
      `SELECT ${CRM_CONTACT_COLUMNS}
       FROM crm_contacts
       ORDER BY
         CASE WHEN datetime(updated_at) IS NULL THEN 1 ELSE 0 END ASC,
         datetime(updated_at) ASC,
         CAST(id AS TEXT) ASC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
  }

  async function readIncrementalPage(sourceType, options = {}) {
    if (!["contacts", "crm_contacts"].includes(sourceType)) {
      throw new Error("CUSTOMER_MASTER_INCREMENTAL_SOURCE_TYPE_INVALID");
    }
    const { limit, updatedAt, sourceId, upperUpdatedAt, upperSourceId } = normalizeCursorOptions(options);
    const columns = sourceType === "contacts" ? CONTACT_COLUMNS : CRM_CONTACT_COLUMNS;
    const predicates = [];
    const params = [];
    if (updatedAt !== null) {
      predicates.push("(updated_at > ? OR (updated_at = ? AND id > ?))");
      params.push(updatedAt, updatedAt, sourceId || "");
    }
    if (upperUpdatedAt !== null) {
      predicates.push("(updated_at < ? OR (updated_at = ? AND id <= ?))");
      params.push(upperUpdatedAt, upperUpdatedAt, upperSourceId || "");
    }
    const cursorSql = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
    params.push(limit);
    return all(
      `SELECT ${columns}
       FROM ${sourceType}
       ${cursorSql}
       ORDER BY updated_at ASC, id ASC
       LIMIT ?`,
      params
    );
  }

  async function readLatestCursor(sourceType) {
    if (!["contacts", "crm_contacts"].includes(sourceType)) {
      throw new Error("CUSTOMER_MASTER_INCREMENTAL_SOURCE_TYPE_INVALID");
    }
    return get(
      `SELECT updated_at, id FROM ${sourceType}
       WHERE updated_at IS NOT NULL AND TRIM(CAST(updated_at AS TEXT)) != ''
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`
    );
  }

  async function countInvalidIncrementalCursors(sourceType) {
    if (!["contacts", "crm_contacts"].includes(sourceType)) {
      throw new Error("CUSTOMER_MASTER_INCREMENTAL_SOURCE_TYPE_INVALID");
    }
    const row = await get(
      `SELECT COUNT(*) AS total FROM ${sourceType}
       WHERE updated_at IS NULL OR TRIM(CAST(updated_at AS TEXT)) = ''`
    );
    return Number(row?.total || 0);
  }

  async function readSourceById(sourceType, sourceId) {
    if (!["contacts", "crm_contacts"].includes(sourceType)) {
      throw new Error("CUSTOMER_MASTER_INCREMENTAL_SOURCE_TYPE_INVALID");
    }
    const columns = sourceType === "contacts" ? CONTACT_COLUMNS : CRM_CONTACT_COLUMNS;
    return get(`SELECT ${columns} FROM ${sourceType} WHERE id = ?`, [String(sourceId)]);
  }

  async function getSourceSchemaSummary() {
    const [contacts, crmContacts] = await Promise.all([
      tableExists("contacts"),
      tableExists("crm_contacts")
    ]);
    return {
      contacts: { exists: contacts, softDeleteField: "deleted_at" },
      crm_contacts: { exists: crmContacts, softDeleteField: null }
    };
  }

  return Object.freeze({
    countContacts,
    countCrmContacts,
    readContactsPage,
    readCrmContactsPage,
    readIncrementalPage,
    readLatestCursor,
    countInvalidIncrementalCursors,
    readSourceById,
    getSourceSchemaSummary
  });
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizePageOptions,
  normalizeCursorOptions,
  createCustomerMasterSourceReader
};
