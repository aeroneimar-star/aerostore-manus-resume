"use strict";

const {
  sourceKey,
  validIdentifiers
} = require("./customerMasterCandidateBuilder");

const CONFLICT_RULE_VERSION = "customer-master-conflict-rules/v1";

function maskedValues(records, indexes, type) {
  return Array.from(new Set(indexes.flatMap((index) => (
    records[index].normalizedIdentity.identifiers
      .filter((identifier) => identifier.type === type && identifier.maskedValue)
      .map((identifier) => identifier.maskedValue)
  )))).sort();
}

function createConflict(type, severity, indexes, records, options = {}) {
  return {
    type,
    severity,
    participants: indexes.map((index) => sourceKey(records[index])).sort(),
    evidence: {
      identifierType: options.identifierType || null,
      maskedValues: options.identifierType ? maskedValues(records, indexes, options.identifierType) : [],
      participantCount: indexes.length,
      sourceTypes: Array.from(new Set(indexes.map((index) => records[index].sourceType))).sort()
    },
    reasonCodes: options.reasonCodes || [type],
    blocking: options.blocking !== false,
    ruleVersion: CONFLICT_RULE_VERSION
  };
}

function detectCustomerMasterConflicts(records, graph, candidates, options = {}) {
  const conflicts = [];
  const warnings = ["PHONE_RECYCLED_NOT_DETERMINABLE_WITHOUT_HISTORY"];

  function addBucketConflicts(buckets, type, severity, identifierType, blocking = true) {
    for (const indexes of buckets.values()) {
      if (indexes.length > 1) {
        conflicts.push(createConflict(type, severity, indexes, records, {
          identifierType,
          blocking
        }));
      }
    }
  }

  for (const indexes of graph.sourceBuckets.values()) {
    if (indexes.length > 1) {
      conflicts.push(createConflict("SOURCE_ID_COLLISION", "CRITICAL", indexes, records));
    }
  }
  addBucketConflicts(graph.phoneBuckets, "PHONE_DUPLICATE", "HIGH", "PHONE", true);
  for (const indexes of graph.phoneBuckets.values()) {
    if (indexes.length > 2) {
      conflicts.push(createConflict("PHONE_SHARED", "CRITICAL", indexes, records, {
        identifierType: "PHONE",
        reasonCodes: ["PHONE_SHARED", "PHONE_RECYCLED_NOT_DETERMINABLE"]
      }));
    }
    const active = indexes.filter((index) => !records[index].sourceInactive && !records[index].sourceDeleted);
    if (active.length > 1) {
      conflicts.push(createConflict("MULTIPLE_ELIGIBLE_CUSTOMERS", "CRITICAL", active, records, {
        identifierType: "PHONE"
      }));
    }
  }
  addBucketConflicts(graph.cpfBuckets, "CPF_DUPLICATE", "MEDIUM", "CPF", false);
  addBucketConflicts(graph.emailBuckets, "EMAIL_DUPLICATE", "LOW", "EMAIL", false);

  records.forEach((record, index) => {
    const cpf = record.normalizedIdentity.identifiers.find((identifier) => identifier.type === "CPF");
    if (cpf && ["CPF_INVALID", "AMBIGUOUS"].includes(cpf.classification)) {
      conflicts.push(createConflict("CPF_INVALID", "MEDIUM", [index], records, {
        identifierType: "CPF",
        blocking: false,
        reasonCodes: cpf.reasons.length ? cpf.reasons : ["CPF_INVALID"]
      }));
    }
    if (record.sourceDeleted) {
      conflicts.push(createConflict("DELETED_SOURCE", "HIGH", [index], records));
    } else if (record.sourceInactive) {
      conflicts.push(createConflict("INACTIVE_SOURCE", "HIGH", [index], records));
    }
    if (
      options.staleBefore
      && record.sourceUpdatedAt
      && Number.isFinite(Date.parse(options.staleBefore))
      && Date.parse(record.sourceUpdatedAt) < Date.parse(options.staleBefore)
    ) {
      conflicts.push(createConflict("STALE_SOURCE", "LOW", [index], records, { blocking: false }));
    }
    if (!record.sourceId) {
      conflicts.push(createConflict("SOURCE_ID_COLLISION", "CRITICAL", [index], records, {
        reasonCodes: ["SOURCE_ID_MISSING"]
      }));
    }
  });

  for (const candidate of candidates) {
    const indexes = candidate.recordIndexes;
    if (indexes.length <= 1) continue;
    const cpfValues = new Set(indexes.flatMap((index) => validIdentifiers(records[index], "CPF").map((item) => item.canonicalValue)));
    const phoneValues = new Set(indexes.flatMap((index) => validIdentifiers(records[index], "PHONE").map((item) => item.canonicalValue)));
    const names = new Set(indexes
      .map((index) => records[index].normalizedIdentity.name)
      .filter((name) => name.isValid)
      .map((name) => name.searchValue));
    if (cpfValues.size > 1) {
      conflicts.push(createConflict("CPF_MISMATCH", "CRITICAL", indexes, records, { identifierType: "CPF" }));
    }
    if (phoneValues.size > 1) {
      conflicts.push(createConflict("PHONE_MISMATCH", "HIGH", indexes, records, { identifierType: "PHONE" }));
    }
    if (names.size > 1) {
      conflicts.push(createConflict("NAME_MISMATCH", "MEDIUM", indexes, records, { blocking: true }));
    }
    if (indexes.length > 2) {
      let transitiveGap = false;
      for (let left = 0; left < indexes.length; left += 1) {
        for (let right = left + 1; right < indexes.length; right += 1) {
          const pair = indexes[left] < indexes[right]
            ? `${indexes[left]}:${indexes[right]}`
            : `${indexes[right]}:${indexes[left]}`;
          if (!graph.directPairs.has(pair)) transitiveGap = true;
        }
      }
      if (transitiveGap) {
        conflicts.push(createConflict("TRANSITIVE_MATCH_CONFLICT", "CRITICAL", indexes, records));
      }
    }
  }

  for (const bucket of graph.oversizedBuckets) {
    warnings.push(`OVERSIZED_${bucket.type}_BUCKET:${bucket.size}`);
  }

  const conflictsByParticipant = new Map();
  conflicts.forEach((conflict) => {
    conflict.participants.forEach((participant) => {
      if (!conflictsByParticipant.has(participant)) conflictsByParticipant.set(participant, []);
      conflictsByParticipant.get(participant).push(conflict);
    });
  });
  candidates.forEach((candidate) => {
    const related = candidate.sourceRefs.flatMap((source) => conflictsByParticipant.get(source) || []);
    if (
      candidate.classification !== "INVALID_SOURCE"
      && related.some((conflict) => conflict.blocking)
    ) {
      candidate.classification = "CONFLICT";
    } else if (
      candidate.classification === "ISOLATED"
      && related.some((conflict) => ["CPF_DUPLICATE", "EMAIL_DUPLICATE", "CPF_INVALID"].includes(conflict.type))
    ) {
      candidate.classification = "REVIEW_REQUIRED";
      conflicts.push(createConflict("MANUAL_REVIEW_REQUIRED", "MEDIUM", candidate.recordIndexes, records, {
        blocking: false
      }));
    }
  });

  return {
    ruleVersion: CONFLICT_RULE_VERSION,
    conflicts: conflicts.sort((a, b) => (
      a.type.localeCompare(b.type) || a.participants.join("|").localeCompare(b.participants.join("|"))
    )),
    warnings: Array.from(new Set(warnings)).sort()
  };
}

module.exports = {
  CONFLICT_RULE_VERSION,
  createConflict,
  detectCustomerMasterConflicts
};
