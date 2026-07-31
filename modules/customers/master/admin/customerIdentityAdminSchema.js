"use strict";

const CUSTOMER_IDENTITY_ADMIN_SCHEMA_VERSION = "customer-identity-admin-review/v1";

const OPERATIONAL_COLUMNS = Object.freeze({
  reviewer_user_id: "TEXT",
  review_started_at: "TEXT",
  review_updated_at: "TEXT",
  review_version: "INTEGER NOT NULL DEFAULT 0",
  operational_flag: "TEXT NOT NULL DEFAULT ''",
  last_event_at: "TEXT"
});

const OPERATIONAL_INDEXES = Object.freeze([
  "CREATE INDEX IF NOT EXISTS idx_customer_identity_cases_reviewer ON customer_identity_cases(reviewer_user_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_customer_identity_cases_operational ON customer_identity_cases(queue_type, operational_flag, updated_at)"
]);

function assertDb(dbApi, write = false) {
  if (!dbApi || typeof dbApi.get !== "function" || typeof dbApi.all !== "function") {
    throw new Error("CUSTOMER_IDENTITY_ADMIN_DB_REQUIRED");
  }
  if (write && typeof dbApi.run !== "function") {
    throw new Error("CUSTOMER_IDENTITY_ADMIN_WRITE_DB_REQUIRED");
  }
}

async function getCustomerIdentityAdminSchemaStatus(dbApi) {
  assertDb(dbApi);
  const table = await dbApi.get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'customer_identity_cases'"
  );
  if (!table?.name) {
    return {
      schemaVersion: CUSTOMER_IDENTITY_ADMIN_SCHEMA_VERSION,
      ready: false,
      tableExists: false,
      columns: []
    };
  }
  const columns = await dbApi.all("PRAGMA table_info(customer_identity_cases)");
  const names = columns.map((column) => String(column.name || ""));
  return {
    schemaVersion: CUSTOMER_IDENTITY_ADMIN_SCHEMA_VERSION,
    ready: Object.keys(OPERATIONAL_COLUMNS).every((column) => names.includes(column)),
    tableExists: true,
    columns: names
  };
}

async function applyCustomerIdentityAdminSchema(dbApi) {
  assertDb(dbApi, true);
  const before = await getCustomerIdentityAdminSchemaStatus(dbApi);
  if (!before.tableExists) {
    throw new Error("CUSTOMER_IDENTITY_CASE_SCHEMA_REQUIRED");
  }
  const missingColumns = Object.keys(OPERATIONAL_COLUMNS)
    .filter((column) => !before.columns.includes(column));

  await dbApi.run("BEGIN IMMEDIATE");
  try {
    for (const column of missingColumns) {
      await dbApi.run(
        `ALTER TABLE customer_identity_cases ADD COLUMN ${column} ${OPERATIONAL_COLUMNS[column]}`
      );
    }
    for (const statement of OPERATIONAL_INDEXES) {
      await dbApi.run(statement);
    }
    await dbApi.run("COMMIT");
  } catch (error) {
    await dbApi.run("ROLLBACK").catch(() => null);
    throw error;
  }

  const after = await getCustomerIdentityAdminSchemaStatus(dbApi);
  if (!after.ready) {
    throw new Error("CUSTOMER_IDENTITY_ADMIN_SCHEMA_INCOMPLETE");
  }
  return {
    schemaVersion: CUSTOMER_IDENTITY_ADMIN_SCHEMA_VERSION,
    columnsAdded: missingColumns,
    before,
    after
  };
}

module.exports = {
  CUSTOMER_IDENTITY_ADMIN_SCHEMA_VERSION,
  OPERATIONAL_COLUMNS,
  getCustomerIdentityAdminSchemaStatus,
  applyCustomerIdentityAdminSchema
};
