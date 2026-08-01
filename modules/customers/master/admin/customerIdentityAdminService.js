"use strict";

const crypto = require("node:crypto");
const sqlite3 = require("sqlite3");

const IDENTITY_QUEUE = "IDENTITY_ELIGIBILITY";
const PRIORITIES = Object.freeze(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
const STATUSES = Object.freeze(["OPEN", "UNDER_REVIEW", "RESOLVED", "ARCHIVED", "REOPENED"]);
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
const MAX_ADMIN_TEXT = 500;

const CASE_RESOLUTIONS = Object.freeze({
  CONFIRM_SAME_PERSON: Object.freeze({
    resolutionType: "CONFIRMED_SAME_PERSON",
    operationalFlag: "RESOLVED_SAME_PERSON",
    eventType: "CASE_RESOLVED_SAME_PERSON"
  }),
  KEEP_SEPARATE: Object.freeze({
    resolutionType: "KEPT_SEPARATE",
    operationalFlag: "RESOLVED_KEPT_SEPARATE",
    eventType: "CASE_RESOLVED_KEPT_SEPARATE"
  }),
  PHONE_SHARED: Object.freeze({
    resolutionType: "PHONE_SHARED_ACKNOWLEDGED",
    operationalFlag: "RESOLVED_PHONE_SHARED",
    eventType: "CASE_RESOLVED_PHONE_SHARED"
  }),
  PHONE_RECYCLED: Object.freeze({
    resolutionType: "PHONE_RECYCLED_ACKNOWLEDGED",
    operationalFlag: "RESOLVED_PHONE_RECYCLED",
    eventType: "CASE_RESOLVED_PHONE_RECYCLED"
  }),
  CPF_VALIDATED: Object.freeze({
    resolutionType: "CPF_VALIDATED",
    operationalFlag: "RESOLVED_CPF_VALIDATED",
    eventType: "CASE_RESOLVED_CPF_VALIDATED"
  }),
  CPF_REJECTED: Object.freeze({
    resolutionType: "CPF_REJECTED",
    operationalFlag: "RESOLVED_CPF_REJECTED",
    eventType: "CASE_RESOLVED_CPF_REJECTED"
  })
});

const ADMINISTRATIVE_RESOLUTION_TYPES = Object.freeze(
  Object.values(CASE_RESOLUTIONS).map((resolution) => resolution.resolutionType)
);

class CustomerIdentityAdminError extends Error {
  constructor(code, status = 400, message = code) {
    super(message);
    this.name = "CustomerIdentityAdminError";
    this.code = code;
    this.status = status;
  }
}

function assertDb(dbApi) {
  if (
    !dbApi
    || typeof dbApi.run !== "function"
    || typeof dbApi.get !== "function"
    || typeof dbApi.all !== "function"
  ) {
    throw new Error("CUSTOMER_IDENTITY_ADMIN_DB_REQUIRED");
  }
}

function createDedicatedSqliteDbApi(databasePath) {
  const connection = new sqlite3.Database(databasePath);
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    connection.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      return resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
  const get = (sql, params = []) => new Promise((resolve, reject) => {
    connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
  const close = () => new Promise((resolve, reject) => {
    connection.close((error) => error ? reject(error) : resolve());
  });
  return { run, get, all, close };
}

function parseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function toBooleanFilter(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "sim"].includes(normalized)) return 1;
  if (["0", "false", "no", "nao", "não"].includes(normalized)) return 0;
  throw new CustomerIdentityAdminError("INVALID_BOOLEAN_FILTER");
}

function toNonNegativeInteger(value, name, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new CustomerIdentityAdminError(`INVALID_${name}`);
  }
  return number;
}

function normalizeDate(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new CustomerIdentityAdminError(`INVALID_${name}`);
  }
  return normalized;
}

function normalizeEnum(value, allowed, name) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "";
  if (!allowed.includes(normalized)) {
    throw new CustomerIdentityAdminError(`INVALID_${name}`);
  }
  return normalized;
}

function normalizeCaseSearch(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (!/^[a-z0-9:_-]{3,90}$/i.test(normalized)) {
    throw new CustomerIdentityAdminError("INVALID_CASE_SEARCH");
  }
  return normalized;
}

function maskCpf(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return `***.***.***-${digits.slice(-2).padStart(2, "*")}`;
}

function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const local = digits.length > 11 ? digits.slice(-11) : digits;
  const ddd = local.length >= 10 ? local.slice(0, 2) : "**";
  const suffix = local.slice(-4).padStart(4, "*");
  return `(${ddd}) *****-${suffix}`;
}

function maskEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const [local = "", domain = ""] = normalized.split("@");
  if (!local || !domain) return "";
  const domainParts = domain.split(".");
  const domainName = domainParts.shift() || "";
  const suffix = domainParts.length ? `.${domainParts.join(".")}` : "";
  return `${local.slice(0, 1) || "*"}***@${domainName.slice(0, 1) || "*"}***${suffix}`;
}

function maskName(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((part) => `${part.slice(0, 1).toUpperCase()}.`)
    .join(" ");
}

function maskIdentifier(type, value) {
  const normalizedType = String(type || "").trim().toUpperCase();
  if (normalizedType.includes("CPF") || normalizedType.includes("DOCUMENT")) return maskCpf(value);
  if (normalizedType.includes("PHONE") || normalizedType.includes("TELEF")) return maskPhone(value);
  if (normalizedType.includes("EMAIL")) return maskEmail(value);
  if (normalizedType.includes("NAME") || normalizedType.includes("NOME")) return maskName(value);
  return value ? "[DADO PROTEGIDO]" : "";
}

function sanitizeAdministrativeText(value) {
  let text = String(value || "").trim().slice(0, MAX_ADMIN_TEXT);
  text = text.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    (match) => maskEmail(match)
  );
  text = text.replace(
    /(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)?\d{4,5}[\s.-]*\d{4}/g,
    (match) => maskPhone(match)
  );
  text = text.replace(
    /\b\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-.\s]?\d{2}\b/g,
    (match) => maskCpf(match)
  );
  return text;
}

function sanitizeReason(value, required = true) {
  const reason = sanitizeAdministrativeText(value);
  if (required && !reason) {
    throw new CustomerIdentityAdminError("REASON_REQUIRED");
  }
  return reason;
}

function technicalReference(kind, entityId) {
  const digest = crypto
    .createHash("sha256")
    .update(`${String(kind || "")}|${String(entityId || "")}`)
    .digest("hex")
    .slice(0, 12);
  return `${String(kind || "ENTITY").toUpperCase()}-${digest}`;
}

function sanitizeCaseSummary(summaryJson) {
  const summary = parseJson(summaryJson, {});
  return {
    version: String(summary.summaryVersion || ""),
    queueType: String(summary.queueType || ""),
    caseType: String(summary.caseType || ""),
    priority: String(summary.priority || ""),
    blocking: Boolean(summary.blocking),
    conflictCount: Number(summary.conflictCount || 0),
    masterCount: Number(summary.masterCount || 0),
    sourceCount: Number(summary.sourceCount || 0),
    conflictTypes: summary.conflictTypes && typeof summary.conflictTypes === "object"
      ? summary.conflictTypes
      : {},
    severities: summary.severities && typeof summary.severities === "object"
      ? summary.severities
      : {},
    composite: Boolean(summary.composite)
  };
}

function sanitizeEventState(jsonValue) {
  const value = parseJson(jsonValue, {});
  const allowed = [
    "status",
    "reviewVersion",
    "operationalFlag",
    "queueType",
    "priority",
    "blocking",
    "conflictCount",
    "reviewerUserId",
    "resolvedConflicts",
    "reopenedConflicts",
    "note"
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => value[key] !== undefined)
      .map((key) => [
        key,
        typeof value[key] === "string" ? sanitizeAdministrativeText(value[key]) : value[key]
      ])
  );
}

function normalizeCaseRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ""),
    caseType: String(row.case_type || ""),
    queueType: String(row.queue_type || ""),
    status: String(row.status || ""),
    priority: String(row.priority || ""),
    blocking: Number(row.blocking || 0) === 1,
    conflictCount: Number(row.conflict_count || 0),
    masterCount: Number(row.master_count || 0),
    sourceCount: Number(row.source_count || 0),
    composite: Number(row.conflict_count || 0) > 1,
    reviewerUserId: row.reviewer_user_id === null ? null : String(row.reviewer_user_id || ""),
    reviewStartedAt: row.review_started_at || null,
    reviewUpdatedAt: row.review_updated_at || null,
    reviewVersion: Number(row.review_version || 0),
    operationalFlag: String(row.operational_flag || ""),
    lastEventAt: row.last_event_at || null,
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || "")
  };
}

function buildListFilters(query = {}) {
  const queue = normalizeEnum(query.queue || IDENTITY_QUEUE, [IDENTITY_QUEUE], "QUEUE");
  const status = normalizeEnum(query.status, STATUSES, "STATUS");
  const priority = normalizeEnum(query.priority, PRIORITIES, "PRIORITY");
  const blocking = toBooleanFilter(query.blocking);
  const composite = toBooleanFilter(query.composite);
  const minConflicts = toNonNegativeInteger(query.minConflicts, "MIN_CONFLICTS", 0);
  const minMasters = toNonNegativeInteger(query.minMasters, "MIN_MASTERS", 0);
  const createdFrom = normalizeDate(query.createdFrom, "CREATED_FROM");
  const createdTo = normalizeDate(query.createdTo, "CREATED_TO");
  const reviewer = String(query.reviewer || "").trim();
  if (reviewer && !/^[a-z0-9:_-]{1,80}$/i.test(reviewer)) {
    throw new CustomerIdentityAdminError("INVALID_REVIEWER");
  }
  const caseType = String(query.caseType || "").trim().toUpperCase();
  if (caseType && !/^[A-Z0-9_]{2,80}$/.test(caseType)) {
    throw new CustomerIdentityAdminError("INVALID_CASE_TYPE");
  }
  const search = normalizeCaseSearch(query.search);
  const page = Math.max(1, toNonNegativeInteger(query.page, "PAGE", 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, toNonNegativeInteger(query.pageSize, "PAGE_SIZE", DEFAULT_PAGE_SIZE))
  );
  return {
    queue,
    status,
    priority,
    blocking,
    composite,
    minConflicts,
    minMasters,
    createdFrom,
    createdTo,
    reviewer,
    caseType,
    search,
    page,
    pageSize
  };
}

function buildWhere(filters) {
  const where = ["queue_type = ?"];
  const params = [filters.queue];
  const add = (condition, value) => {
    where.push(condition);
    params.push(value);
  };
  if (filters.status) add("status = ?", filters.status);
  if (filters.priority) add("priority = ?", filters.priority);
  if (filters.blocking !== null) add("blocking = ?", filters.blocking);
  if (filters.composite !== null) {
    where.push(filters.composite ? "conflict_count > 1" : "conflict_count = 1");
  }
  if (filters.minConflicts > 0) add("conflict_count >= ?", filters.minConflicts);
  if (filters.minMasters > 0) add("master_count >= ?", filters.minMasters);
  if (filters.createdFrom) add("date(created_at) >= date(?)", filters.createdFrom);
  if (filters.createdTo) add("date(created_at) <= date(?)", filters.createdTo);
  if (filters.reviewer) add("reviewer_user_id = ?", filters.reviewer);
  if (filters.caseType) add("case_type = ?", filters.caseType);
  if (filters.search) add("id LIKE ?", `%${filters.search}%`);
  return { sql: where.join(" AND "), params };
}

async function listCases(db, query = {}) {
  assertDb(db);
  const filters = buildListFilters(query);
  const where = buildWhere(filters);
  const total = Number((await db.get(
    `SELECT COUNT(*) AS total FROM customer_identity_cases WHERE ${where.sql}`,
    where.params
  ))?.total || 0);
  const rows = await db.all(
    `SELECT id, case_type, queue_type, status, priority, blocking,
            conflict_count, master_count, source_count, created_at, updated_at,
            reviewer_user_id, review_started_at, review_updated_at,
            review_version, operational_flag, last_event_at
       FROM customer_identity_cases
      WHERE ${where.sql}
      ORDER BY CASE priority
        WHEN 'CRITICAL' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'MEDIUM' THEN 3
        ELSE 4 END,
        datetime(created_at) ASC,
        id ASC
      LIMIT ? OFFSET ?`,
    [...where.params, filters.pageSize, (filters.page - 1) * filters.pageSize]
  );
  const counters = await db.all(
    `SELECT priority, status, COUNT(*) AS total
       FROM customer_identity_cases
      WHERE queue_type = ?
      GROUP BY priority, status`,
    [IDENTITY_QUEUE]
  );
  const byPriority = Object.fromEntries(PRIORITIES.map((priority) => [priority, 0]));
  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const counter of counters) {
    byPriority[counter.priority] = Number(byPriority[counter.priority] || 0) + Number(counter.total || 0);
    byStatus[counter.status] = Number(byStatus[counter.status] || 0) + Number(counter.total || 0);
  }
  return {
    rows: rows.map(normalizeCaseRow),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / filters.pageSize))
    },
    counters: {
      total: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
      byPriority,
      byStatus
    },
    filters
  };
}

async function readEvents(db, caseId) {
  const events = await db.all(
    `SELECT id, event_type, actor_user_id, reason, before_json, after_json, created_at
      FROM customer_identity_case_events
      WHERE case_id = ?
      ORDER BY created_at DESC, id DESC`,
    [caseId]
  );
  return events.map((event) => ({
    id: technicalReference("EVENT", event.id),
    eventType: String(event.event_type || ""),
    actorUserId: event.actor_user_id === null ? null : String(event.actor_user_id || ""),
    reason: sanitizeAdministrativeText(event.reason || ""),
    before: sanitizeEventState(event.before_json),
    after: sanitizeEventState(event.after_json),
    createdAt: String(event.created_at || "")
  }));
}

async function getCase(db, caseId, options = {}) {
  assertDb(db);
  const id = normalizeCaseSearch(caseId);
  const row = await db.get(
    `SELECT id, case_type, queue_type, status, priority, blocking,
            conflict_count, master_count, source_count, summary_json,
            created_at, updated_at, reviewer_user_id, review_started_at,
            review_updated_at, review_version, operational_flag, last_event_at
       FROM customer_identity_cases
      WHERE id = ? AND queue_type = ?`,
    [id, IDENTITY_QUEUE]
  );
  if (!row) {
    throw new CustomerIdentityAdminError("CASE_NOT_FOUND", 404);
  }

  const conflicts = await db.all(
    `SELECT c.conflict_type, c.severity, COUNT(*) AS total
       FROM customer_identity_case_conflicts cc
       JOIN customer_identity_conflicts c ON c.id = cc.conflict_id
      WHERE cc.case_id = ?
      GROUP BY c.conflict_type, c.severity
      ORDER BY c.conflict_type, c.severity`,
    [id]
  );
  const sources = await db.all(
    `SELECT e.entity_id, s.master_id, s.source_type, s.status
       FROM customer_identity_case_entities e
       JOIN customer_master_sources s ON s.id = e.entity_id
      WHERE e.case_id = ? AND e.entity_type = 'SOURCE'
      ORDER BY s.source_type, e.entity_id`,
    [id]
  );
  const identifiers = await db.all(
    `SELECT i.master_id, i.identifier_type, i.masked_value,
            i.validation_status, i.verification_status, i.is_primary, i.is_active
       FROM customer_identity_case_entities e
       JOIN customer_master_identifiers i ON i.master_id = e.entity_id
      WHERE e.case_id = ? AND e.entity_type = 'MASTER'
      ORDER BY i.master_id, i.identifier_type, i.is_primary DESC`,
    [id]
  );
  const identifiersByMaster = new Map();
  for (const identifier of identifiers) {
    const masterId = String(identifier.master_id || "");
    if (!identifiersByMaster.has(masterId)) identifiersByMaster.set(masterId, []);
    identifiersByMaster.get(masterId).push({
      type: String(identifier.identifier_type || ""),
      value: maskIdentifier(identifier.identifier_type, identifier.masked_value),
      validationStatus: String(identifier.validation_status || ""),
      verificationStatus: String(identifier.verification_status || ""),
      primary: Number(identifier.is_primary || 0) === 1,
      active: Number(identifier.is_active || 0) === 1
    });
  }
  const participants = [...new Set(sources.map((source) => String(source.master_id || "")))]
    .sort()
    .map((masterId) => ({
      reference: technicalReference("MASTER", masterId),
      identifiers: identifiersByMaster.get(masterId) || [],
      origins: sources
        .filter((source) => String(source.master_id || "") === masterId)
        .map((source) => ({
          reference: technicalReference("SOURCE", source.entity_id),
          sourceType: String(source.source_type || ""),
          status: String(source.status || "")
        }))
    }));
  const result = {
    ...normalizeCaseRow(row),
    summary: sanitizeCaseSummary(row.summary_json),
    evidenceGroups: conflicts.map((conflict) => ({
      conflictType: String(conflict.conflict_type || ""),
      severity: String(conflict.severity || ""),
      count: Number(conflict.total || 0)
    })),
    participants
  };
  if (options.includeEvents !== false) {
    result.events = await readEvents(db, id);
  }
  return result;
}

function validateMutationInput(input = {}) {
  return {
    expectedVersion: toNonNegativeInteger(input.expectedVersion, "EXPECTED_VERSION", -1),
    reason: sanitizeReason(input.reason)
  };
}

function snapshot(row) {
  return {
    status: String(row.status || ""),
    reviewerUserId: row.reviewer_user_id === null ? null : String(row.reviewer_user_id || ""),
    reviewVersion: Number(row.review_version || 0),
    operationalFlag: String(row.operational_flag || "")
  };
}

async function mutateCase(db, caseId, actor, input, operation) {
  assertDb(db);
  const id = normalizeCaseSearch(caseId);
  const actorUserId = String(actor?.id || "").trim();
  if (!actorUserId) {
    throw new CustomerIdentityAdminError("ACTOR_REQUIRED", 400);
  }
  const validated = validateMutationInput(input);
  if (validated.expectedVersion < 0) {
    throw new CustomerIdentityAdminError("EXPECTED_VERSION_REQUIRED");
  }
  const now = new Date().toISOString();

  await db.run("PRAGMA busy_timeout = 5000");
  await db.run("BEGIN IMMEDIATE");
  try {
    const current = await db.get(
      `SELECT id, queue_type, status, reviewer_user_id, review_version,
              operational_flag, review_started_at
         FROM customer_identity_cases
        WHERE id = ? AND queue_type = ?`,
      [id, IDENTITY_QUEUE]
    );
    if (!current) {
      throw new CustomerIdentityAdminError("CASE_NOT_FOUND", 404);
    }
    if (Number(current.review_version || 0) !== validated.expectedVersion) {
      throw new CustomerIdentityAdminError("CASE_CONCURRENT_UPDATE", 409);
    }
    const change = operation({
      current,
      actorUserId,
      reason: validated.reason,
      now,
      input
    });
    const nextVersion = Number(current.review_version || 0) + 1;
    const before = snapshot(current);
    const after = {
      status: change.status,
      reviewerUserId: change.reviewerUserId,
      reviewVersion: nextVersion,
      operationalFlag: change.operationalFlag,
      ...(change.eventNote ? { note: change.eventNote } : {})
    };
    const update = await db.run(
      `UPDATE customer_identity_cases
          SET status = ?,
              reviewer_user_id = ?,
              review_started_at = ?,
              review_updated_at = ?,
              review_version = ?,
              operational_flag = ?,
              last_event_at = ?,
              updated_at = ?
        WHERE id = ? AND queue_type = ? AND review_version = ?`,
      [
        change.status,
        change.reviewerUserId,
        change.reviewStartedAt,
        now,
        nextVersion,
        change.operationalFlag,
        now,
        now,
        id,
        IDENTITY_QUEUE,
        validated.expectedVersion
      ]
    );
    if (Number(update?.changes || 0) !== 1) {
      throw new CustomerIdentityAdminError("CASE_CONCURRENT_UPDATE", 409);
    }
    await db.run(
      `INSERT INTO customer_identity_case_events
        (id, case_id, event_type, actor_user_id, reason, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `cice-admin:${crypto.randomUUID()}`,
        id,
        change.eventType,
        actorUserId,
        validated.reason,
        JSON.stringify(before),
        JSON.stringify(after),
        now
      ]
    );
    await db.run("COMMIT");
  } catch (error) {
    await db.run("ROLLBACK").catch(() => null);
    if (
      error?.code === "SQLITE_BUSY"
      || /cannot start a transaction within a transaction/i.test(String(error?.message || ""))
    ) {
      throw new CustomerIdentityAdminError("CASE_CONCURRENT_UPDATE", 409);
    }
    throw error;
  }
  return getCase(db, id);
}

async function mutateCaseResolution(db, caseId, actor, input, operation) {
  assertDb(db);
  const id = normalizeCaseSearch(caseId);
  const actorUserId = String(actor?.id || "").trim();
  if (!actorUserId) {
    throw new CustomerIdentityAdminError("ACTOR_REQUIRED", 400);
  }
  const validated = validateMutationInput(input);
  if (validated.expectedVersion < 0) {
    throw new CustomerIdentityAdminError("EXPECTED_VERSION_REQUIRED");
  }
  const now = new Date().toISOString();

  await db.run("PRAGMA busy_timeout = 5000");
  await db.run("BEGIN IMMEDIATE");
  try {
    const current = await db.get(
      `SELECT id, queue_type, status, reviewer_user_id, review_version,
              operational_flag, review_started_at, resolved_at
         FROM customer_identity_cases
        WHERE id = ? AND queue_type = ?`,
      [id, IDENTITY_QUEUE]
    );
    if (!current) {
      throw new CustomerIdentityAdminError("CASE_NOT_FOUND", 404);
    }
    if (Number(current.review_version || 0) !== validated.expectedVersion) {
      throw new CustomerIdentityAdminError("CASE_CONCURRENT_UPDATE", 409);
    }
    const change = operation({
      current,
      actorUserId,
      reason: validated.reason,
      now,
      input
    });
    const nextVersion = Number(current.review_version || 0) + 1;
    const before = snapshot(current);
    let resolvedConflicts = 0;
    let reopenedConflicts = 0;
    if (change.conflictAction?.mode === "resolve") {
      const update = await db.run(
        `UPDATE customer_identity_conflicts
            SET status = 'RESOLVED',
                resolution_type = ?,
                resolution_reason = ?,
                resolved_by = ?,
                resolved_at = ?,
                updated_at = ?
          WHERE status = 'OPEN'
            AND id IN (
              SELECT conflict_id FROM customer_identity_case_conflicts WHERE case_id = ?
            )`,
        [
          change.conflictAction.resolutionType,
          validated.reason,
          actorUserId,
          now,
          now,
          id
        ]
      );
      resolvedConflicts = Number(update?.changes || 0);
    } else if (change.conflictAction?.mode === "reopen") {
      const placeholders = ADMINISTRATIVE_RESOLUTION_TYPES.map(() => "?").join(", ");
      const update = await db.run(
        `UPDATE customer_identity_conflicts
            SET status = 'OPEN',
                resolution_type = NULL,
                resolution_reason = NULL,
                resolved_by = NULL,
                resolved_at = NULL,
                reopened_at = ?,
                updated_at = ?
          WHERE resolution_type IN (${placeholders})
            AND id IN (
              SELECT conflict_id FROM customer_identity_case_conflicts WHERE case_id = ?
            )`,
        [now, now, ...ADMINISTRATIVE_RESOLUTION_TYPES, id]
      );
      reopenedConflicts = Number(update?.changes || 0);
    }
    const after = {
      status: change.status,
      reviewerUserId: change.reviewerUserId,
      reviewVersion: nextVersion,
      operationalFlag: change.operationalFlag,
      ...(resolvedConflicts ? { resolvedConflicts } : {}),
      ...(reopenedConflicts ? { reopenedConflicts } : {})
    };
    const update = await db.run(
      `UPDATE customer_identity_cases
          SET status = ?,
              reviewer_user_id = ?,
              review_started_at = ?,
              review_updated_at = ?,
              review_version = ?,
              operational_flag = ?,
              last_event_at = ?,
              resolved_at = ?,
              updated_at = ?
        WHERE id = ? AND queue_type = ? AND review_version = ?`,
      [
        change.status,
        change.reviewerUserId,
        change.reviewStartedAt,
        now,
        nextVersion,
        change.operationalFlag,
        now,
        change.resolvedAt,
        now,
        id,
        IDENTITY_QUEUE,
        validated.expectedVersion
      ]
    );
    if (Number(update?.changes || 0) !== 1) {
      throw new CustomerIdentityAdminError("CASE_CONCURRENT_UPDATE", 409);
    }
    await db.run(
      `INSERT INTO customer_identity_case_events
        (id, case_id, event_type, actor_user_id, reason, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `cice-admin:${crypto.randomUUID()}`,
        id,
        change.eventType,
        actorUserId,
        validated.reason,
        JSON.stringify(before),
        JSON.stringify(after),
        now
      ]
    );
    await db.run("COMMIT");
  } catch (error) {
    await db.run("ROLLBACK").catch(() => null);
    if (
      error?.code === "SQLITE_BUSY"
      || /cannot start a transaction within a transaction/i.test(String(error?.message || ""))
    ) {
      throw new CustomerIdentityAdminError("CASE_CONCURRENT_UPDATE", 409);
    }
    throw error;
  }
  return getCase(db, id);
}

function requireStatus(current, allowed) {
  if (!allowed.includes(String(current.status || ""))) {
    throw new CustomerIdentityAdminError("INVALID_CASE_TRANSITION", 409);
  }
}

function requireReviewer(current, actorUserId) {
  if (
    current.reviewer_user_id !== null
    && String(current.reviewer_user_id || "") !== String(actorUserId || "")
  ) {
    throw new CustomerIdentityAdminError("CASE_REVIEWED_BY_ANOTHER_ADMIN", 409);
  }
}

function createCustomerIdentityAdminService(dbApi, options = {}) {
  assertDb(dbApi);
  const databasePath = String(options.databasePath || "").trim();
  const mutate = async (caseId, actor, input, operation) => {
    const mutationDb = databasePath ? createDedicatedSqliteDbApi(databasePath) : dbApi;
    try {
      return await mutateCase(mutationDb, caseId, actor, input, operation);
    } finally {
      if (mutationDb !== dbApi) await mutationDb.close();
    }
  };
  const mutateResolution = async (caseId, actor, input, operation) => {
    const mutationDb = databasePath ? createDedicatedSqliteDbApi(databasePath) : dbApi;
    try {
      return await mutateCaseResolution(mutationDb, caseId, actor, input, operation);
    } finally {
      if (mutationDb !== dbApi) await mutationDb.close();
    }
  };
  const resolveWith = (actionKey) => (caseId, actor, input) => mutateResolution(
    caseId,
    actor,
    input,
    ({ current, actorUserId, now }) => {
      requireStatus(current, ["UNDER_REVIEW"]);
      requireReviewer(current, actorUserId);
      const resolution = CASE_RESOLUTIONS[actionKey];
      return {
        status: "RESOLVED",
        reviewerUserId: actorUserId,
        reviewStartedAt: current.review_started_at,
        operationalFlag: resolution.operationalFlag,
        eventType: resolution.eventType,
        resolvedAt: now,
        conflictAction: { mode: "resolve", resolutionType: resolution.resolutionType }
      };
    }
  );
  return Object.freeze({
    listCases: (query) => listCases(dbApi, query),
    getCase: (caseId) => getCase(dbApi, caseId),
    getEvents: async (caseId) => {
      await getCase(dbApi, caseId, { includeEvents: false });
      return readEvents(dbApi, caseId);
    },
    startReview: (caseId, actor, input) => mutate(caseId, actor, input, ({ current, actorUserId, now }) => {
      requireStatus(current, ["OPEN", "REOPENED"]);
      if (current.reviewer_user_id && String(current.reviewer_user_id) !== actorUserId) {
        throw new CustomerIdentityAdminError("CASE_REVIEWED_BY_ANOTHER_ADMIN", 409);
      }
      return {
        status: "UNDER_REVIEW",
        reviewerUserId: actorUserId,
        reviewStartedAt: now,
        operationalFlag: "ACTIVE_REVIEW",
        eventType: "REVIEW_STARTED"
      };
    }),
    releaseReview: (caseId, actor, input) => mutate(caseId, actor, input, ({ current }) => {
      requireStatus(current, ["UNDER_REVIEW"]);
      return {
        status: "OPEN",
        reviewerUserId: null,
        reviewStartedAt: null,
        operationalFlag: "",
        eventType: "REVIEW_RELEASED"
      };
    }),
    addNote: (caseId, actor, input) => mutate(caseId, actor, input, ({ current, actorUserId, input: rawInput }) => {
      if (String(current.status || "") === "UNDER_REVIEW") requireReviewer(current, actorUserId);
      const note = sanitizeReason(rawInput.note);
      return {
        status: String(current.status || ""),
        reviewerUserId: current.reviewer_user_id,
        reviewStartedAt: current.review_started_at,
        operationalFlag: String(current.operational_flag || ""),
        eventType: "NOTE_ADDED",
        eventNote: note
      };
    }),
    markWaitingInformation: (caseId, actor, input) => mutate(caseId, actor, input, ({ current, actorUserId }) => {
      requireStatus(current, ["UNDER_REVIEW"]);
      requireReviewer(current, actorUserId);
      return {
        status: "UNDER_REVIEW",
        reviewerUserId: actorUserId,
        reviewStartedAt: current.review_started_at,
        operationalFlag: "WAITING_INFORMATION",
        eventType: "REVIEW_WAITING_INFORMATION"
      };
    }),
    endWithoutResolution: (caseId, actor, input) => mutate(caseId, actor, input, ({ current, actorUserId }) => {
      requireStatus(current, ["UNDER_REVIEW"]);
      requireReviewer(current, actorUserId);
      return {
        status: "REOPENED",
        reviewerUserId: null,
        reviewStartedAt: null,
        operationalFlag: "REVIEW_ENDED_NO_RESOLUTION",
        eventType: "CASE_REOPENED"
      };
    }),
    reopenCase: (caseId, actor, input) => mutateResolution(caseId, actor, input, ({ current, actorUserId }) => {
      requireStatus(current, ["UNDER_REVIEW", "RESOLVED", "ARCHIVED"]);
      if (String(current.status || "") === "UNDER_REVIEW") requireReviewer(current, actorUserId);
      return {
        status: "REOPENED",
        reviewerUserId: null,
        reviewStartedAt: null,
        operationalFlag: "REOPENED_FOR_REVIEW",
        eventType: "CASE_REOPENED",
        resolvedAt: null,
        conflictAction: { mode: "reopen" }
      };
    }),
    confirmSamePerson: resolveWith("CONFIRM_SAME_PERSON"),
    keepSeparate: resolveWith("KEEP_SEPARATE"),
    markPhoneShared: resolveWith("PHONE_SHARED"),
    markPhoneRecycled: resolveWith("PHONE_RECYCLED"),
    validateCpf: resolveWith("CPF_VALIDATED"),
    rejectCpf: resolveWith("CPF_REJECTED")
  });
}

module.exports = {
  IDENTITY_QUEUE,
  PRIORITIES,
  STATUSES,
  CASE_RESOLUTIONS,
  ADMINISTRATIVE_RESOLUTION_TYPES,
  CustomerIdentityAdminError,
  maskCpf,
  maskPhone,
  maskEmail,
  maskName,
  maskIdentifier,
  sanitizeAdministrativeText,
  sanitizeCaseSummary,
  createCustomerIdentityAdminService
};
