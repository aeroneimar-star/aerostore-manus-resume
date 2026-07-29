"use strict";

const {
  stableStringify
} = require("./customerMasterSourceModel");

const REPORT_VERSION = "customer-master-backfill-dry-run-report/v2";

function increment(target, key, amount = 1) {
  target[key] = Number(target[key] || 0) + amount;
}

function countIdentifiers(records) {
  const byType = {};
  const byClassification = {};
  let valid = 0;
  let invalid = 0;
  let ambiguous = 0;
  records.forEach((record) => {
    record.normalizedIdentity.identifiers.forEach((identifier) => {
      increment(byClassification, identifier.classification);
      if (identifier.classification === "EMPTY") return;
      increment(byType, identifier.type);
      if (identifier.valid) valid += 1;
      else if (identifier.classification === "AMBIGUOUS") ambiguous += 1;
      else if (identifier.classification !== "EMPTY") invalid += 1;
    });
  });
  return { byType, byClassification, valid, invalid, ambiguous };
}

function countAddresses(records, candidates) {
  let present = 0;
  let complete = 0;
  let incomplete = 0;
  let divergentGroups = 0;
  const bySourceType = {};
  records.forEach((record) => {
    const address = record.normalizedIdentity.address;
    const hasAddress = Object.values(address.fields || {}).some(Boolean);
    if (!hasAddress) return;
    present += 1;
    increment(bySourceType, record.sourceType);
    if (address.isValid) complete += 1;
    else incomplete += 1;
  });
  candidates.forEach((candidate) => {
    if (candidate.recordIndexes.length < 2) return;
    const addresses = new Set(candidate.recordIndexes
      .map((index) => records[index].normalizedIdentity.address)
      .filter((address) => Object.values(address.fields || {}).some(Boolean))
      .map((address) => stableStringify(address.fields)));
    if (addresses.size > 1) divergentGroups += 1;
  });
  return { present, complete, incomplete, divergentGroups, bySourceType };
}

function buildCounts(records, candidates, conflicts, sourceCounts, pageCounts) {
  const identifiers = countIdentifiers(records);
  const addresses = countAddresses(records, candidates);
  const candidateClassifications = {};
  const conflictTypes = {};
  const conflictSeverities = {};
  const eligibilityStatuses = {};
  candidates.forEach((candidate) => {
    increment(candidateClassifications, candidate.classification);
    increment(eligibilityStatuses, candidate.simulatedEligibility.simulatedStatus);
  });
  conflicts.forEach((conflict) => {
    increment(conflictTypes, conflict.type);
    increment(conflictSeverities, conflict.severity);
  });
  return {
    sourceRows: records.length,
    sourceRowsByType: { ...sourceCounts },
    pagesByType: { ...pageCounts },
    normalizedRows: records.length,
    rowsWithWarnings: records.filter((record) => record.warnings.length).length,
    inactiveSources: records.filter((record) => record.sourceInactive).length,
    deletedSources: records.filter((record) => record.sourceDeleted).length,
    validIdentifiers: identifiers.valid,
    invalidIdentifiers: identifiers.invalid,
    ambiguousIdentifiers: identifiers.ambiguous,
    identifiersByType: identifiers.byType,
    identifiersByClassification: identifiers.byClassification,
    addresses,
    candidateGroups: candidates.length,
    candidateClassifications,
    isolated: Number(candidateClassifications.ISOLATED || 0),
    safeCandidates: Number(candidateClassifications.SAFE_CANDIDATE || 0),
    reviewRequired: Number(candidateClassifications.REVIEW_REQUIRED || 0),
    conflictingCandidates: Number(candidateClassifications.CONFLICT || 0),
    conflicts: conflicts.length,
    blockingConflicts: conflicts.filter((conflict) => conflict.blocking).length,
    conflictsByType: conflictTypes,
    conflictsBySeverity: conflictSeverities,
    simulatedEligibility: eligibilityStatuses
  };
}

function sanitizeCandidate(candidate, records) {
  const sourceRecords = candidate.recordIndexes.map((index) => records[index]);
  const identifierTypes = Array.from(new Set(sourceRecords.flatMap((record) => (
    record.normalizedIdentity.identifiers
      .filter((identifier) => identifier.classification !== "EMPTY")
      .map((identifier) => identifier.type)
  )))).sort();
  return {
    id: candidate.id,
    sourceRefs: [...candidate.sourceRefs],
    sourceCount: candidate.recordIndexes.length,
    sourceTypes: Array.from(new Set(sourceRecords.map((record) => record.sourceType))).sort(),
    identifierTypes,
    sourceState: sourceRecords.some((record) => record.sourceInactive || record.sourceDeleted)
      ? "INACTIVE_OR_DELETED"
      : "ACTIVE",
    classification: candidate.classification,
    ruleVersion: candidate.ruleVersion,
    simulatedEligibility: { ...candidate.simulatedEligibility }
  };
}

function sanitizeConflict(conflict) {
  return {
    type: conflict.type,
    severity: conflict.severity,
    evidence: {
      identifierType: conflict.evidence.identifierType,
      participantCount: conflict.evidence.participantCount,
      sourceTypes: [...conflict.evidence.sourceTypes]
    },
    reasonCodes: [...conflict.reasonCodes],
    blocking: conflict.blocking,
    ruleVersion: conflict.ruleVersion
  };
}

function buildConflictSummary(conflicts, sampleLimit) {
  const conflictCountsByType = {};
  const conflictCountsBySeverity = {};
  let blockingConflictCount = 0;
  conflicts.forEach((conflict) => {
    increment(conflictCountsByType, conflict.type);
    increment(conflictCountsBySeverity, conflict.severity);
    if (conflict.blocking) blockingConflictCount += 1;
  });
  const deterministic = [...conflicts].sort((a, b) => (
    a.type.localeCompare(b.type)
    || a.severity.localeCompare(b.severity)
    || Number(b.blocking) - Number(a.blocking)
    || a.reasonCodes.join("|").localeCompare(b.reasonCodes.join("|"))
    || a.participants.join("|").localeCompare(b.participants.join("|"))
  ));
  const sampledConflicts = deterministic
    .slice(0, Math.max(0, Number(sampleLimit || 0)))
    .map(sanitizeConflict);
  return {
    totalConflicts: conflicts.length,
    conflictCountsByType,
    conflictCountsBySeverity,
    blockingConflictCount,
    sampledConflictCount: sampledConflicts.length,
    conflictsTruncated: sampledConflicts.length < conflicts.length,
    sampledConflicts
  };
}

module.exports = {
  REPORT_VERSION,
  buildCounts,
  sanitizeCandidate,
  sanitizeConflict,
  buildConflictSummary
};
