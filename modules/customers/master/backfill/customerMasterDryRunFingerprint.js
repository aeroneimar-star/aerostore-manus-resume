"use strict";

const crypto = require("node:crypto");
const {
  stableStringify
} = require("./customerMasterSourceModel");

const FINGERPRINT_VERSION = "customer-master-dry-run-fingerprint/v1";

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
    conflicts: [...(input.conflicts || [])]
      .map((conflict) => ({
        type: conflict.type,
        severity: conflict.severity,
        participants: [...conflict.participants].sort(),
        evidence: conflict.evidence,
        reasonCodes: [...conflict.reasonCodes].sort(),
        blocking: conflict.blocking
      }))
      .sort((a, b) => `${a.type}:${a.participants.join("|")}`.localeCompare(`${b.type}:${b.participants.join("|")}`)),
    counts: input.counts
  };
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

module.exports = {
  FINGERPRINT_VERSION,
  buildDryRunFingerprint
};
