"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createCustomerMasterSourceReader
} = require("../backfill/customerMasterSourceReader");
const {
  buildSourceRecord
} = require("../backfill/customerMasterSourceModel");
const {
  buildCandidateGraph,
  buildCandidateClusters
} = require("../backfill/customerMasterCandidateBuilder");
const {
  detectCustomerMasterConflicts
} = require("../backfill/customerMasterConflictDetector");
const {
  runCustomerMasterBackfillDryRun
} = require("../backfill/customerMasterDryRunService");
const {
  compareCustomerShadow
} = require("../services/customerMasterShadowComparisonService");
const {
  createDryRunDatabase,
  insertContact,
  insertCrmContact,
  snapshotDatabase,
  rawContact,
  createArrayReader
} = require("./customerMasterDryRunTestUtils");

test("source reader covers empty, both sources, paging and stable invalid-timestamp fallback", async () => {
  const db = await createDryRunDatabase();
  try {
    const reader = createCustomerMasterSourceReader(db);
    assert.equal(await reader.countContacts(), 0);
    assert.equal(await reader.countCrmContacts(), 0);
    assert.deepEqual(await reader.readContactsPage({ limit: 2 }), []);

    await insertContact(db, { id: "2", updated_at: "2026-02-01T00:00:00.000Z" });
    await insertContact(db, { id: "10", updated_at: "2026-01-01T00:00:00.000Z" });
    await insertContact(db, { id: "3", updated_at: "not-a-date" });
    await insertCrmContact(db, { id: "crm-1", external_id: "external-1" });

    assert.deepEqual(
      (await reader.readContactsPage({ limit: 2, offset: 0 })).map((row) => row.id),
      ["10", "2"]
    );
    assert.deepEqual(
      (await reader.readContactsPage({ limit: 2, offset: 2 })).map((row) => row.id),
      ["3"]
    );
    assert.equal((await reader.readCrmContactsPage({ limit: 1 }))[0].id, "crm-1");
  } finally {
    await db.close();
  }
});

test("service covers contacts-only, crm-contacts-only and combined source populations", async () => {
  const contact = rawContact(1);
  const crmContact = { ...rawContact(2), external_id: "synthetic-external-2" };
  const contactsOnly = await runCustomerMasterBackfillDryRun(createArrayReader([contact], []));
  const crmOnly = await runCustomerMasterBackfillDryRun(createArrayReader([], [crmContact]));
  const combined = await runCustomerMasterBackfillDryRun(
    createArrayReader([contact], [crmContact])
  );
  assert.deepEqual(contactsOnly.counts.sourceRowsByType, {
    contacts: 1,
    crm_contacts: 0
  });
  assert.deepEqual(crmOnly.counts.sourceRowsByType, {
    contacts: 0,
    crm_contacts: 1
  });
  assert.deepEqual(combined.counts.sourceRowsByType, {
    contacts: 1,
    crm_contacts: 1
  });
});

test("source model reuses normalization for phones, CPF, email, name, address and source states", () => {
  const model = buildSourceRecord("contacts", {
    id: 7,
    name: "  Synthetic   Customer ",
    mobile: "+55 (11) 90000-0001",
    phone_fixed: "(11) 3000-0001",
    phone: "(11) 8000-0001",
    document: "123.456.789-09",
    email: " CUSTOMER@EXAMPLE.INVALID ",
    address: "Synthetic Street",
    city: "Sao Paulo",
    state: "SP",
    deleted_at: "2026-01-03T00:00:00.000Z",
    status: "inactive",
    updated_at: null
  });
  const identifiers = model.normalizedIdentity.identifiers;
  assert.equal(model.sourceId, "7");
  assert.equal(identifiers.some((item) => item.classification === "BRAZIL_MOBILE"), true);
  assert.equal(identifiers.some((item) => item.classification === "BRAZIL_LANDLINE"), true);
  assert.equal(identifiers.some((item) => item.classification === "AMBIGUOUS"), true);
  const international = buildSourceRecord("crm_contacts", {
    id: "international",
    phone: "+1 202 555 0101",
    document: "123.456.789-00",
    birth_date: "not-a-date",
    updated_at: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(
    international.normalizedIdentity.identifiers.some((item) => (
      item.classification === "INTERNATIONAL_VALID"
    )),
    true
  );
  assert.equal(
    international.normalizedIdentity.identifiers.some((item) => (
      item.classification === "CPF_INVALID"
    )),
    true
  );
  assert.equal(international.warnings.includes("BIRTH_DATE_INVALID"), true);
  assert.equal(identifiers.some((item) => item.classification === "CPF_VALID"), true);
  assert.equal(identifiers.some((item) => item.classification === "EMAIL_VALID"), true);
  assert.equal(model.normalizedIdentity.name.searchValue, "synthetic customer");
  assert.equal(model.normalizedIdentity.address.isValid, true);
  assert.equal(model.sourceDeleted, true);
  assert.equal(model.sourceInactive, true);
  assert.equal(model.warnings.includes("SOURCE_UPDATED_AT_INVALID_OR_MISSING"), true);
});

test("candidate rules reject email, name, CPF or phone alone and allow only explicit combined evidence", () => {
  const records = [
    buildSourceRecord("contacts", rawContact(1, {
      name: "Same Name", document: "123.456.789-09", phone: "", email: ""
    })),
    buildSourceRecord("crm_contacts", {
      ...rawContact(2, { name: "Same Name", document: "123.456.789-09", phone: "", email: "" }),
      external_id: ""
    }),
    buildSourceRecord("contacts", rawContact(3, {
      name: "Phone Pair", phone: "11900000003", email: "pair@example.invalid", document: ""
    })),
    buildSourceRecord("crm_contacts", {
      ...rawContact(4, {
        name: "Different Name", phone: "11900000003", email: "pair@example.invalid", document: ""
      }),
      external_id: ""
    }),
    buildSourceRecord("contacts", rawContact(5, {
      name: "Email Only A", phone: "", email: "email-only@example.invalid", document: ""
    })),
    buildSourceRecord("crm_contacts", {
      ...rawContact(6, {
        name: "Email Only B", phone: "", email: "email-only@example.invalid", document: ""
      }),
      external_id: ""
    }),
    buildSourceRecord("contacts", rawContact(7, {
      name: "Cpf Alone A", phone: "", email: "", document: "987.654.321-00"
    })),
    buildSourceRecord("crm_contacts", {
      ...rawContact(8, {
        name: "Cpf Alone B", phone: "", email: "", document: "987.654.321-00"
      }),
      external_id: ""
    }),
    buildSourceRecord("contacts", rawContact(9, {
      name: "Name Alone", phone: "", email: "", document: ""
    })),
    buildSourceRecord("crm_contacts", {
      ...rawContact(10, {
        name: "Name Alone", phone: "", email: "", document: ""
      }),
      external_id: ""
    }),
    buildSourceRecord("contacts", rawContact(11, {
      name: "Phone Alone A", phone: "11900000011", email: "", document: ""
    })),
    buildSourceRecord("crm_contacts", {
      ...rawContact(12, {
        name: "Phone Alone B", phone: "11900000011", email: "", document: ""
      }),
      external_id: ""
    })
  ];
  const graph = buildCandidateGraph(records);
  const candidates = buildCandidateClusters(records, graph);
  assert.equal(graph.edges.some((edge) => edge.rule === "CPF_WITH_SECOND_SIGNAL"), true);
  assert.equal(graph.edges.some((edge) => edge.rule === "UNIQUE_PHONE_WITH_SECOND_SIGNAL"), true);
  assert.equal(graph.edges.some((edge) => edge.left === 4 && edge.right === 5), false);
  assert.equal(graph.edges.some((edge) => edge.left === 6 && edge.right === 7), false);
  assert.equal(graph.edges.some((edge) => edge.left === 8 && edge.right === 9), false);
  assert.equal(graph.edges.some((edge) => edge.left === 10 && edge.right === 11), false);
  assert.equal(candidates.filter((candidate) => candidate.classification === "ISOLATED").length, 8);
});

test("transitive bridge, divergent identity, shared phone and recycled-phone uncertainty are explicit", () => {
  const records = [
    buildSourceRecord("contacts", rawContact(1, {
      name: "Bridge Person", phone: "", email: "", document: "123.456.789-09"
    })),
    buildSourceRecord("crm_contacts", {
      ...rawContact(2, {
        name: "Bridge Person", phone: "", email: "", document: "123.456.789-09"
      }),
      external_id: "bridge-ext"
    }),
    buildSourceRecord("crm_contacts", {
      ...rawContact(3, {
        name: "Divergent Person", phone: "", email: "", document: ""
      }),
      external_id: "bridge-ext"
    }),
    buildSourceRecord("contacts", rawContact(4, { phone: "11900000004" })),
    buildSourceRecord("contacts", rawContact(5, { phone: "11900000004" })),
    buildSourceRecord("contacts", rawContact(6, { phone: "11900000004" }))
  ];
  const graph = buildCandidateGraph(records);
  const candidates = buildCandidateClusters(records, graph);
  const result = detectCustomerMasterConflicts(records, graph, candidates);
  const types = new Set(result.conflicts.map((conflict) => conflict.type));
  assert.equal(types.has("TRANSITIVE_MATCH_CONFLICT"), true);
  assert.equal(types.has("NAME_MISMATCH"), true);
  assert.equal(types.has("PHONE_DUPLICATE"), true);
  assert.equal(types.has("PHONE_SHARED"), true);
  assert.equal(types.has("MULTIPLE_ELIGIBLE_CUSTOMERS"), true);
  assert.equal(result.warnings.includes("PHONE_RECYCLED_NOT_DETERMINABLE_WITHOUT_HISTORY"), true);
});

test("all determinable conflict families carry blocking, participants and masked evidence", () => {
  const records = [
    buildSourceRecord("crm_contacts", {
      ...rawContact(1, {
        name: "Divergent A",
        phone: "11900000001",
        document: "123.456.789-09",
        email: "shared@example.invalid"
      }),
      external_id: "shared-external"
    }),
    buildSourceRecord("crm_contacts", {
      ...rawContact(2, {
        name: "Divergent B",
        phone: "11900000002",
        document: "111.444.777-35",
        email: "shared@example.invalid"
      }),
      external_id: "shared-external",
      status: "inactive"
    }),
    buildSourceRecord("contacts", rawContact(3, {
      id: "collision",
      phone: "11900000003",
      document: "123.456.789-00",
      deleted_at: "2026-01-02T00:00:00.000Z"
    })),
    buildSourceRecord("contacts", rawContact(4, {
      id: "collision",
      phone: "11900000004"
    })),
    buildSourceRecord("contacts", rawContact(5, {
      phone: "11900000005",
      email: "duplicate@example.invalid"
    })),
    buildSourceRecord("crm_contacts", {
      ...rawContact(6, {
        phone: "11900000006",
        email: "duplicate@example.invalid"
      }),
      external_id: ""
    }),
    buildSourceRecord("contacts", rawContact(7, {
      id: "invalid-cpf-isolated",
      phone: "11900000007",
      document: "123.456.789-00"
    }))
  ];
  const graph = buildCandidateGraph(records);
  const candidates = buildCandidateClusters(records, graph);
  const result = detectCustomerMasterConflicts(records, graph, candidates, {
    staleBefore: "2030-01-01T00:00:00.000Z"
  });
  const types = new Set(result.conflicts.map((conflict) => conflict.type));
  for (const type of [
    "CPF_MISMATCH",
    "PHONE_MISMATCH",
    "CPF_INVALID",
    "EMAIL_DUPLICATE",
    "NAME_MISMATCH",
    "SOURCE_ID_COLLISION",
    "INACTIVE_SOURCE",
    "DELETED_SOURCE",
    "STALE_SOURCE",
    "MANUAL_REVIEW_REQUIRED"
  ]) {
    assert.equal(types.has(type), true, `missing ${type}`);
  }
  assert.equal(result.conflicts.some((conflict) => conflict.blocking), true);
  assert.equal(result.conflicts.every((conflict) => conflict.participants.length > 0), true);
  const serialized = JSON.stringify(result.conflicts);
  assert.equal(serialized.includes("11900000001"), false);
  assert.equal(serialized.includes("12345678909"), false);
  assert.equal(serialized.includes("shared@example.invalid"), false);
});

test("full dry-run is complete, sanitized, deterministic and does not mutate legacy or master tables", async () => {
  const db = await createDryRunDatabase();
  try {
    await insertContact(db, {
      id: "contact-safe",
      name: "Synthetic Safe",
      phone: "11900000001",
      document: "123.456.789-09",
      email: "private-safe@example.invalid",
      address: "Private Synthetic Street",
      city: "Sao Paulo",
      state: "SP"
    });
    await insertCrmContact(db, {
      id: "crm-safe",
      name: "Synthetic Safe",
      document: "123.456.789-09",
      external_id: "private-external-value"
    });
    await insertContact(db, {
      id: "contact-deleted",
      name: "Deleted Synthetic",
      phone: "11900000002",
      deleted_at: "2026-01-02T00:00:00.000Z"
    });
    const before = await snapshotDatabase(db);
    const reader = createCustomerMasterSourceReader(db);
    const first = await runCustomerMasterBackfillDryRun(reader, {
      codeVersion: "synthetic-test-commit"
    });
    const second = await runCustomerMasterBackfillDryRun(reader, {
      codeVersion: "synthetic-test-commit"
    });
    const after = await snapshotDatabase(db);

    assert.equal(first.status, "COMPLETE");
    assert.equal(first.mode, "DRY_RUN");
    assert.equal(first.fingerprint, second.fingerprint);
    assert.deepEqual(after, before);
    assert.equal(Object.values(after.masterCounts).every((count) => count === 0), true);
    assert.equal(first.counts.sourceRowsByType.contacts, 2);
    assert.equal(first.counts.sourceRowsByType.crm_contacts, 1);
    assert.equal(first.counts.deletedSources, 1);
    assert.equal(first.counts.safeCandidates, 1);
    assert.equal(
      first.candidates.some((candidate) => (
        candidate.simulatedEligibility.accessDecision === "NOT_AVAILABLE_IN_PHASE_3_1_D"
      )),
      true
    );
    assert.equal(
      first.candidates.some((candidate) => (
        candidate.simulatedEligibility.simulatedStatus
          === "SIMULATED_ELIGIBLE_SUBJECT_TO_PHONE_VERIFICATION"
      )),
      true
    );
    assert.equal(
      first.candidates.some((candidate) => (
        candidate.simulatedEligibility.simulatedStatus === "SIMULATED_INELIGIBLE"
      )),
      true
    );

    const serialized = JSON.stringify(first);
    for (const forbidden of [
      "private-safe@example.invalid",
      "Private Synthetic Street",
      "private-external-value",
      "12345678909",
      "canonicalValue",
      "rawIdentity",
      "sourceHash",
      "lookupHash",
      "protectedValue"
    ]) {
      assert.equal(serialized.includes(forbidden), false, `report leaked ${forbidden}`);
    }
  } finally {
    await db.close();
  }
});

test("open blocking conflicts and multiple eligible phone owners never become real access", async () => {
  const report = await runCustomerMasterBackfillDryRun(createArrayReader([
    rawContact(1, {
      phone: "11900000001",
      email: "same-owner-signal@example.invalid"
    }),
    rawContact(2, {
      phone: "11900000001",
      email: "same-owner-signal@example.invalid"
    })
  ]));
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.counts.blockingConflicts > 0, true);
  assert.equal(report.counts.conflictsByType.MULTIPLE_ELIGIBLE_CUSTOMERS > 0, true);
  assert.equal(report.candidates[0].classification, "CONFLICT");
  assert.equal(report.candidates[0].simulatedEligibility.blockingConflicts.length > 0, true);
  assert.equal(
    report.candidates.every((candidate) => (
      candidate.simulatedEligibility.accessDecision === "NOT_AVAILABLE_IN_PHASE_3_1_D"
    )),
    true
  );
  assert.equal(JSON.stringify(report).includes("\"SIMULATED_ELIGIBLE\""), false);
});

test("legacy DTO and 3.1-C shadow result are compared in memory without operational decisions", async () => {
  const report = await runCustomerMasterBackfillDryRun(
    createArrayReader([rawContact(1, { document: "", email: "" })]),
    {
      codeVersion: "synthetic-comparison-v1",
      legacySummary: {
        groupCount: 1,
        conflictCount: 0,
        groups: [{
          sourceTypes: ["contacts"],
          identifierTypes: ["PHONE"],
          status: "ACTIVE",
          maskedOnly: true
        }],
        shadowComparisons: [compareCustomerShadow(
          {
            master: { id: "synthetic-master", displayName: "Synthetic", status: "ACTIVE" },
            sources: [{ sourceType: "contacts" }],
            identifiers: [],
            conflicts: [],
            eligibility: { observableStatus: "NOT_EVALUATED" },
            addressObservation: { available: false, sourceTypes: [] }
          },
          {
            unified_id: "synthetic-legacy",
            name: "Synthetic",
            source_count: 1,
            identifier_count: 0,
            conflict: false,
            status: "ACTIVE",
            observableEligibility: "NOT_EVALUATED",
            addressPresent: false,
            addressSourceTypes: []
          }
        )]
      }
    }
  );
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.legacyComparison.classification, "MATCH");
  assert.equal(
    report.legacyComparison.warnings.includes(
      "SHADOW_COMPARISON_DOES_NOT_AUTHORIZE_OPERATIONAL_DECISIONS"
    ),
    true
  );
});

test("missing schema, count drift, record, cluster, evidence and operation limits fail safely", async () => {
  const missing = createArrayReader();
  missing.getSourceSchemaSummary = async () => ({
    contacts: { exists: false },
    crm_contacts: { exists: true }
  });
  assert.equal(
    (await runCustomerMasterBackfillDryRun(missing)).errors[0].code,
    "SOURCE_SCHEMA_UNAVAILABLE"
  );

  const records = Array.from({ length: 3 }, (_, index) => rawContact(index + 1));
  assert.equal(
    (await runCustomerMasterBackfillDryRun(createArrayReader(records), {
      limits: { maxRecords: 2 }
    })).errors[0].code,
    "SOURCE_RECORD_LIMIT_EXCEEDED"
  );

  const drift = createArrayReader(records);
  drift.countContacts = async () => 4;
  assert.equal(
    (await runCustomerMasterBackfillDryRun(drift)).errors[0].code,
    "SOURCE_COUNT_CHANGED_DURING_READ"
  );

  const shared = records.map((row) => ({ ...row, phone: "11900000001" }));
  assert.equal(
    (await runCustomerMasterBackfillDryRun(createArrayReader(shared), {
      limits: { maxClusterSize: 2 }
    })).errors[0].code,
    "CLUSTER_SIZE_LIMIT_EXCEEDED"
  );

  assert.equal(
    (await runCustomerMasterBackfillDryRun(createArrayReader([rawContact(1)]), {
      limits: { maxEvidenceBytes: 1 }
    })).status,
    "COMPLETE"
  );

  const paired = [
    rawContact(1, { phone: "11900000001", email: "pair@example.invalid" }),
    rawContact(2, { phone: "11900000001", email: "pair@example.invalid" })
  ];
  assert.equal(
    (await runCustomerMasterBackfillDryRun(createArrayReader(paired), {
      limits: { maxEvidenceBytes: 1 }
    })).errors[0].code,
    "CONFLICT_EVIDENCE_LIMIT_EXCEEDED"
  );
  assert.equal(
    (await runCustomerMasterBackfillDryRun(createArrayReader(paired), {
      limits: { maxOperations: 2 }
    })).errors[0].code,
    "OPERATION_LIMIT_EXCEEDED"
  );
});

test("dry-run modules have no global database, route, network or operational-module integration", () => {
  const directory = path.join(__dirname, "../backfill");
  const source = fs.readdirSync(directory)
    .filter((name) => name.endsWith(".js"))
    .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /dbApi\.run|new\s+sqlite3\.Database|require\(["'][^"']*(db|server)\b/i);
  assert.doesNotMatch(source, /customerUnifiedService|express|router\.|apps[\\/]mobile/i);
  assert.doesNotMatch(source, /https?:\/\/|process\.env|\.env\b/i);
  assert.doesNotMatch(source, /\b(apply|persist|backfillReal|writeMaster|mergeMaster)\s*\(/i);
});
