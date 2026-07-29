"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SYNTHETIC_TOTAL,
  SYNTHETIC_CONTACTS,
  SYNTHETIC_CRM_CONTACTS,
  deterministicCpf,
  buildRepresentativeDataset,
  buildStressDataset,
  runSyntheticCalibration
} = require("../calibration/customerMasterSynthetic59143");
const {
  isValidCpf
} = require("../normalization");
const {
  SYNTHETIC_59143_LIMIT_PROFILE,
  SYNTHETIC_59143_LIMITS,
  resolveCalibrationLimits
} = require("../calibration/customerMasterCalibrationLimits");
const {
  parseArgs: parseRealCalibrationArgs
} = require("../../../../scripts/customer-master-real-readonly-calibration");

test("59k calibration limits are explicit and do not change general defaults", () => {
  const calibrated = resolveCalibrationLimits(SYNTHETIC_59143_LIMIT_PROFILE);
  const defaults = resolveCalibrationLimits();
  assert.deepEqual(calibrated, SYNTHETIC_59143_LIMITS);
  assert.equal(calibrated.maxRecords, 59143);
  assert.equal(calibrated.maxConflicts, 5000);
  assert.equal(calibrated.maxApproxMemoryBytes, 128 * 1024 * 1024);
  assert.equal(defaults.maxRecords, 5000);
  assert.throws(
    () => resolveCalibrationLimits("unknown"),
    /CUSTOMER_MASTER_CALIBRATION_LIMIT_PROFILE_INVALID/
  );
  assert.equal(
    parseRealCalibrationArgs([
      "--database", "synthetic.db",
      "--allowed-root", ".",
      "--limit-profile", SYNTHETIC_59143_LIMIT_PROFILE,
      "--read-only"
    ])["limit-profile"],
    SYNTHETIC_59143_LIMIT_PROFILE
  );
});

test("59k synthetic contract preserves the aggregate real-source proportions", () => {
  assert.equal(SYNTHETIC_CONTACTS + SYNTHETIC_CRM_CONTACTS, SYNTHETIC_TOTAL);
  assert.equal(SYNTHETIC_TOTAL, 59143);
  const dataset = buildRepresentativeDataset();
  assert.equal(dataset.contacts.length, 36502);
  assert.equal(dataset.crmContacts.length, 22641);
});

test("representative generator is deterministic and contains no real PII", () => {
  const first = buildRepresentativeDataset({
    contactsCount: 12,
    crmContactsCount: 8,
    pairCount: 3
  });
  const second = buildRepresentativeDataset({
    contactsCount: 12,
    crmContactsCount: 8,
    pairCount: 3
  });
  assert.deepEqual(first, second);
  assert.equal(isValidCpf(deterministicCpf(1)), true);
  assert.equal(first.contacts[0].document, first.crmContacts[0].document);
  assert.match(JSON.stringify(first), /Synthetic Customer/);
  assert.doesNotMatch(JSON.stringify(first), /@(?!(?:example\.invalid))/);
});

test("representative synthetic calibration completes deterministically at reduced scale", async () => {
  const options = {
    scenario: "representative",
    dataset: { contactsCount: 120, crmContactsCount: 80, pairCount: 10 },
    limits: {
      maxRecords: 200,
      maxApproxMemoryBytes: 20 * 1024 * 1024
    }
  };
  const first = await runSyntheticCalibration(options);
  const second = await runSyntheticCalibration(options);
  assert.equal(first.status, "COMPLETE");
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.volume.total, 200);
  assert.equal(first.candidates.safe, 0);
  assert.equal(first.candidates.conflicting, 72);
  assert.equal(first.candidates.isolated, 118);
});

test("single stress scenario proves the oversized bucket guard before pair explosion", async () => {
  const dataset = buildStressDataset({
    contactsCount: 60,
    crmContactsCount: 10,
    pairCount: 0,
    bucketSize: 51
  });
  assert.equal(new Set(dataset.contacts.slice(0, 51).map((row) => row.document)).size, 1);
  const result = await runSyntheticCalibration({
    scenario: "stress",
    dataset: {
      contactsCount: 60,
      crmContactsCount: 10,
      pairCount: 0,
      bucketSize: 51
    },
    limits: {
      maxRecords: 70,
      maxApproxMemoryBytes: 20 * 1024 * 1024
    }
  });
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.errorCode, "CLUSTER_SIZE_LIMIT_EXCEEDED");
  assert.equal(result.fingerprint, null);
  assert.equal(result.clusters.largest, 51);
  assert.deepEqual(result.clusters.oversizedBuckets, [{ type: "CPF", size: 51 }]);
});
