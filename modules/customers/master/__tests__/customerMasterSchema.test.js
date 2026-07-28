"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const sqlite3 = require("sqlite3").verbose();
const {
  CUSTOMER_MASTER_SCHEMA_VERSION,
  CUSTOMER_MASTER_TABLES,
  getCustomerMasterDdlPath,
  getCustomerMasterSchemaStatus,
  applyCustomerMasterSchema,
  rollbackEmptyCustomerMasterSchema
} = require("../persistence/customerMasterSchema");

const EXPECTED_COLUMNS = Object.freeze({
  customer_master_records: [
    "id", "display_name", "status", "version", "eligibility_status",
    "eligibility_reasons_json", "eligibility_evaluated_at", "eligibility_rule_version",
    "eligibility_source_version", "created_at", "updated_at", "deleted_at"
  ],
  customer_master_sources: [
    "id", "master_id", "source_type", "source_id", "source_updated_at", "imported_at",
    "source_hash", "status", "created_at", "updated_at", "revoked_at"
  ],
  customer_master_identifiers: [
    "id", "master_id", "source_link_id", "identifier_type", "lookup_hash", "masked_value",
    "protected_value", "classification", "validation_status", "verification_status",
    "is_primary", "is_active", "normalization_version", "created_at", "updated_at", "revoked_at"
  ],
  customer_identity_conflicts: [
    "id", "conflict_type", "severity", "status", "rule_version", "evidence_json",
    "resolution_type", "resolution_reason", "resolved_by", "resolved_at", "created_at",
    "updated_at", "reopened_at"
  ],
  customer_identity_conflict_participants: [
    "id", "conflict_id", "participant_type", "participant_id", "role", "created_at"
  ],
  customer_master_merge_history: [
    "id", "operation_type", "primary_master_id", "secondary_master_id", "source_link_id",
    "before_json", "after_json", "reason", "actor_user_id", "correlation_id", "created_at",
    "reverted_by_event_id", "reverted_at"
  ],
  customer_master_sync_checkpoints: [
    "id", "source_type", "cursor_updated_at", "cursor_source_id", "last_job_id", "status",
    "created_at", "updated_at"
  ],
  customer_master_jobs: [
    "id", "job_type", "status", "code_version", "schema_version", "fingerprint",
    "counts_json", "checkpoint_json", "started_at", "finished_at", "created_by",
    "error_code", "error_summary", "created_at", "updated_at"
  ]
});

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

async function withMemoryDatabase(callback) {
  const dbApi = createMemoryDatabase();
  try {
    return await callback(dbApi);
  } finally {
    await dbApi.close();
  }
}

async function createSyntheticLegacyTables(dbApi) {
  await dbApi.run(`
    CREATE TABLE contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await dbApi.run(`
    CREATE TABLE crm_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

async function tableInfo(dbApi, table) {
  return dbApi.all(`PRAGMA table_info(${table})`);
}

async function insertSyntheticMaster(dbApi, id) {
  await dbApi.run(
    `INSERT INTO customer_master_records
      (id, display_name, status, version, eligibility_status, created_at, updated_at)
     VALUES (?, '', 'PENDING', 1, 'NOT_EVALUATED', 'synthetic-time', 'synthetic-time')`,
    [id]
  );
}

async function insertSyntheticSource(dbApi, id, masterId, sourceType, sourceId) {
  await dbApi.run(
    `INSERT INTO customer_master_sources
      (id, master_id, source_type, source_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'synthetic-time', 'synthetic-time')`,
    [id, masterId, sourceType, sourceId]
  );
}

test("migration applies to an empty in-memory SQLite database and is idempotent", async () => {
  await withMemoryDatabase(async (dbApi) => {
    await createSyntheticLegacyTables(dbApi);
    const contactsBefore = await tableInfo(dbApi, "contacts");
    const crmBefore = await tableInfo(dbApi, "crm_contacts");

    const first = await applyCustomerMasterSchema(dbApi);
    const second = await applyCustomerMasterSchema(dbApi);
    const sqliteRuntime = await dbApi.get("SELECT sqlite_version() AS version");
    const foreignKeys = await dbApi.get("PRAGMA foreign_keys");

    assert.equal(first.schemaVersion, CUSTOMER_MASTER_SCHEMA_VERSION);
    assert.equal(first.before.ready, false);
    assert.equal(first.after.ready, true);
    assert.equal(first.after.empty, true);
    assert.equal(second.before.ready, true);
    assert.equal(second.after.ready, true);
    assert.equal(second.after.empty, true);
    assert.match(sqliteRuntime.version, /^\d+\.\d+\.\d+$/);
    assert.equal(foreignKeys.foreign_keys, 1);
    assert.deepEqual(await tableInfo(dbApi, "contacts"), contactsBefore);
    assert.deepEqual(await tableInfo(dbApi, "crm_contacts"), crmBefore);
  });
});

test("all eight tables, expected indexes and restrictive foreign keys exist", async () => {
  await withMemoryDatabase(async (dbApi) => {
    await applyCustomerMasterSchema(dbApi);
    const status = await getCustomerMasterSchemaStatus(dbApi);
    assert.deepEqual(status.tables.map((item) => item.table), CUSTOMER_MASTER_TABLES);
    assert.equal(status.tables.every((item) => item.exists && item.count === 0), true);
    for (const table of CUSTOMER_MASTER_TABLES) {
      const columns = await tableInfo(dbApi, table);
      assert.deepEqual(columns.map((column) => column.name), EXPECTED_COLUMNS[table]);
      assert.equal(columns.find((column) => column.name === "id")?.pk, 1);
    }

    const indexRows = await dbApi.all(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_customer_%'"
    );
    const indexNames = new Set(indexRows.map((row) => row.name));
    for (const name of [
      "idx_customer_master_records_eligibility",
      "idx_customer_master_sources_master",
      "idx_customer_master_identifiers_lookup",
      "idx_customer_identity_conflicts_status",
      "idx_customer_conflict_participants_target",
      "idx_customer_master_history_primary",
      "idx_customer_master_jobs_status",
      "idx_customer_master_checkpoints_updated"
    ]) {
      assert.equal(indexNames.has(name), true, `missing index ${name}`);
    }

    for (const table of [
      "customer_master_sources",
      "customer_master_identifiers",
      "customer_identity_conflict_participants",
      "customer_master_merge_history",
      "customer_master_sync_checkpoints"
    ]) {
      const foreignKeys = await dbApi.all(`PRAGMA foreign_key_list(${table})`);
      assert.equal(foreignKeys.length > 0, true, `${table} should have foreign keys`);
      assert.equal(foreignKeys.every((foreignKey) => foreignKey.on_delete === "RESTRICT"), true);
    }
  });
});

test("safe uniqueness rules do not create global phone, email or CPF uniqueness", async () => {
  await withMemoryDatabase(async (dbApi) => {
    await applyCustomerMasterSchema(dbApi);
    await insertSyntheticMaster(dbApi, "master-synthetic-a");
    await insertSyntheticMaster(dbApi, "master-synthetic-b");
    await insertSyntheticSource(dbApi, "source-synthetic-a", "master-synthetic-a", "contacts", "synthetic-1");
    await insertSyntheticSource(dbApi, "source-synthetic-b", "master-synthetic-b", "crm_contacts", "synthetic-2");

    for (const identifierType of ["PHONE", "EMAIL", "CPF"]) {
      const hash = `synthetic-shared-${identifierType.toLowerCase()}-hash`;
      await dbApi.run(
        `INSERT INTO customer_master_identifiers
          (id, master_id, source_link_id, identifier_type, lookup_hash, masked_value, created_at, updated_at)
         VALUES (?, 'master-synthetic-a', 'source-synthetic-a', ?, ?, '***', 'synthetic-time', 'synthetic-time')`,
        [`identifier-a-${identifierType}`, identifierType, hash]
      );
      await dbApi.run(
        `INSERT INTO customer_master_identifiers
          (id, master_id, source_link_id, identifier_type, lookup_hash, masked_value, created_at, updated_at)
         VALUES (?, 'master-synthetic-b', 'source-synthetic-b', ?, ?, '***', 'synthetic-time', 'synthetic-time')`,
        [`identifier-b-${identifierType}`, identifierType, hash]
      );
    }

    await assert.rejects(
      insertSyntheticSource(dbApi, "source-duplicate", "master-synthetic-b", "contacts", "synthetic-1"),
      /UNIQUE constraint failed/
    );
  });
});

test("duplicate conflict participant is blocked and history restricts master deletion", async () => {
  await withMemoryDatabase(async (dbApi) => {
    await applyCustomerMasterSchema(dbApi);
    await insertSyntheticMaster(dbApi, "master-history");
    await dbApi.run(
      `INSERT INTO customer_identity_conflicts
        (id, conflict_type, evidence_json, created_at, updated_at)
       VALUES ('conflict-synthetic', 'IDENTITY_AMBIGUITY', '{}', 'synthetic-time', 'synthetic-time')`
    );
    await dbApi.run(
      `INSERT INTO customer_identity_conflict_participants
        (id, conflict_id, participant_type, participant_id, role, created_at)
       VALUES ('participant-a', 'conflict-synthetic', 'MASTER', 'master-history', 'CANDIDATE', 'synthetic-time')`
    );
    await assert.rejects(
      dbApi.run(
        `INSERT INTO customer_identity_conflict_participants
          (id, conflict_id, participant_type, participant_id, role, created_at)
         VALUES ('participant-b', 'conflict-synthetic', 'MASTER', 'master-history', 'OTHER', 'synthetic-time')`
      ),
      /UNIQUE constraint failed/
    );

    await dbApi.run(
      `INSERT INTO customer_master_merge_history
        (id, operation_type, primary_master_id, before_json, after_json, created_at)
       VALUES ('history-synthetic', 'MERGE', 'master-history', '{}', '{}', 'synthetic-time')`
    );
    await assert.rejects(
      dbApi.run("DELETE FROM customer_master_records WHERE id = 'master-history'"),
      /FOREIGN KEY constraint failed/
    );
  });
});

test("rollback is explicitly gated, works only while empty and preserves legacy tables", async () => {
  await withMemoryDatabase(async (dbApi) => {
    await createSyntheticLegacyTables(dbApi);
    await applyCustomerMasterSchema(dbApi);
    await assert.rejects(
      rollbackEmptyCustomerMasterSchema(dbApi),
      /Rollback exige/
    );
    await insertSyntheticMaster(dbApi, "master-blocks-rollback");
    await assert.rejects(
      rollbackEmptyCustomerMasterSchema(dbApi, {
        confirmEmptySchema: true,
        temporaryDatabaseOnly: true
      }),
      /Rollback bloqueado: tabelas possuem dados/
    );
    await dbApi.run("DELETE FROM customer_master_records WHERE id = 'master-blocks-rollback'");
    const after = await rollbackEmptyCustomerMasterSchema(dbApi, {
      confirmEmptySchema: true,
      temporaryDatabaseOnly: true
    });
    assert.equal(after.ready, false);
    assert.equal(await tableExistsForTest(dbApi, "contacts"), true);
    assert.equal(await tableExistsForTest(dbApi, "crm_contacts"), true);
  });
});

async function tableExistsForTest(dbApi, table) {
  const row = await dbApi.get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table]
  );
  return Boolean(row?.name);
}

test("migration remains isolated from operational, app, mobile and destructive behavior", () => {
  const ddl = fs.readFileSync(getCustomerMasterDdlPath(), "utf8");
  const migrationSource = fs.readFileSync(
    path.join(__dirname, "../persistence/customerMasterSchema.js"),
    "utf8"
  );
  const combined = `${ddl}\n${migrationSource}`;

  assert.doesNotMatch(
    ddl,
    /^\s*(INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TRIGGER)\b/im
  );
  assert.doesNotMatch(ddl, /\bcontacts\b|\bcrm_contacts\b/i);
  assert.doesNotMatch(ddl, /CREATE\s+UNIQUE\s+INDEX[\s\S]*?(PHONE|EMAIL|CPF|lookup_hash)/i);
  assert.doesNotMatch(combined, /SHOP_PUBLIC_CATALOG_ENABLED|\/app\/v1|app_customer_accounts/i);
  assert.doesNotMatch(combined, /customerUnifiedService|apps[\\/]mobile|https?:\/\//i);
  assert.doesNotMatch(combined, /(?:require|import|await|function)\s*[^\n;]*backfill/i);
  assert.doesNotMatch(combined, /require\([^)]*(server|pdv|crm|whatsapp|cashback)/i);
});
