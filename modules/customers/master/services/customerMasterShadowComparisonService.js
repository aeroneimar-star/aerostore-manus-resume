"use strict";

const SHADOW_COMPARISON_VERSION = "customer-master-shadow-comparison/v1";
const CLASSIFICATIONS = Object.freeze({
  MATCH: "MATCH",
  DIFFERENT: "DIFFERENT",
  MISSING_IN_MASTER: "MISSING_IN_MASTER",
  MISSING_IN_LEGACY: "MISSING_IN_LEGACY",
  AMBIGUOUS: "AMBIGUOUS",
  UNSAFE_TO_COMPARE: "UNSAFE_TO_COMPARE",
  INVALID_INPUT: "INVALID_INPUT"
});

function cloneJson(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function adaptLegacyUnifiedCustomer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    id: String(value.unified_id || value.id || ""),
    displayName: String(value.name || value.displayName || ""),
    phoneMasked: String(value.phone_masked || value.phoneMasked || ""),
    documentMasked: String(value.document_masked || value.documentMasked || ""),
    emailMasked: String(value.email_masked || value.emailMasked || ""),
    sourceCount: Math.max(0, Number(value.source_count ?? value.sourceCount ?? 0) || 0),
    identifierCount: Math.max(0, Number(value.identifier_count ?? value.identifierCount ?? 0) || 0),
    conflict: Boolean(value.conflict),
    status: String(value.status || ""),
    observableEligibility: String(value.observableEligibility || ""),
    addressObservation: {
      available: Boolean(value.address || value.addressPresent),
      sourceTypes: Array.isArray(value.addressSourceTypes)
        ? Array.from(new Set(value.addressSourceTypes.map(String))).sort()
        : []
    }
  };
}

function identifierValues(masterView, type) {
  return Array.from(new Set(
    (masterView?.identifiers || [])
      .filter((identifier) => identifier.type === type && identifier.isActive && !identifier.revokedAt)
      .map((identifier) => identifier.maskedValue)
      .filter(Boolean)
  )).sort();
}

function compareScalar(field, masterValue, legacyValue) {
  const masterMissing = masterValue === null || masterValue === undefined || masterValue === "";
  const legacyMissing = legacyValue === null || legacyValue === undefined || legacyValue === "";
  if (masterMissing && legacyMissing) {
    return { field, classification: CLASSIFICATIONS.MATCH };
  }
  if (masterMissing) {
    return { field, classification: CLASSIFICATIONS.MISSING_IN_MASTER };
  }
  if (legacyMissing) {
    return { field, classification: CLASSIFICATIONS.MISSING_IN_LEGACY };
  }
  return {
    field,
    classification: masterValue === legacyValue
      ? CLASSIFICATIONS.MATCH
      : CLASSIFICATIONS.DIFFERENT
  };
}

function compareMaskedIdentifier(field, values, legacyValue) {
  if (values.length > 1) {
    return {
      field,
      classification: CLASSIFICATIONS.AMBIGUOUS,
      warning: `${field.toUpperCase()}_HAS_MULTIPLE_MASTER_VALUES`
    };
  }
  return compareScalar(field, values[0] || "", legacyValue);
}

function compareCustomerShadow(masterViewInput, legacyInput) {
  const clonedMaster = cloneJson(masterViewInput);
  const masterView = clonedMaster
    && typeof clonedMaster === "object"
    && !Array.isArray(clonedMaster)
    && clonedMaster.master
    && typeof clonedMaster.master === "object"
    ? clonedMaster
    : null;
  const legacy = adaptLegacyUnifiedCustomer(cloneJson(legacyInput));
  if (!masterView && !legacy) {
    return {
      version: SHADOW_COMPARISON_VERSION,
      summary: CLASSIFICATIONS.INVALID_INPUT,
      differences: [],
      warnings: ["MASTER_AND_LEGACY_INPUTS_ARE_INVALID"],
      comparedFields: [],
      ignoredFields: ["rawPayload", "protectedValue", "lookupHash", "canonicalIdentifiers"]
    };
  }
  if (!masterView) {
    return {
      version: SHADOW_COMPARISON_VERSION,
      summary: CLASSIFICATIONS.MISSING_IN_MASTER,
      differences: [{ field: "record", classification: CLASSIFICATIONS.MISSING_IN_MASTER }],
      warnings: [],
      comparedFields: ["presence"],
      ignoredFields: ["rawPayload", "protectedValue", "lookupHash", "canonicalIdentifiers"]
    };
  }
  if (!legacy) {
    return {
      version: SHADOW_COMPARISON_VERSION,
      summary: CLASSIFICATIONS.MISSING_IN_LEGACY,
      differences: [{ field: "record", classification: CLASSIFICATIONS.MISSING_IN_LEGACY }],
      warnings: [],
      comparedFields: ["presence"],
      ignoredFields: ["rawPayload", "protectedValue", "lookupHash", "canonicalIdentifiers"]
    };
  }

  const master = masterView.master || {};
  const phoneValues = identifierValues(masterView, "PHONE");
  const documentValues = identifierValues(masterView, "CPF");
  const emailValues = identifierValues(masterView, "EMAIL");
  const comparisons = [
    compareScalar("displayName", master.displayName, legacy.displayName),
    compareMaskedIdentifier("phoneMasked", phoneValues, legacy.phoneMasked),
    compareMaskedIdentifier("documentMasked", documentValues, legacy.documentMasked),
    compareMaskedIdentifier("emailMasked", emailValues, legacy.emailMasked),
    compareScalar("sourceCount", Number(masterView.sources?.length || 0), legacy.sourceCount),
    compareScalar("identifierCount", Number(masterView.identifiers?.length || 0), legacy.identifierCount),
    compareScalar("conflictPresence", Boolean(masterView.conflicts?.length), legacy.conflict),
    compareScalar("status", master.status, legacy.status),
    legacy.observableEligibility
      ? compareScalar(
        "observableEligibility",
        masterView.eligibility?.observableStatus || "",
        legacy.observableEligibility
      )
      : {
        field: "observableEligibility",
        classification: CLASSIFICATIONS.UNSAFE_TO_COMPARE
      }
  ];

  const address = masterView.addressObservation || { available: false, sourceTypes: [] };
  comparisons.push({
    field: "addressPresenceBySource",
    classification: address.reason === "ADDRESS_NOT_STORED_IN_MASTER_SCHEMA_V1"
      ? CLASSIFICATIONS.UNSAFE_TO_COMPARE
      : (
        Boolean(address.available) === Boolean(legacy.addressObservation.available)
          && JSON.stringify([...(address.sourceTypes || [])].sort())
            === JSON.stringify(legacy.addressObservation.sourceTypes)
          ? CLASSIFICATIONS.MATCH
          : CLASSIFICATIONS.DIFFERENT
      )
  });

  const differences = comparisons.filter((item) => item.classification !== CLASSIFICATIONS.MATCH);
  const warnings = Array.from(new Set([
    ...comparisons.map((item) => item.warning).filter(Boolean),
    differences.some((item) => item.classification === CLASSIFICATIONS.UNSAFE_TO_COMPARE)
      ? "ADDRESS_COMPARISON_NOT_AVAILABLE"
      : "",
    "LEGACY_UNIFIED_ID_IS_NOT_STABLE_MASTER_ID"
  ].filter(Boolean)));
  let summary = CLASSIFICATIONS.MATCH;
  if (differences.some((item) => item.classification === CLASSIFICATIONS.AMBIGUOUS)) {
    summary = CLASSIFICATIONS.AMBIGUOUS;
  } else if (differences.some((item) => item.classification === CLASSIFICATIONS.UNSAFE_TO_COMPARE)) {
    summary = differences.length === 1
      ? CLASSIFICATIONS.UNSAFE_TO_COMPARE
      : CLASSIFICATIONS.DIFFERENT;
  } else if (differences.length) {
    summary = CLASSIFICATIONS.DIFFERENT;
  }

  return {
    version: SHADOW_COMPARISON_VERSION,
    summary,
    differences,
    warnings,
    comparedFields: comparisons.map((item) => item.field),
    ignoredFields: [
      "rawPayload",
      "protectedValue",
      "lookupHash",
      "canonicalIdentifiers",
      "orders",
      "cashback",
      "sales",
      "appAccount"
    ]
  };
}

module.exports = {
  SHADOW_COMPARISON_VERSION,
  CLASSIFICATIONS,
  adaptLegacyUnifiedCustomer,
  compareCustomerShadow
};
