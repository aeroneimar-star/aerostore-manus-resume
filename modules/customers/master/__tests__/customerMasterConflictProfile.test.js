"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROFILE_VERSION,
  buildCustomerMasterConflictProfile,
  parseBlocking,
  classifyPrimary
} = require("../analysis/customerMasterConflictProfile");
const {
  assertSanitizedOutput
} = require("../../../../scripts/customer-master-conflict-profile");

function evidence(blocking, participantCount) {
  return JSON.stringify({
    identifierType: null,
    maskedValues: [],
    participantCount,
    sourceTypes: ["contacts"],
    reasonCodes: [],
    blocking
  });
}

function fixture() {
  const sourceLinks = [
    { id: "cms:a", master_id: "cmr:1", source_type: "contacts", status: "ACTIVE" },
    { id: "cms:b", master_id: "cmr:1", source_type: "crm_contacts", status: "ACTIVE" },
    { id: "cms:c", master_id: "cmr:2", source_type: "contacts", status: "ACTIVE" },
    { id: "cms:d", master_id: "cmr:3", source_type: "contacts", status: "DELETED" },
    { id: "cms:e", master_id: "cmr:4", source_type: "contacts", status: "INACTIVE" }
  ];
  const conflicts = [
    { id: "cic:1", conflict_type: "DELETED_SOURCE", severity: "HIGH", status: "OPEN", evidence_json: evidence(true, 1) },
    { id: "cic:2", conflict_type: "DELETED_SOURCE", severity: "HIGH", status: "OPEN", evidence_json: evidence(true, 1) },
    { id: "cic:3", conflict_type: "INACTIVE_SOURCE", severity: "HIGH", status: "OPEN", evidence_json: evidence(true, 1) },
    { id: "cic:4", conflict_type: "PHONE_DUPLICATE", severity: "HIGH", status: "OPEN", evidence_json: evidence(true, 2) },
    { id: "cic:5", conflict_type: "PHONE_DUPLICATE", severity: "HIGH", status: "OPEN", evidence_json: evidence(true, 2) },
    { id: "cic:6", conflict_type: "PHONE_MISMATCH", severity: "HIGH", status: "OPEN", evidence_json: evidence(true, 2) },
    { id: "cic:7", conflict_type: "CPF_DUPLICATE", severity: "MEDIUM", status: "OPEN", evidence_json: evidence(false, 2) },
    { id: "cic:8", conflict_type: "MANUAL_REVIEW_REQUIRED", severity: "MEDIUM", status: "OPEN", evidence_json: evidence(false, 1) },
    { id: "cic:9", conflict_type: "EMAIL_DUPLICATE", severity: "LOW", status: "OPEN", evidence_json: "{}" }
  ];
  const participants = [
    { conflict_id: "cic:1", participant_type: "SOURCE", participant_id: "cms:d" },
    { conflict_id: "cic:2", participant_type: "SOURCE", participant_id: "cms:d" },
    { conflict_id: "cic:3", participant_type: "SOURCE", participant_id: "cms:e" },
    { conflict_id: "cic:4", participant_type: "SOURCE", participant_id: "cms:a" },
    { conflict_id: "cic:4", participant_type: "SOURCE", participant_id: "cms:b" },
    { conflict_id: "cic:5", participant_type: "SOURCE", participant_id: "cms:a" },
    { conflict_id: "cic:5", participant_type: "SOURCE", participant_id: "cms:c" },
    { conflict_id: "cic:6", participant_type: "SOURCE", participant_id: "cms:a" },
    { conflict_id: "cic:6", participant_type: "SOURCE", participant_id: "cms:b" },
    { conflict_id: "cic:7", participant_type: "SOURCE", participant_id: "cms:a" },
    { conflict_id: "cic:7", participant_type: "SOURCE", participant_id: "cms:c" },
    { conflict_id: "cic:8", participant_type: "SOURCE", participant_id: "cms:c" }
  ];
  return { conflicts, participants, sourceLinks };
}

test("profile aggregates by type, status, severity and blocking", () => {
  const profile = buildCustomerMasterConflictProfile(fixture());
  assert.equal(profile.profileVersion, PROFILE_VERSION);
  assert.equal(profile.totals.conflicts, 9);
  assert.equal(profile.totals.participants, 12);
  assert.deepEqual(profile.byType, {
    DELETED_SOURCE: 2,
    PHONE_DUPLICATE: 2,
    INACTIVE_SOURCE: 1,
    PHONE_MISMATCH: 1,
    CPF_DUPLICATE: 1,
    MANUAL_REVIEW_REQUIRED: 1,
    EMAIL_DUPLICATE: 1
  });
  assert.deepEqual(profile.bySeverity, { HIGH: 6, MEDIUM: 2, LOW: 1 });
  assert.deepEqual(profile.byStatus, { OPEN: 9 });
  assert.deepEqual(profile.blocking, { blocking: 6, nonBlocking: 2, undetermined: 1 });
});

test("primary classification uses persisted fields with documented priority", () => {
  const profile = buildCustomerMasterConflictProfile(fixture());
  assert.deepEqual(profile.primaryClassification.counts, {
    HISTORICAL_EVIDENCE: 3,
    REAL_ELIGIBILITY_BLOCK: 3,
    POTENTIAL_HUMAN_DECISION: 2,
    NOT_DETERMINABLE: 1
  });
  assert.equal(classifyPrimary("DELETED_SOURCE", true), "HISTORICAL_EVIDENCE");
  assert.equal(classifyPrimary("INACTIVE_SOURCE", false), "HISTORICAL_EVIDENCE");
  assert.equal(classifyPrimary("PHONE_SHARED", true), "REAL_ELIGIBILITY_BLOCK");
  assert.equal(classifyPrimary("CPF_DUPLICATE", false), "POTENTIAL_HUMAN_DECISION");
  assert.equal(classifyPrimary("EMAIL_DUPLICATE", null), "NOT_DETERMINABLE");
  assert.equal(parseBlocking("not-json"), null);
  assert.equal(parseBlocking("{}"), null);
});

test("impact counts affected masters, sources and per-master distribution", () => {
  const profile = buildCustomerMasterConflictProfile(fixture());
  assert.equal(profile.totals.affectedSources, 5);
  assert.equal(profile.totals.affectedMasters, 4);
  assert.deepEqual(profile.masterImpact.conflictsPerMasterHistogram, { "4": 1, "3": 1, "2": 1, "1": 1 });
  assert.deepEqual(profile.masterImpact.largestGroupings, [4, 3, 2, 1]);
  assert.equal(profile.patterns.multiMasterConflicts, 2);
  assert.equal(profile.patterns.multiSourceTypeConflicts, 2);
});

test("duplication and administrative cases collapse repeated participant groups", () => {
  const profile = buildCustomerMasterConflictProfile(fixture());
  // cic:9 nao tem participantes e nao forma conjunto administrativo.
  assert.equal(profile.totals.uniqueParticipantSets, 5);
  assert.equal(profile.duplication.repeatedParticipantSets, 3);
  assert.equal(profile.duplication.conflictsInRepeatedSets, 6);
  assert.equal(profile.duplication.sameTypeSameParticipantSetDuplicates, 1);
  assert.equal(profile.administrativeCases.uniqueParticipantSets, 5);
  assert.equal(profile.administrativeCases.affectedMasters, 4);
  assert.equal(profile.administrativeCases.affectedSources, 5);
  const byClass = profile.administrativeCases.byPrimaryClass;
  assert.deepEqual(byClass, {
    HISTORICAL_EVIDENCE: 2,
    REAL_ELIGIBILITY_BLOCK: 2,
    POTENTIAL_HUMAN_DECISION: 1,
    NOT_DETERMINABLE: 0
  });
});

test("consistency flags evidence mismatches and empty conflicts", () => {
  const data = fixture();
  data.conflicts[3].evidence_json = evidence(true, 99);
  data.conflicts.push({
    id: "cic:10",
    conflict_type: "NAME_MISMATCH",
    severity: "MEDIUM",
    status: "OPEN",
    evidence_json: evidence(true, 0)
  });
  const profile = buildCustomerMasterConflictProfile(data);
  assert.equal(profile.consistency.evidenceParticipantCountMismatches, 1);
  assert.equal(profile.consistency.conflictsWithoutParticipants, 2);
});

test("sanitized output contains no hashes, ids or PII-like tokens", () => {
  const profile = buildCustomerMasterConflictProfile(fixture());
  const clean = assertSanitizedOutput(profile);
  assert.equal(clean.sanitized, true);
  assert.deepEqual(clean.findings, []);

  const poisoned = assertSanitizedOutput({
    note: "cic:9f8e7d6c " + "a".repeat(64) + " 52998224725 leak@example.com"
  });
  assert.equal(poisoned.sanitized, false);
  assert.ok(poisoned.findings.includes("SHA256_LIKE_TOKEN"));
  assert.ok(poisoned.findings.includes("MASTER_ID_PREFIX"));
  assert.ok(poisoned.findings.includes("CPF_LIKE_NUMBER"));
  assert.ok(poisoned.findings.includes("EMAIL_LIKE_TOKEN"));
});
