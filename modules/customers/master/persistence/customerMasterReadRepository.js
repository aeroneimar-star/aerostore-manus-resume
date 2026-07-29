"use strict";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const SOURCE_TYPES = Object.freeze(["contacts", "crm_contacts"]);
const IDENTIFIER_TYPES = Object.freeze(["PHONE", "CPF", "EMAIL", "EXTERNAL_ID", "OTHER_DOCUMENT"]);
const SORT_COLUMNS = Object.freeze({
  updatedAt: "m.updated_at",
  createdAt: "m.created_at",
  displayName: "m.display_name",
  status: "m.status"
});

const MASTER_COLUMNS = `
  m.id, m.display_name, m.status, m.version, m.eligibility_status,
  m.eligibility_reasons_json, m.eligibility_evaluated_at,
  m.eligibility_rule_version, m.created_at, m.updated_at, m.deleted_at
`;

function assertReadDb(dbApi) {
  if (!dbApi || typeof dbApi.get !== "function" || typeof dbApi.all !== "function") {
    throw new Error("customer master read repository requires dbApi.get and dbApi.all");
  }
}

function assertReadOnlySql(sql) {
  const normalized = String(sql || "").replace(/^\s+/, "");
  if (!/^(SELECT|WITH)\b/i.test(normalized)) {
    throw new Error("CUSTOMER_MASTER_READ_ONLY_SQL_REQUIRED");
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH)\b/i.test(normalized)) {
    throw new Error("CUSTOMER_MASTER_WRITE_SQL_BLOCKED");
  }
  if (/\bPRAGMA\s+(?!table_info|foreign_key_list|index_list|index_info)\b/i.test(normalized)) {
    throw new Error("CUSTOMER_MASTER_WRITE_PRAGMA_BLOCKED");
  }
  return normalized;
}

function normalizePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(1, Math.trunc(numeric)));
}

function normalizeListOptions(options = {}) {
  const limit = normalizePositiveInteger(options.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const page = normalizePositiveInteger(options.page, 1);
  if (
    options.sortBy !== undefined
    && !Object.prototype.hasOwnProperty.call(SORT_COLUMNS, options.sortBy)
  ) {
    throw new Error("CUSTOMER_MASTER_INVALID_SORT");
  }
  if (
    options.sortDirection !== undefined
    && !["asc", "desc"].includes(String(options.sortDirection).toLowerCase())
  ) {
    throw new Error("CUSTOMER_MASTER_INVALID_SORT_DIRECTION");
  }
  const sortBy = Object.prototype.hasOwnProperty.call(SORT_COLUMNS, options.sortBy)
    ? options.sortBy
    : "updatedAt";
  const sortDirection = String(options.sortDirection || "desc").toLowerCase() === "asc"
    ? "ASC"
    : "DESC";
  const deleted = ["active", "only", "all"].includes(options.deleted)
    ? options.deleted
    : "active";
  return {
    limit,
    page,
    offset: (page - 1) * limit,
    sortBy,
    sortDirection,
    deleted
  };
}

function assertSourceType(sourceType) {
  if (!SOURCE_TYPES.includes(sourceType)) {
    throw new Error("CUSTOMER_MASTER_INVALID_SOURCE_TYPE");
  }
  return sourceType;
}

function assertIdentifierType(identifierType) {
  if (!IDENTIFIER_TYPES.includes(identifierType)) {
    throw new Error("CUSTOMER_MASTER_INVALID_IDENTIFIER_TYPE");
  }
  return identifierType;
}

function createCustomerMasterReadRepository(dbApi) {
  assertReadDb(dbApi);

  async function readOne(sql, params = []) {
    return dbApi.get(assertReadOnlySql(sql), params);
  }

  async function readMany(sql, params = []) {
    return dbApi.all(assertReadOnlySql(sql), params);
  }

  async function getMasterById(masterId) {
    return readOne(
      `SELECT ${MASTER_COLUMNS}
       FROM customer_master_records m
       WHERE m.id = ?
       LIMIT 1`,
      [String(masterId || "")]
    );
  }

  async function listMasters(options = {}) {
    const normalized = normalizeListOptions(options);
    const clauses = [];
    const params = [];

    if (options.status) {
      clauses.push("m.status = ?");
      params.push(String(options.status));
    }
    if (options.eligibilityStatus) {
      clauses.push("m.eligibility_status = ?");
      params.push(String(options.eligibilityStatus));
    }
    if (options.updatedAfter) {
      clauses.push("m.updated_at > ?");
      params.push(String(options.updatedAfter));
    }
    if (normalized.deleted === "active") clauses.push("m.deleted_at IS NULL");
    if (normalized.deleted === "only") clauses.push("m.deleted_at IS NOT NULL");
    if (options.sourceType) {
      const sourceType = assertSourceType(String(options.sourceType));
      clauses.push(
        `EXISTS (
          SELECT 1 FROM customer_master_sources source_filter
          WHERE source_filter.master_id = m.id AND source_filter.source_type = ?
        )`
      );
      params.push(sourceType);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const sortColumn = SORT_COLUMNS[normalized.sortBy];
    const totalRow = await readOne(
      `SELECT COUNT(*) AS total FROM customer_master_records m ${where}`,
      params
    );
    const rows = await readMany(
      `SELECT ${MASTER_COLUMNS}
       FROM customer_master_records m
       ${where}
       ORDER BY ${sortColumn} ${normalized.sortDirection}, m.id ${normalized.sortDirection}
       LIMIT ? OFFSET ?`,
      [...params, normalized.limit, normalized.offset]
    );
    const total = Number(totalRow?.total || 0);
    return {
      rows,
      pagination: {
        page: normalized.page,
        limit: normalized.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / normalized.limit)),
        hasMore: normalized.offset + rows.length < total
      }
    };
  }

  async function listSourcesByMasterId(masterId) {
    return readMany(
      `SELECT s.id, s.master_id, s.source_type, s.source_id, s.source_updated_at,
              s.imported_at, s.status, s.created_at, s.updated_at, s.revoked_at
       FROM customer_master_sources s
       WHERE s.master_id = ?
       ORDER BY s.source_type ASC, s.source_id ASC, s.id ASC`,
      [String(masterId || "")]
    );
  }

  async function listIdentifiersByMasterId(masterId) {
    return readMany(
      `SELECT i.id, i.master_id, i.source_link_id, i.identifier_type, i.masked_value,
              i.classification, i.validation_status, i.verification_status,
              i.is_primary, i.is_active, i.normalization_version,
              i.created_at, i.updated_at, i.revoked_at
       FROM customer_master_identifiers i
       WHERE i.master_id = ?
       ORDER BY i.identifier_type ASC, i.masked_value ASC, i.id ASC`,
      [String(masterId || "")]
    );
  }

  async function listConflictsByMasterId(masterId) {
    const id = String(masterId || "");
    return readMany(
      `SELECT c.id, c.conflict_type, c.severity, c.status, c.rule_version,
              c.evidence_json, c.resolution_type,
              CASE WHEN c.resolution_reason IS NULL OR c.resolution_reason = '' THEN 0 ELSE 1 END
                AS resolution_has_reason,
              c.resolved_at, c.created_at, c.updated_at, c.reopened_at
       FROM customer_identity_conflicts c
       WHERE EXISTS (
         SELECT 1
         FROM customer_identity_conflict_participants p
         WHERE p.conflict_id = c.id
           AND (
             (p.participant_type = 'MASTER' AND p.participant_id = ?)
             OR (p.participant_type = 'SOURCE' AND p.participant_id IN (
               SELECT s.id FROM customer_master_sources s WHERE s.master_id = ?
             ))
             OR (p.participant_type = 'IDENTIFIER' AND p.participant_id IN (
               SELECT i.id FROM customer_master_identifiers i WHERE i.master_id = ?
             ))
           )
       )
       ORDER BY c.created_at DESC, c.id ASC`,
      [id, id, id]
    );
  }

  async function findMastersByIdentifierHash(identifierType, lookupHash) {
    const type = assertIdentifierType(String(identifierType || ""));
    if (!String(lookupHash || "").trim()) {
      throw new Error("CUSTOMER_MASTER_LOOKUP_HASH_REQUIRED");
    }
    return readMany(
      `SELECT DISTINCT ${MASTER_COLUMNS}
       FROM customer_master_records m
       INNER JOIN customer_master_identifiers i ON i.master_id = m.id
       WHERE i.identifier_type = ? AND i.lookup_hash = ?
         AND i.is_active = 1 AND i.revoked_at IS NULL
       ORDER BY m.updated_at DESC, m.id ASC`,
      [type, String(lookupHash || "")]
    );
  }

  async function findMasterBySource(sourceType, sourceId) {
    const type = assertSourceType(String(sourceType || ""));
    if (!String(sourceId || "").trim()) {
      throw new Error("CUSTOMER_MASTER_SOURCE_ID_REQUIRED");
    }
    return readOne(
      `SELECT ${MASTER_COLUMNS},
              s.id AS linked_source_id, s.source_type AS linked_source_type,
              s.source_id AS linked_source_record_id,
              s.source_updated_at AS linked_source_updated_at,
              s.imported_at AS linked_source_imported_at,
              s.status AS linked_source_status, s.revoked_at AS linked_source_revoked_at
       FROM customer_master_sources s
       INNER JOIN customer_master_records m ON m.id = s.master_id
       WHERE s.source_type = ? AND s.source_id = ?
       LIMIT 1`,
      [type, String(sourceId || "")]
    );
  }

  return Object.freeze({
    getMasterById,
    listMasters,
    listSourcesByMasterId,
    listIdentifiersByMasterId,
    listConflictsByMasterId,
    findMastersByIdentifierHash,
    findMasterBySource
  });
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  SOURCE_TYPES,
  IDENTIFIER_TYPES,
  SORT_COLUMNS,
  assertReadOnlySql,
  normalizeListOptions,
  createCustomerMasterReadRepository
};
