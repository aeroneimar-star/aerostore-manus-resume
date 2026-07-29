"use strict";

const sqlite3 = require("sqlite3").verbose();
const {
  applyCustomerMasterSchema,
  CUSTOMER_MASTER_TABLES
} = require("../persistence/customerMasterSchema");

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
    connection.close((error) => error ? reject(error) : resolve());
  });
  return { run, get, all, close };
}

async function createLegacyTables(db) {
  await db.run(`
    CREATE TABLE contacts (
      id TEXT PRIMARY KEY, name TEXT, phone TEXT, mobile TEXT, mobile_normalized TEXT,
      phone_fixed TEXT, document TEXT, email TEXT, birth_date TEXT, address TEXT,
      neighborhood TEXT, zipcode TEXT, city TEXT, state TEXT, status TEXT, source TEXT,
      deleted_at TEXT, created_at TEXT, updated_at TEXT
    )
  `);
  await db.run(`
    CREATE TABLE crm_contacts (
      id TEXT PRIMARY KEY, external_id TEXT, external_code TEXT, name TEXT,
      fantasy_name TEXT, document TEXT, person_type TEXT, phone TEXT, mobile TEXT,
      email TEXT, address TEXT, number TEXT, complement TEXT, neighborhood TEXT,
      zipcode TEXT, city TEXT, state TEXT, status TEXT, birth_date TEXT,
      source_file TEXT, source_row TEXT, import_hash TEXT, created_at TEXT, updated_at TEXT
    )
  `);
}

async function createDryRunDatabase() {
  const db = createMemoryDatabase();
  await createLegacyTables(db);
  await applyCustomerMasterSchema(db);
  return db;
}

async function insertContact(db, row = {}) {
  await db.run(
    `INSERT INTO contacts
      (id, name, phone, mobile, mobile_normalized, phone_fixed, document, email,
       birth_date, address, neighborhood, zipcode, city, state, status, source,
       deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.name || "", row.phone || "", row.mobile || "",
      row.mobile_normalized || "", row.phone_fixed || "", row.document || "",
      row.email || "", row.birth_date || "", row.address || "", row.neighborhood || "",
      row.zipcode || "", row.city || "", row.state || "", row.status || "active",
      row.source || "synthetic", row.deleted_at || null,
      row.created_at || "2026-01-01T00:00:00.000Z",
      row.updated_at === undefined ? "2026-01-01T00:00:00.000Z" : row.updated_at
    ]
  );
}

async function insertCrmContact(db, row = {}) {
  await db.run(
    `INSERT INTO crm_contacts
      (id, external_id, external_code, name, fantasy_name, document, person_type,
       phone, mobile, email, address, number, complement, neighborhood, zipcode,
       city, state, status, birth_date, source_file, source_row, import_hash,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.external_id || "", row.external_code || "", row.name || "",
      row.fantasy_name || "", row.document || "", row.person_type || "",
      row.phone || "", row.mobile || "", row.email || "", row.address || "",
      row.number || "", row.complement || "", row.neighborhood || "",
      row.zipcode || "", row.city || "", row.state || "", row.status || "active",
      row.birth_date || "", row.source_file || "synthetic.csv", row.source_row || "",
      row.import_hash || "", row.created_at || "2026-01-01T00:00:00.000Z",
      row.updated_at === undefined ? "2026-01-01T00:00:00.000Z" : row.updated_at
    ]
  );
}

async function snapshotDatabase(db) {
  const masterCounts = {};
  for (const table of CUSTOMER_MASTER_TABLES) {
    masterCounts[table] = Number((await db.get(`SELECT COUNT(*) AS total FROM ${table}`)).total);
  }
  return {
    masterCounts,
    contacts: await db.all("SELECT id, created_at, updated_at, deleted_at FROM contacts ORDER BY id"),
    crmContacts: await db.all("SELECT id, created_at, updated_at FROM crm_contacts ORDER BY id")
  };
}

function rawContact(index, overrides = {}) {
  const suffix = String(index).padStart(8, "0");
  return {
    id: String(index),
    name: `Synthetic Customer ${index}`,
    phone: `119${suffix}`,
    mobile: "",
    mobile_normalized: "",
    phone_fixed: "",
    document: "",
    email: `synthetic-${index}@example.invalid`,
    birth_date: "",
    address: "",
    neighborhood: "",
    zipcode: "",
    city: "",
    state: "",
    status: "active",
    source: "synthetic",
    deleted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function createArrayReader(contacts = [], crmContacts = []) {
  return {
    async getSourceSchemaSummary() {
      return {
        contacts: { exists: true, softDeleteField: "deleted_at" },
        crm_contacts: { exists: true, softDeleteField: null }
      };
    },
    async countContacts() {
      return contacts.length;
    },
    async countCrmContacts() {
      return crmContacts.length;
    },
    async readContactsPage({ offset, limit }) {
      return contacts.slice(offset, offset + limit);
    },
    async readCrmContactsPage({ offset, limit }) {
      return crmContacts.slice(offset, offset + limit);
    }
  };
}

module.exports = {
  createMemoryDatabase,
  createLegacyTables,
  createDryRunDatabase,
  insertContact,
  insertCrmContact,
  snapshotDatabase,
  rawContact,
  createArrayReader
};
