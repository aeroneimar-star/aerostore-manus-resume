"use strict";

/**
 * Estados de prontidão fiscal — Stage 3.
 * Campo preenchido ≠ tributação correta (tax_correctness permanece unverified).
 */

const FISCAL_READINESS_STATUSES = Object.freeze({
  READY: "READY",
  WARNING: "WARNING",
  BLOCKED: "BLOCKED",
  NOT_APPLICABLE: "NOT_APPLICABLE"
});

const FISCAL_READINESS_SEVERITIES = Object.freeze({
  BLOCKING: "blocking",
  WARNING: "warning",
  INFORMATIONAL: "informational"
});

const FISCAL_READINESS_EVALUATOR_VERSION = "stage3-1.0.0";

const CEST_STATUSES = Object.freeze({
  REQUIRED_UNKNOWN: "cest_required_unknown",
  REQUIRED_MISSING: "cest_required_missing",
  NOT_APPLICABLE: "cest_not_applicable",
  PRESENT: "cest_present"
});

function createFinding({
  code,
  severity = FISCAL_READINESS_SEVERITIES.WARNING,
  message = "",
  itemRef = null,
  field = null,
  meta = null
} = {}) {
  return {
    code: String(code || "UNKNOWN"),
    severity: String(severity || FISCAL_READINESS_SEVERITIES.WARNING),
    message: String(message || ""),
    item_ref: itemRef || null,
    field: field || null,
    meta: meta || null
  };
}

function deriveStatusFromFindings(findings = []) {
  const list = Array.isArray(findings) ? findings : [];
  if (list.some((item) => item.severity === FISCAL_READINESS_SEVERITIES.BLOCKING)) {
    return FISCAL_READINESS_STATUSES.BLOCKED;
  }
  if (list.some((item) => item.severity === FISCAL_READINESS_SEVERITIES.WARNING)) {
    return FISCAL_READINESS_STATUSES.WARNING;
  }
  return FISCAL_READINESS_STATUSES.READY;
}

function buildReadinessResult({
  status = null,
  entityType = "",
  entityRef = "",
  checks = [],
  findings = [],
  extras = {}
} = {}) {
  const list = Array.isArray(findings) ? findings : [];
  const blocking = list.filter((item) => item.severity === FISCAL_READINESS_SEVERITIES.BLOCKING);
  const warnings = list.filter((item) => item.severity === FISCAL_READINESS_SEVERITIES.WARNING);
  const informational = list.filter((item) => item.severity === FISCAL_READINESS_SEVERITIES.INFORMATIONAL);
  const resolvedStatus = status || deriveStatusFromFindings(list);
  return {
    status: resolvedStatus,
    entity_type: String(entityType || ""),
    entity_ref: String(entityRef || ""),
    checks: Array.isArray(checks) ? checks : [],
    blocking_errors: blocking,
    warnings,
    informational,
    findings: list,
    evaluated_at: new Date().toISOString(),
    evaluator_version: FISCAL_READINESS_EVALUATOR_VERSION,
    tax_correctness: "unverified",
    extras: extras && typeof extras === "object" ? extras : {}
  };
}

module.exports = {
  FISCAL_READINESS_STATUSES,
  FISCAL_READINESS_SEVERITIES,
  FISCAL_READINESS_EVALUATOR_VERSION,
  CEST_STATUSES,
  createFinding,
  deriveStatusFromFindings,
  buildReadinessResult
};
