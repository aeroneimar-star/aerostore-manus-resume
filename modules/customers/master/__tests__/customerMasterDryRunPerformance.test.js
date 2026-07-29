"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  runCustomerMasterBackfillDryRun
} = require("../backfill/customerMasterDryRunService");
const {
  rawContact,
  createArrayReader
} = require("./customerMasterDryRunTestUtils");

for (const size of [0, 10, 100, 1000]) {
  test(`synthetic dry-run benchmark remains bounded for ${size} isolated rows`, async () => {
    const rows = Array.from({ length: size }, (_, index) => rawContact(index + 1));
    const started = Date.now();
    const report = await runCustomerMasterBackfillDryRun(createArrayReader(rows), {
      codeVersion: "synthetic-benchmark-v1",
      limits: {
        pageSize: 100,
        maxRecords: 1000,
        maxApproxMemoryBytes: 20 * 1024 * 1024
      }
    });
    const elapsed = Date.now() - started;
    assert.equal(report.status, "COMPLETE");
    assert.equal(report.counts.sourceRows, size);
    assert.equal(report.performance.comparisons, 0);
    assert.equal(report.performance.operations, size * 2);
    assert.equal(elapsed < 5000, true, `synthetic benchmark took ${elapsed}ms`);
  });
}

test("concentrated duplicate bucket stops at the configured cluster guard", async () => {
  const rows = Array.from({ length: 100 }, (_, index) => rawContact(index + 1, {
    phone: "11900000001"
  }));
  const report = await runCustomerMasterBackfillDryRun(createArrayReader(rows), {
    codeVersion: "synthetic-benchmark-v1",
    limits: { maxClusterSize: 50 }
  });
  assert.equal(report.status, "INCOMPLETE");
  assert.equal(report.fingerprint, null);
  assert.equal(report.errors[0].code, "CLUSTER_SIZE_LIMIT_EXCEEDED");
});
