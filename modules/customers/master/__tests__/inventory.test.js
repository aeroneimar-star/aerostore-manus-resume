"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OFFICIAL_MASTER_SOURCES,
  EXPECTED_SCHEMA,
  SOURCE_CLASSIFICATION,
  ROUTE_SURFACES,
  assertExpectedCustomerSchema,
  buildCustomerSourceInventory
} = require("../customerSourceInventory");

const dbPath = path.resolve(__dirname, "../../../../db.js");
const dbSource = fs.readFileSync(dbPath, "utf8");

test("only contacts and crm_contacts are official identity sources", () => {
  assert.deepEqual(OFFICIAL_MASTER_SOURCES, ["contacts", "crm_contacts"]);
  assert.deepEqual(SOURCE_CLASSIFICATION.official.sources, OFFICIAL_MASTER_SOURCES);
  assert.equal(
    SOURCE_CLASSIFICATION.auxiliary.every((source) => /never|not an identity authority|no propagation/i.test(source.policy)),
    true
  );
});

test("executable inventory fails on customer schema drift", () => {
  const schemas = assertExpectedCustomerSchema(dbSource);
  assert.deepEqual(schemas.map((schema) => schema.table), OFFICIAL_MASTER_SOURCES);
  for (const schema of schemas) {
    assert.equal(schema.primaryKey, EXPECTED_SCHEMA[schema.table].primaryKey);
    assert.deepEqual(
      schema.columns.map((column) => column.name),
      EXPECTED_SCHEMA[schema.table].columns
    );
    assert.deepEqual(
      schema.indexes.map((index) => index.name),
      EXPECTED_SCHEMA[schema.table].indexes
    );
    assert.equal(schema.indexes.some((index) => index.unique), false);
  }
});

test("inventory records frozen phase decisions without enabling integration", () => {
  const inventory = buildCustomerSourceInventory(dbSource);
  assert.equal(inventory.generatedFrom.includes("no database connection"), true);
  assert.equal(inventory.decisions.currentUnifiedServiceIsTruth, false);
  assert.equal(inventory.decisions.shadowReadOnly, true);
  assert.equal(inventory.decisions.propagationEnabled, false);
  assert.equal(inventory.decisions.primaryAddressDefined, false);
  assert.equal(inventory.decisions.cpfUniqueIndexNow, false);
  assert.equal(inventory.decisions.retentionPolicy, "pending legal definition");
  assert.deepEqual(inventory.routeSurfaces, ROUTE_SURFACES);
  assert.equal(inventory.routeSurfaces.some((surface) => /3\.1-a/i.test(surface.route)), false);
});

test("inventory parser detects a synthetic drift", () => {
  const drifted = dbSource.replace(
    /(CREATE TABLE IF NOT EXISTS contacts \([\s\S]*?updated_at TEXT NOT NULL)(\r?\n\s*\)\r?\n\s*`)/,
    "$1,\n      unexpected_identity_column TEXT DEFAULT ''$2"
  );
  assert.notEqual(drifted, dbSource);
  assert.throws(() => assertExpectedCustomerSchema(drifted), /contacts: column drift/);
});
