"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const sqlite3 = require("sqlite3");
const express = require("express");
const { applyAppCustomerAccessSchema } = require("../../app-access/persistence/appCustomerAccessSchema");
const { applyAppSessionSchema } = require("../persistence/appSessionSchema");
const { applyAppProfileSchema, getAppProfileSchemaStatus } = require("../persistence/appProfileSchema");
const { createAppSessionService } = require("../appSessionService");
const { createAppProfileService, AppProfileError } = require("../appProfileService");
const { createAppSessionRouter, createRequireAppSession } = require("../appSessionRoutes");

function memoryDb() {
  const connection = new sqlite3.Database(":memory:");
  return { run: (sql, params = []) => new Promise((resolve, reject) => connection.run(sql, params, function done(error) { error ? reject(error) : resolve({ changes: this.changes }); })), get: (sql, params = []) => new Promise((resolve, reject) => connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row))), all: (sql, params = []) => new Promise((resolve, reject) => connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))), close: () => new Promise((resolve, reject) => connection.close((error) => error ? reject(error) : resolve())) };
}
async function fixture() {
  const db = memoryDb(); await db.run("PRAGMA foreign_keys=ON");
  await db.run("CREATE TABLE customer_master_records(id TEXT PRIMARY KEY,status TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,eligibility_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED',updated_at TEXT NOT NULL,deleted_at TEXT)");
  await db.run("CREATE TABLE customer_master_sources(id TEXT PRIMARY KEY,master_id TEXT,source_type TEXT,source_id TEXT,source_hash TEXT,status TEXT,updated_at TEXT)");
  await db.run("CREATE TABLE customer_identity_conflicts(id TEXT PRIMARY KEY,conflict_type TEXT,severity TEXT,status TEXT)");
  await db.run("CREATE TABLE customer_identity_conflict_participants(id TEXT PRIMARY KEY,conflict_id TEXT,participant_type TEXT,participant_id TEXT)");
  await db.run("CREATE TABLE customer_identity_cases(id TEXT PRIMARY KEY,blocking INTEGER)");
  await db.run("CREATE TABLE customer_identity_case_conflicts(case_id TEXT,conflict_id TEXT)");
  await applyAppCustomerAccessSchema(db); await applyAppSessionSchema(db); await applyAppProfileSchema(db);
  const now = new Date("2026-08-01T12:00:00.000Z"); const events = [];
  const common = { dbApi: db, pepper: "profile-pepper-for-tests-at-least-32-characters", now: () => new Date(now), recordAudit: (event) => events.push(event) };
  const session = createAppSessionService({ ...common, jwtSecret: "jwt-secret-for-tests-only-at-least-32-characters", randomToken: () => `refresh-${"x".repeat(50)}` });
  const profile = createAppProfileService(common);
  return { db, events, session, profile, now };
}
async function seed(context, suffix = "1") {
  const at = "2026-08-01T11:00:00.000Z"; const accountId = `account-${suffix}`;
  await context.db.run("INSERT INTO customer_master_records(id,status,updated_at) VALUES (?, 'ACTIVE', ?)", [`master-${suffix}`, at]);
  await context.db.run("INSERT INTO customer_master_sources(id,master_id,source_type,source_id,source_hash,status,updated_at) VALUES (?,?, 'contacts', ?, 'source-hash','ACTIVE',?)", [`source-${suffix}`, `master-${suffix}`, suffix, at]);
  await context.db.run("INSERT INTO app_customer_accounts(id,phone_lookup_hash,phone_masked,phone_verified_at,email_lookup_hash,email_masked,account_status,access_status,version,created_at,updated_at,token_version) VALUES (?,?, '+55 (***) *****-4321',?,'','c***@example.test','ACTIVE','APPROVED',1,?,?,1)", [accountId, `phone-${suffix}`, at, at, at]);
  await context.db.run("INSERT INTO app_access_requests(id,account_id,request_type,status,submitted_profile_json,submitted_at,version,created_at,updated_at) VALUES (?,?, 'EXISTING_CUSTOMER_LINK','APPROVED','{}',?,1,?,?)", [`request-${suffix}`, accountId, at, at, at]);
  await context.db.run("INSERT INTO app_customer_links(id,account_id,master_id,link_status,link_type,confidence,created_at,updated_at) VALUES (?,?,?,'ACTIVE','PHONE_IDENTIFIER',100,?,?)", [`link-${suffix}`, accountId, `master-${suffix}`, at, at]);
  const tokens = await context.session.createSession({ accountId, deviceId: `device-${suffix}`, platform: "WEB" });
  const auth = await context.session.authenticateAccess(tokens.accessToken, { observeStatus: true });
  return { accountId, tokens, auth };
}

test("migration de perfil e idempotente", async () => { const context = await fixture(); const again = await applyAppProfileSchema(context.db); assert.equal(again.after.ready, true); assert.equal((await getAppProfileSchemaStatus(context.db)).profiles, 0); await context.db.close(); });
test("segredo de protecao e obrigatorio", async () => { const db = memoryDb(); assert.throws(() => createAppProfileService({ dbApi: db, profileSecret: "short" }), /APP_PROFILE_SECRET_REQUIRED/); await db.close(); });

for (const [accountStatus, accessStatus, expected] of [
  ["ACTIVE", "PENDING_PHONE_VERIFICATION", "PENDING_PHONE_VERIFICATION"], ["ACTIVE", "PENDING_APPROVAL", "PENDING_APPROVAL"],
  ["ACTIVE", "APPROVED", "APPROVED"], ["ACTIVE", "REJECTED", "REJECTED"], ["SUSPENDED", "APPROVED", "SUSPENDED"],
  ["BLOCKED", "APPROVED", "BLOCKED"], ["CLOSED", "APPROVED", "CLOSED"]
]) test(`status real ${expected} mantem catalogo fechado`, async () => {
  const context = await fixture(); const seeded = await seed(context);
  await context.db.run("UPDATE app_customer_accounts SET account_status=?,access_status=?,updated_at='2026-08-01T12:01:00.000Z' WHERE id=?", [accountStatus, accessStatus, seeded.accountId]);
  const status = await context.profile.getAccessStatus(seeded.auth);
  assert.equal(status.effectiveStatus, expected); assert.equal(status.canViewCatalog, false); assert.equal(status.permissions.canViewCatalog, false); assert.equal(status.hasActiveMasterLink, true);
  assert.doesNotMatch(JSON.stringify(status), /administrativeReason|internalReason|cpf|phone_lookup|master-/i);
  if (expected === "CLOSED") assert.equal((await context.db.get("SELECT status FROM app_sessions WHERE account_id=?", [seeded.accountId])).status, "REVOKED");
  await context.db.close();
});

test("mudanca administrativa aparece sem recriar sessao", async () => {
  const context = await fixture(); const seeded = await seed(context); assert.equal((await context.profile.getAccessStatus(seeded.auth)).effectiveStatus, "APPROVED");
  await context.db.run("UPDATE app_customer_accounts SET access_status='REJECTED',updated_at='2026-08-01T12:02:00.000Z' WHERE id=?", [seeded.accountId]);
  assert.equal((await context.profile.getAccessStatus(seeded.auth)).effectiveStatus, "REJECTED"); assert.ok(context.events.some((event) => event.action === "APP_ACCESS_STATUS_CHANGED_OBSERVED")); await context.db.close();
});

test("bloqueio administrativo continua observavel somente pela rota de status", async () => {
  const context = await fixture(); const seeded = await seed(context);
  await context.db.run("UPDATE app_customer_accounts SET account_status='BLOCKED',token_version=token_version+1 WHERE id=?", [seeded.accountId]);
  const observable = await context.session.authenticateAccess(seeded.tokens.accessToken, { observeStatus: true });
  assert.equal((await context.profile.getAccessStatus(observable)).effectiveStatus, "BLOCKED");
  await assert.rejects(context.session.authenticateAccess(seeded.tokens.accessToken, { allowPending: true }), /TOKEN_VERSION_INVALID/); await context.db.close();
});

test("sessao invalida recebe 401 no middleware", async () => {
  const context = await fixture(); let statusCode = 0; let called = false;
  await createRequireAppSession(context.session, { observeStatus: true })({ get: () => "Bearer invalid", body: {} }, { status(code) { statusCode = code; return this; }, json() { return this; } }, () => { called = true; });
  assert.equal(called, false); assert.equal(statusCode, 401); await context.db.close();
});

test("endpoints privados entregam status e perfil e rejeitam requisicao sem token", async () => {
  const context = await fixture(); const seeded = await seed(context); const app = express();
  app.use("/app/v1", createAppSessionRouter({ service: context.session, profileService: context.profile }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); }); const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${seeded.tokens.accessToken}`, "x-device-id": "device-1", "Content-Type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/app/v1/access/status`)).status, 401);
    const statusResponse = await fetch(`${base}/app/v1/access/status`, { headers }); assert.equal(statusResponse.status, 200); assert.equal((await statusResponse.json()).canViewCatalog, false);
    const profileResponse = await fetch(`${base}/app/v1/profile`, { headers }); assert.equal(profileResponse.status, 200); const profile = await profileResponse.json();
    const updateResponse = await fetch(`${base}/app/v1/profile`, { method: "PATCH", headers, body: JSON.stringify({ version: profile.version, fullName: "Cliente Endpoint", email: "endpoint@example.test" }) }); assert.equal(updateResponse.status, 200); assert.equal((await updateResponse.json()).email, "e***@example.test");
  } finally { await new Promise((resolve) => server.close(resolve)); await context.db.close(); }
});

test("perfil e criado, consultado e retornado por DTO allow-list", async () => {
  const context = await fixture(); const seeded = await seed(context); const profile = await context.profile.getProfile(seeded.auth);
  assert.deepEqual(Object.keys(profile).sort(), ["accountStatus","accessStatus","createdAt","displayName","email","emailMasked","fullName","hasActiveMasterLink","phoneMasked","preferences","primaryAddressConsolidated","profileComplete","profileStatus","updatedAt","version"].sort());
  assert.equal(profile.phoneMasked, "+55 (***) *****-4321"); assert.equal(profile.email, "c***@example.test"); assert.ok(context.events.some((event) => event.action === "APP_PROFILE_CREATED")); await context.db.close();
});

test("perfil atualiza nome e e-mail protegidos sem alterar fontes", async () => {
  const context = await fixture(); const seeded = await seed(context); const beforeSource = await context.db.get("SELECT * FROM customer_master_sources");
  const created = await context.profile.getProfile(seeded.auth); const updated = await context.profile.updateProfile(seeded.auth, { version: created.version, displayName: "Ana", fullName: "Ana Cliente", email: "ana@example.test", preferences: { marketingOptIn: true } });
  assert.equal(updated.fullName, "Ana Cliente"); assert.equal(updated.email, "a***@example.test"); assert.equal(updated.version, 2); assert.equal(updated.profileComplete, true);
  const stored = await context.db.get("SELECT email_lookup_hash,email_protected,email_masked FROM app_customer_profiles"); assert.notEqual(stored.email_protected, "ana@example.test"); assert.doesNotMatch(JSON.stringify(stored), /ana@example\.test/);
  assert.deepEqual(await context.db.get("SELECT * FROM customer_master_sources"), beforeSource); assert.equal(await context.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('contacts','crm_contacts')"), undefined); await context.db.close();
});

test("versao desatualizada gera 409 e repeticao identica e idempotente", async () => {
  const context = await fixture(); const seeded = await seed(context); const created = await context.profile.getProfile(seeded.auth);
  const payload = { version: created.version, fullName: "Cliente Teste", email: "cliente@example.test" }; const updated = await context.profile.updateProfile(seeded.auth, payload);
  const repeated = await context.profile.updateProfile(seeded.auth, payload); assert.equal(repeated.version, updated.version);
  await assert.rejects(context.profile.updateProfile(seeded.auth, { version: 1, fullName: "Outro Nome" }), (error) => error instanceof AppProfileError && error.status === 409); await context.db.close();
});

for (const field of ["phone", "cpf", "masterId", "accessStatus", "accountStatus", "approval", "address"]) test(`${field} nao pode ser alterado`, async () => {
  const context = await fixture(); const seeded = await seed(context); await context.profile.getProfile(seeded.auth);
  await assert.rejects(context.profile.updateProfile(seeded.auth, { version: 1, [field]: "forbidden" }), (error) => error instanceof AppProfileError && error.code === "APP_PROFILE_FIELD_NOT_ALLOWED"); await context.db.close();
});

test("auditoria e sanitizada e nao contem PII integral", async () => {
  const context = await fixture(); const seeded = await seed(context); const created = await context.profile.getProfile(seeded.auth);
  await context.profile.updateProfile(seeded.auth, { version: created.version, fullName: "Nome Muito Privado", email: "privado@example.test" });
  const serialized = JSON.stringify(context.events); assert.doesNotMatch(serialized, /Nome Muito Privado|privado@example\.test|\+55/); assert.ok(context.events.some((event) => event.action === "APP_PROFILE_UPDATED")); await context.db.close();
});
