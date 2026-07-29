"use strict";

const crypto = require("node:crypto");
const {
  stableStringify
} = require("./customerMasterSourceModel");

const FINGERPRINT_VERSION = "customer-master-dry-run-fingerprint/v2";

function buildDryRunFingerprint(input = {}) {
  const payload = {
    fingerprintVersion: FINGERPRINT_VERSION,
    codeVersion: input.codeVersion,
    normalizationVersion: input.normalizationVersion,
    candidateRuleVersion: input.candidateRuleVersion,
    conflictRuleVersion: input.conflictRuleVersion,
    eligibilityRuleVersion: input.eligibilityRuleVersion,
    sources: [...(input.sources || [])]
      .map((source) => ({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceHash: source.sourceHash
      }))
      .sort((a, b) => `${a.sourceType}:${a.sourceId}`.localeCompare(`${b.sourceType}:${b.sourceId}`)),
    candidates: [...(input.candidates || [])]
      .map((candidate) => ({
        id: candidate.id,
        classification: candidate.classification,
        sourceRefs: [...candidate.sourceRefs].sort(),
        simulatedStatus: candidate.simulatedEligibility?.simulatedStatus
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    conflicts: {
      totalConflicts: Number(input.conflictSummary?.totalConflicts || 0),
      conflictCountsByType: { ...(input.conflictSummary?.conflictCountsByType || {}) },
      conflictCountsBySeverity: { ...(input.conflictSummary?.conflictCountsBySeverity || {}) },
      blockingConflictCount: Number(input.conflictSummary?.blockingConflictCount || 0)
    },
    counts: input.counts
  };
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

module.exports = {
  FINGERPRINT_VERSION,
  buildDryRunFingerprint
};
