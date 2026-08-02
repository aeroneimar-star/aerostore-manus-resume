"use strict";

const assert = require("node:assert");
const test = require("node:test");
const { memoryDb } = require("../../master/__tests__/memoryDb");
const { applyAppCustomerAccessSchema } = require("../../app-access/persistence/appCustomerAccessSchema");
const { applyAppSessionSchema } = require("../../app-auth/persistence/appSessionSchema");
const { applyAppCartSchema } = require("../../app-cart/persistence/appCartSchema");
const { applyAppAddressSchema } = require("../../app-address/persistence/appAddressSchema");
const { applyAppFulfillmentSchema } = require("../persistence/appFulfillmentSchema");
const { createAppFulfillmentService, AppFulfillmentError } = require("../appFulfillmentService");
const { MockShippingProvider, ShippingQuoteError } = require("../shippingQuoteProvider");

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
  await applyAppCartSchema(db);
  await applyAppAddressSchema(db);
  await applyAppFulfillmentSchema(db);

  // Criar conta de teste
  const accountId = randomUUID();
  const now = new Date().toISOString();
  await db.run(`INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, phone_verified_at, version, created_at, updated_at) VALUES (?, '', '', '', '', 'ACTIVE', 'APPROVED', ?, 1, ?, ?)`, [accountId, now, now, now]);

  const service = createAppFulfillmentService({
    dbApi: db,
    recordAudit: (event) => EVENTS.push(event)
  });

  return { db, service, accountId };
}

test("getFulfillmentOptions retorna opcoes disponiveis", async () => {
  const { service, accountId } = await fixture();
  const result = await service.getFulfillmentOptions(accountId);
  assert.equal(result.success, true);
  assert.equal(Array.isArray(result.data.availableFulfillmentTypes), true);
  assert.ok(result.data.availableFulfillmentTypes.includes("PICKUP"));
  assert.ok(result.data.availableFulfillmentTypes.includes("DELIVERY"));
  assert.ok(result.data.pickupStores.length >= 2);
});

test("getFulfillmentOptions retorna enderecos do cliente", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const addressId = randomUUID();
  await db.run(`INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, neighborhood, city, state, validation_status, is_default, version, created_at, updated_at)
    VALUES (?, ?, 'Casa', 'Joao', '14010030', '14010-030', 'R. Saldanha', '807', 'Centro', 'Ribeirao Preto', 'SP', 'VALID', 1, 1, ?, ?)`, [addressId, accountId, now, now]);

  const result = await service.getFulfillmentOptions(accountId);
  assert.ok(result.data.availableAddresses.length >= 1);
  assert.equal(result.data.availableAddresses[0].city, "Ribeirao Preto");
});

test("setFulfillment PICKUP com loja valida", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);
  const result = await service.setFulfillment(accountId, {
    fulfillment_type: "PICKUP",
    pickup_store_id: "vila"
  });
  assert.equal(result.success, true);
  assert.equal(result.data.fulfillmentType, "PICKUP");
  assert.equal(result.data.pickupStoreId, "vila");
});

test("setFulfillment DELIVERY com endereco valido", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);
  const addressId = randomUUID();
  await db.run(`INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, neighborhood, city, state, validation_status, is_default, version, created_at, updated_at)
    VALUES (?, ?, 'Casa', 'Joao', '01310100', '01310-100', 'Av. Paulista', '1000', 'Bela Vista', 'Sao Paulo', 'SP', 'VALID', 1, 1, ?, ?)`, [addressId, accountId, now, now]);

  const result = await service.setFulfillment(accountId, {
    fulfillment_type: "DELIVERY",
    address_id: addressId
  });
  assert.equal(result.success, true);
  assert.equal(result.data.fulfillmentType, "DELIVERY");
  assert.equal(result.data.addressId, addressId);
});

test("setFulfillment rejeita tipo invalido", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);
  await assert.rejects(() => service.setFulfillment(accountId, {
    fulfillment_type: "INVALID"
  }), (err) => {
    assert.equal(err.code, "INVALID_FULFILLMENT_TYPE");
    assert.equal(err.status, 400);
    return true;
  });
});

test("setFulfillment rejeita loja inexistente", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);
  await assert.rejects(() => service.setFulfillment(accountId, {
    fulfillment_type: "PICKUP",
    pickup_store_id: "loja_inexistente"
  }), (err) => {
    assert.equal(err.code, "INVALID_PICKUP_STORE");
    return true;
  });
});

test("setFulfillment rejeita DELIVERY sem endereco", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);
  await assert.rejects(() => service.setFulfillment(accountId, {
    fulfillment_type: "DELIVERY"
  }), (err) => {
    assert.equal(err.code, "ADDRESS_REQUIRED");
    return true;
  });
});

test("setFulfillment rejeita endereco inexistente", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);
  await assert.rejects(() => service.setFulfillment(accountId, {
    fulfillment_type: "DELIVERY",
    address_id: randomUUID()
  }), (err) => {
    assert.equal(err.code, "ADDRESS_NOT_FOUND");
    return true;
  });
});

test("setFulfillment atualiza fulfillment existente", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);
  const first = await service.setFulfillment(accountId, {
    fulfillment_type: "PICKUP",
    pickup_store_id: "vila"
  });

  const updated = await service.setFulfillment(accountId, {
    fulfillment_type: "PICKUP",
    pickup_store_id: "botanico",
    expectedVersion: first.data.version
  });
  assert.equal(updated.data.pickupStoreId, "botanico");
  assert.equal(updated.data.version, first.data.version + 1);
});

test("setFulfillment rejeita version conflict", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);
  await service.setFulfillment(accountId, {
    fulfillment_type: "PICKUP",
    pickup_store_id: "vila"
  });

  await assert.rejects(() => service.setFulfillment(accountId, {
    fulfillment_type: "PICKUP",
    pickup_store_id: "botanico",
    expectedVersion: 999
  }), (err) => {
    assert.equal(err.code, "FULFILLMENT_VERSION_CONFLICT");
    assert.equal(err.status, 409);
    return true;
  });
});

test("getDeliverySummary sem carrinho retorna bloqueio", async () => {
  const { service, accountId } = await fixture();
  const result = await service.getDeliverySummary(accountId);
  assert.equal(result.success, true);
  assert.ok(result.data.blockingIssues.includes("Nenhum carrinho ativo."));
  assert.equal(result.data.canContinueToCheckoutFuture, false);
});

test("getDeliverySummary com PICKUP retorna resumo", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at)
    VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);
  await db.run(`INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at)
    VALUES (?, ?, 'prod-1', 'prod-1-default', 1, 15000, 15000, 15000, '{}', 'in_stock', 1, ?, ?)`, [randomUUID(), cartId, now, now]);

  await service.setFulfillment(accountId, {
    fulfillment_type: "PICKUP",
    pickup_store_id: "vila"
  });

  const result = await service.getDeliverySummary(accountId);
  assert.equal(result.success, true);
  assert.equal(result.data.fulfillmentType, "PICKUP");
  assert.equal(result.data.pickupStoreSummary.name, "Vila");
  assert.equal(result.data.cartSubtotalCents, 15000);
  assert.equal(result.data.shippingPriceCents, 0);
  assert.equal(result.data.canContinueToCheckoutFuture, true);
});

test("getDeliverySummary com DELIVERY sem cotacao retorna bloqueio", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const addressId = randomUUID();
  const cartId = randomUUID();

  await db.run(`INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, neighborhood, city, state, validation_status, is_default, version, created_at, updated_at)
    VALUES (?, ?, 'Casa', 'Joao', '01310100', '01310-100', 'Av. Paulista', '1000', 'Bela Vista', 'Sao Paulo', 'SP', 'VALID', 1, 1, ?, ?)`, [addressId, accountId, now, now]);
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at)
    VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);

  await service.setFulfillment(accountId, {
    fulfillment_type: "DELIVERY",
    address_id: addressId
  });

  const result = await service.getDeliverySummary(accountId);
  assert.equal(result.data.fulfillmentType, "DELIVERY");
  assert.ok(result.data.blockingIssues.length > 0 || result.data.shippingMethod === null);
});

test("requestShippingQuote com mock provider", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const addressId = randomUUID();
  const cartId = randomUUID();
  const productId = "prod-test-001";

  await db.run(`INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, neighborhood, city, state, validation_status, is_default, version, created_at, updated_at)
    VALUES (?, ?, 'Casa', 'Joao', '01310100', '01310-100', 'Av. Paulista', '1000', 'Bela Vista', 'Sao Paulo', 'SP', 'VALID', 1, 1, ?, ?)`, [addressId, accountId, now, now]);
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at)
    VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);
  await db.run(`INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at)
    VALUES (?, ?, ?, 'prod-test-001-default', 1, 15000, 15000, 15000, '{}', 'in_stock', 1, ?, ?)`, [randomUUID(), cartId, productId, now, now]);

  await service.setFulfillment(accountId, {
    fulfillment_type: "DELIVERY",
    address_id: addressId
  });

  // Service sem catalogService: deve falhar
  const serviceNoCatalog = createAppFulfillmentService({
    dbApi: db,
    recordAudit: (event) => EVENTS.push(event)
  });

  await assert.rejects(() => serviceNoCatalog.requestShippingQuote(accountId), (err) => {
    assert.equal(err.code, "CATALOG_UNAVAILABLE");
    return true;
  });
});

test("requestShippingQuote rejeita sem modalidade DELIVERY", async () => {
  const { service, accountId } = await fixture();
  await assert.rejects(() => service.requestShippingQuote(accountId), (err) => {
    assert.equal(err.code, "NO_ACTIVE_CART");
    return true;
  });
});

test("getActiveStores retorna lojas operacionais", async () => {
  const { service } = await fixture();
  const stores = service.getActiveStores();
  assert.ok(stores.length >= 2);
  assert.ok(stores.some(s => s.id === "vila"));
  assert.ok(stores.some(s => s.id === "botanico"));
  assert.ok(stores.some(s => s.id === "sul"));
});

test("MockShippingProvider retorna cotacao padrao", async () => {
  const provider = new MockShippingProvider({});
  const quote = await provider.quote({
    originPostalCode: "14010030",
    destinationPostalCode: "01310100",
    items: [{ weight: 0.5, width: 30, height: 5, length: 40, declaredValue: 15000, quantity: 1 }]
  });
  assert.equal(quote.provider, "mock");
  assert.ok(quote.priceCents > 0);
  assert.ok(quote.estimatedMinDays > 0);
  assert.ok(quote.expiresAt);
});

test("MockShippingProvider com failMode timeout", async () => {
  const provider = new MockShippingProvider({ failMode: "timeout" });
  await assert.rejects(() => provider.quote({
    originPostalCode: "14010030",
    destinationPostalCode: "01310100",
    items: [{ weight: 0.5, width: 30, height: 5, length: 40 }]
  }), (err) => {
    assert.equal(err.code, "SHIPPING_QUOTE_TIMEOUT");
    return true;
  });
});

test("MockShippingProvider com failMode error", async () => {
  const provider = new MockShippingProvider({ failMode: "error" });
  await assert.rejects(() => provider.quote({
    originPostalCode: "14010030",
    destinationPostalCode: "01310100",
    items: [{ weight: 0.5, width: 30, height: 5, length: 40 }]
  }), (err) => {
    assert.equal(err.code, "SHIPPING_QUOTE_FAILED");
    return true;
  });
});

test("MockShippingProvider com mockQuote customizado", async () => {
  const provider = new MockShippingProvider({
    mockQuote: {
      provider: "mock-custom",
      serviceCode: "express",
      serviceName: "Entrega Express",
      priceCents: 3500,
      estimatedMinDays: 1,
      estimatedMaxDays: 2,
      warnings: []
    }
  });
  const quote = await provider.quote({
    originPostalCode: "14010030",
    destinationPostalCode: "01310100",
    items: [{ weight: 0.5, width: 30, height: 5, length: 40 }]
  });
  assert.equal(quote.serviceName, "Entrega Express");
  assert.equal(quote.priceCents, 3500);
});

test("MockShippingProvider configurado retorna configurado true", () => {
  const provider = new MockShippingProvider({});
  assert.equal(provider.isConfigured, true);
  const unconfigured = new MockShippingProvider({ configured: false });
  assert.equal(unconfigured.isConfigured, false);
});

test("ShippingQuoteProvider base throws NOT_IMPLEMENTED", async () => {
  const { ShippingQuoteProvider } = require("../shippingQuoteProvider");
  const provider = new ShippingQuoteProvider();
  await assert.rejects(() => provider.quote({}), (err) => {
    assert.equal(err.message, "NOT_IMPLEMENTED");
    return true;
  });
});

test("deliverySummaryDTO formata moeda BRL", () => {
  const { formatCentsBrl } = require("../appFulfillmentDto");
  assert.equal(formatCentsBrl(0), "R$\u00a00,00");
  assert.equal(formatCentsBrl(15000), "R$\u00a0150,00");
  assert.equal(formatCentsBrl(2500), "R$\u00a025,00");
});

test("deliverySummaryDTO bloco de issues e booleano", () => {
  const { deliverySummaryDto } = require("../appFulfillmentDto");
  const summary = deliverySummaryDto({
    blockingIssues: ["Carrinho vazio."],
    canContinueToCheckoutFuture: false,
    cartSubtotalCents: 0,
    shippingPriceCents: 0
  });
  assert.equal(Array.isArray(summary.blockingIssues), true);
  assert.equal(summary.blockingIssues.length, 1);
  assert.equal(summary.canContinueToCheckoutFuture, false);
  assert.equal(summary.estimatedTotalCents, 0);
});
test("nenhuma retirada dividida entre lojas — apenas uma pickup_store_id no fulfillment", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 2, 30000, 1, ?, ?)`, [cartId, accountId, now, now]);
  await db.run(`INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, 'prod-1', 'v1', 1, 15000, 15000, 15000, '{}', 'in_stock', 1, ?, ?)`, [randomUUID(), cartId, now, now]);
  await db.run(`INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, 'prod-2', 'v2', 1, 15000, 15000, 15000, '{}', 'in_stock', 1, ?, ?)`, [randomUUID(), cartId, now, now]);

  const result = await service.setFulfillment(accountId, { fulfillment_type: "PICKUP", pickup_store_id: "vila" });
  assert.equal(result.data.fulfillmentType, "PICKUP");
  assert.equal(result.data.pickupStoreId, "vila");

  const fulfillment = await db.get(`SELECT pickup_store_id, fulfillment_type FROM app_cart_fulfillment WHERE cart_id = ?`, [cartId]);
  assert.equal(fulfillment.pickup_store_id, "vila");
  assert.equal(fulfillment.fulfillment_type, "PICKUP");
});

test("recomendacao nao força a escolha — todas as lojas sao elegiveis para PICKUP", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);

  // O service nao força uma loja — qualquer loja valida pode ser escolhida
  const result1 = await service.setFulfillment(accountId, { fulfillment_type: "PICKUP", pickup_store_id: "vila" });
  assert.equal(result1.data.pickupStoreId, "vila");

  const result2 = await service.setFulfillment(accountId, { fulfillment_type: "PICKUP", pickup_store_id: "botanico", expectedVersion: result1.data.version });
  assert.equal(result2.data.pickupStoreId, "botanico");

  const result3 = await service.setFulfillment(accountId, { fulfillment_type: "PICKUP", pickup_store_id: "sul", expectedVersion: result2.data.version });
  assert.equal(result3.data.pickupStoreId, "sul");
});

test("loja inexistente ou nao operacional nao pode ser selecionada para retirada", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);

  // Loja inexistente deve ser rejeitada
  await assert.rejects(() => service.setFulfillment(accountId, {
    fulfillment_type: "PICKUP",
    pickup_store_id: "inexistente"
  }), (err) => {
    assert.equal(err.code, "INVALID_PICKUP_STORE");
    return true;
  });

  // Loja null deve ser rejeitada
  await assert.rejects(() => service.setFulfillment(accountId, {
    fulfillment_type: "PICKUP",
    pickup_store_id: null
  }), (err) => {
    assert.equal(err.code, "INVALID_PICKUP_STORE");
    return true;
  });
});

test("nenhuma reserva de estoque durante fulfillment", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);

  // Antes do fulfillment, verificar que nao existe tabela de reservas
  const tables = await db.all(`SELECT name FROM sqlite_master WHERE type='table'`);
  const reservationTables = tables.filter(t => t.name && t.name.includes('reservation'));
  assert.equal(reservationTables.length, 0, "Nao deve existir tabela de reservas de estoque");

  await service.setFulfillment(accountId, { fulfillment_type: "PICKUP", pickup_store_id: "vila" });

  // Depois do fulfillment, verificar que ainda nao existe reserva
  const tablesAfter = await db.all(`SELECT name FROM sqlite_master WHERE type='table'`);
  const reservationTablesAfter = tablesAfter.filter(t => t.name && t.name.includes('reservation'));
  assert.equal(reservationTablesAfter.length, 0, "Fulfillment nao deve criar reservas de estoque");
});

test("nenhum pedido criado durante fulfillment", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);

  // Verificar que nao existe tabela de pedidos
  const tablesBefore = await db.all(`SELECT name FROM sqlite_master WHERE type='table'`);
  const orderTablesBefore = tablesBefore.filter(t => t.name && (t.name.includes('order') || t.name.includes('pedido')));
  assert.equal(orderTablesBefore.length, 0, "Nao deve existir tabela de pedidos antes do fulfillment");

  await service.setFulfillment(accountId, { fulfillment_type: "PICKUP", pickup_store_id: "vila" });

  const tablesAfter = await db.all(`SELECT name FROM sqlite_master WHERE type='table'`);
  const orderTablesAfter = tablesAfter.filter(t => t.name && (t.name.includes('order') || t.name.includes('pedido')));
  assert.equal(orderTablesAfter.length, 0, "Fulfillment nao deve criar tabela de pedidos");
});

test("nenhum pagamento iniciado durante fulfillment — sem tabela de pagamentos criada", async () => {
  const { db, service, accountId } = await fixture();
  const now = new Date().toISOString();
  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 15000, 1, ?, ?)`, [cartId, accountId, now, now]);
  const addressId = randomUUID();
  await db.run(`INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, neighborhood, city, state, validation_status, is_default, version, created_at, updated_at)
    VALUES (?, ?, 'Casa', 'Joao', '01310100', '01310-100', 'Av. Paulista', '1000', 'Bela Vista', 'Sao Paulo', 'SP', 'VALID', 1, 1, ?, ?)`, [addressId, accountId, now, now]);

  // Verificar que nao existe tabela de pagamentos
  const tablesBefore = await db.all(`SELECT name FROM sqlite_master WHERE type='table'`);
  const paymentTablesBefore = tablesBefore.filter(t => t.name && (t.name.includes('payment') || t.name.includes('pagamento')));
  assert.equal(paymentTablesBefore.length, 0, "Nao deve existir tabela de pagamentos antes do fulfillment");

  await service.setFulfillment(accountId, { fulfillment_type: "DELIVERY", address_id: addressId });

  const tablesAfter = await db.all(`SELECT name FROM sqlite_master WHERE type='table'`);
  const paymentTablesAfter = tablesAfter.filter(t => t.name && (t.name.includes('payment') || t.name.includes('pagamento')));
  assert.equal(paymentTablesAfter.length, 0, "Fulfillment nao deve criar tabela de pagamentos");
});

test("getFulfillmentOptions valida accountId e retorna estrutura completa", async () => {
  const { service, accountId } = await fixture();
  const result = await service.getFulfillmentOptions(accountId);
  assert.equal(result.success, true);
  assert.ok(Array.isArray(result.data.pickupStores), "pickupStores deve ser array");
  assert.ok(result.data.pickupStores.length >= 3, "Deve retornar pelo menos 3 lojas operacionais");
  assert.ok(result.data.availableFulfillmentTypes.includes("PICKUP"));
  assert.ok(result.data.availableFulfillmentTypes.includes("DELIVERY"));

  // Todas as lojas retornadas sao operacionais e elegiveis para PICKUP
  for (const store of result.data.pickupStores) {
    assert.ok(store.id, "Loja deve ter id");
    assert.ok(store.name, "Loja deve ter nome");
    assert.ok(store.city, "Loja deve ter cidade");
    assert.ok(store.state, "Loja deve ter estado");
  }
});
