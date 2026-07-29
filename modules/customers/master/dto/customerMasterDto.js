"use strict";

const SAFE_REASON_PATTERN = /^[A-Z0-9_:-]{1,80}$/;
const SAFE_SOURCE_TYPES = new Set(["contacts", "crm_contacts"]);

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseJson(value, fallback, warningCode) {
  if (typeof value !== "string" || !value.trim()) {
    return { value: fallback, warnings: [] };
  }
  try {
    return { value: JSON.parse(value), warnings: [] };
  } catch {
    return { value: fallback, warnings: [warningCode] };
  }
}

function sanitizeReasonCodes(value) {
  return Array.isArray(value)
    ? uniqueStrings(value.map(String).filter((item) => SAFE_REASON_PATTERN.test(item)))
    : [];
}

function sanitizeEvidenceJson(value) {
  const parsed = parseJson(value, null, "CONFLICT_EVIDENCE_INVALID_JSON");
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return { evidence: null, warnings: parsed.warnings };
  }

  const source = parsed.value;
  const evidence = {
    codes: sanitizeReasonCodes(source.codes),
    signals: sanitizeReasonCodes(source.signals),
    sourceTypes: Array.isArray(source.sourceTypes)
      ? uniqueStrings(source.sourceTypes.map(String).filter((item) => SAFE_SOURCE_TYPES.has(item)))
      : [],
    participantCount: Number.isSafeInteger(source.participantCount) && source.participantCount >= 0
      ? source.participantCount
      : null
  };
  const allowedKeys = new Set(["codes", "signals", "sourceTypes", "participantCount"]);
  const ignored = Object.keys(source).some((key) => !allowedKeys.has(key));
  return {
    evidence,
    warnings: uniqueStrings([
      ...parsed.warnings,
      ignored ? "CONFLICT_EVIDENCE_FIELDS_IGNORED" : ""
    ])
  };
}

function toMasterDto(row = {}) {
  const reasons = parseJson(
    row.eligibility_reasons_json,
    [],
    "ELIGIBILITY_REASONS_INVALID_JSON"
  );
  return {
    dto: {
      id: String(row.id || ""),
      displayName: String(row.display_name || ""),
      status: String(row.status || ""),
      version: Number(row.version || 0),
      eligibilityStatus: String(row.eligibility_status || "NOT_EVALUATED"),
      eligibilityReasons: sanitizeReasonCodes(reasons.value),
      eligibilityEvaluatedAt: row.eligibility_evaluated_at || null,
      eligibilityRuleVersion: String(row.eligibility_rule_version || ""),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      deletedAt: row.deleted_at || null
    },
    warnings: reasons.warnings
  };
}

function toSourceDto(row = {}) {
  return {
    id: String(row.linked_source_id ?? row.id ?? ""),
    sourceType: String(row.linked_source_type ?? row.source_type ?? ""),
    sourceId: String(row.linked_source_record_id ?? row.source_id ?? ""),
    sourceUpdatedAt: row.linked_source_updated_at ?? row.source_updated_at ?? null,
    importedAt: row.linked_source_imported_at ?? row.imported_at ?? null,
    status: String(row.linked_source_status ?? row.status ?? ""),
    revokedAt: row.linked_source_revoked_at ?? row.revoked_at ?? null
  };
}

function toIdentifierDto(row = {}) {
  return {
    id: String(row.id || ""),
    type: String(row.identifier_type || ""),
    maskedValue: String(row.masked_value || ""),
    classification: String(row.classification || ""),
    validationStatus: String(row.validation_status || ""),
    verificationStatus: String(row.verification_status || ""),
    isPrimary: Number(row.is_primary || 0) === 1,
    isActive: Number(row.is_active || 0) === 1,
    normalizationVersion: String(row.normalization_version || ""),
    revokedAt: row.revoked_at || null
  };
}

function toConflictDto(row = {}) {
  const sanitized = sanitizeEvidenceJson(row.evidence_json);
  return {
    dto: {
      id: String(row.id || ""),
      type: String(row.conflict_type || ""),
      severity: String(row.severity || ""),
      status: String(row.status || ""),
      ruleVersion: String(row.rule_version || ""),
      evidence: sanitized.evidence,
      resolution: {
        type: row.resolution_type || null,
        hasReason: Number(row.resolution_has_reason || 0) === 1,
        resolved: Boolean(row.resolved_at)
      },
      resolvedAt: row.resolved_at || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      reopenedAt: row.reopened_at || null
    },
    warnings: sanitized.warnings
  };
}

module.exports = {
  parseJson,
  sanitizeReasonCodes,
  sanitizeEvidenceJson,
  toMasterDto,
  toSourceDto,
  toIdentifierDto,
  toConflictDto
};
