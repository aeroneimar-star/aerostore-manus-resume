"use strict";

const PROFILE_VERSION = "customer-master-conflict-profile/v1";

const HISTORICAL_EVIDENCE_TYPES = Object.freeze(["DELETED_SOURCE", "INACTIVE_SOURCE"]);

const PRIMARY_CLASSES = Object.freeze([
  "HISTORICAL_EVIDENCE",
  "REAL_ELIGIBILITY_BLOCK",
  "POTENTIAL_HUMAN_DECISION",
  "NOT_DETERMINABLE"
]);

function increment(target, key, amount = 1) {
  target[key] = Number(target[key] || 0) + amount;
}

function parseBlocking(evidenceJson) {
  try {
    const parsed = JSON.parse(String(evidenceJson || "{}"));
    if (parsed.blocking === true) return true;
    if (parsed.blocking === false) return false;
    return null;
  } catch {
    return null;
  }
}

function classifyPrimary(conflictType, blocking) {
  if (HISTORICAL_EVIDENCE_TYPES.includes(conflictType)) return "HISTORICAL_EVIDENCE";
  if (blocking === true) return "REAL_ELIGIBILITY_BLOCK";
  if (blocking === false) return "POTENTIAL_HUMAN_DECISION";
  return "NOT_DETERMINABLE";
}

function sortedHistogram(countsByKey) {
  return Object.fromEntries(
    Object.entries(countsByKey).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  );
}

function buildCustomerMasterConflictProfile(input = {}) {
  const conflicts = Array.isArray(input.conflicts) ? input.conflicts : [];
  const participants = Array.isArray(input.participants) ? input.participants : [];
  const sourceLinks = Array.isArray(input.sourceLinks) ? input.sourceLinks : [];

  const byType = {};
  const byStatus = {};
  const bySeverity = {};
  const byTypeSeverity = {};
  let blockingTrue = 0;
  let blockingFalse = 0;
  let blockingUndetermined = 0;
  const byPrimaryClass = {};
  let evidenceParticipantCountMismatches = 0;

  const participantsByConflict = new Map();
  for (const participant of participants) {
    const key = String(participant.conflict_id || "");
    if (!participantsByConflict.has(key)) participantsByConflict.set(key, []);
    participantsByConflict.get(key).push(participant);
  }

  const sourceLinkById = new Map(sourceLinks.map((link) => [String(link.id), link]));

  const conflictsEnriched = conflicts.map((conflict) => {
    const id = String(conflict.id || "");
    const blocking = parseBlocking(conflict.evidence_json);
    const rows = participantsByConflict.get(id) || [];
    const participantCount = rows.length;
    let evidenceCount = null;
    try {
      const parsed = JSON.parse(String(conflict.evidence_json || "{}"));
      if (Number.isFinite(Number(parsed.participantCount))) {
        evidenceCount = Number(parsed.participantCount);
      }
    } catch {
      evidenceCount = null;
    }
    if (evidenceCount !== null && evidenceCount !== participantCount) {
      evidenceParticipantCountMismatches += 1;
    }
    const sourceTypes = Array.from(new Set(
      rows
        .filter((row) => row.participant_type === "SOURCE")
        .map((row) => sourceLinkById.get(String(row.participant_id))?.source_type)
        .filter(Boolean)
    )).sort();
    const masterIds = Array.from(new Set(
      rows
        .filter((row) => row.participant_type === "SOURCE")
        .map((row) => sourceLinkById.get(String(row.participant_id))?.master_id)
        .filter(Boolean)
    )).sort();
    const participantSetKey = rows
      .map((row) => `${row.participant_type}:${row.participant_id}`)
      .sort()
      .join("|");
    return {
      id,
      type: String(conflict.conflict_type || ""),
      severity: String(conflict.severity || ""),
      status: String(conflict.status || ""),
      blocking,
      primaryClass: classifyPrimary(String(conflict.conflict_type || ""), blocking),
      participantCount,
      sourceTypes,
      masterIds,
      participantSetKey
    };
  });

  for (const conflict of conflictsEnriched) {
    increment(byType, conflict.type);
    increment(byStatus, conflict.status);
    increment(bySeverity, conflict.severity);
    increment(byTypeSeverity, `${conflict.type}|${conflict.severity}`);
    if (conflict.blocking === true) blockingTrue += 1;
    else if (conflict.blocking === false) blockingFalse += 1;
    else blockingUndetermined += 1;
    increment(byPrimaryClass, conflict.primaryClass);
  }

  const affectedSourceIds = new Set();
  const affectedMasterIds = new Set();
  const conflictsByMaster = new Map();
  const conflictsByParticipantSet = new Map();
  const patternCounts = new Map();
  let multiMasterConflicts = 0;
  let multiSourceTypeConflicts = 0;

  for (const conflict of conflictsEnriched) {
    for (const row of participantsByConflict.get(conflict.id) || []) {
      if (row.participant_type !== "SOURCE") continue;
      affectedSourceIds.add(String(row.participant_id));
      const link = sourceLinkById.get(String(row.participant_id));
      if (link?.master_id) affectedMasterIds.add(String(link.master_id));
    }
    for (const masterId of conflict.masterIds) {
      if (!conflictsByMaster.has(masterId)) conflictsByMaster.set(masterId, []);
      conflictsByMaster.get(masterId).push(conflict);
    }
    if (conflict.masterIds.length > 1) multiMasterConflicts += 1;
    if (conflict.sourceTypes.length > 1) multiSourceTypeConflicts += 1;
    if (conflict.participantSetKey) {
      if (!conflictsByParticipantSet.has(conflict.participantSetKey)) {
        conflictsByParticipantSet.set(conflict.participantSetKey, []);
      }
      conflictsByParticipantSet.get(conflict.participantSetKey).push(conflict);
    }
    const patternKey = [
      conflict.type,
      conflict.severity,
      conflict.blocking === null ? "UNDETERMINED" : conflict.blocking ? "BLOCKING" : "NON_BLOCKING",
      `participants:${conflict.participantCount}`,
      `sources:${conflict.sourceTypes.join("+") || "NONE"}`
    ].join("|");
    patternCounts.set(patternKey, (patternCounts.get(patternKey) || 0) + 1);
  }

  const conflictsPerMasterHistogram = {};
  const masterClassSets = { onlyHistorical: 0, withBlocking: 0, withHumanDecision: 0, withUndetermined: 0 };
  for (const masterConflicts of conflictsByMaster.values()) {
    increment(conflictsPerMasterHistogram, String(masterConflicts.length));
    const classes = new Set(masterConflicts.map((conflict) => conflict.primaryClass));
    if ([...classes].every((klass) => klass === "HISTORICAL_EVIDENCE")) masterClassSets.onlyHistorical += 1;
    if (classes.has("REAL_ELIGIBILITY_BLOCK")) masterClassSets.withBlocking += 1;
    if (classes.has("POTENTIAL_HUMAN_DECISION")) masterClassSets.withHumanDecision += 1;
    if (classes.has("NOT_DETERMINABLE")) masterClassSets.withUndetermined += 1;
  }

  const participantSetSizes = {};
  let repeatedParticipantSets = 0;
  let conflictsInRepeatedSets = 0;
  const classByUniqueParticipantSet = {};
  for (const setConflicts of conflictsByParticipantSet.values()) {
    increment(participantSetSizes, String(setConflicts.length));
    if (setConflicts.length > 1) {
      repeatedParticipantSets += 1;
      conflictsInRepeatedSets += setConflicts.length;
    }
    const classes = new Set(setConflicts.map((conflict) => conflict.primaryClass));
    const setClass = classes.size === 1
      ? [...classes][0]
      : classes.has("REAL_ELIGIBILITY_BLOCK") ? "REAL_ELIGIBILITY_BLOCK"
        : classes.has("HISTORICAL_EVIDENCE") ? "HISTORICAL_EVIDENCE"
          : classes.has("POTENTIAL_HUMAN_DECISION") ? "POTENTIAL_HUMAN_DECISION" : "NOT_DETERMINABLE";
    increment(classByUniqueParticipantSet, setClass);
  }

  const topPatterns = [...patternCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([pattern, count]) => ({ pattern, count }));

  const largestMasterGroupings = [...conflictsByMaster.values()]
    .map((masterConflicts) => masterConflicts.length)
    .sort((a, b) => b - a)
    .slice(0, 10);

  const sameTypeSameSetDuplicates = [...conflictsByParticipantSet.values()].reduce((total, setConflicts) => {
    const seen = new Set();
    let duplicates = 0;
    for (const conflict of setConflicts) {
      if (seen.has(conflict.type)) duplicates += 1;
      seen.add(conflict.type);
    }
    return total + duplicates;
  }, 0);

  return {
    profileVersion: PROFILE_VERSION,
    totals: {
      conflicts: conflicts.length,
      participants: participants.length,
      sourceLinks: sourceLinks.length,
      affectedSources: affectedSourceIds.size,
      affectedMasters: affectedMasterIds.size,
      uniqueParticipantSets: conflictsByParticipantSet.size
    },
    byType: sortedHistogram(byType),
    byStatus: sortedHistogram(byStatus),
    bySeverity: sortedHistogram(bySeverity),
    byTypeSeverity: sortedHistogram(byTypeSeverity),
    blocking: {
      blocking: blockingTrue,
      nonBlocking: blockingFalse,
      undetermined: blockingUndetermined
    },
    primaryClassification: {
      description: "classificacao exclusiva por prioridade sobre campos persistidos: "
        + "HISTORICAL_EVIDENCE (DELETED_SOURCE/INACTIVE_SOURCE) > "
        + "REAL_ELIGIBILITY_BLOCK (blocking=true) > "
        + "POTENTIAL_HUMAN_DECISION (blocking=false) > NOT_DETERMINABLE",
      counts: Object.fromEntries(PRIMARY_CLASSES.map((klass) => [klass, Number(byPrimaryClass[klass] || 0)]))
    },
    duplication: {
      repeatedParticipantSets,
      conflictsInRepeatedSets,
      conflictsPerParticipantSetHistogram: sortedHistogram(participantSetSizes),
      sameTypeSameParticipantSetDuplicates: sameTypeSameSetDuplicates
    },
    patterns: {
      topRepeatedShapes: topPatterns,
      multiMasterConflicts,
      multiSourceTypeConflicts
    },
    masterImpact: {
      conflictsPerMasterHistogram: sortedHistogram(conflictsPerMasterHistogram),
      largestGroupings: largestMasterGroupings,
      mastersByConflictClass: masterClassSets
    },
    administrativeCases: {
      estimateBasis: "conjuntos unicos de participantes (um caso administrativo por grupo de origens), "
        + "com recorte por classe primaria; 34.051 conflitos NAO equivalem a 34.051 decisoes",
      uniqueParticipantSets: conflictsByParticipantSet.size,
      byPrimaryClass: Object.fromEntries(
        PRIMARY_CLASSES.map((klass) => [klass, Number(classByUniqueParticipantSet[klass] || 0)])
      ),
      affectedMasters: affectedMasterIds.size,
      affectedSources: affectedSourceIds.size
    },
    consistency: {
      evidenceParticipantCountMismatches,
      conflictsWithoutParticipants: conflictsEnriched.filter((conflict) => conflict.participantCount === 0).length
    }
  };
}

module.exports = {
  PROFILE_VERSION,
  PRIMARY_CLASSES,
  HISTORICAL_EVIDENCE_TYPES,
  parseBlocking,
  classifyPrimary,
  buildCustomerMasterConflictProfile
};
