"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createDryRunDatabase
} = require("./customerMasterDryRunTestUtils");
const {
  applyCustomerMasterSchema
} = require("../persistence/customerMasterSchema");
const {
  applyCustomerIdentityCaseSchema
} = require("../persistence/customerIdentityCaseSchema");
const {
  auditCustomerMasterIntegrity,
  CPF_PARTIAL_UNIQUE_INDEX
} = require("../hardening/customerMasterIntegrityAudit");
const {
  parseArgs
} = require("../../../../scripts/customer-master-incremental-sync");

async function createHardenedDatabase() {
  const db = await createDryRunDatabase();
  await applyCustomerIdentityCaseSchema(db);
  return db;
}

async function seedMasters(db) {
  for (const id of ["master-a", "master-b"]) {
    await db.run(
      `INSERT INTO customer_master_records
        (id, display_name, status, version, eligibility_status, eligibility_reasons_json,
         eligibility_rule_version, eligibility_source_version, created_at, updated_at)
       VALUES (?, '', 'PENDING', 1, 'NOT_EVALUATED', '[]', '', '', '2026-01-01', '2026-01-01')`,
      [id]
    );
  }
  await db.run(
    `INSERT INTO customer_master_sources
      (id, master_id, source_type, source_id, source_hash, status, created_at, updated_at)
     VALUES ('source-a', 'master-a', 'contacts', '1', 'hash-a', 'ACTIVE', '2026-01-01', '2026-01-01')`
  );
  await db.run(
    `INSERT INTO customer_master_sources
      (id, master_id, source_type, source_id, source_hash, status, created_at, updated_at)
     VALUES ('source-b', 'master-b', 'crm_contacts', '2', 'hash-b', 'ACTIVE', '2026-01-01', '2026-01-01')`
  );
}

async function insertIdentifier(db, id, masterId, sourceId, type, lookupHash) {
  return db.run(
    `INSERT INTO customer_master_identifiers
      (id, master_id, source_link_id, identifier_type, lookup_hash, masked_value,
       classification, validation_status, verification_status, is_primary, is_active,
       normalization_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '***', 'VALID', 'VALID', 'NOT_VERIFIED', 1, 1,
             'test', '2026-01-01', '2026-01-01')`,
    [id, masterId, sourceId, type, lookupHash]
  );
}

test("schema limpo e migrations existentes permanecem idempotentes", async () => {
  const db = await createHardenedDatabase();
  try {
    await applyCustomerMasterSchema(db);
    await applyCustomerIdentityCaseSchema(db);
    const audit = await auditCustomerMasterIntegrity(db);
    assert.equal(audit.status, "INTEGRITY_OK");
    assert.equal(audit.foreignKeys.masterViolations, 0);
    assert.equal(audit.foreignKeys.cascadeActions, 0);
    assert.equal(audit.missingIndexes.length, 0);
    assert.ok(Object.values(audit.constraints).every(Boolean));
    assert.equal(audit.cpfPartialUnique.status, "SAFE_NOT_APPLIED");
  } finally {
    await db.close();
  }
});

test("constraints bloqueiam duplicidade estrutural dentro do mesmo vinculo", async () => {
  const db = await createHardenedDatabase();
  try {
    await seedMasters(db);
    await assert.rejects(
      db.run(
        `INSERT INTO customer_master_sources
          (id, master_id, source_type, source_id, source_hash, status, created_at, updated_at)
         VALUES ('source-duplicate', 'master-b', 'contacts', '1', 'hash', 'ACTIVE', '2026-01-01', '2026-01-01')`
      ),
      /UNIQUE constraint failed/
    );
    await insertIdentifier(db, "identifier-a", "master-a", "source-a", "PHONE", "same-phone");
    await assert.rejects(
      insertIdentifier(db, "identifier-a2", "master-a", "source-a", "PHONE", "same-phone"),
      /UNIQUE constraint failed/
    );
  } finally {
    await db.close();
  }
});

test("telefone, email e CPF iguais em mestres distintos continuam permitidos", async () => {
  const db = await createHardenedDatabase();
  try {
    await seedMasters(db);
    for (const [type, hash] of [["PHONE", "phone-hash"], ["EMAIL", "email-hash"], ["CPF", "cpf-hash"]]) {
      await insertIdentifier(db, `${type}-a`, "master-a", "source-a", type, hash);
      await insertIdentifier(db, `${type}-b`, "master-b", "source-b", type, hash);
    }
    const audit = await auditCustomerMasterIntegrity(db);
    assert.equal(audit.duplicates.identifiers, 0);
    assert.equal(audit.cpfPartialUnique.violationGroups, 1);
    assert.equal(audit.cpfPartialUnique.status, "PENDING_VIOLATIONS");
    const indexes = await db.all("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?", [CPF_PARTIAL_UNIQUE_INDEX]);
    assert.equal(indexes.length, 0);
  } finally {
    await db.close();
  }
});

test("foreign keys usam RESTRICT ou NO ACTION e detectam tentativa de orfandade", async () => {
  const db = await createHardenedDatabase();
  try {
    await db.run("PRAGMA foreign_keys = ON");
    await seedMasters(db);
    await assert.rejects(
      db.run("UPDATE customer_master_sources SET master_id = 'missing' WHERE id = 'source-a'"),
      /FOREIGN KEY constraint failed/
    );
    const audit = await auditCustomerMasterIntegrity(db);
    assert.equal(audit.foreignKeys.masterViolations, 0);
    assert.equal(audit.foreignKeys.cascadeActions, 0);
    assert.ok(Object.values(audit.orphans).every((value) => value === 0));
  } finally {
    await db.close();
  }
});

test("CLI exige modo unico e argumentos explicitos", () => {
  assert.equal(parseArgs(["--dry-run", "--database", "db.sqlite", "--allowed-root", "."]).mode, "dry-run");
  assert.equal(parseArgs(["--apply", "--database", "db.sqlite", "--allowed-root", "."]).mode, "apply");
  assert.equal(parseArgs(["--verify", "--database", "db.sqlite", "--allowed-root", "."]).mode, "verify");
  assert.throws(() => parseArgs([]), /CUSTOMER_MASTER_INCREMENTAL_MODE_REQUIRED/);
  assert.throws(() => parseArgs(["--apply", "--verify"]), /CUSTOMER_MASTER_INCREMENTAL_MODE_REQUIRED/);
  assert.throws(() => parseArgs(["--dry-run", "--unknown"]), /CUSTOMER_MASTER_INCREMENTAL_ARGUMENT_INVALID/);
});
