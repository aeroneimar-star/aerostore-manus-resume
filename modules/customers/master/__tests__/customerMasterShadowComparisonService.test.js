"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SHADOW_COMPARISON_VERSION,
  CLASSIFICATIONS,
  adaptLegacyUnifiedCustomer,
  compareCustomerShadow
} = require("../services/customerMasterShadowComparisonService");

function buildMasterView(overrides = {}) {
  return {
    master: {
      id: "master-synthetic",
      displayName: "Synthetic Customer",
      status: "ACTIVE",
      eligibilityStatus: "NOT_EVALUATED"
    },
    sources: [
      { id: "source-b", sourceType: "crm_contacts" },
      { id: "source-a", sourceType: "contacts" }
    ],
    identifiers: [
      { id: "email", type: "EMAIL", maskedValue: "s***@example.invalid", isActive: true, revokedAt: null },
      { id: "phone", type: "PHONE", maskedValue: "*********0001", isActive: true, revokedAt: null },
      { id: "cpf", type: "CPF", maskedValue: "***.***.***-09", isActive: true, revokedAt: null }
    ],
    conflicts: [],
    eligibility: {
      observableStatus: "NOT_EVALUATED",
      accessDecision: "NOT_AVAILABLE_IN_PHASE_3_1_C"
    },
    addressObservation: {
      available: true,
      sourceTypes: ["contacts"]
    },
    ...overrides
  };
}

function buildLegacy(overrides = {}) {
  return {
    unified_id: "U00000001",
    name: "Synthetic Customer",
    phone_masked: "*********0001",
    document_masked: "***.***.***-09",
    email_masked: "s***@example.invalid",
    source_count: 2,
    identifier_count: 3,
    conflict: false,
    status: "ACTIVE",
    observableEligibility: "NOT_EVALUATED",
    addressPresent: true,
    addressSourceTypes: ["contacts"],
    ...overrides
  };
}

test("matching synthetic views produce a deterministic MATCH without exposing values", () => {
  const master = buildMasterView();
  const legacy = buildLegacy();
  const first = compareCustomerShadow(master, legacy);
  const second = compareCustomerShadow(master, legacy);
  assert.deepEqual(second, first);
  assert.equal(first.version, SHADOW_COMPARISON_VERSION);
  assert.equal(first.summary, CLASSIFICATIONS.MATCH);
  assert.deepEqual(first.differences, []);
  assert.equal(first.warnings.includes("LEGACY_UNIFIED_ID_IS_NOT_STABLE_MASTER_ID"), true);
  assert.equal(JSON.stringify(first).includes("synthetic-phone"), false);
});

test("differences are observable, field-only and never become a merge decision", () => {
  const result = compareCustomerShadow(
    buildMasterView(),
    buildLegacy({
      name: "Synthetic Different",
      phone_masked: "*********9999",
      source_count: 1,
      conflict: true,
      status: "INACTIVE"
    })
  );
  assert.equal(result.summary, CLASSIFICATIONS.DIFFERENT);
  assert.equal(result.differences.some((item) => item.field === "displayName"), true);
  assert.equal(result.differences.some((item) => item.field === "phoneMasked"), true);
  assert.equal(result.differences.some((item) => item.field === "sourceCount"), true);
  assert.doesNotMatch(JSON.stringify(result), /mergeDecision|masterIdToCreate|canAccessApp/i);
});

test("multiple identifier matches remain ambiguous", () => {
  const master = buildMasterView();
  master.identifiers.push({
    id: "phone-two",
    type: "PHONE",
    maskedValue: "*********0002",
    isActive: true,
    revokedAt: null
  });
  const result = compareCustomerShadow(master, buildLegacy());
  assert.equal(result.summary, CLASSIFICATIONS.AMBIGUOUS);
  assert.equal(
    result.differences.find((item) => item.field === "phoneMasked").classification,
    CLASSIFICATIONS.AMBIGUOUS
  );
});

test("missing and invalid inputs are never converted into a match", () => {
  assert.equal(
    compareCustomerShadow(null, buildLegacy()).summary,
    CLASSIFICATIONS.MISSING_IN_MASTER
  );
  assert.equal(
    compareCustomerShadow(buildMasterView(), null).summary,
    CLASSIFICATIONS.MISSING_IN_LEGACY
  );
  assert.equal(
    compareCustomerShadow(null, null).summary,
    CLASSIFICATIONS.INVALID_INPUT
  );
  const circular = {};
  circular.self = circular;
  assert.equal(
    compareCustomerShadow(circular, null).summary,
    CLASSIFICATIONS.INVALID_INPUT
  );
});

test("source and identifier order do not change semantic comparison", () => {
  const master = buildMasterView();
  const reversed = buildMasterView({
    sources: [...master.sources].reverse(),
    identifiers: [...master.identifiers].reverse()
  });
  assert.deepEqual(
    compareCustomerShadow(reversed, buildLegacy()),
    compareCustomerShadow(master, buildLegacy())
  );
});

test("comparison does not mutate either input", () => {
  const master = buildMasterView();
  const legacy = buildLegacy();
  const masterBefore = JSON.parse(JSON.stringify(master));
  const legacyBefore = JSON.parse(JSON.stringify(legacy));
  compareCustomerShadow(master, legacy);
  assert.deepEqual(master, masterBefore);
  assert.deepEqual(legacy, legacyBefore);
});

test("unavailable eligibility and address remain unsafe to compare", () => {
  const master = buildMasterView({
    addressObservation: {
      available: false,
      sourceTypes: [],
      reason: "ADDRESS_NOT_STORED_IN_MASTER_SCHEMA_V1"
    }
  });
  const legacy = buildLegacy();
  delete legacy.observableEligibility;
  const result = compareCustomerShadow(master, legacy);
  assert.equal(
    result.differences.some((item) => item.classification === CLASSIFICATIONS.UNSAFE_TO_COMPARE),
    true
  );
  assert.equal(result.warnings.includes("ADDRESS_COMPARISON_NOT_AVAILABLE"), true);
});

test("legacy adapter uses only public masked fields and ignores raw sentinels", () => {
  const adapted = adaptLegacyUnifiedCustomer({
    ...buildLegacy(),
    phone: "UNSAFE_RAW_PHONE_SENTINEL",
    document: "UNSAFE_RAW_DOCUMENT_SENTINEL",
    email: "UNSAFE_RAW_EMAIL_SENTINEL",
    address: "UNSAFE_RAW_ADDRESS_SENTINEL"
  });
  const serialized = JSON.stringify(adapted);
  assert.equal(serialized.includes("UNSAFE_RAW_PHONE_SENTINEL"), false);
  assert.equal(serialized.includes("UNSAFE_RAW_DOCUMENT_SENTINEL"), false);
  assert.equal(serialized.includes("UNSAFE_RAW_EMAIL_SENTINEL"), false);
  assert.equal(serialized.includes("UNSAFE_RAW_ADDRESS_SENTINEL"), false);
  assert.equal(adapted.addressObservation.available, true);
});
