"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const sqlite3 = require("sqlite3");
const {
  applyAppCustomerAccessSchema,
  getAppCustomerAccessSchemaStatus
} = require("../persistence/appCustomerAccessSchema");
const { evaluateAppCustomerEligibility } = require("../evaluateAppCustomerEligibility");
const {
  AppCustomerAccessError,
  createAppCustomerAccessService,
  validateAndSanitizeRegistration
} = require("../appCustomerAccessService");
const {
  canReview,
  createAppCustomerAccessRouter,
  createAppCustomerReviewPermissionHandler
} = require("../appCustomerAccessRoutes");

function openMemoryDb() {
  const connection = new sqlite3.Database(":memory:");
  return {
    run: (sql, params = []) => new Promise((resolve, reject) => connection.run(sql, params, function done(error) {
      if (error) reject(error); else resolve({ changes: this.changes, lastID: this.lastID });
    })),
    get: (sql, params = []) => new Promise((resolve, reject) => connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row))),
    all: (sql, params = []) => new Promise((resolve, reject) => connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))),
    close: () => new Promise((resolve, reject) => connection.close((error) => error ? reject(error) : resolve()))
  };
}

async function fixture() {
  const db = openMemoryDb();
  await db.run("PRAGMA foreign_keys = ON");
  await db.run(`CREATE TABLE customer_master_records (
    id TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    eligibility_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED', updated_at TEXT NOT NULL, deleted_at TEXT
  )`);
  await db.run(`CREATE TABLE customer_identity_conflicts (
    id TEXT PRIMARY KEY, conflict_type TEXT NOT NULL, severity TEXT NOT NULL,
    status TEXT NOT NULL, rule_version TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  )`);
  await db.run(`CREATE TABLE customer_identity_conflict_participants (
    id TEXT PRIMARY KEY, conflict_id TEXT NOT NULL, participant_type TEXT NOT NULL,
    participant_id TEXT NOT NULL, FOREIGN KEY (conflict_id) REFERENCES customer_identity_conflicts(id) ON DELETE RESTRICT
  )`);
  await db.run(`CREATE TABLE customer_identity_cases (
    id TEXT PRIMARY KEY, blocking INTEGER NOT NULL DEFAULT 0
  )`);
  await db.run(`CREATE TABLE customer_identity_case_conflicts (
    case_id TEXT NOT NULL, conflict_id TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES customer_identity_cases(id) ON DELETE RESTRICT,
    FOREIGN KEY (conflict_id) REFERENCES customer_identity_conflicts(id) ON DELETE RESTRICT
  )`);
  await db.run("CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT)");
  await db.run("CREATE TABLE crm_contacts (id INTEGER PRIMARY KEY, name TEXT)");
  await db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, permissions_json TEXT, updated_at TEXT)");
  await applyAppCustomerAccessSchema(db);
  return { db, service: createAppCustomerAccessService(db) };
}

const registration = {
  fullName: "Cliente Exemplo Seguro", email: "cliente@example.test", whatsappPhone: "11987654321",
  cpf: "12345678901", cep: "12345678", street: "Rua Teste", neighborhood: "Centro",
  city: "Sao Paulo", state: "SP", number: "10", complement: "Sala", deliveryNotes: "Portaria"
};

async function seedEligible({ db, service }, accountId = "account-1", masterId = "master-1") {
  await db.run("INSERT INTO customer_master_records (id, status, updated_at) VALUES (?, 'ACTIVE', ?)", [masterId, "2026-08-01T12:00:00.000Z"]);
  await service.createAccountAndRequest({ accountId, requestId: `request-${accountId}`, requestType: "EXISTING_CUSTOMER_LINK", phone: "11987654321", now: "2026-08-01T12:00:00.000Z" });
  await service.addCandidateLink(accountId, masterId, { id: `link-${accountId}`, confidence: 100, now: "2026-08-01T12:00:00.000Z" });
  await db.run("UPDATE app_customer_accounts SET phone_verified_at = ? WHERE id = ?", ["2026-08-01T12:01:00.000Z", accountId]);
}

test("schema expansivo e migration idempotente em memoria", async () => {
  const { db } = await fixture();
  const second = await applyAppCustomerAccessSchema(db);
  assert.equal(second.after.ready, true);
  assert.equal(second.after.empty, true);
  assert.equal((await getAppCustomerAccessSchemaStatus(db)).tables.length, 4);
  await db.close();
});

test("conta nova fica pendente de confirmacao de telefone e sem aprovacao", async () => {
  const { db, service } = await fixture();
  const detail = await service.createAccountAndRequest({ accountId: "new-1", requestId: "new-r1", profile: registration });
  assert.equal(detail.accessStatus, "PENDING_PHONE_VERIFICATION");
  assert.equal(detail.phoneVerified, false);
  assert.equal(detail.request.status, "PENDING_PHONE_VERIFICATION");
  await db.close();
});

test("contrato de cadastro guarda apenas perfil protegido e sanitizado", () => {
  const sanitized = validateAndSanitizeRegistration(registration).protectedPayload;
  const text = JSON.stringify(sanitized);
  assert.doesNotMatch(text, /12345678901|11987654321|cliente@example\.test|Rua Teste|Portaria/);
  assert.match(sanitized.emailMasked, /\*\*\*@/);
  assert.equal(sanitized.deliveryNotesPresent, true);
});

test("elegibilidade bloqueia autoaprovacao sem telefone confirmado", () => {
  const result = evaluateAppCustomerEligibility({ phoneConfirmed: false, masterCandidates: [{ id: "m1", status: "ACTIVE" }], accountStatus: "ACTIVE" });
  assert.equal(result.autoApprovalEligible, false);
  assert.equal(result.outcome, "PENDING_APPROVAL");
});

test("telefone confirmado e mestre unico ativo sao elegiveis", () => {
  const result = evaluateAppCustomerEligibility({ phoneConfirmed: true, masterCandidates: [{ id: "m1", status: "ACTIVE" }], accountStatus: "ACTIVE" });
  assert.equal(result.outcome, "AUTO_APPROVAL_ELIGIBLE");
  assert.equal(result.masterId, "m1");
});

test("novo cadastro confirmado sem mestre segue para aprovacao manual", () => {
  const result = evaluateAppCustomerEligibility({ phoneConfirmed: true, masterCandidates: [], accountStatus: "ACTIVE" });
  assert.equal(result.outcome, "PENDING_APPROVAL");
  assert.equal(result.autoApprovalEligible, false);
});

test("multiplos candidatos exigem revisao sem escolher o primeiro", () => {
  const result = evaluateAppCustomerEligibility({ phoneConfirmed: true, masterCandidates: [{ id: "m1", status: "ACTIVE" }, { id: "m2", status: "ACTIVE" }], accountStatus: "ACTIVE" });
  assert.equal(result.outcome, "REVIEW_REQUIRED");
  assert.equal(result.masterId, undefined);
});

for (const type of ["PHONE_SHARED", "PHONE_RECYCLED", "PHONE_DUPLICATE", "CPF_DUPLICATE"]) {
  test(`${type} impede elegibilidade automatica`, () => {
    const result = evaluateAppCustomerEligibility({ phoneConfirmed: true, masterCandidates: [{ id: "m1", status: "ACTIVE" }], conflicts: [{ type }], accountStatus: "ACTIVE" });
    assert.equal(result.outcome, "REVIEW_REQUIRED");
  });
}

for (const status of ["INACTIVE", "BLOCKED", "DELETED", "SUSPENDED"]) {
  test(`mestre ${status} e inelegivel`, () => {
    const result = evaluateAppCustomerEligibility({ phoneConfirmed: true, masterCandidates: [{ id: "m1", status }], accountStatus: "ACTIVE" });
    assert.equal(result.outcome, "INELIGIBLE");
  });
}

test("conta suspensa ou bloqueada nao e elegivel", () => {
  for (const accountStatus of ["SUSPENDED", "BLOCKED", "CLOSED"]) {
    assert.equal(evaluateAppCustomerEligibility({ phoneConfirmed: true, masterCandidates: [{ id: "m1", status: "ACTIVE" }], accountStatus }).outcome, "BLOCKED");
  }
});

test("ADMIN aprova com telefone confirmado e vinculo mestre valido", async () => {
  const context = await fixture();
  await seedEligible(context);
  const detail = await context.service.decide("account-1", "approve", { id: 1, role: "admin" }, { expectedVersion: 1 });
  assert.equal(detail.accessStatus, "APPROVED");
  assert.equal(detail.links[0].linkStatus, "ACTIVE");
  assert.equal(detail.decisions[0].type, "ADMIN_APPROVED");
  await context.db.close();
});

test("aprovacao sem telefone confirmado e bloqueada", async () => {
  const context = await fixture();
  await seedEligible(context);
  await context.db.run("UPDATE app_customer_accounts SET phone_verified_at = NULL WHERE id = 'account-1'");
  await assert.rejects(() => context.service.decide("account-1", "approve", { id: 1, role: "admin" }, { expectedVersion: 1 }), (error) => error.code === "PHONE_NOT_VERIFIED");
  await context.db.close();
});

test("conflito estrutural bloqueante impede aprovacao", async () => {
  const context = await fixture();
  await seedEligible(context);
  await context.db.run("INSERT INTO customer_identity_conflicts (id, conflict_type, severity, status, updated_at) VALUES ('conflict-1', 'STRUCTURAL_AMBIGUITY', 'CRITICAL', 'OPEN', '2026-08-01')");
  await context.db.run("INSERT INTO customer_identity_conflict_participants (id, conflict_id, participant_type, participant_id) VALUES ('participant-1', 'conflict-1', 'MASTER', 'master-1')");
  await context.db.run("INSERT INTO customer_identity_cases (id, blocking) VALUES ('case-1', 1)");
  await context.db.run("INSERT INTO customer_identity_case_conflicts (case_id, conflict_id) VALUES ('case-1', 'conflict-1')");
  await assert.rejects(() => context.service.decide("account-1", "approve", { id: 1, role: "admin" }, { expectedVersion: 1 }), (error) => error.code === "BLOCKING_CONFLICT_REVIEW_REQUIRED");
  await context.db.close();
});

test("indice parcial impede dois vinculos ACTIVE", async () => {
  const context = await fixture();
  await seedEligible(context);
  await context.db.run("INSERT INTO customer_master_records (id, status, updated_at) VALUES ('master-2', 'ACTIVE', '2026-08-01')");
  await context.service.addCandidateLink("account-1", "master-2", { id: "link-2", linkStatus: "ACTIVE" });
  await assert.rejects(() => context.db.run("UPDATE app_customer_links SET link_status = 'ACTIVE' WHERE id = 'link-account-1'"), /UNIQUE/);
  await context.db.close();
});

test("ADMIN rejeita, suspende, reativa e bloqueia com auditoria imutavel", async () => {
  const context = await fixture();
  await seedEligible(context);
  let detail = await context.service.decide("account-1", "reject", { id: 1, role: "admin" }, { expectedVersion: 1, reason: "Divergencia" });
  detail = await context.service.decide("account-1", "suspend", { id: 1, role: "admin" }, { expectedVersion: 2, reason: "Risco" });
  detail = await context.service.decide("account-1", "reactivate", { id: 1, role: "admin" }, { expectedVersion: 3, reason: "Revisado" });
  detail = await context.service.decide("account-1", "block", { id: 1, role: "admin" }, { expectedVersion: 4, reason: "Fraude" });
  assert.equal(detail.accountStatus, "BLOCKED");
  assert.deepEqual(detail.decisions.map((item) => item.type), ["ADMIN_BLOCKED", "ADMIN_REACTIVATED", "ADMIN_SUSPENDED", "ADMIN_REJECTED"]);
  await context.db.close();
});

test("motivo e obrigatorio para rejeicao e para Supervisor", async () => {
  const context = await fixture();
  await seedEligible(context);
  await assert.rejects(() => context.service.decide("account-1", "reject", { id: 1, role: "admin" }, { expectedVersion: 1 }), (error) => error.code === "APP_CUSTOMER_REASON_REQUIRED");
  await assert.rejects(() => context.service.decide("account-1", "approve", { id: 2, role: "manager" }, { expectedVersion: 1 }), (error) => error.code === "APP_CUSTOMER_REASON_REQUIRED");
  await context.db.close();
});

test("motivo administrativo mascara telefone, CPF e e-mail antes da decisao", async () => {
  const context = await fixture();
  await seedEligible(context);
  const detail = await context.service.decide("account-1", "reject", { id: 1, role: "admin" }, {
    expectedVersion: 1,
    reason: "Contato 11987654321 CPF 12345678901 e cliente@example.test"
  });
  const stored = detail.decisions[0].reason;
  assert.doesNotMatch(stored, /11987654321|12345678901|cliente@example\.test/);
  await context.db.close();
});

test("Supervisor autorizado aprova e rejeita, mas nao suspende", async () => {
  const first = await fixture(); await seedEligible(first);
  let detail = await first.service.decide("account-1", "approve", { id: 2, role: "manager" }, { expectedVersion: 1, reason: "Conferido" });
  assert.equal(detail.decisions[0].type, "SUPERVISOR_APPROVED"); await first.db.close();
  const second = await fixture(); await seedEligible(second, "account-2", "master-2");
  detail = await second.service.decide("account-2", "reject", { id: 2, role: "manager" }, { expectedVersion: 1, reason: "Divergencia" });
  assert.equal(detail.decisions[0].type, "SUPERVISOR_REJECTED");
  await assert.rejects(() => second.service.decide("account-2", "suspend", { id: 2, role: "manager" }, { expectedVersion: 2, reason: "X" }), (error) => error.status === 403);
  await second.db.close();
});

test("concorrencia otimista retorna conflito e decisao repetida e idempotente", async () => {
  const context = await fixture(); await seedEligible(context);
  await assert.rejects(() => context.service.decide("account-1", "reject", { id: 1, role: "admin" }, { expectedVersion: 9, reason: "X" }), (error) => error.status === 409);
  const first = await context.service.decide("account-1", "reject", { id: 1, role: "admin" }, { expectedVersion: 1, reason: "X" });
  const second = await context.service.decide("account-1", "reject", { id: 1, role: "admin" }, { expectedVersion: 1, reason: "X" });
  assert.equal(first.decisions.length, 1);
  assert.equal(second.decisions.length, 1);
  await context.db.close();
});

test("autorizacao diferencia ADMIN, Supervisor autorizado e demais perfis", () => {
  assert.equal(canReview({ role: "admin", permissions: {} }), true);
  assert.equal(canReview({ role: "manager", permissions: { can_review_app_customers: true } }), true);
  assert.equal(canReview({ role: "manager", permissions: {} }), false);
  assert.equal(canReview({ role: "seller", permissions: { can_review_app_customers: true } }), false);
});

test("rotas retornam 401, 403 e lista paginada sem PII integral", async () => {
  const context = await fixture();
  await context.service.createAccountAndRequest({ accountId: "route-1", requestId: "route-r1", profile: registration });
  const app = express(); app.use(express.json());
  let user = null;
  app.use((req, res, next) => { req.user = user; next(); });
  app.use("/api/admin/app-customers", createAppCustomerAccessRouter({ dbApi: context.db }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/admin/app-customers/pending`)).status, 401);
    user = { id: 3, role: "manager", permissions: {} };
    assert.equal((await fetch(`${base}/api/admin/app-customers/pending`)).status, 403);
    user = { id: 2, role: "manager", permissions: { can_review_app_customers: true } };
    const response = await fetch(`${base}/api/admin/app-customers/pending?page=1&pageSize=10`);
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.rows.length, 1);
    assert.doesNotMatch(JSON.stringify(body), /12345678901|11987654321|cliente@example\.test/);
    assert.equal((await fetch(`${base}/api/admin/app-customers/missing`)).status, 404);
  } finally { await new Promise((resolve) => server.close(resolve)); await context.db.close(); }
});

test("permissao individual somente ADMIN concede e remove no mecanismo existente", async () => {
  const context = await fixture();
  await context.db.run("INSERT INTO users (id, role, permissions_json, updated_at) VALUES (2, 'manager', '{}', '')");
  const handler = createAppCustomerReviewPermissionHandler({ dbApi: context.db });
  const invoke = (user, enabled) => new Promise((resolve) => {
    const result = { statusCode: 200, body: null };
    handler({ user, params: { id: "2" }, body: { enabled } }, { status(code) { result.statusCode = code; return this; }, json(body) { result.body = body; resolve(result); } });
  });
  assert.equal((await invoke({ id: 3, role: "manager" }, true)).statusCode, 403);
  assert.equal((await invoke({ id: 1, role: "admin" }, true)).body.enabled, true);
  assert.equal(JSON.parse((await context.db.get("SELECT permissions_json FROM users WHERE id = 2")).permissions_json).can_review_app_customers, true);
  assert.equal((await invoke({ id: 1, role: "admin" }, false)).body.enabled, false);
  await context.db.close();
});

test("workflow nao altera contacts, crm_contacts ou mestres", async () => {
  const context = await fixture();
  await context.db.run("INSERT INTO contacts (id, name) VALUES (1, 'Legado')");
  await context.db.run("INSERT INTO crm_contacts (id, name) VALUES (1, 'CRM')");
  await seedEligible(context);
  const beforeMaster = await context.db.get("SELECT id, status, version, eligibility_status, updated_at, deleted_at FROM customer_master_records WHERE id = 'master-1'");
  await context.service.decide("account-1", "approve", { id: 1, role: "admin" }, { expectedVersion: 1 });
  assert.deepEqual(await context.db.get("SELECT id, name FROM contacts WHERE id = 1"), { id: 1, name: "Legado" });
  assert.deepEqual(await context.db.get("SELECT id, name FROM crm_contacts WHERE id = 1"), { id: 1, name: "CRM" });
  assert.deepEqual(await context.db.get("SELECT id, status, version, eligibility_status, updated_at, deleted_at FROM customer_master_records WHERE id = 'master-1'"), beforeMaster);
  await context.db.close();
});

test("frontend administrativo permanece separado do fluxo publico de autenticacao", () => {
  const root = path.resolve(__dirname, "../../../..");
  const appSource = fs.readFileSync(path.join(root, "public", "appCustomerAccessAdmin.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const accessRoutes = fs.readFileSync(path.join(root, "modules", "customers", "app-access", "appCustomerAccessRoutes.js"), "utf8");
  assert.match(appSource, /data-app-customer-action="approve"/);
  assert.match(html, /\/admin\/clientes-app/);
  assert.doesNotMatch(accessRoutes, /\/app\/v1\/auth/);
  assert.match(accessRoutes, /APP_CUSTOMER_REVIEW_FORBIDDEN/);
});
