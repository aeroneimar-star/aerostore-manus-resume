"use strict";

const COMPARISON_VERSION = "customer-master-dry-run-comparison/v1";
const COMPARISON_CLASSIFICATIONS = Object.freeze({
  MATCH: "MATCH",
  LEGACY_OVERMERGE_RISK: "LEGACY_OVERMERGE_RISK",
  LEGACY_UNDERMERGE_RISK: "LEGACY_UNDERMERGE_RISK",
  MASTER_REVIEW_REQUIRED: "MASTER_REVIEW_REQUIRED",
  UNSAFE_TO_COMPARE: "UNSAFE_TO_COMPARE",
  INVALID_INPUT: "INVALID_INPUT"
});

function sortedSignatures(groups, field) {
  if (!Array.isArray(groups)) return null;
  return groups.map((group) => (
    Array.isArray(group?.[field])
      ? Array.from(new Set(group[field].map(String))).sort().join("+")
      : ""
  )).sort();
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareDryRunWithLegacy(report, legacySummary) {
  if (!report || report.mode !== "DRY_RUN" || !legacySummary || typeof legacySummary !== "object") {
    return {
      version: COMPARISON_VERSION,
      classification: COMPARISON_CLASSIFICATIONS.INVALID_INPUT,
      differences: [],
      warnings: ["COMPARISON_INPUT_INVALID"]
    };
  }
  const dryGroups = Number(report.counts?.candidateGroups || 0);
  const legacyGroups = Number(legacySummary.groupCount);
  if (!Number.isFinite(legacyGroups)) {
    return {
      version: COMPARISON_VERSION,
      classification: COMPARISON_CLASSIFICATIONS.UNSAFE_TO_COMPARE,
      differences: [],
      warnings: ["LEGACY_GROUP_COUNT_UNAVAILABLE"]
    };
  }
  const differences = [];
  if (legacyGroups < dryGroups) differences.push("LEGACY_HAS_FEWER_GROUPS");
  if (legacyGroups > dryGroups) differences.push("LEGACY_HAS_MORE_GROUPS");
  if (Number(legacySummary.conflictCount || 0) !== Number(report.counts?.conflicts || 0)) {
    differences.push("CONFLICT_COUNT_DIFFERS");
  }
  if (Array.isArray(legacySummary.groups)) {
    const drySourceSignatures = sortedSignatures(report.candidates, "sourceTypes");
    const legacySourceSignatures = sortedSignatures(legacySummary.groups, "sourceTypes");
    if (!sameJson(drySourceSignatures, legacySourceSignatures)) {
      differences.push("SOURCE_GROUPING_DIFFERS");
    }
    const dryIdentifierSignatures = sortedSignatures(report.candidates, "identifierTypes");
    const legacyIdentifierSignatures = sortedSignatures(legacySummary.groups, "identifierTypes");
    if (!sameJson(dryIdentifierSignatures, legacyIdentifierSignatures)) {
      differences.push("IDENTIFIER_OBSERVATION_DIFFERS");
    }
    const dryStatuses = report.candidates.map((candidate) => candidate.sourceState).sort();
    const legacyStatuses = legacySummary.groups.map((group) => String(group.status || "")).sort();
    if (!sameJson(dryStatuses, legacyStatuses)) differences.push("SOURCE_STATUS_DIFFERS");
    if (legacySummary.groups.some((group) => group.maskedOnly === false)) {
      differences.push("LEGACY_MASKING_UNSAFE");
    }
  }
  if (
    Array.isArray(legacySummary.shadowComparisons)
    && legacySummary.shadowComparisons.some((comparison) => (
      !["MATCH", "MISSING_IN_MASTER", "MISSING_IN_LEGACY"].includes(comparison?.summary)
    ))
  ) {
    differences.push("SHADOW_COMPARISON_REQUIRES_REVIEW");
  }
  let classification = COMPARISON_CLASSIFICATIONS.MATCH;
  if (
    legacyGroups < dryGroups
    || differences.includes("SOURCE_GROUPING_DIFFERS") && legacyGroups <= dryGroups
  ) {
    classification = COMPARISON_CLASSIFICATIONS.LEGACY_OVERMERGE_RISK;
  } else if (
    legacyGroups > dryGroups
    || differences.includes("SOURCE_GROUPING_DIFFERS") && legacyGroups > dryGroups
  ) {
    classification = COMPARISON_CLASSIFICATIONS.LEGACY_UNDERMERGE_RISK;
  } else if (
    differences.length
    || Number(report.counts?.reviewRequired || 0) > 0
    || Number(report.counts?.blockingConflicts || 0) > 0
  ) {
    classification = COMPARISON_CLASSIFICATIONS.MASTER_REVIEW_REQUIRED;
  }
  return {
    version: COMPARISON_VERSION,
    classification,
    differences,
    warnings: [
      "LEGACY_UNIFIED_RESULT_IS_DIAGNOSTIC_ONLY",
      "SHADOW_COMPARISON_DOES_NOT_AUTHORIZE_OPERATIONAL_DECISIONS"
    ]
  };
}

module.exports = {
  COMPARISON_VERSION,
  COMPARISON_CLASSIFICATIONS,
  sortedSignatures,
  compareDryRunWithLegacy
};
