"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const sqlite3 = require("sqlite3");

const {
  applyCustomerMasterSchema
} = require("../persistence/customerMasterSchema");
const {
  applyCustomerIdentityCaseSchema
} = require("../persistence/customerIdentityCaseSchema");
const {
  applyCustomerIdentityAdminSchema
} = require("../admin/customerIdentityAdminSchema");
const {
  CustomerIdentityAdminError,
  createCustomerIdentityAdminService
} = require("../admin/customerIdentityAdminService");
const {
  createCustomerIdentityAdminRouter
} = require("../admin/customerIdentityAdminRoutes");

function openDb(databasePath) {
  const connection = new sqlite3.Database(databasePath);
  const run = (sql, params = []) => new Promise((resolve, reject) => {
    connection.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      return resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
  const get = (sql, params = []) => new Promise((resolve, reject) => {
    connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
  const all = (sql, params = []) => new Promise((resolve, reject) => {
    connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
  const close = () => new Promise((resolve, reject) => {
    connection.close((error) => error ? reject(error) : resolve());
  });
  return { run, get, all, close };
}

async function seedFixture(db) {
  const now = "2026-07-01T10:00:00.000Z";
  for (const [id, displayName] of [["master-1", "Maria Souza"], ["master-2", "Marina Silva"], ["master-3", "Ana Lima"]]) {
    await db.run(
      `INSERT INTO customer_master_records
        (id, display_name, status, version, eligibility_status,
         eligibility_reasons_json, eligibility_rule_version, eligibility_source_version,
         created_at, updated_at)
       VALUES (?, ?, 'ACTIVE', 1, 'BLOCKED', '["IDENTITY_CONFLICT"]', 'eligibility/v1', 'source/v1', ?, ?)`,
      [id, displayName, now, now]
    );
  }
  for (const row of [
    ["source-1", "master-1", "contacts", "101"],
    ["source-2", "master-2", "crm_contacts", "202"],
    ["source-3", "master-3", "contacts", "303"]
  ]) {
    await db.run(
      `INSERT INTO customer_master_sources
        (id, master_id, source_type, source_id, source_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'fixture-hash', 'ACTIVE', ?, ?)`,
      [...row, now, now]
    );
  }
  for (const row of [
    ["identifier-1", "master-1", "source-1", "CPF", "cpf-hash-1", "123.456.789-01"],
    ["identifier-2", "master-1", "source-1", "PHONE", "phone-hash-1", "(47) 99999-1234"],
    ["identifier-3", "master-2", "source-2", "PHONE", "phone-hash-2", "(47) 98888-5678"]
  ]) {
    await db.run(
      `INSERT INTO customer_master_identifiers
        (id, master_id, source_link_id, identifier_type, lookup_hash, masked_value,
         validation_status, verification_status, is_primary, is_active,
         normalization_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'VALID', 'NOT_VERIFIED', 1, 1, 'normalization/v1', ?, ?)`,
      [...row, now, now]
    );
  }

  const conflicts = [
    ["conflict-1", "PHONE_DUPLICATE", "CRITICAL"],
    ["conflict-2", "PHONE_SHARED", "HIGH"],
    ["conflict-3", "MULTIPLE_ELIGIBLE_CUSTOMERS", "HIGH"],
    ["conflict-4", "CPF_INVALID", "MEDIUM"],
    ["conflict-5", "CPF_DUPLICATE", "HIGH"],
    ["conflict-6", "PHONE_DUPLICATE", "MEDIUM"],
    ["conflict-7", "PHONE_SHARED", "HIGH"],
    ["conflict-8", "PHONE_DUPLICATE", "LOW"]
  ];
  for (const row of conflicts) {
    await db.run(
      `INSERT INTO customer_identity_conflicts
        (id, conflict_type, severity, status, rule_version, evidence_json, created_at, updated_at)
       VALUES (?, ?, ?, 'OPEN', 'conflict/v1', '{"blocking":true}', ?, ?)`,
      [...row, now, now]
    );
  }

  const cases = [
    ["case-alpha", "IDENTITY_ELIGIBILITY", "OPEN", "CRITICAL", 2, 2, 2, "2026-06-01T10:00:00.000Z"],
    ["case-beta", "IDENTITY_ELIGIBILITY", "OPEN", "HIGH", 1, 1, 1, "2026-06-02T10:00:00.000Z"],
    ["case-gamma", "IDENTITY_ELIGIBILITY", "OPEN", "MEDIUM", 2, 1, 1, "2026-06-03T10:00:00.000Z"],
    ["case-delta", "IDENTITY_ELIGIBILITY", "OPEN", "HIGH", 1, 1, 1, "2026-06-04T10:00:00.000Z"],
    ["case-epsilon", "IDENTITY_ELIGIBILITY", "OPEN", "LOW", 1, 1, 1, "2026-06-05T10:00:00.000Z"],
    ["case-hygiene", "DATA_HYGIENE", "OPEN", "MEDIUM", 1, 1, 1, "2026-06-06T10:00:00.000Z"]
  ];
  for (const [id, queue, status, priority, conflictCount, masterCount, sourceCount, createdAt] of cases) {
    const summary = JSON.stringify({
      summaryVersion: "customer-identity-case-summary/v1",
      queueType: queue,
      caseType: queue === "DATA_HYGIENE" ? "CPF_DATA_HYGIENE" : "IDENTITY_ELIGIBILITY",
      priority,
      blocking: true,
      conflictCount,
      masterCount,
      sourceCount,
      conflictTypes: { PHONE_DUPLICATE: conflictCount },
      severities: { [priority]: conflictCount },
      composite: conflictCount > 1
    });
    await db.run(
      `INSERT INTO customer_identity_cases
        (id, case_type, queue_type, status, priority, blocking, fingerprint,
         grouping_version, conflict_count, master_count, source_count, summary_json,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 'grouping/v1', ?, ?, ?, ?, ?, ?)`,
      [
        id,
        queue === "DATA_HYGIENE" ? "CPF_DATA_HYGIENE" : "IDENTITY_ELIGIBILITY",
        queue,
        status,
        priority,
        `fingerprint-${id}`,
        conflictCount,
        masterCount,
        sourceCount,
        summary,
        createdAt,
        createdAt
      ]
    );
    await db.run(
      `INSERT INTO customer_identity_case_events
        (id, case_id, event_type, reason, before_json, after_json, created_at)
       VALUES (?, ?, 'CREATED', 'fixture', '{}', '{"status":"OPEN"}', ?)`,
      [`event-${id}`, id, createdAt]
    );
  }

  for (const [caseId, conflictId] of [
    ["case-alpha", "conflict-1"],
    ["case-alpha", "conflict-2"],
    ["case-beta", "conflict-3"],
    ["case-gamma", "conflict-4"],
    ["case-gamma", "conflict-5"],
    ["case-hygiene", "conflict-6"],
    ["case-delta", "conflict-7"],
    ["case-epsilon", "conflict-8"]
  ]) {
    await db.run(
      `INSERT INTO customer_identity_case_conflicts
        (case_id, conflict_id, role, created_at) VALUES (?, ?, 'EVIDENCE', ?)`,
      [caseId, conflictId, now]
    );
  }
  for (const [caseId, type, entityId] of [
    ["case-alpha", "MASTER", "master-1"],
    ["case-alpha", "MASTER", "master-2"],
    ["case-alpha", "SOURCE", "source-1"],
    ["case-alpha", "SOURCE", "source-2"],
    ["case-beta", "MASTER", "master-3"],
    ["case-beta", "SOURCE", "source-3"]
  ]) {
    await db.run(
      `INSERT INTO customer_identity_case_entities
        (case_id, entity_type, entity_id, role, created_at)
       VALUES (?, ?, ?, 'AFFECTED', ?)`,
      [caseId, type, entityId, now]
    );
  }
}

async function expectAdminError(promise, code, status) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof CustomerIdentityAdminError);
    assert.equal(error.code, code);
    if (status) assert.equal(error.status, status);
    return true;
  });
}

function conflictSnapshot(rows) {
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    resolution_type: row.resolution_type,
    resolution_reason: row.resolution_reason,
    resolved_by: row.resolved_by,
    resolved_at: row.resolved_at,
    reopened_at: row.reopened_at
  }));
}

test("FASE 3.1-G.2 - resolucao administrativa dos casos de identidade", { concurrency: false }, async (t) => {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-identity-resolution-"));
  const databasePath = path.join(tempDir, "identity-resolution.sqlite");
  const db = openDb(databasePath);
  let server;
  let baseUrl;
  try {
    await applyCustomerMasterSchema(db);
    await applyCustomerIdentityCaseSchema(db);
    await applyCustomerIdentityAdminSchema(db);
    await seedFixture(db);
    const service = createCustomerIdentityAdminService(db, { databasePath });
    const originalMasters = await db.all(
      "SELECT id, status, version, eligibility_status, eligibility_reasons_json FROM customer_master_records ORDER BY id"
    );
    const originalLinks = await db.all(
      "SELECT case_id, conflict_id, role FROM customer_identity_case_conflicts ORDER BY case_id, conflict_id"
    );
    const originalFingerprints = await db.all(
      "SELECT id, fingerprint FROM customer_identity_cases ORDER BY id"
    );
    const readConflicts = () => db.all(
      "SELECT id, status, resolution_type, resolution_reason, resolved_by, resolved_at, reopened_at FROM customer_identity_conflicts ORDER BY id"
    );
    const originalConflicts = await readConflicts();

    const app = express();
    app.use(express.json());
    app.use("/api", (req, res, next) => {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return res.status(401).json({ error: "UNAUTHENTICATED" });
      req.user = token === "admin"
        ? { id: "10", role: "admin" }
        : { id: "20", role: "manager" };
      return next();
    });
    const requireAdmin = (req, res, next) => (
      req.user?.role === "admin"
        ? next()
        : res.status(403).json({ error: "FORBIDDEN" })
    );
    app.use(
      "/api/admin/customer-identity-cases",
      createCustomerIdentityAdminRouter({ dbApi: db, databasePath, requireAdmin })
    );
    server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const postResolution = (caseId, action, body, token = "admin") => fetch(
      `${baseUrl}/api/admin/customer-identity-cases/${caseId}/resolution/${action}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body || {})
      }
    );

    await t.test("sem autenticação a resolução retorna 401", async () => {
      const response = await fetch(
        `${baseUrl}/api/admin/customer-identity-cases/case-alpha/resolution/confirm-same-person`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      assert.equal(response.status, 401);
    });

    await t.test("perfil não ADMIN recebe 403 na resolução", async () => {
      const response = await postResolution(
        "case-alpha",
        "confirm-same-person",
        { expectedVersion: 0, reason: "Tentativa sem permissão" },
        "manager"
      );
      assert.equal(response.status, 403);
    });

    await t.test("caso inexistente retorna 404 na resolução", async () => {
      const response = await postResolution(
        "case-inexistente",
        "confirm-same-person",
        { expectedVersion: 0, reason: "Caso ausente" }
      );
      assert.equal(response.status, 404);
    });

    await t.test("motivo administrativo é obrigatório", async () => {
      await expectAdminError(
        service.confirmSamePerson("case-alpha", { id: "10" }, { expectedVersion: 0, reason: "" }),
        "REASON_REQUIRED",
        400
      );
      const response = await postResolution("case-alpha", "confirm-same-person", { expectedVersion: 0 });
      assert.equal(response.status, 400);
    });

    await t.test("versão esperada é obrigatória e conflito de versão retorna 409", async () => {
      await expectAdminError(
        service.confirmSamePerson("case-alpha", { id: "10" }, { reason: "Sem versão" }),
        "EXPECTED_VERSION_REQUIRED"
      );
      await expectAdminError(
        service.confirmSamePerson("case-alpha", { id: "10" }, { expectedVersion: 9, reason: "Versão errada" }),
        "CASE_CONCURRENT_UPDATE",
        409
      );
    });

    await t.test("resolução exige caso UNDER_REVIEW", async () => {
      await expectAdminError(
        service.confirmSamePerson("case-alpha", { id: "10" }, { expectedVersion: 0, reason: "Fora de fluxo" }),
        "INVALID_CASE_TRANSITION",
        409
      );
    });

    await t.test("confirmar mesma pessoa resolve conflitos do caso com auditoria", async () => {
      const started = await service.startReview(
        "case-alpha",
        { id: "10" },
        { expectedVersion: 0, reason: "Triagem do caso alpha" }
      );
      assert.equal(started.status, "UNDER_REVIEW");
      const resolved = await service.confirmSamePerson(
        "case-alpha",
        { id: "10" },
        { expectedVersion: started.reviewVersion, reason: "Mesmo titular confirmado por maria.souza@example.com" }
      );
      assert.equal(resolved.status, "RESOLVED");
      assert.equal(resolved.operationalFlag, "RESOLVED_SAME_PERSON");
      assert.equal(resolved.reviewerUserId, "10");
      assert.equal(resolved.events[0].eventType, "CASE_RESOLVED_SAME_PERSON");
      assert.equal(resolved.events[0].actorUserId, "10");
      assert.equal(resolved.events[0].after.resolvedConflicts, 2);
      assert.equal(JSON.stringify(resolved.events[0]).includes("maria.souza@example.com"), false);
      const conflicts = await readConflicts();
      const resolvedRows = conflicts.filter((row) => ["conflict-1", "conflict-2"].includes(row.id));
      assert.equal(resolvedRows.every((row) => row.status === "RESOLVED"), true);
      assert.equal(resolvedRows.every((row) => row.resolution_type === "CONFIRMED_SAME_PERSON"), true);
      assert.equal(resolvedRows.every((row) => row.resolved_by === "10"), true);
      assert.equal(resolvedRows.every((row) => Boolean(row.resolved_at)), true);
      assert.equal(resolvedRows.every((row) => !String(row.resolution_reason || "").includes("maria.souza@example.com")), true);
      const caseRow = await db.get("SELECT resolved_at FROM customer_identity_cases WHERE id = 'case-alpha'");
      assert.equal(Boolean(caseRow.resolved_at), true);
    });

    await t.test("recálculo é parcial: demais casos e conflitos permanecem intactos", async () => {
      const conflicts = await readConflicts();
      for (const id of ["conflict-3", "conflict-4", "conflict-5", "conflict-6", "conflict-7", "conflict-8"]) {
        const row = conflicts.find((conflict) => conflict.id === id);
        assert.equal(row.status, "OPEN");
        assert.equal(row.resolution_type, null);
      }
      const others = await db.all(
        "SELECT id, status, review_version, resolved_at FROM customer_identity_cases WHERE id != 'case-alpha' ORDER BY id"
      );
      assert.equal(others.every((row) => row.status === "OPEN" && row.resolved_at === null), true);
    });

    await t.test("repetição com versão antiga é idempotente via 409", async () => {
      const before = await readConflicts();
      await expectAdminError(
        service.confirmSamePerson("case-alpha", { id: "10" }, { expectedVersion: 1, reason: "Repetição" }),
        "CASE_CONCURRENT_UPDATE",
        409
      );
      assert.deepEqual(await readConflicts(), before);
    });

    await t.test("outro administrador não decide caso assumido", async () => {
      const started = await service.startReview(
        "case-beta",
        { id: "10" },
        { expectedVersion: 0, reason: "Análise do caso beta" }
      );
      await expectAdminError(
        service.keepSeparate("case-beta", { id: "11" }, { expectedVersion: started.reviewVersion, reason: "Invasão" }),
        "CASE_REVIEWED_BY_ANOTHER_ADMIN",
        409
      );
    });

    await t.test("manter separados registra decisão definitiva sem merge", async () => {
      const current = await service.getCase("case-beta");
      const resolved = await service.keepSeparate(
        "case-beta",
        { id: "10" },
        { expectedVersion: current.reviewVersion, reason: "Pessoas distintas confirmadas" }
      );
      assert.equal(resolved.status, "RESOLVED");
      assert.equal(resolved.operationalFlag, "RESOLVED_KEPT_SEPARATE");
      assert.equal(resolved.events[0].eventType, "CASE_RESOLVED_KEPT_SEPARATE");
      const conflict = (await readConflicts()).find((row) => row.id === "conflict-3");
      assert.equal(conflict.status, "RESOLVED");
      assert.equal(conflict.resolution_type, "KEPT_SEPARATE");
      const merges = await db.all("SELECT COUNT(*) AS total FROM customer_master_merge_history");
      assert.equal(Number(merges[0]?.total || 0), 0);
    });

    await t.test("validar CPF e rejeitar CPF com reabertura entre decisões", async () => {
      const started = await service.startReview(
        "case-gamma",
        { id: "10" },
        { expectedVersion: 0, reason: "Análise de CPF" }
      );
      const validated = await service.validateCpf(
        "case-gamma",
        { id: "10" },
        { expectedVersion: started.reviewVersion, reason: "CPF conferido na Receita" }
      );
      assert.equal(validated.status, "RESOLVED");
      assert.equal(validated.operationalFlag, "RESOLVED_CPF_VALIDATED");
      let conflicts = await readConflicts();
      assert.equal(
        conflicts.filter((row) => ["conflict-4", "conflict-5"].includes(row.id))
          .every((row) => row.resolution_type === "CPF_VALIDATED"),
        true
      );

      const reopened = await service.reopenCase(
        "case-gamma",
        { id: "10" },
        { expectedVersion: validated.reviewVersion, reason: "Nova evidência exige revisão" }
      );
      assert.equal(reopened.status, "REOPENED");
      assert.equal(reopened.events[0].eventType, "CASE_REOPENED");
      assert.equal(reopened.events[0].after.reopenedConflicts, 2);
      conflicts = await readConflicts();
      const reopenedRows = conflicts.filter((row) => ["conflict-4", "conflict-5"].includes(row.id));
      assert.equal(reopenedRows.every((row) => row.status === "OPEN"), true);
      assert.equal(reopenedRows.every((row) => row.resolution_type === null), true);
      assert.equal(reopenedRows.every((row) => row.resolved_at === null), true);
      assert.equal(reopenedRows.every((row) => Boolean(row.reopened_at)), true);
      const caseRow = await db.get("SELECT resolved_at FROM customer_identity_cases WHERE id = 'case-gamma'");
      assert.equal(caseRow.resolved_at, null);

      const restarted = await service.startReview(
        "case-gamma",
        { id: "10" },
        { expectedVersion: reopened.reviewVersion, reason: "Reanálise após reabertura" }
      );
      const rejected = await service.rejectCpf(
        "case-gamma",
        { id: "10" },
        { expectedVersion: restarted.reviewVersion, reason: "CPF inválido confirmado" }
      );
      assert.equal(rejected.status, "RESOLVED");
      assert.equal(rejected.operationalFlag, "RESOLVED_CPF_REJECTED");
      conflicts = await readConflicts();
      assert.equal(
        conflicts.filter((row) => ["conflict-4", "conflict-5"].includes(row.id))
          .every((row) => row.resolution_type === "CPF_REJECTED" && row.status === "RESOLVED"),
        true
      );
    });

    await t.test("telefone compartilhado e reciclado registram evidência sem tocar na origem", async () => {
      const started = await service.startReview(
        "case-delta",
        { id: "10" },
        { expectedVersion: 0, reason: "Análise de telefone" }
      );
      const shared = await service.markPhoneShared(
        "case-delta",
        { id: "10" },
        { expectedVersion: started.reviewVersion, reason: "Telefone comercial da empresa" }
      );
      assert.equal(shared.status, "RESOLVED");
      assert.equal(shared.operationalFlag, "RESOLVED_PHONE_SHARED");
      assert.equal(shared.events[0].eventType, "CASE_RESOLVED_PHONE_SHARED");
      let conflict = (await readConflicts()).find((row) => row.id === "conflict-7");
      assert.equal(conflict.resolution_type, "PHONE_SHARED_ACKNOWLEDGED");

      const reopened = await service.reopenCase(
        "case-delta",
        { id: "10" },
        { expectedVersion: shared.reviewVersion, reason: "Evidência de reciclagem" }
      );
      const restarted = await service.startReview(
        "case-delta",
        { id: "10" },
        { expectedVersion: reopened.reviewVersion, reason: "Reanálise de reciclagem" }
      );
      const recycled = await service.markPhoneRecycled(
        "case-delta",
        { id: "10" },
        { expectedVersion: restarted.reviewVersion, reason: "Número reciclado pela operadora" }
      );
      assert.equal(recycled.status, "RESOLVED");
      assert.equal(recycled.operationalFlag, "RESOLVED_PHONE_RECYCLED");
      assert.equal(recycled.events[0].eventType, "CASE_RESOLVED_PHONE_RECYCLED");
      conflict = (await readConflicts()).find((row) => row.id === "conflict-7");
      assert.equal(conflict.resolution_type, "PHONE_RECYCLED_ACKNOWLEDGED");
      const sources = await db.all(
        "SELECT id, master_id, source_type, source_id, status FROM customer_master_sources ORDER BY id"
      );
      assert.deepEqual(sources, [
        { id: "source-1", master_id: "master-1", source_type: "contacts", source_id: "101", status: "ACTIVE" },
        { id: "source-2", master_id: "master-2", source_type: "crm_contacts", source_id: "202", status: "ACTIVE" },
        { id: "source-3", master_id: "master-3", source_type: "contacts", source_id: "303", status: "ACTIVE" }
      ]);
    });

    await t.test("rota de resolução executa decisão completa com HTTP 200", async () => {
      const startResponse = await fetch(
        `${baseUrl}/api/admin/customer-identity-cases/case-epsilon/review/start`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer admin",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ expectedVersion: 0, reason: "Triagem via rota" })
        }
      );
      assert.equal(startResponse.status, 200);
      const started = (await startResponse.json()).case;
      const resolveResponse = await postResolution(
        "case-epsilon",
        "confirm-same-person",
        { expectedVersion: started.reviewVersion, reason: "Decisão via rota" }
      );
      assert.equal(resolveResponse.status, 200);
      const resolved = (await resolveResponse.json()).case;
      assert.equal(resolved.status, "RESOLVED");
      assert.equal(resolved.operationalFlag, "RESOLVED_SAME_PERSON");
      const conflict = (await readConflicts()).find((row) => row.id === "conflict-8");
      assert.equal(conflict.status, "RESOLVED");
      assert.equal(conflict.resolution_type, "CONFIRMED_SAME_PERSON");
    });

    await t.test("transição inválida via rota retorna 409", async () => {
      const response = await postResolution(
        "case-epsilon",
        "keep-separate",
        { expectedVersion: 2, reason: "Caso já resolvido" }
      );
      assert.equal(response.status, 409);
    });

    await t.test("caso de outra fila não é alcançado pelo service administrativo", async () => {
      const result = await service.startReview(
        "case-hygiene",
        { id: "10" },
        { expectedVersion: 0, reason: "Caso fora da fila nunca é tocado" }
      ).catch((error) => error);
      assert.ok(result instanceof CustomerIdentityAdminError);
      assert.equal(result.code, "CASE_NOT_FOUND");
      assert.equal(result.status, 404);
    });

    await t.test("fila DATA_HYGIENE permanece fora do escopo das resoluções", async () => {
      const conflict = (await readConflicts()).find((row) => row.id === "conflict-6");
      assert.equal(conflict.status, "OPEN");
      assert.equal(conflict.resolution_type, null);
    });

    await t.test("integridade: nada foi apagado e fingerprints se preservam", async () => {
      const conflicts = await readConflicts();
      assert.equal(conflicts.length, originalConflicts.length);
      assert.deepEqual(
        await db.all("SELECT case_id, conflict_id, role FROM customer_identity_case_conflicts ORDER BY case_id, conflict_id"),
        originalLinks
      );
      assert.deepEqual(
        await db.all("SELECT id, fingerprint FROM customer_identity_cases ORDER BY id"),
        originalFingerprints
      );
      const events = await db.all("SELECT COUNT(*) AS total FROM customer_identity_case_events");
      assert.ok(Number(events[0]?.total || 0) >= 20);
      const masters = await db.all(
        "SELECT id, status, version, eligibility_status, eligibility_reasons_json FROM customer_master_records ORDER BY id"
      );
      assert.deepEqual(masters, originalMasters);
      assert.equal(masters.every((row) => row.eligibility_status === "BLOCKED"), true);
    });

    await t.test("contacts e crm_contacts não são criadas nem alteradas pelo módulo", async () => {
      const tables = await db.all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('contacts', 'crm_contacts') ORDER BY name"
      );
      assert.deepEqual(tables, []);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.close().catch(() => null);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
