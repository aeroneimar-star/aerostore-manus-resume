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
  applyCustomerIdentityAdminSchema,
  getCustomerIdentityAdminSchemaStatus
} = require("../admin/customerIdentityAdminSchema");
const {
  CustomerIdentityAdminError,
  maskCpf,
  maskPhone,
  maskEmail,
  sanitizeAdministrativeText,
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
    ["identifier-3", "master-1", "source-1", "EMAIL", "email-hash-1", "maria.souza@example.com"],
    ["identifier-4", "master-2", "source-2", "NAME", "name-hash-2", "Marina Silva"],
    ["identifier-5", "master-3", "source-3", "PHONE", "phone-hash-3", "(47) 98888-5678"]
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
    ["conflict-4", "PHONE_SHARED", "HIGH"],
    ["conflict-5", "CPF_INVALID", "MEDIUM"],
    ["conflict-6", "PHONE_DUPLICATE", "LOW"],
    ["conflict-7", "PHONE_DUPLICATE", "MEDIUM"]
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
    ["case-critical", "IDENTITY_ELIGIBILITY", "OPEN", "CRITICAL", 3, 2, 2, "2026-06-01T10:00:00.000Z"],
    ["case-high", "IDENTITY_ELIGIBILITY", "OPEN", "HIGH", 1, 1, 1, "2026-06-02T10:00:00.000Z"],
    ["case-archived", "IDENTITY_ELIGIBILITY", "ARCHIVED", "MEDIUM", 1, 1, 1, "2026-06-03T10:00:00.000Z"],
    ["case-resolved", "IDENTITY_ELIGIBILITY", "RESOLVED", "LOW", 1, 1, 1, "2026-06-04T10:00:00.000Z"],
    ["case-reopened", "IDENTITY_ELIGIBILITY", "REOPENED", "LOW", 1, 1, 1, "2026-06-05T10:00:00.000Z"],
    ["case-medium", "IDENTITY_ELIGIBILITY", "OPEN", "MEDIUM", 1, 1, 1, "2026-06-06T10:00:00.000Z"],
    ["case-hygiene", "DATA_HYGIENE", "OPEN", "CRITICAL", 1, 1, 1, "2026-05-01T10:00:00.000Z"]
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
      composite: conflictCount > 1,
      rawPayload: { cpf: "123.456.789-01" }
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
    ["case-critical", "conflict-1"],
    ["case-critical", "conflict-2"],
    ["case-critical", "conflict-3"],
    ["case-high", "conflict-4"],
    ["case-hygiene", "conflict-5"],
    ["case-reopened", "conflict-6"],
    ["case-medium", "conflict-7"]
  ]) {
    await db.run(
      `INSERT INTO customer_identity_case_conflicts
        (case_id, conflict_id, role, created_at) VALUES (?, ?, 'EVIDENCE', ?)`,
      [caseId, conflictId, now]
    );
  }
  for (const [caseId, type, entityId] of [
    ["case-critical", "MASTER", "master-1"],
    ["case-critical", "MASTER", "master-2"],
    ["case-critical", "SOURCE", "source-1"],
    ["case-critical", "SOURCE", "source-2"],
    ["case-high", "MASTER", "master-3"],
    ["case-high", "SOURCE", "source-3"]
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

test("FASE 3.1-G.1 - fila administrativa e fluxo de revisao", { concurrency: false }, async (t) => {
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-identity-admin-"));
  const databasePath = path.join(tempDir, "identity-admin.sqlite");
  const db = openDb(databasePath);
  let server;
  let baseUrl;
  try {
    await applyCustomerMasterSchema(db);
    await applyCustomerIdentityCaseSchema(db);
    const firstMigration = await applyCustomerIdentityAdminSchema(db);
    await seedFixture(db);
    const service = createCustomerIdentityAdminService(db, { databasePath });
    const originalMasters = await db.all(
      "SELECT id, status, version, eligibility_status, eligibility_reasons_json FROM customer_master_records ORDER BY id"
    );
    const originalConflicts = await db.all(
      "SELECT id, conflict_type, severity, status, evidence_json, resolution_type, resolved_at FROM customer_identity_conflicts ORDER BY id"
    );

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

    await t.test("migração aditiva cria somente colunas operacionais", () => {
      assert.deepEqual(firstMigration.columnsAdded.sort(), [
        "last_event_at",
        "operational_flag",
        "review_started_at",
        "review_updated_at",
        "review_version",
        "reviewer_user_id"
      ]);
    });

    await t.test("migração é idempotente", async () => {
      const second = await applyCustomerIdentityAdminSchema(db);
      assert.deepEqual(second.columnsAdded, []);
      assert.equal((await getCustomerIdentityAdminSchemaStatus(db)).ready, true);
    });

    await t.test("não autenticado recebe 401", async () => {
      const response = await fetch(`${baseUrl}/api/admin/customer-identity-cases`);
      assert.equal(response.status, 401);
    });

    await t.test("perfil não ADMIN recebe 403", async () => {
      const response = await fetch(`${baseUrl}/api/admin/customer-identity-cases`, {
        headers: { Authorization: "Bearer manager" }
      });
      assert.equal(response.status, 403);
    });

    await t.test("ADMIN acessa a listagem", async () => {
      const response = await fetch(`${baseUrl}/api/admin/customer-identity-cases`, {
        headers: { Authorization: "Bearer admin" }
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.counters.total, 6);
    });

    await t.test("paginação acontece no servidor", async () => {
      const payload = await service.listCases({ page: 2, pageSize: 2 });
      assert.equal(payload.rows.length, 2);
      assert.equal(payload.pagination.page, 2);
      assert.equal(payload.pagination.total, 6);
      assert.equal(payload.pagination.pageCount, 3);
    });

    await t.test("ordenação respeita prioridade e antiguidade", async () => {
      const payload = await service.listCases({ pageSize: 20 });
      assert.deepEqual(payload.rows.slice(0, 3).map((row) => row.priority), [
        "CRITICAL",
        "HIGH",
        "MEDIUM"
      ]);
      assert.equal(payload.rows[0].id, "case-critical");
    });

    await t.test("filtros combinados funcionam", async () => {
      const payload = await service.listCases({
        status: "OPEN",
        blocking: "1",
        composite: "1",
        minConflicts: "2",
        minMasters: "2",
        createdFrom: "2026-06-01",
        createdTo: "2026-06-30",
        caseType: "IDENTITY_ELIGIBILITY"
      });
      assert.deepEqual(payload.rows.map((row) => row.id), ["case-critical"]);
    });

    await t.test("fila fora do escopo é rejeitada", async () => {
      await expectAdminError(
        service.listCases({ queue: "DATA_HYGIENE" }),
        "INVALID_QUEUE"
      );
    });

    await t.test("busca aceita apenas identificador técnico sanitizado", async () => {
      const payload = await service.listCases({ search: "case-high" });
      assert.deepEqual(payload.rows.map((row) => row.id), ["case-high"]);
      await expectAdminError(service.listCases({ search: "maria@example.com" }), "INVALID_CASE_SEARCH");
    });

    await t.test("detalhe não devolve payload bruto ou IDs internos das entidades", async () => {
      const detail = await service.getCase("case-critical");
      const serialized = JSON.stringify(detail);
      assert.equal(serialized.includes("rawPayload"), false);
      assert.equal(serialized.includes("source-1"), false);
      assert.equal(serialized.includes("master-1"), false);
      assert.equal(detail.participants.length, 2);
    });

    await t.test("CPF é mascarado no backend", async () => {
      const detail = await service.getCase("case-critical");
      const serialized = JSON.stringify(detail);
      assert.equal(serialized.includes("123.456.789-01"), false);
      assert.equal(serialized.includes("***.***.***-01"), true);
      assert.equal(maskCpf("12345678901"), "***.***.***-01");
    });

    await t.test("telefone é mascarado no backend", async () => {
      const detail = await service.getCase("case-critical");
      const serialized = JSON.stringify(detail);
      assert.equal(serialized.includes("(47) 99999-1234"), false);
      assert.equal(serialized.includes("(47) *****-1234"), true);
      assert.equal(maskPhone("47999991234"), "(47) *****-1234");
    });

    await t.test("e-mail é mascarado no backend", async () => {
      const detail = await service.getCase("case-critical");
      const serialized = JSON.stringify(detail);
      assert.equal(serialized.includes("maria.souza@example.com"), false);
      assert.equal(serialized.includes("m***@e***.com"), true);
      assert.equal(maskEmail("maria.souza@example.com"), "m***@e***.com");
    });

    await t.test("texto administrativo remove PII integral", () => {
      const sanitized = sanitizeAdministrativeText(
        "CPF 123.456.789-01, telefone (47) 99999-1234 e maria.souza@example.com"
      );
      assert.equal(sanitized.includes("123.456.789-01"), false);
      assert.equal(sanitized.includes("99999-1234"), false);
      assert.equal(sanitized.includes("maria.souza@example.com"), false);
    });

    await t.test("início de revisão atribui responsável e cria auditoria", async () => {
      const detail = await service.startReview(
        "case-critical",
        { id: "10" },
        { expectedVersion: 0, reason: "Triagem administrativa" }
      );
      assert.equal(detail.status, "UNDER_REVIEW");
      assert.equal(detail.reviewerUserId, "10");
      assert.equal(detail.reviewVersion, 1);
      assert.equal(detail.events[0].eventType, "REVIEW_STARTED");
    });

    await t.test("disputa com versão antiga retorna 409", async () => {
      await expectAdminError(
        service.startReview(
          "case-critical",
          { id: "11" },
          { expectedVersion: 0, reason: "Disputa concorrente" }
        ),
        "CASE_CONCURRENT_UPDATE",
        409
      );
    });

    await t.test("duas requisições simultâneas têm um vencedor e um 409", async () => {
      const competingService = createCustomerIdentityAdminService(db, { databasePath });
      const results = await Promise.allSettled([
        service.startReview(
          "case-medium",
          { id: "10" },
          { expectedVersion: 0, reason: "Primeiro administrador" }
        ),
        competingService.startReview(
          "case-medium",
          { id: "11" },
          { expectedVersion: 0, reason: "Segundo administrador" }
        )
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      const rejected = results.find((result) => result.status === "rejected");
      assert.equal(rejected.reason.code, "CASE_CONCURRENT_UPDATE");
      assert.equal(rejected.reason.status, 409);
    });

    await t.test("outro administrador não altera revisão assumida", async () => {
      await expectAdminError(
        service.markWaitingInformation(
          "case-critical",
          { id: "11" },
          { expectedVersion: 1, reason: "Tentativa externa" }
        ),
        "CASE_REVIEWED_BY_ANOTHER_ADMIN",
        409
      );
    });

    await t.test("observação é sanitizada e auditada", async () => {
      const detail = await service.addNote(
        "case-critical",
        { id: "10" },
        {
          expectedVersion: 1,
          reason: "Registro de contexto",
          note: "Confirmar com maria.souza@example.com"
        }
      );
      assert.equal(detail.reviewVersion, 2);
      assert.equal(detail.events[0].eventType, "NOTE_ADDED");
      assert.equal(JSON.stringify(detail.events[0]).includes("maria.souza@example.com"), false);
    });

    await t.test("aguardando informação preserva UNDER_REVIEW", async () => {
      const detail = await service.markWaitingInformation(
        "case-critical",
        { id: "10" },
        { expectedVersion: 2, reason: "Falta evidência externa" }
      );
      assert.equal(detail.status, "UNDER_REVIEW");
      assert.equal(detail.operationalFlag, "WAITING_INFORMATION");
      assert.equal(detail.events[0].eventType, "REVIEW_WAITING_INFORMATION");
    });

    await t.test("liberação devolve caso para OPEN", async () => {
      const detail = await service.releaseReview(
        "case-critical",
        { id: "10" },
        { expectedVersion: 3, reason: "Liberar fila sem resolver" }
      );
      assert.equal(detail.status, "OPEN");
      assert.equal(detail.reviewerUserId, null);
      assert.equal(detail.events[0].eventType, "REVIEW_RELEASED");
    });

    await t.test("encerrar sem resolução produz REOPENED, nunca RESOLVED", async () => {
      const started = await service.startReview(
        "case-high",
        { id: "10" },
        { expectedVersion: 0, reason: "Nova análise" }
      );
      const ended = await service.endWithoutResolution(
        "case-high",
        { id: "10" },
        { expectedVersion: started.reviewVersion, reason: "Sem evidência suficiente" }
      );
      assert.equal(ended.status, "REOPENED");
      assert.equal(ended.events[0].eventType, "CASE_REOPENED");
    });

    await t.test("caso RESOLVED pode ser reaberto sem resolução nova", async () => {
      const detail = await service.reopenCase(
        "case-resolved",
        { id: "10" },
        { expectedVersion: 0, reason: "Revisão administrativa necessária" }
      );
      assert.equal(detail.status, "REOPENED");
    });

    await t.test("transição inválida é bloqueada", async () => {
      await expectAdminError(
        service.startReview(
          "case-archived",
          { id: "10" },
          { expectedVersion: 0, reason: "Transição inválida" }
        ),
        "INVALID_CASE_TRANSITION",
        409
      );
    });

    await t.test("caso inexistente retorna 404", async () => {
      const response = await fetch(
        `${baseUrl}/api/admin/customer-identity-cases/case-inexistente`,
        { headers: { Authorization: "Bearer admin" } }
      );
      assert.equal(response.status, 404);
    });

    await t.test("payload inválido retorna 400", async () => {
      const response = await fetch(
        `${baseUrl}/api/admin/customer-identity-cases/case-medium/review/start`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer admin",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ reason: "" })
        }
      );
      assert.equal(response.status, 400);
    });

    await t.test("eventos são imutáveis e consultáveis", async () => {
      const events = await service.getEvents("case-critical");
      assert.ok(events.length >= 5);
      assert.equal(events.some((event) => event.eventType === "REVIEW_STARTED"), true);
      assert.equal(events.some((event) => event.eventType === "REVIEW_RELEASED"), true);
    });

    await t.test("customer masters e elegibilidade permanecem intactos", async () => {
      const after = await db.all(
        "SELECT id, status, version, eligibility_status, eligibility_reasons_json FROM customer_master_records ORDER BY id"
      );
      assert.deepEqual(after, originalMasters);
      assert.equal(after.every((row) => row.eligibility_status === "BLOCKED"), true);
    });

    await t.test("conflitos originais permanecem intactos e OPEN", async () => {
      const after = await db.all(
        "SELECT id, conflict_type, severity, status, evidence_json, resolution_type, resolved_at FROM customer_identity_conflicts ORDER BY id"
      );
      assert.deepEqual(after, originalConflicts);
      assert.equal(after.every((row) => row.status === "OPEN"), true);
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
