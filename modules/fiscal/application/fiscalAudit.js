"use strict";

const { recordAuditEvent } = require("../../audit/auditService");

const SENSITIVE_FRAGMENT = /(password|senha|token|secret|certificado|certificate|pfx|p12|csc|credential|api[_-]?key)/i;

function sanitizeFiscalDetail(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeFiscalDetail(item));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce((acc, [key, item]) => {
      if (SENSITIVE_FRAGMENT.test(key)) {
        acc[key] = "[REDACTED]";
      } else {
        acc[key] = sanitizeFiscalDetail(item);
      }
      return acc;
    }, {});
  }
  return value;
}

async function recordFiscalAudit({
  action,
  saleId = "",
  entityId = "",
  storeId = "",
  user = {},
  result = "success",
  message = "",
  metadata = null,
  reason = ""
} = {}) {
  return recordAuditEvent({
    module: "fiscal",
    action,
    entity_type: "fiscal_document",
    entity_id: String(entityId || ""),
    sale_id: String(saleId || ""),
    store_id: String(storeId || ""),
    user,
    result,
    message: String(message || "").slice(0, 400),
    reason: String(reason || "").slice(0, 400),
    metadata: sanitizeFiscalDetail(metadata || {}),
    source: "fiscal_module"
  });
}

module.exports = {
  recordFiscalAudit,
  sanitizeFiscalDetail
};
