"use strict";

const {
  NORMALIZATION_VERSION
} = require("../normalization");
const {
  buildSourceRecord,
  stableStringify
} = require("./customerMasterSourceModel");
const {
  CANDIDATE_RULE_VERSION,
  buildCandidateGraph,
  buildCandidateClusters,
  validIdentifiers
} = require("./customerMasterCandidateBuilder");
const {
  CONFLICT_RULE_VERSION,
  detectCustomerMasterConflicts
} = require("./customerMasterConflictDetector");
const {
  FINGERPRINT_VERSION,
  buildDryRunFingerprint
} = require("./customerMasterDryRunFingerprint");
const {
  compareDryRunWithLegacy
} = require("./customerMasterDryRunComparison");
const {
  REPORT_VERSION,
  buildCounts,
  sanitizeCandidate,
  sanitizeConflict
} = require("./customerMasterDryRunReport");

const DRY_RUN_SERVICE_VERSION = "customer-master-backfill-dry-run/v1";
const ELIGIBILITY_RULE_VERSION = "customer-master-simulated-eligibility/v1";
const DEFAULT_LIMITS = Object.freeze({
  pageSize: 250,
  maxRecords: 5000,
  maxClusterSize: 50,
  maxConflicts: 2000,
  maxEvidenceBytes: 1024,
  maxOperations: 200000,
  maxApproxMemoryBytes: 20 * 1024 * 1024
});

const SAFE_ERROR_CODES = new Set([
  "SOURCE_SCHEMA_UNAVAILABLE",
  "SOURCE_RECORD_LIMIT_EXCEEDED",
  "SOURCE_COUNT_CHANGED_DURING_READ",
  "CLUSTER_SIZE_LIMIT_EXCEEDED",
  "CONFLICT_LIMIT_EXCEEDED",
  "CONFLICT_EVIDENCE_LIMIT_EXCEEDED",
  "OPERATION_LIMIT_EXCEEDED",
  "APPROX_MEMORY_LIMIT_EXCEEDED",
  "CUSTOMER_MASTER_DRY_RUN_READER_REQUIRED"
]);

function normalizeLimits(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const normalized = Object.fromEntries(Object.entries(limits).map(([key, value]) => {
    const numeric = Math.trunc(Number(value));
    return [key, Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_LIMITS[key]];
  }));
  normalized.pageSize = Math.min(500, normalized.pageSize);
  return normalized;
}

function incompleteReport(code, startedAt, details = {}) {
  return {
    reportVersion: REPORT_VERSION,
    serviceVersion: DRY_RUN_SERVICE_VERSION,
    mode: "DRY_RUN",
    status: "INCOMPLETE",
    fingerprintVersion: FINGERPRINT_VERSION,
    fingerprint: null,
    errors: [{ code, details }],
    warnings: ["NO_WRITE_WAS_ATTEMPTED", "INCOMPLETE_RESULT_MUST_NOT_BE_USED_FOR_BACKFILL"],
    performance: {
      durationMs: Date.now() - startedAt
    }
  };
}

function validateReader(reader) {
  const methods = [
    "getSourceSchemaSummary",
    "countContacts",
    "countCrmContacts",
    "readContactsPage",
    "readCrmContactsPage"
  ];
  if (!reader || methods.some((method) => typeof reader[method] !== "function")) {
    throw new Error("CUSTOMER_MASTER_DRY_RUN_READER_REQUIRED");
  }
}

async function readSource(reader, sourceType, total, pageSize, metrics) {
  const rows = [];
  const method = sourceType === "contacts" ? "readContactsPage" : "readCrmContactsPage";
  for (let offset = 0; offset < total; offset += pageSize) {
    const page = await reader[method]({ limit: pageSize, offset });
    metrics.pages[sourceType] += 1;
    rows.push(...page);
    if (page.length === 0) break;
  }
  return rows;
}

function simulateEligibility(records, candidates, conflicts = []) {
  const blockingByParticipant = new Map();
  conflicts.filter((conflict) => conflict.blocking).forEach((conflict) => {
    conflict.participants.forEach((participant) => {
      if (!blockingByParticipant.has(participant)) blockingByParticipant.set(participant, new Set());
      blockingByParticipant.get(participant).add(conflict.type);
    });
  });
  candidates.forEach((candidate) => {
    const sourceRecords = candidate.recordIndexes.map((index) => records[index]);
    const hasPhone = sourceRecords.some((record) => validIdentifiers(record, "PHONE").length > 0);
    const inactive = sourceRecords.some((record) => record.sourceInactive || record.sourceDeleted);
    const blockingConflicts = Array.from(new Set(candidate.sourceRefs.flatMap((sourceRef) => (
      Array.from(blockingByParticipant.get(sourceRef) || [])
    )))).sort();
    const safeClassification = ["ISOLATED", "SAFE_CANDIDATE"].includes(candidate.classification);
    let simulatedStatus = "SIMULATED_REVIEW_REQUIRED";
    const reasonCodes = [];
    if (!hasPhone) {
      simulatedStatus = "SIMULATED_INELIGIBLE";
      reasonCodes.push("VALID_PHONE_REQUIRED");
    }
    if (inactive) {
      simulatedStatus = "SIMULATED_INELIGIBLE";
      reasonCodes.push("ACTIVE_SOURCE_REQUIRED");
    }
    if (!safeClassification) reasonCodes.push("IDENTITY_REVIEW_REQUIRED");
    if (safeClassification && hasPhone && !inactive) {
      simulatedStatus = "SIMULATED_ELIGIBLE_SUBJECT_TO_PHONE_VERIFICATION";
      reasonCodes.push("PHONE_OWNERSHIP_NOT_VERIFIED_IN_DRY_RUN");
    }
    candidate.simulatedEligibility = {
      simulatedStatus,
      reasonCodes: Array.from(new Set(reasonCodes)).sort(),
      blockingConflicts,
      accessDecision: "NOT_AVAILABLE_IN_PHASE_3_1_D",
      ruleVersion: ELIGIBILITY_RULE_VERSION
    };
  });
}

function safeErrorCode(error) {
  const code = String(error?.message || "");
  return SAFE_ERROR_CODES.has(code) ? code : "CUSTOMER_MASTER_DRY_RUN_FAILED_SAFELY";
}

async function runCustomerMasterBackfillDryRun(reader, options = {}) {
  const startedAt = Date.now();
  const limits = normalizeLimits(options);
  const metrics = {
    pages: { contacts: 0, crm_contacts: 0 },
    approximateMemoryBytes: 0,
    comparisons: 0,
    operations: 0
  };
  try {
    validateReader(reader);
    const schema = await reader.getSourceSchemaSummary();
    if (!schema?.contacts?.exists || !schema?.crm_contacts?.exists) {
      return incompleteReport("SOURCE_SCHEMA_UNAVAILABLE", startedAt, {
        contactsExists: Boolean(schema?.contacts?.exists),
        crmContactsExists: Boolean(schema?.crm_contacts?.exists)
      });
    }
    const [contactsCount, crmContactsCount] = await Promise.all([
      reader.countContacts(),
      reader.countCrmContacts()
    ]);
    const sourceCounts = {
      contacts: Number(contactsCount || 0),
      crm_contacts: Number(crmContactsCount || 0)
    };
    const total = sourceCounts.contacts + sourceCounts.crm_contacts;
    if (total > limits.maxRecords) {
      return incompleteReport("SOURCE_RECORD_LIMIT_EXCEEDED", startedAt, {
        observed: total,
        limit: limits.maxRecords
      });
    }
    const [contactRows, crmContactRows] = await Promise.all([
      readSource(reader, "contacts", sourceCounts.contacts, limits.pageSize, metrics),
      readSource(reader, "crm_contacts", sourceCounts.crm_contacts, limits.pageSize, metrics)
    ]);
    if (
      contactRows.length !== sourceCounts.contacts
      || crmContactRows.length !== sourceCounts.crm_contacts
    ) {
      return incompleteReport("SOURCE_COUNT_CHANGED_DURING_READ", startedAt, {
        expected: total,
        observed: contactRows.length + crmContactRows.length
      });
    }
    const records = [
      ...contactRows.map((row) => buildSourceRecord("contacts", row)),
      ...crmContactRows.map((row) => buildSourceRecord("crm_contacts", row))
    ];
    metrics.approximateMemoryBytes = Buffer.byteLength(stableStringify(records), "utf8");
    if (metrics.approximateMemoryBytes > limits.maxApproxMemoryBytes) {
      return incompleteReport("APPROX_MEMORY_LIMIT_EXCEEDED", startedAt, {
        observed: metrics.approximateMemoryBytes,
        limit: limits.maxApproxMemoryBytes
      });
    }
    const graph = buildCandidateGraph(records, { maxClusterSize: limits.maxClusterSize });
    metrics.comparisons = graph.comparisons;
    metrics.operations = records.length + graph.comparisons;
    if (graph.oversizedBuckets.length) {
      return incompleteReport("CLUSTER_SIZE_LIMIT_EXCEEDED", startedAt, {
        buckets: graph.oversizedBuckets.map((bucket) => ({ ...bucket })),
        limit: limits.maxClusterSize
      });
    }
    if (metrics.operations > limits.maxOperations) {
      return incompleteReport("OPERATION_LIMIT_EXCEEDED", startedAt, {
        observed: metrics.operations,
        limit: limits.maxOperations
      });
    }
    const candidates = buildCandidateClusters(records, graph);
    const oversizedCandidate = candidates.find((candidate) => (
      candidate.recordIndexes.length > limits.maxClusterSize
    ));
    if (oversizedCandidate) {
      return incompleteReport("CLUSTER_SIZE_LIMIT_EXCEEDED", startedAt, {
        observed: oversizedCandidate.recordIndexes.length,
        limit: limits.maxClusterSize
      });
    }
    const detection = detectCustomerMasterConflicts(records, graph, candidates, options.conflictOptions);
    const conflicts = detection.conflicts;
    metrics.operations += candidates.length
      + conflicts.reduce((total, conflict) => total + conflict.participants.length, 0);
    if (metrics.operations > limits.maxOperations) {
      return incompleteReport("OPERATION_LIMIT_EXCEEDED", startedAt, {
        observed: metrics.operations,
        limit: limits.maxOperations
      });
    }
    if (conflicts.length > limits.maxConflicts) {
      return incompleteReport("CONFLICT_LIMIT_EXCEEDED", startedAt, {
        observed: conflicts.length,
        limit: limits.maxConflicts
      });
    }
    const oversizedEvidence = conflicts.find((conflict) => (
      Buffer.byteLength(stableStringify(conflict.evidence), "utf8") > limits.maxEvidenceBytes
    ));
    if (oversizedEvidence) {
      return incompleteReport("CONFLICT_EVIDENCE_LIMIT_EXCEEDED", startedAt, {
        conflictType: oversizedEvidence.type,
        limit: limits.maxEvidenceBytes
      });
    }
    simulateEligibility(records, candidates, conflicts);
    const counts = buildCounts(
      records,
      candidates,
      conflicts,
      sourceCounts,
      metrics.pages
    );
    const fingerprint = buildDryRunFingerprint({
      codeVersion: String(options.codeVersion || "LOCAL_UNCOMMITTED"),
      normalizationVersion: NORMALIZATION_VERSION,
      candidateRuleVersion: CANDIDATE_RULE_VERSION,
      conflictRuleVersion: CONFLICT_RULE_VERSION,
      eligibilityRuleVersion: ELIGIBILITY_RULE_VERSION,
      sources: records,
      candidates,
      conflicts,
      counts
    });
    const report = {
      reportVersion: REPORT_VERSION,
      serviceVersion: DRY_RUN_SERVICE_VERSION,
      mode: "DRY_RUN",
      status: "COMPLETE",
      codeVersion: String(options.codeVersion || "LOCAL_UNCOMMITTED"),
      versions: {
        normalization: NORMALIZATION_VERSION,
        candidates: CANDIDATE_RULE_VERSION,
        conflicts: CONFLICT_RULE_VERSION,
        eligibility: ELIGIBILITY_RULE_VERSION,
        fingerprint: FINGERPRINT_VERSION
      },
      sources: {
        tables: ["contacts", "crm_contacts"],
        ordering: "VALID_UPDATED_AT_ASC_THEN_SOURCE_ID_TEXT_ASC_INVALID_TIMESTAMPS_LAST",
        counts: sourceCounts,
        softDelete: { contacts: "deleted_at", crm_contacts: null }
      },
      counts,
      candidates: candidates.map((candidate) => sanitizeCandidate(candidate, records)),
      conflicts: conflicts.map(sanitizeConflict),
      warnings: Array.from(new Set([
        "DRY_RUN_ONLY_NO_WRITE_PATH_EXISTS",
        "PHONE_OWNERSHIP_AND_RECYCLED_PHONE_ARE_NOT_VERIFIED",
        ...detection.warnings,
        ...records.flatMap((record) => record.warnings)
      ])).sort(),
      errors: [],
      fingerprint,
      performance: {
        durationMs: Date.now() - startedAt,
        approximateMemoryBytes: metrics.approximateMemoryBytes,
        pages: { ...metrics.pages },
        comparisons: metrics.comparisons,
        operations: metrics.operations
      }
    };
    if (options.legacySummary) {
      report.legacyComparison = compareDryRunWithLegacy(report, options.legacySummary);
    }
    return report;
  } catch (error) {
    return incompleteReport(safeErrorCode(error), startedAt);
  }
}

module.exports = {
  DRY_RUN_SERVICE_VERSION,
  ELIGIBILITY_RULE_VERSION,
  DEFAULT_LIMITS,
  normalizeLimits,
  simulateEligibility,
  runCustomerMasterBackfillDryRun
};
