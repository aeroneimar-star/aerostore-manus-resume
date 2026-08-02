"use strict";

const assert = require("node:assert");
const test = require("node:test");
const { memoryDb } = require("../../master/__tests__/memoryDb");
const { applyAppCustomerAccessSchema } = require("../../app-access/persistence/appCustomerAccessSchema");
const { applyAppSessionSchema } = require("../../app-auth/persistence/appSessionSchema");
const { applyAppAddressSchema } = require("../persistence/appAddressSchema");
const { applyAppFulfillmentSchema } = require("../../app-fulfillment/persistence/appFulfillmentSchema");
const { applyAppCartSchema } = require("../../app-cart/persistence/appCartSchema");
const { createAppAddressService, AppAddressError, sanitizeAddress, validateAddressInput } = require("../appAddressService");
const { createPostalCodeService } = require("../postalCodeService");

function randomUUID() { return require("crypto").randomUUID(); }

const EVENTS = [];

async function fixture() {
  const db = memoryDb();
  await db.run("PRAGMA foreign_keys=ON");
  await db.run(`CREATE TABLE IF NOT EXISTS customer_master_records(id TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, eligibility_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED', updated_at TEXT NOT NULL, deleted_at TEXT)`);
  await db.run(`CREATE TABLE IF NOT EXISTS customer_identity_conflicts(id TEXT PRIMARY KEY, conflict_type TEXT, severity TEXT, status TEXT)`);
  await db.run(`CREATE TABLE IF NOT EXISTS customer_identity_conflict_participants(id TEXT PRIMARY KEY, conflict_id TEXT, participant_type TEXT, participant_id TEXT)`);
  await db.run(`CREATE TABLE IF NOT EXISTS customer_identity_cases(id TEXT PRIMARY KEY, blocking INTEGER)`);
  await db.run(`CREATE TABLE IF NOT EXISTS customer_identity_case_conflicts(case_id TEXT, conflict_id TEXT)`);
  await applyAppCustomerAccessSchema(db);
  await applyAppSessionSchema(db);
  await applyAppAddressSchema(db);
  await applyAppCartSchema(db);
  await applyAppFulfillmentSchema(db);

  // Criar conta de teste
  const accountId = randomUUID();
  const now = new Date().toISOString();
  await db.run(`INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, phone_verified_at, version, created_at, updated_at) VALUES (?, '', '', '', '', 'ACTIVE', 'APPROVED', ?, 1, ?, ?)`, [accountId, now, now, now]);

  const service = createAppAddressService({
    dbApi: db,
    recordAudit: (event) => EVENTS.push(event)
  });

  return { db, service, accountId };
}

const ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

test("validateAddressInput rejeita campos faltantes", () => {
  const errors = validateAddressInput({});
  assert.ok(errors.includes("recipient_name"));
  assert.ok(errors.includes("postal_code"));
  assert.ok(errors.includes("street"));
  assert.ok(errors.includes("number"));
  assert.ok(errors.includes("neighborhood"));
  assert.ok(errors.includes("city"));
  assert.ok(errors.includes("state"));
});

test("validateAddressInput aceita campos validos", () => {
  const errors = validateAddressInput({
    recipient_name: "Joao Silva",
    postal_code: "14010030",
    street: "R. Saldanha Marinho",
    number: "807",
    neighborhood: "Centro",
    city: "Ribeirao Preto",
    state: "SP"
  });
  assert.equal(errors.length, 0);
});

test("sanitizeAddress normaliza CEP com mascara", () => {
  const result = sanitizeAddress({
    recipient_name: "Maria Santos",
    postal_code: "14010030",
    street: "R. Jose Bonifacio",
    number: "100",
    neighborhood: "Jardim",
    city: "Ribeirao Preto",
    state: "sp",
    label: "Casa"
  });
  assert.equal(result.postal_code_protected, "14010030");
  assert.equal(result.postal_code_masked, "14010-030");
  assert.equal(result.state, "SP");
  assert.equal(result.label, "Casa");
});

test("sanitizeAddress trunca campos longos", () => {
  const result = sanitizeAddress({
    recipient_name: "a".repeat(200),
    postal_code: "14010030",
    street: "b".repeat(300),
    number: "1",
    neighborhood: "c".repeat(200),
    city: "d".repeat(200),
    state: "sp",
    label: "e".repeat(100),
    complement: "f".repeat(200),
    delivery_instructions: "g".repeat(500)
  });
  assert.equal(result.recipient_name.length, 120);
  assert.equal(result.street.length, 200);
  assert.equal(result.neighborhood.length, 100);
  assert.equal(result.city.length, 100);
  assert.equal(result.label.length, 40);
  assert.equal(result.complement.length, 80);
  assert.equal(result.delivery_instructions.length, 300);
});

test("listAddresses retorna vazio para conta sem enderecos", async () => {
  const { service, accountId } = await fixture();
  const result = await service.listAddresses(accountId);
  assert.equal(result.success, true);
  assert.equal(Array.isArray(result.data), true);
  assert.equal(result.data.length, 0);
});

test("listAddresses rejeita accountId invalido", async () => {
  const { service } = await fixture();
  await assert.rejects(() => service.listAddresses("invalido"), (err) => {
    assert.equal(err.code, "INVALID_ACCOUNT_ID");
    return true;
  });
});

test("createAddress cria primeiro endereco como default", async () => {
  const { service, accountId } = await fixture();
  const result = await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "14010030",
    street: "R. Saldanha Marinho",
    number: "807",
    neighborhood: "Centro",
    city: "Ribeirao Preto",
    state: "SP",
    label: "Casa"
  });
  assert.equal(result.success, true);
  assert.equal(result.data.isDefault, true);
  assert.equal(result.data.postalCode, "14010-030");
  assert.equal(result.data.city, "Ribeirao Preto");
  assert.equal(result.data.state, "SP");
});

test("createAddress rejeita campos faltantes", async () => {
  const { service, accountId } = await fixture();
  await assert.rejects(() => service.createAddress(accountId, { recipient_name: "Joao" }), (err) => {
    assert.equal(err.code, "INVALID_ADDRESS_FIELDS");
    assert.equal(err.status, 400);
    return true;
  });
});

test("createAddress segundo endereco nao e default por padrao", async () => {
  const { service, accountId } = await fixture();
  await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "14010030",
    street: "R. Saldanha Marinho",
    number: "807",
    neighborhood: "Centro",
    city: "Ribeirao Preto",
    state: "SP"
  });
  const second = await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "01310100",
    street: "Av. Paulista",
    number: "1000",
    neighborhood: "Bela Vista",
    city: "Sao Paulo",
    state: "SP"
  });
  assert.equal(second.data.isDefault, false);
  assert.equal(second.data.city, "Sao Paulo");
});

test("createAddress permite explicitar is_default", async () => {
  const { service, accountId } = await fixture();
  await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "14010030",
    street: "R. Saldanha Marinho",
    number: "807",
    neighborhood: "Centro",
    city: "Ribeirao Preto",
    state: "SP"
  });
  const second = await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "01310100",
    street: "Av. Paulista",
    number: "1000",
    neighborhood: "Bela Vista",
    city: "Sao Paulo",
    state: "SP",
    is_default: true
  });
  assert.equal(second.data.isDefault, true);
});

test("updateAddress atualiza campos e versiona", async () => {
  const { service, accountId } = await fixture();
  const created = await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "14010030",
    street: "R. Saldanha Marinho",
    number: "807",
    neighborhood: "Centro",
    city: "Ribeirao Preto",
    state: "SP"
  });
  const updated = await service.updateAddress(accountId, created.data.id, {
    label: "Trabalho",
    city: "Sao Paulo",
    expectedVersion: created.data.version
  });
  assert.equal(updated.data.label, "Trabalho");
  assert.equal(updated.data.city, "Sao Paulo");
  assert.equal(updated.data.version, created.data.version + 1);
});

test("updateAddress rejeita version conflict", async () => {
  const { service, accountId } = await fixture();
  const created = await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "14010030",
    street: "R. Saldanha Marinho",
    number: "807",
    neighborhood: "Centro",
    city: "Ribeirao Preto",
    state: "SP"
  });
  await assert.rejects(() => service.updateAddress(accountId, created.data.id, {
    city: "Sao Paulo",
    expectedVersion: 999
  }), (err) => {
    assert.equal(err.code, "ADDRESS_VERSION_CONFLICT");
    assert.equal(err.status, 409);
    return true;
  });
});

test("archiveAddress arquiva endereco e escolhe novo default", async () => {
  const { service, accountId } = await fixture();
  const first = await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "14010030",
    street: "R. Saldanha Marinho",
    number: "807",
    neighborhood: "Centro",
    city: "Ribeirao Preto",
    state: "SP"
  });
  const second = await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "01310100",
    street: "Av. Paulista",
    number: "1000",
    neighborhood: "Bela Vista",
    city: "Sao Paulo",
    state: "SP"
  });

  await service.archiveAddress(accountId, first.data.id);

  const list = await service.listAddresses(accountId);
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].id, second.data.id);

  await assert.rejects(() => service.getAddress(accountId, first.data.id), (err) => {
    assert.equal(err.code, "ADDRESS_NOT_FOUND");
    return true;
  });
});

test("archiveAddress bloqueia se endereco em uso por carrinho", async () => {
  const { service, accountId, db } = await fixture();
  const created = await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "14010030",
    street: "R. Saldanha Marinho",
    number: "807",
    neighborhood: "Centro",
    city: "Ribeirao Preto",
    state: "SP"
  });

  // Criar cart_fulfillment usando o endereco (precisa de cart real para FK)
  const cartId = randomUUID();
  const now = new Date().toISOString();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at)
    VALUES (?, ?, 'ACTIVE', 'BRL', 0, 0, 1, ?, ?)`, [cartId, accountId, now, now]);
  const fulfillmentId = randomUUID();
  await db.run(`INSERT INTO app_cart_fulfillment (id, cart_id, account_id, fulfillment_type, address_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_status, version, created_at, updated_at)
    VALUES (?, ?, ?, 'DELIVERY', ?, '', '', 0, 'CALCULATED', 1, ?, ?)`, [fulfillmentId, cartId, accountId, created.data.id, now, now]);

  await assert.rejects(() => service.archiveAddress(accountId, created.data.id), (err) => {
    assert.equal(err.code, "ADDRESS_IN_USE_BY_CART");
    assert.equal(err.status, 409);
    return true;
  });
});

test("setDefaultAddress muda endereco padrao", async () => {
  const { service, accountId } = await fixture();
  const first = await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "14010030",
    street: "R. Saldanha Marinho",
    number: "807",
    neighborhood: "Centro",
    city: "Ribeirao Preto",
    state: "SP"
  });
  const second = await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "01310100",
    street: "Av. Paulista",
    number: "1000",
    neighborhood: "Bela Vista",
    city: "Sao Paulo",
    state: "SP"
  });

  assert.equal(first.data.isDefault, true);
  assert.equal(second.data.isDefault, false);

  await service.setDefaultAddress(accountId, second.data.id);

  const list = await service.listAddresses(accountId);
  const firstAfter = list.data.find(a => a.id === first.data.id);
  const secondAfter = list.data.find(a => a.id === second.data.id);
  assert.equal(firstAfter.isDefault, false);
  assert.equal(secondAfter.isDefault, true);
});

test("getAddress retorna endereco existente", async () => {
  const { service, accountId } = await fixture();
  const created = await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "14010030",
    street: "R. Saldanha Marinho",
    number: "807",
    neighborhood: "Centro",
    city: "Ribeirao Preto",
    state: "SP"
  });
  const fetched = await service.getAddress(accountId, created.data.id);
  assert.equal(fetched.data.id, created.data.id);
  assert.equal(fetched.data.city, "Ribeirao Preto");
});

test("getAddress retorna 404 para endereco inexistente", async () => {
  const { service, accountId } = await fixture();
  await assert.rejects(() => service.getAddress(accountId, randomUUID()), (err) => {
    assert.equal(err.code, "ADDRESS_NOT_FOUND");
    assert.equal(err.status, 404);
    return true;
  });
});

test("createAddress mascara PII no response", async () => {
  const { service, accountId } = await fixture();
  const result = await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "14010030",
    street: "R. Saldanha Marinho",
    number: "807",
    neighborhood: "Centro",
    city: "Ribeirao Preto",
    state: "SP"
  });
  // CEP mascarado: 14010-030
  assert.equal(result.data.postalCode, "14010-030");
  // Nao deve conter postal_code_protected
  assert.equal(result.data.postal_code_protected, undefined);
});

test("audit registra eventos de CRUD", async () => {
  EVENTS.length = 0;
  const { service, accountId } = await fixture();
  await service.createAddress(accountId, {
    recipient_name: "Joao Silva",
    postal_code: "14010030",
    street: "R. Saldanha Marinho",
    number: "807",
    neighborhood: "Centro",
    city: "Ribeirao Preto",
    state: "SP"
  });
  assert.ok(EVENTS.some(e => e.action === "APP_ADDRESS_CREATED"));
});
