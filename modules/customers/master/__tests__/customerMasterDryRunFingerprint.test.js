"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  runCustomerMasterBackfillDryRun
} = require("../backfill/customerMasterDryRunService");
const {
  buildDryRunFingerprint
} = require("../backfill/customerMasterDryRunFingerprint");
const {
  buildSourceRecord
} = require("../backfill/customerMasterSourceModel");
const {
  compareDryRunWithLegacy
} = require("../backfill/customerMasterDryRunComparison");
const {
  rawContact,
  createArrayReader
} = require("./customerMasterDryRunTestUtils");

test("fingerprint ignores execution time, path and input order but changes with normalized source data", async () => {
  const firstRows = [
    rawContact(2, { updated_at: "2026-01-02T00:00:00.000Z" }),
    rawContact(1, { updated_at: "2026-01-01T00:00:00.000Z" })
  ];
  const first = await runCustomerMasterBackfillDryRun(createArrayReader(firstRows), {
    codeVersion: "synthetic-code-v1",
    executionPath: "C:\\synthetic\\first",
    executionTimestamp: "2026-01-01T00:00:00.000Z"
  });
  const second = await runCustomerMasterBackfillDryRun(createArrayReader([...firstRows].reverse()), {
    codeVersion: "synthetic-code-v1",
    executionPath: "D:\\synthetic\\second",
    executionTimestamp: "2030-01-01T00:00:00.000Z"
  });
  const changed = await runCustomerMasterBackfillDryRun(createArrayReader([
    firstRows[0],
    { ...firstRows[1], phone: "11999999999" }
  ]), {
    codeVersion: "synthetic-code-v1"
  });

  assert.equal(first.status, "COMPLETE");
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(second.fingerprint, first.fingerprint);
  assert.notEqual(changed.fingerprint, first.fingerprint);
});

test("fingerprint includes semantic versions and sanitized decisions, not runtime performance", async () => {
  const reader = createArrayReader([rawContact(1)]);
  const v1 = await runCustomerMasterBackfillDryRun(reader, { codeVersion: "code-v1" });
  const v2 = await runCustomerMasterBackfillDryRun(reader, { codeVersion: "code-v2" });
  assert.notEqual(v1.fingerprint, v2.fingerprint);
  assert.equal(typeof v1.performance.durationMs, "number");
  assert.equal(JSON.stringify(v1).includes("executionTimestamp"), false);
});

test("fingerprint uses aggregate conflict totals and ignores sample contents and order", () => {
  const input = {
    codeVersion: "aggregate-conflicts-v1",
    normalizationVersion: "normalization-v1",
    candidateRuleVersion: "candidates-v1",
    conflictRuleVersion: "conflicts-v1",
    eligibilityRuleVersion: "eligibility-v1",
    sources: [],
    candidates: [],
    counts: { sourceRows: 0 },
    conflictSummary: {
      totalConflicts: 3,
      conflictCountsByType: { PHONE_SHARED: 1, PHONE_DUPLICATE: 2 },
      conflictCountsBySeverity: { CRITICAL: 1, HIGH: 2 },
      blockingConflictCount: 3,
      sampledConflicts: [{ type: "PHONE_SHARED" }]
    }
  };
  const sameAggregatesDifferentSample = {
    ...input,
    conflictSummary: {
      ...input.conflictSummary,
      sampledConflicts: [{ type: "PHONE_DUPLICATE" }, { type: "PHONE_SHARED" }]
    }
  };
  const changedTotal = {
    ...input,
    conflictSummary: {
      ...input.conflictSummary,
      totalConflicts: 4,
      conflictCountsByType: { PHONE_SHARED: 2, PHONE_DUPLICATE: 2 },
      blockingConflictCount: 4
    }
  };

  assert.equal(
    buildDryRunFingerprint(sameAggregatesDifferentSample),
    buildDryRunFingerprint(input)
  );
  assert.notEqual(buildDryRunFingerprint(changedTotal), buildDryRunFingerprint(input));
});

test("source hash is stable, normalized and changes only for relevant modeled data", () => {
  const row = rawContact(1, { phone: "+55 (11) 90000-0001" });
  const formatted = buildSourceRecord("contacts", row);
  const equivalent = buildSourceRecord("contacts", {
    ...row,
    phone: "11900000001",
    source_row: "irrelevant-import-detail"
  });
  const changed = buildSourceRecord("contacts", {
    ...row,
    phone: "11900000002"
  });
  assert.equal(equivalent.sourceHash, formatted.sourceHash);
  assert.notEqual(changed.sourceHash, formatted.sourceHash);
  assert.match(formatted.sourceHash, /^[a-f0-9]{64}$/);
});

test("legacy comparison classifications remain diagnostic and cover invalid, unsafe, over and under merge", () => {
  const report = {
    mode: "DRY_RUN",
    counts: {
      candidateGroups: 2,
      conflicts: 0,
      reviewRequired: 0,
      blockingConflicts: 0
    },
    candidates: []
  };
  assert.equal(compareDryRunWithLegacy(null, null).classification, "INVALID_INPUT");
  assert.equal(compareDryRunWithLegacy(report, {}).classification, "UNSAFE_TO_COMPARE");
  assert.equal(
    compareDryRunWithLegacy(report, { groupCount: 1, conflictCount: 0 }).classification,
    "LEGACY_OVERMERGE_RISK"
  );
  assert.equal(
    compareDryRunWithLegacy(report, { groupCount: 3, conflictCount: 0 }).classification,
    "LEGACY_UNDERMERGE_RISK"
  );
  assert.equal(
    compareDryRunWithLegacy({
      ...report,
      counts: { ...report.counts, blockingConflicts: 1 }
    }, {
      groupCount: 2,
      conflictCount: 0
    }).classification,
    "MASTER_REVIEW_REQUIRED"
  );
});
