"use strict";

const OFFICIAL_MASTER_SOURCES = Object.freeze(["contacts", "crm_contacts"]);

const EXPECTED_SCHEMA = Object.freeze({
  contacts: {
    primaryKey: "id",
    columns: [
      "id", "name", "phone", "gender", "store", "seller_id", "seller_name", "tags",
      "cashback", "validity", "status", "notes", "created_at", "updated_at", "document",
      "email", "birth_date", "zipcode", "city", "state", "neighborhood", "first_name",
      "mobile", "mobile_normalized", "phone_fixed", "address", "preferred_store", "source",
      "quality_flags", "top_size", "bottom_size", "shoe_size", "size_profile_json",
      "size_profile_source", "size_profile_confidence", "size_profile_updated_at",
      "preferences_json", "behavior_signals_json", "favorite_brands_json",
      "favorite_colors_json", "favorite_categories_json", "average_ticket",
      "last_purchase_at", "preferred_seller", "ai_notes", "aerointel_last_enriched_at",
      "aerointel_confidence_score", "deleted_at"
    ],
    indexes: [
      "idx_contacts_name", "idx_contacts_first_name", "idx_contacts_mobile_normalized",
      "idx_contacts_phone", "idx_contacts_document", "idx_contacts_status",
      "idx_contacts_source", "idx_contacts_deleted_at", "idx_contacts_store",
      "idx_contacts_preferred_store", "idx_contacts_deleted_updated"
    ]
  },
  crm_contacts: {
    primaryKey: "id",
    columns: [
      "id", "external_id", "external_code", "name", "fantasy_name", "document",
      "person_type", "phone", "mobile", "email", "address", "number", "complement",
      "neighborhood", "zipcode", "city", "state", "contact_notes", "status", "gender",
      "birth_date", "seller_name", "contact_type", "credit_limit", "source_file",
      "source_row", "import_hash", "source_files_json", "dedupe_key", "created_at",
      "updated_at"
    ],
    indexes: [
      "idx_crm_contacts_document", "idx_crm_contacts_mobile",
      "idx_crm_contacts_email", "idx_crm_contacts_external_code"
    ]
  }
});

const SOURCE_CLASSIFICATION = Object.freeze({
  official: {
    sources: OFFICIAL_MASTER_SOURCES,
    policy: "Eligible only for a future controlled backfill; this module performs no backfill."
  },
  auxiliary: [
    {
      source: "quick-customers.json",
      location: "modules/pdv/pdvOperationalService.js",
      policy: "Operational evidence only; never creates master identity or automatic eligibility."
    },
    {
      source: "master-customers.json",
      location: "modules/pdv/pdvConsolidationService.js",
      policy: "Derived operational artifact only; not an identity authority."
    },
    {
      source: "sales/session/cashback JSON",
      location: "modules/pdv/pdvConsolidationService.js",
      policy: "Transactional evidence only; no propagation into official sources."
    },
    {
      source: "cashbacks and cashback ledger",
      location: "db.js",
      policy: "Financial evidence only; not an identity authority."
    },
    {
      source: "campaign contacts and commercial tables",
      location: "db.js",
      policy: "Activation evidence only; never creates master identity automatically."
    }
  ]
});

const FIELD_GROUPS = Object.freeze({
  identity: ["name", "first_name", "fantasy_name", "document", "person_type"],
  contact: ["phone", "mobile", "mobile_normalized", "phone_fixed", "email"],
  address: ["address", "number", "complement", "neighborhood", "zipcode", "city", "state"],
  provenance: [
    "source", "external_id", "external_code", "source_file", "source_row",
    "import_hash", "source_files_json", "dedupe_key"
  ],
  lifecycle: ["status", "deleted_at", "created_at", "updated_at"]
});

const LEGACY_ENTRYPOINTS = Object.freeze([
  {
    location: "modules/customers/customerUnifiedService.js",
    functions: [
      "normalizeCustomerDocument", "normalizeCustomerEmail", "normalizeCustomerPhone",
      "normalizeSourceRecord", "buildCustomerUnifiedKey", "buildRecordKeys",
      "mergeCustomerRecordsReadOnly", "buildUnifiedCustomers"
    ],
    risk: "Read model uses unstable generated IDs, transitive key union and longest-string precedence; it is not master truth."
  },
  {
    location: "server.js",
    functions: ["normalizePhone", "normalizeBrazilMobile", "CRM import normalizers"],
    risk: "Multiple contracts with different DDI, carrier-prefix and validity behavior."
  },
  {
    location: "modules/pdv/pdvConsolidationService.js",
    functions: ["phone normalization for consolidation"],
    risk: "Operational normalization removes country code and must not become identity authority."
  }
]);

const ROUTE_SURFACES = Object.freeze([
  {
    method: "GET",
    route: "/api/crm_contacts",
    source: "crm_contacts",
    mode: "read",
    risk: "Legacy CRM read contract; not wired to the Fase 3.1-A normalizers."
  },
  {
    method: "POST",
    route: "/api/crm_contacts/import/preview",
    source: "crm_contacts",
    mode: "preview",
    risk: "Uses legacy import normalization and requires an explicit later integration phase."
  },
  {
    method: "POST",
    route: "/api/crm_contacts/import/commit",
    source: "crm_contacts",
    mode: "write",
    risk: "Operational write path; intentionally untouched."
  },
  {
    method: "POST",
    route: "/api/contacts",
    source: "contacts",
    mode: "write",
    risk: "Manual customer creation and duplicate rules remain unchanged."
  },
  {
    method: "GET",
    route: "/api/customers/unified",
    source: "contacts + crm_contacts",
    mode: "legacy-read",
    risk: "Current unified projection is read-only but is not master identity truth."
  },
  {
    method: "POST",
    route: "/api/customers/unified/:id/activate",
    source: "legacy unified projection -> contacts",
    mode: "write",
    risk: "Propagation-capable legacy route; explicitly excluded from this phase."
  }
]);

function splitColumnDefinitions(body) {
  return body
    .split(",")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseColumn(definition) {
  const match = definition.match(/^([a-z_][a-z0-9_]*)\s+(.+)$/i);
  if (!match || /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(match[1])) return null;
  const definitionText = match[2].trim();
  const defaultMatch = definitionText.match(/\bDEFAULT\s+('(?:[^']|'')*'|"(?:[^"]|"")*"|[^\s,]+)/i);
  return {
    name: match[1],
    type: (definitionText.match(/^([A-Z]+)/i) || [null, ""])[1].toUpperCase(),
    nullable: !/\bNOT\s+NULL\b/i.test(definitionText) && !/\bPRIMARY\s+KEY\b/i.test(definitionText),
    default: defaultMatch ? defaultMatch[1] : null,
    primaryKey: /\bPRIMARY\s+KEY\b/i.test(definitionText)
  };
}

function inspectTableSchema(dbSource, table) {
  const createPattern = new RegExp(
    `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\s*\\(([\\s\\S]*?)\\)\\s*\\x60`,
    "i"
  );
  const createMatch = dbSource.match(createPattern);
  if (!createMatch) throw new Error(`Schema source missing CREATE TABLE for ${table}`);

  const columnMap = new Map();
  splitColumnDefinitions(createMatch[1]).forEach((definition) => {
    const column = parseColumn(definition);
    if (column) columnMap.set(column.name, column);
  });

  const ensurePattern = new RegExp(
    `ensureColumn\\("${table}",\\s*"([^"]+)",\\s*"([^"]+)"\\)`,
    "g"
  );
  for (const match of dbSource.matchAll(ensurePattern)) {
    if (!columnMap.has(match[1])) {
      const column = parseColumn(`${match[1]} ${match[2]}`);
      if (column) columnMap.set(column.name, column);
    }
  }

  const indexes = [];
  const indexPattern = new RegExp(
    `CREATE\\s+(UNIQUE\\s+)?INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+([a-z0-9_]+)\\s+ON\\s+${table}\\s*\\(([^)]+)\\)`,
    "gi"
  );
  for (const match of dbSource.matchAll(indexPattern)) {
    indexes.push({
      name: match[2],
      unique: Boolean(match[1]),
      columns: match[3].split(",").map((column) => column.trim().replace(/\s+(ASC|DESC)$/i, ""))
    });
  }

  const columns = Array.from(columnMap.values());
  return {
    table,
    primaryKey: columns.find((column) => column.primaryKey)?.name || null,
    columns,
    indexes
  };
}

function inspectCustomerSourceSchema(dbSource) {
  return OFFICIAL_MASTER_SOURCES.map((table) => inspectTableSchema(dbSource, table));
}

function assertExpectedCustomerSchema(dbSource) {
  const inspected = inspectCustomerSourceSchema(dbSource);
  for (const tableSchema of inspected) {
    const expected = EXPECTED_SCHEMA[tableSchema.table];
    const actualColumns = tableSchema.columns.map((column) => column.name);
    const actualIndexes = tableSchema.indexes.map((index) => index.name);
    if (tableSchema.primaryKey !== expected.primaryKey) {
      throw new Error(`${tableSchema.table}: primary key drift`);
    }
    if (JSON.stringify(actualColumns) !== JSON.stringify(expected.columns)) {
      throw new Error(`${tableSchema.table}: column drift`);
    }
    if (JSON.stringify(actualIndexes) !== JSON.stringify(expected.indexes)) {
      throw new Error(`${tableSchema.table}: index drift`);
    }
    if (tableSchema.indexes.some((index) => index.unique)) {
      throw new Error(`${tableSchema.table}: unexpected unique identity index`);
    }
  }
  return inspected;
}

function buildCustomerSourceInventory(dbSource) {
  return {
    generatedFrom: "db.js source text (no database connection)",
    officialSources: assertExpectedCustomerSchema(dbSource),
    classification: SOURCE_CLASSIFICATION,
    fieldGroups: FIELD_GROUPS,
    legacyEntrypoints: LEGACY_ENTRYPOINTS,
    routeSurfaces: ROUTE_SURFACES,
    decisions: {
      currentUnifiedServiceIsTruth: false,
      shadowReadOnly: true,
      propagationEnabled: false,
      primaryAddressDefined: false,
      adminStructuralConflictReviewOnly: true,
      cpfUniqueIndexNow: false,
      retentionPolicy: "pending legal definition"
    }
  };
}

module.exports = {
  OFFICIAL_MASTER_SOURCES,
  EXPECTED_SCHEMA,
  SOURCE_CLASSIFICATION,
  FIELD_GROUPS,
  LEGACY_ENTRYPOINTS,
  ROUTE_SURFACES,
  inspectCustomerSourceSchema,
  assertExpectedCustomerSchema,
  buildCustomerSourceInventory
};
