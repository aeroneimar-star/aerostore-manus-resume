"use strict";

const crypto = require("crypto");
const { run, all } = require("../../db");

const SENSITIVE_KEYS = new Set([
  "password",
  "senha",
  "token",
  "pin",
  "code",
  "authorization",
  "authorization_code",
  "password_hash"
]);

function buildAuditId() {
  return `AUD_${Date.now()}_${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce((acc, [key, item]) => {
      const normalizedKey = normalizeText(key).toLowerCase();
      acc[key] = SENSITIVE_KEYS.has(normalizedKey) ? "[REDACTED]" : sanitizeValue(item);
      return acc;
    }, {});
  }
  return value;
}

function jsonOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  try {
    return JSON.stringify(sanitizeValue(value));
  } catch (error) {
    return JSON.stringify({ value: "[unserializable]" });
  }
}

function getRequestIp(req = {}) {
  return normalizeText(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || "").split(",")[0].trim();
}

function getStoreFromUser(user = {}) {
  return {
    store_id: normalizeText(user.store_id || user.storeId || user.store || ""),
    store_name: normalizeText(user.store || user.store_name || user.storeName || user.store_id || "")
  };
}

function getAuditUser(user = {}) {
  return {
    user_id: user.id || user.user_id || null,
    user_name: normalizeText(user.name || user.username || user.email || ""),
    user_email: normalizeText(user.email || user.login || ""),
    user_role: normalizeText(user.role || user.perfil || user.profile || "")
  };
}

function buildAuditEventFromRequest(req = {}, event = {}) {
  const user = getAuditUser(req.user || event.user || {});
  const store = {
    ...getStoreFromUser(req.user || {}),
    store_id: normalizeText(event.store_id || event.storeId || getStoreFromUser(req.user || {}).store_id),
    store_name: normalizeText(event.store_name || event.storeName || getStoreFromUser(req.user || {}).store_name)
  };
  return {
    audit_id: normalizeText(event.audit_id || "") || buildAuditId(),
    created_at: normalizeText(event.created_at || "") || new Date().toISOString(),
    user_id: user.user_id,
    user_name: normalizeText(event.user_name || user.user_name),
    user_email: normalizeText(event.user_email || user.user_email),
    user_role: normalizeText(event.user_role || user.user_role),
    store_id: store.store_id,
    store_name: store.store_name,
    module: normalizeText(event.module || "system"),
    action: normalizeText(event.action || "event"),
    entity_type: normalizeText(event.entity_type || event.entityType || ""),
    entity_id: normalizeText(event.entity_id || event.entityId || ""),
    entity_label: normalizeText(event.entity_label || event.entityLabel || ""),
    sale_id: normalizeText(event.sale_id || event.saleId || req.params?.saleId || req.body?.sale_id || ""),
    customer_id: normalizeText(event.customer_id || event.customerId || req.params?.customerId || req.body?.customer_id || ""),
    product_id: normalizeText(event.product_id || event.productId || req.params?.productId || req.params?.id || req.body?.product_id || ""),
    amount: event.amount === undefined || event.amount === null ? null : Number(event.amount || 0),
    previous_amount: event.previous_amount === undefined || event.previousAmount === undefined ? null : Number(event.previous_amount ?? event.previousAmount ?? 0),
    new_amount: event.new_amount === undefined || event.newAmount === undefined ? null : Number(event.new_amount ?? event.newAmount ?? 0),
    before_json: jsonOrNull(event.before),
    after_json: jsonOrNull(event.after),
    metadata_json: jsonOrNull({
      ...(event.metadata && typeof event.metadata === "object" ? event.metadata : {}),
      path: req.originalUrl || req.path || "",
      method: req.method || "",
      params: req.params || {},
      body: event.includeBody === false ? undefined : req.body || undefined
    }),
    reason: normalizeText(event.reason || req.body?.reason || ""),
    authorized_by: normalizeText(event.authorized_by || event.authorizedBy || event.authorized_by_name || ""),
    result: normalizeText(event.result || "success"),
    message: normalizeText(event.message || ""),
    source: normalizeText(event.source || "backend"),
    ip: normalizeText(event.ip || getRequestIp(req)),
    user_agent: normalizeText(event.user_agent || req.headers?.["user-agent"] || "")
  };
}

async function recordAuditEvent(event = {}) {
  try {
    const req = event.req || {};
    const payload = buildAuditEventFromRequest(req, event);
    await run(
      `INSERT INTO audit_logs (
        audit_id, created_at, user_id, user_name, user_email, user_role,
        store_id, store_name, module, action, entity_type, entity_id, entity_label,
        sale_id, customer_id, product_id, amount, previous_amount, new_amount,
        before_json, after_json, metadata_json, reason, authorized_by, result,
        message, source, ip, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.audit_id,
        payload.created_at,
        payload.user_id,
        payload.user_name,
        payload.user_email,
        payload.user_role,
        payload.store_id,
        payload.store_name,
        payload.module,
        payload.action,
        payload.entity_type,
        payload.entity_id,
        payload.entity_label,
        payload.sale_id,
        payload.customer_id,
        payload.product_id,
        payload.amount,
        payload.previous_amount,
        payload.new_amount,
        payload.before_json,
        payload.after_json,
        payload.metadata_json,
        payload.reason,
        payload.authorized_by,
        payload.result,
        payload.message,
        payload.source,
        payload.ip,
        payload.user_agent
      ]
    );
    return payload;
  } catch (error) {
    console.error("[AUDIT] Falha ao registrar evento", error);
    return null;
  }
}

function buildAuditFilters(query = {}) {
  const clauses = [];
  const params = [];
  const addLike = (column, value) => {
    const text = normalizeText(value || "");
    if (!text) return;
    clauses.push(`${column} LIKE ?`);
    params.push(`%${text}%`);
  };
  addLike("user_email", query.user || query.email || "");
  addLike("module", query.module || "");
  addLike("action", query.action || "");
  addLike("store_id", query.store || query.store_id || "");
  addLike("sale_id", query.sale_id || query.sale || "");
  addLike("customer_id", query.customer_id || query.customer || "");
  addLike("product_id", query.product_id || query.product || "");
  addLike("result", query.result || "");
  if (query.date_from) {
    clauses.push("created_at >= ?");
    params.push(`${query.date_from}T00:00:00.000Z`);
  }
  if (query.date_to) {
    clauses.push("created_at <= ?");
    params.push(`${query.date_to}T23:59:59.999Z`);
  }
  return { clauses, params };
}

async function listAuditLogs(query = {}) {
  const { clauses, params } = buildAuditFilters(query);
  const limit = Math.min(300, Math.max(25, Number(query.limit || 100)));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return all(
    `SELECT * FROM audit_logs ${where} ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`,
    [...params, limit]
  );
}

module.exports = {
  recordAuditEvent,
  listAuditLogs,
  sanitizeValue
};
