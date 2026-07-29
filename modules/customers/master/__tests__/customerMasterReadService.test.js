"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const sqlite3 = require("sqlite3").verbose();
const {
  applyCustomerMasterSchema
} = require("../persistence/customerMasterSchema");
const {
  MAX_LIMIT,
  assertReadOnlySql,
  createCustomerMasterReadRepository
} = require("../persistence/customerMasterReadRepository");
const {
  ACCESS_DECISION,
  createCustomerMasterReadService
} = require("../services/customerMasterReadService");

function createMemoryDatabase() {
  const connection = new sqlite3.Database(":memory:");
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    connection.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
  const get = (sql, params = []) => new Promise((resolve, reject) => {
    connection.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    connection.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
  const close = () => new Promise((resolve, reject) => {
    connection.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  return { run, get, all, close };
}

async function insertMaster(db, {
  id,
  displayName,
  status = "ACTIVE",
  eligibilityStatus = "NOT_EVALUATED",
  reasons = "[]",
  deletedAt = null,
  order = 1
}) {
  const timestamp = `2026-01-${String(order).padStart(2, "0")}T00:00:00.000Z`;
  await db.run(
    `INSERT INTO customer_master_records
      (id, display_name, status, version, eligibility_status, eligibility_reasons_json,
       eligibility_rule_version, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 1, ?, ?, 'synthetic-rule-v1', ?, ?, ?)`,
    [id, displayName, status, eligibilityStatus, reasons, timestamp, timestamp, deletedAt]
  );
}

async function insertSource(db, {
  id,
  masterId,
  sourceType,
  sourceId,
  status = "ACTIVE",
  revokedAt = null
}) {
  await db.run(
    `INSERT INTO customer_master_sources
      (id, master_id, source_type, source_id, source_hash, status, created_at, updated_at, revoked_at)
     VALUES (?, ?, ?, ?, 'synthetic-source-hash', ?, 'synthetic-time', 'synthetic-time', ?)`,
    [id, masterId, sourceType, sourceId, status, revokedAt]
  );
}

async function insertIdentifier(db, {
  id,
  masterId,
  sourceLinkId,
  type,
  hash,
  maskedValue,
  active = 1,
  revokedAt = null
}) {
  await db.run(
    `INSERT INTO customer_master_identifiers
      (id, master_id, source_link_id, identifier_type, lookup_hash, masked_value,
       protected_value, classification, validation_status, verification_status,
       is_primary, is_active, normalization_version, created_at, updated_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, 'SYNTHETIC_PROTECTED_SENTINEL', 'VALID',
             'VALID', 'NOT_VERIFIED', 0, ?, 'customer-identity-normalization/v1',
             'synthetic-time', 'synthetic-time', ?)`,
    [id, masterId, sourceLinkId, type, hash, maskedValue, active, revokedAt]
  );
}

async function insertConflict(db, {
  id,
  masterId,
  status,
  evidence = "{\"codes\":[\"SYNTHETIC_CONFLICT\"],\"participantCount\":1}"
}) {
  await db.run(
    `INSERT INTO customer_identity_conflicts
      (id, conflict_type, severity, status, rule_version, evidence_json,
       resolution_type, resolution_reason, resolved_at, created_at, updated_at)
     VALUES (?, 'IDENTITY_AMBIGUITY', 'HIGH', ?, 'synthetic-rule-v1', ?,
             ?, ?, ?, 'synthetic-time', 'synthetic-time')`,
    [
      id,
      status,
      evidence,
      status === "RESOLVED" ? "ADMIN_REVIEW" : null,
      status === "RESOLVED" ? "synthetic reason sentinel" : null,
      status === "RESOLVED" ? "synthetic-time" : null
    ]
  );
  await db.run(
    `INSERT INTO customer_identity_conflict_participants
      (id, conflict_id, participant_type, participant_id, role, created_at)
     VALUES (?, ?, 'MASTER', ?, 'CANDIDATE', 'synthetic-time')`,
    [`participant-${id}`, id, masterId]
  );
}

async function seedSyntheticDataset(db) {
  const masters = [
    ["master-no-source", "Synthetic No Source", "ACTIVE", "NOT_EVALUATED", "[]", null],
    ["master-contacts", "Synthetic Contacts", "ACTIVE", "NOT_EVALUATED", "[]", null],
    ["master-crm", "Synthetic CRM", "ACTIVE", "NOT_EVALUATED", "[]", null],
    ["master-both", "Synthetic Both", "ACTIVE", "STORED_ELIGIBLE", "[\"SYNTHETIC_STORED_REASON\"]", null],
    ["master-duplicate-a", "Synthetic Duplicate A", "ACTIVE", "NOT_EVALUATED", "[]", null],
    ["master-duplicate-b", "Synthetic Duplicate B", "ACTIVE", "NOT_EVALUATED", "[]", null],
    ["master-open-conflict", "Synthetic Open Conflict", "ACTIVE", "NOT_EVALUATED", "[]", null],
    ["master-resolved-conflict", "Synthetic Resolved Conflict", "ACTIVE", "NOT_EVALUATED", "[]", null],
    ["master-revoked", "Synthetic Revoked", "ACTIVE", "NOT_EVALUATED", "[]", null],
    ["master-invalid-json", "Synthetic Invalid JSON", "ACTIVE", "NOT_EVALUATED", "{invalid-json", null],
    ["master-deleted", "Synthetic Deleted", "ACTIVE", "STORED_ELIGIBLE", "[]", "synthetic-deleted-time"]
  ];
  for (let index = 0; index < masters.length; index += 1) {
    const [id, displayName, status, eligibilityStatus, reasons, deletedAt] = masters[index];
    await insertMaster(db, {
      id,
      displayName,
      status,
      eligibilityStatus,
      reasons,
      deletedAt,
      order: index + 1
    });
  }

  const sources = [
    ["source-contacts", "master-contacts", "contacts", "synthetic-contact-1", "ACTIVE", null],
    ["source-crm", "master-crm", "crm_contacts", "synthetic-crm-1", "ACTIVE", null],
    ["source-both-contacts", "master-both", "contacts", "synthetic-contact-2", "ACTIVE", null],
    ["source-both-crm", "master-both", "crm_contacts", "synthetic-crm-2", "ACTIVE", null],
    ["source-duplicate-a", "master-duplicate-a", "contacts", "synthetic-contact-3", "ACTIVE", null],
    ["source-duplicate-b", "master-duplicate-b", "crm_contacts", "synthetic-crm-3", "ACTIVE", null],
    ["source-revoked", "master-revoked", "contacts", "synthetic-contact-4", "REVOKED", "synthetic-revoked-time"]
  ];
  for (const [id, masterId, sourceType, sourceId, status, revokedAt] of sources) {
    await insertSource(db, { id, masterId, sourceType, sourceId, status, revokedAt });
  }

  const identifiers = [
    ["identifier-phone", "master-both", "source-both-contacts", "PHONE", "synthetic-phone-hash", "*********0001", 1, null],
    ["identifier-email", "master-both", "source-both-crm", "EMAIL", "synthetic-email-hash", "s***@example.invalid", 1, null],
    ["identifier-cpf", "master-both", "source-both-contacts", "CPF", "synthetic-cpf-hash", "***.***.***-09", 1, null],
    ["identifier-revoked", "master-both", "source-both-crm", "OTHER_DOCUMENT", "synthetic-revoked-hash", "********0000", 0, "synthetic-revoked-time"],
    ["identifier-dup-phone-a", "master-duplicate-a", "source-duplicate-a", "PHONE", "synthetic-shared-phone-hash", "*********0002", 1, null],
    ["identifier-dup-phone-b", "master-duplicate-b", "source-duplicate-b", "PHONE", "synthetic-shared-phone-hash", "*********0002", 1, null],
    ["identifier-dup-cpf-a", "master-duplicate-a", "source-duplicate-a", "CPF", "synthetic-shared-cpf-hash", "***.***.***-18", 1, null],
    ["identifier-dup-cpf-b", "master-duplicate-b", "source-duplicate-b", "CPF", "synthetic-shared-cpf-hash", "***.***.***-18", 1, null]
  ];
  for (const values of identifiers) {
    await insertIdentifier(db, {
      id: values[0],
      masterId: values[1],
      sourceLinkId: values[2],
      type: values[3],
      hash: values[4],
      maskedValue: values[5],
      active: values[6],
      revokedAt: values[7]
    });
  }

  await insertConflict(db, {
    id: "conflict-open",
    masterId: "master-open-conflict",
    status: "OPEN"
  });
  await insertConflict(db, {
    id: "conflict-resolved",
    masterId: "master-resolved-conflict",
    status: "RESOLVED"
  });
  await insertConflict(db, {
    id: "conflict-invalid-json",
    masterId: "master-invalid-json",
    status: "OPEN",
    evidence: "{invalid-sensitive-sentinel"
  });
}

async function withContext(callback, { seed = true } = {}) {
  const db = createMemoryDatabase();
  try {
    await applyCustomerMasterSchema(db);
    if (seed) await seedSyntheticDataset(db);
    const repository = createCustomerMasterReadRepository(db);
    const service = createCustomerMasterReadService({ repository });
    return await callback({ db, repository, service });
  } finally {
    await db.close();
  }
}

test("empty database and missing master return predictable read-only results", async () => {
  await withContext(async ({ service }) => {
    const listed = await service.listMasters();
    assert.deepEqual(listed.items, []);
    assert.equal(listed.pagination.total, 0);
    assert.equal(listed.pagination.limit, 25);
    assert.equal(await service.getMasterById("missing"), null);
    assert.equal(await service.getCustomerMasterView("missing"), null);
    const eligibility = await service.getObservableEligibility("missing");
    assert.equal(eligibility.accessDecision, ACCESS_DECISION);
    assert.equal(eligibility.observableStatus, "NOT_AVAILABLE");
  }, { seed: false });
});

test("detailed view represents both sources and masked identifiers with an allow-list DTO", async () => {
  await withContext(async ({ service }) => {
    const view = await service.getCustomerMasterView("master-both");
    assert.equal(view.master.displayName, "Synthetic Both");
    assert.deepEqual(view.sources.map((source) => source.sourceType), ["contacts", "crm_contacts"]);
    assert.equal(view.identifiers.length, 4);
    assert.deepEqual(
      view.identifiers.map((identifier) => identifier.type),
      ["CPF", "EMAIL", "OTHER_DOCUMENT", "PHONE"]
    );
    assert.equal(view.addressObservation.available, false);
    assert.equal(view.eligibility.accessDecision, ACCESS_DECISION);

    const serialized = JSON.stringify(view);
    for (const forbidden of [
      "lookup_hash",
      "lookupHash",
      "protected_value",
      "protectedValue",
      "SYNTHETIC_PROTECTED_SENTINEL",
      "source_hash",
      "canonicalValue",
      "canAccessApp"
    ]) {
      assert.equal(serialized.includes(forbidden), false, `forbidden DTO field ${forbidden}`);
    }
  });
});

test("contacts, crm_contacts, both sources, revoked source and revoked identifier remain distinguishable", async () => {
  await withContext(async ({ service }) => {
    const noSource = await service.getCustomerMasterView("master-no-source");
    assert.deepEqual(noSource.sources, []);
    assert.equal(noSource.eligibility.warnings.includes("NO_ACTIVE_SOURCE_LINK"), true);
    assert.deepEqual(
      (await service.listSourcesByMasterId("master-contacts")).map((source) => source.sourceType),
      ["contacts"]
    );
    assert.deepEqual(
      (await service.listSourcesByMasterId("master-crm")).map((source) => source.sourceType),
      ["crm_contacts"]
    );
    assert.equal((await service.listSourcesByMasterId("master-both")).length, 2);

    const revoked = await service.getCustomerMasterView("master-revoked");
    assert.equal(revoked.sources[0].revokedAt, "synthetic-revoked-time");
    assert.equal(revoked.eligibility.activeSourceCount, 0);
    assert.equal(revoked.eligibility.warnings.includes("NO_ACTIVE_SOURCE_LINK"), true);

    const identifiers = await service.listIdentifiersByMasterId("master-both");
    const revokedIdentifier = identifiers.find((identifier) => identifier.type === "OTHER_DOCUMENT");
    assert.equal(revokedIdentifier.isActive, false);
    assert.equal(revokedIdentifier.revokedAt, "synthetic-revoked-time");
  });
});

test("open, resolved, invalid JSON and soft-deleted states are safe and observable only", async () => {
  await withContext(async ({ service }) => {
    const open = await service.getCustomerMasterView("master-open-conflict");
    assert.equal(open.conflicts[0].status, "OPEN");
    assert.equal(open.eligibility.observableStatus, "REVIEW_REQUIRED");
    assert.equal(open.eligibility.warnings.includes("OPEN_IDENTITY_CONFLICT_REQUIRES_ADMIN_REVIEW"), true);

    const resolved = await service.getCustomerMasterView("master-resolved-conflict");
    assert.equal(resolved.conflicts[0].status, "RESOLVED");
    assert.equal(resolved.conflicts[0].resolution.resolved, true);
    assert.equal(resolved.conflicts[0].resolution.hasReason, true);

    const invalid = await service.getCustomerMasterView("master-invalid-json");
    assert.equal(invalid.master.eligibilityReasons.length, 0);
    assert.equal(invalid.conflicts[0].evidence, null);
    assert.equal(invalid.warnings.includes("ELIGIBILITY_REASONS_INVALID_JSON"), true);
    assert.equal(invalid.warnings.includes("CONFLICT_EVIDENCE_INVALID_JSON"), true);
    assert.equal(JSON.stringify(invalid).includes("invalid-sensitive-sentinel"), false);

    const deleted = await service.getCustomerMasterView("master-deleted");
    assert.equal(deleted.eligibility.observableStatus, "BLOCKED_SOFT_DELETED");
    assert.equal(deleted.eligibility.accessDecision, ACCESS_DECISION);
  });
});

test("source and identifier lookup enforce allow-lists and preserve ambiguity", async () => {
  await withContext(async ({ service }) => {
    const bySource = await service.findMasterBySource("contacts", "synthetic-contact-2");
    assert.equal(bySource.master.id, "master-both");
    assert.equal(bySource.source.id, "source-both-contacts");
    assert.equal(bySource.revoked, false);

    const revoked = await service.findMasterBySource("contacts", "synthetic-contact-4");
    assert.equal(revoked.revoked, true);
    assert.equal(await service.findMasterBySource("contacts", "missing"), null);
    await assert.rejects(
      service.findMasterBySource("unsupported", "synthetic-contact-2"),
      /CUSTOMER_MASTER_INVALID_SOURCE_TYPE/
    );

    const phoneMatches = await service.findMastersByIdentifierHash(
      "PHONE",
      "synthetic-shared-phone-hash"
    );
    assert.equal(phoneMatches.matchCount, 2);
    assert.equal(phoneMatches.ambiguity, "MULTIPLE_MASTER_CANDIDATES");
    assert.equal(phoneMatches.accessDecision, ACCESS_DECISION);
    assert.equal(JSON.stringify(phoneMatches).includes("synthetic-shared-phone-hash"), false);

    const cpfMatches = await service.findMastersByIdentifierHash(
      "CPF",
      "synthetic-shared-cpf-hash"
    );
    assert.equal(cpfMatches.matchCount, 2);
    const revokedMatches = await service.findMastersByIdentifierHash(
      "OTHER_DOCUMENT",
      "synthetic-revoked-hash"
    );
    assert.equal(revokedMatches.matchCount, 0);
    await assert.rejects(
      service.findMastersByIdentifierHash("UNSUPPORTED", "synthetic-hash"),
      /CUSTOMER_MASTER_INVALID_IDENTIFIER_TYPE/
    );
  });
});

test("pagination is stable, capped and restricted to allow-listed filters and ordering", async () => {
  await withContext(async ({ service }) => {
    const first = await service.listMasters({
      page: 1,
      limit: 3,
      sortBy: "createdAt",
      sortDirection: "asc",
      deleted: "all"
    });
    const second = await service.listMasters({
      page: 2,
      limit: 3,
      sortBy: "createdAt",
      sortDirection: "asc",
      deleted: "all"
    });
    assert.equal(first.items.length, 3);
    assert.equal(second.items.length, 3);
    assert.equal(
      first.items.some((item) => second.items.some((other) => other.id === item.id)),
      false
    );

    const capped = await service.listMasters({ limit: 999, deleted: "all" });
    assert.equal(capped.pagination.limit, MAX_LIMIT);
    const activeDefault = await service.listMasters({ limit: 100 });
    assert.equal(activeDefault.items.some((item) => item.deletedAt), false);
    const deletedOnly = await service.listMasters({ deleted: "only" });
    assert.deepEqual(deletedOnly.items.map((item) => item.id), ["master-deleted"]);
    const sourceFiltered = await service.listMasters({ sourceType: "crm_contacts", deleted: "all" });
    assert.equal(sourceFiltered.items.some((item) => item.id === "master-crm"), true);
    assert.equal(sourceFiltered.items.some((item) => item.id === "master-contacts"), false);

    await assert.rejects(
      service.listMasters({ sortBy: "lookup_hash" }),
      /CUSTOMER_MASTER_INVALID_SORT/
    );
    await assert.rejects(
      service.listMasters({ sortDirection: "sideways" }),
      /CUSTOMER_MASTER_INVALID_SORT_DIRECTION/
    );
  });
});

test("reads are deterministic and do not alter row counts or timestamps", async () => {
  await withContext(async ({ db, service }) => {
    const countsBefore = await db.all(
      `SELECT name, (SELECT COUNT(*) FROM customer_master_records) AS masters,
                    (SELECT COUNT(*) FROM customer_master_sources) AS sources,
                    (SELECT COUNT(*) FROM customer_master_identifiers) AS identifiers
       FROM sqlite_master WHERE type = 'table' LIMIT 1`
    );
    const timestampBefore = await db.get(
      "SELECT updated_at FROM customer_master_records WHERE id = 'master-both'"
    );
    const first = await service.getCustomerMasterView("master-both");
    const second = await service.getCustomerMasterView("master-both");
    await service.listMasters({ page: 1, limit: 5 });
    assert.deepEqual(second, first);
    assert.deepEqual(
      await db.all(
        `SELECT name, (SELECT COUNT(*) FROM customer_master_records) AS masters,
                      (SELECT COUNT(*) FROM customer_master_sources) AS sources,
                      (SELECT COUNT(*) FROM customer_master_identifiers) AS identifiers
         FROM sqlite_master WHERE type = 'table' LIMIT 1`
      ),
      countsBefore
    );
    assert.deepEqual(
      await db.get("SELECT updated_at FROM customer_master_records WHERE id = 'master-both'"),
      timestampBefore
    );
  });
});

test("repository blocks write SQL, uses no SELECT star and has no operational import side effect", async () => {
  for (const statement of [
    "INSERT INTO x VALUES (1)",
    "UPDATE x SET y = 1",
    "DELETE FROM x",
    "DROP TABLE x",
    "ALTER TABLE x ADD COLUMN y",
    "CREATE TABLE x (id INTEGER)",
    "REPLACE INTO x VALUES (1)",
    "VACUUM",
    "ATTACH DATABASE 'x' AS y",
    "DETACH DATABASE y",
    "PRAGMA foreign_keys = ON"
  ]) {
    assert.throws(() => assertReadOnlySql(statement), /READ_ONLY|WRITE/);
  }
  assert.equal(assertReadOnlySql("SELECT id FROM x"), "SELECT id FROM x");

  const repositorySource = fs.readFileSync(
    path.join(__dirname, "../persistence/customerMasterReadRepository.js"),
    "utf8"
  );
  assert.doesNotMatch(repositorySource, /SELECT\s+\*/i);
  assert.doesNotMatch(repositorySource, /dbApi\.run|require\([^)]*(db|server|customerUnifiedService)/i);
  assert.doesNotMatch(repositorySource, /https?:\/\//i);

  await withContext(async ({ service }) => {
    assert.equal(await service.getMasterById("x' OR 1=1 --"), null);
  });
});
