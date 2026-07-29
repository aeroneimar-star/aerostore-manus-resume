"use strict";

const {
  createCustomerMasterReadRepository
} = require("../persistence/customerMasterReadRepository");
const {
  toMasterDto,
  toSourceDto,
  toIdentifierDto,
  toConflictDto
} = require("../dto/customerMasterDto");

const OPEN_CONFLICT_STATUSES = new Set(["OPEN", "UNDER_REVIEW", "REOPENED"]);
const ACCESS_DECISION = "NOT_AVAILABLE_IN_PHASE_3_1_C";

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildObservableEligibility(master, sources = [], conflicts = []) {
  const activeSources = sources.filter((source) => !source.revokedAt && source.status !== "REVOKED");
  const openConflicts = conflicts.filter((conflict) => OPEN_CONFLICT_STATUSES.has(conflict.status));
  const reasons = [...(master?.eligibilityReasons || [])];
  const warnings = [];
  let observableStatus = "REVIEW_REQUIRED";

  if (!master) {
    reasons.push("MASTER_NOT_FOUND");
    observableStatus = "NOT_AVAILABLE";
  } else if (master.deletedAt) {
    reasons.push("MASTER_SOFT_DELETED");
    observableStatus = "BLOCKED_SOFT_DELETED";
  } else if (openConflicts.length) {
    reasons.push("OPEN_IDENTITY_CONFLICT");
    warnings.push("OPEN_IDENTITY_CONFLICT_REQUIRES_ADMIN_REVIEW");
    observableStatus = "REVIEW_REQUIRED";
  } else if (!master.eligibilityStatus || master.eligibilityStatus === "NOT_EVALUATED") {
    reasons.push("ELIGIBILITY_NOT_EVALUATED");
    observableStatus = "NOT_EVALUATED";
  } else {
    warnings.push("STORED_ELIGIBILITY_IS_OBSERVATIONAL_ONLY");
    observableStatus = "STORED_STATUS_UNVERIFIED";
  }

  if (!activeSources.length) warnings.push("NO_ACTIVE_SOURCE_LINK");
  return {
    storedStatus: master?.eligibilityStatus || "NOT_EVALUATED",
    observableStatus,
    reasons: uniqueStrings(reasons),
    warnings: uniqueStrings(warnings),
    activeSourceCount: activeSources.length,
    openConflictCount: openConflicts.length,
    accessDecision: ACCESS_DECISION
  };
}

function createCustomerMasterReadService({ dbApi, repository } = {}) {
  const readRepository = repository || createCustomerMasterReadRepository(dbApi);
  const requiredMethods = [
    "getMasterById",
    "listMasters",
    "listSourcesByMasterId",
    "listIdentifiersByMasterId",
    "listConflictsByMasterId",
    "findMastersByIdentifierHash",
    "findMasterBySource"
  ];
  if (!readRepository || requiredMethods.some((method) => typeof readRepository[method] !== "function")) {
    throw new Error("CUSTOMER_MASTER_READ_REPOSITORY_REQUIRED");
  }

  async function getMasterById(masterId) {
    const row = await readRepository.getMasterById(masterId);
    return row ? toMasterDto(row).dto : null;
  }

  async function listMasters(options = {}) {
    const result = await readRepository.listMasters(options);
    const mapped = result.rows.map(toMasterDto);
    return {
      items: mapped.map((item) => item.dto),
      pagination: result.pagination,
      warnings: uniqueStrings(mapped.flatMap((item) => item.warnings))
    };
  }

  async function listSourcesByMasterId(masterId) {
    const rows = await readRepository.listSourcesByMasterId(masterId);
    return rows.map(toSourceDto);
  }

  async function listIdentifiersByMasterId(masterId) {
    const rows = await readRepository.listIdentifiersByMasterId(masterId);
    return rows.map(toIdentifierDto);
  }

  async function listConflictsByMasterId(masterId) {
    const rows = await readRepository.listConflictsByMasterId(masterId);
    const mapped = rows.map(toConflictDto);
    return {
      items: mapped.map((item) => item.dto),
      warnings: uniqueStrings(mapped.flatMap((item) => item.warnings))
    };
  }

  async function getCustomerMasterView(masterId) {
    const row = await readRepository.getMasterById(masterId);
    if (!row) return null;

    const [sourceRows, identifierRows, conflictRows] = await Promise.all([
      readRepository.listSourcesByMasterId(masterId),
      readRepository.listIdentifiersByMasterId(masterId),
      readRepository.listConflictsByMasterId(masterId)
    ]);
    const masterResult = toMasterDto(row);
    const sources = sourceRows.map(toSourceDto);
    const identifiers = identifierRows.map(toIdentifierDto);
    const conflictResults = conflictRows.map(toConflictDto);
    const conflicts = conflictResults.map((item) => item.dto);
    const warnings = uniqueStrings([
      ...masterResult.warnings,
      ...conflictResults.flatMap((item) => item.warnings)
    ]);

    return {
      master: masterResult.dto,
      sources,
      identifiers,
      conflicts,
      eligibility: buildObservableEligibility(masterResult.dto, sources, conflicts),
      addressObservation: {
        available: false,
        sourceTypes: [],
        reason: "ADDRESS_NOT_STORED_IN_MASTER_SCHEMA_V1"
      },
      warnings
    };
  }

  async function findMastersByIdentifierHash(identifierType, lookupHash) {
    const rows = await readRepository.findMastersByIdentifierHash(identifierType, lookupHash);
    const items = rows.map((row) => toMasterDto(row).dto);
    return {
      items,
      matchCount: items.length,
      ambiguity: items.length > 1 ? "MULTIPLE_MASTER_CANDIDATES" : "NONE",
      accessDecision: ACCESS_DECISION
    };
  }

  async function findMasterBySource(sourceType, sourceId) {
    const row = await readRepository.findMasterBySource(sourceType, sourceId);
    if (!row) return null;
    return {
      master: toMasterDto(row).dto,
      source: toSourceDto(row),
      revoked: Boolean(row.linked_source_revoked_at) || row.linked_source_status === "REVOKED"
    };
  }

  async function getObservableEligibility(masterId) {
    const view = await getCustomerMasterView(masterId);
    return view
      ? view.eligibility
      : buildObservableEligibility(null, [], []);
  }

  return Object.freeze({
    getMasterById,
    listMasters,
    listSourcesByMasterId,
    listIdentifiersByMasterId,
    listConflictsByMasterId,
    getCustomerMasterView,
    findMastersByIdentifierHash,
    findMasterBySource,
    getObservableEligibility
  });
}

module.exports = {
  ACCESS_DECISION,
  OPEN_CONFLICT_STATUSES,
  buildObservableEligibility,
  createCustomerMasterReadService
};
