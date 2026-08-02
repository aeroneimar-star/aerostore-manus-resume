"use strict";
/**
 * Teste HTTP ponta a ponta — Phase 3.4-E
 *
 * Valida que o contrato HTTP real funciona:
 *   Cliente HTTP → servidor Express real → appOrderService → SQLite temporário
 *
 * Este teste NÃO importa HttpOrderClient.ts (que depende de react-native).
 * Em vez disso, usa http nativo para chamar as rotas Express reais,
 * validando que o contrato /app/v1/orders está correto.
 *
 * Valida 8 cenários:
 *   1. criar pedido com entrega → READY_FOR_PAYMENT
 *   2. criar pedido com retirada → READY_FOR_PAYMENT
 *   3. listar pedidos
 *   4. abrir detalhe
 *   5. repetir idempotency_key (sem duplicação)
 *   6. estoque insuficiente → 400
 *   7. sessão expirada (token inválido) → 401
 *   8. falha de rede simulada (cliente sem servidor)
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');
const { memoryDb } = require('../../master/__tests__/memoryDb');
const { applyAppCustomerAccessSchema } = require('../../app-access/persistence/appCustomerAccessSchema');
const { applyAppSessionSchema } = require('../../app-auth/persistence/appSessionSchema');
const { applyAppAddressSchema } = require('../../app-address/persistence/appAddressSchema');
const { applyAppFulfillmentSchema } = require('../../app-fulfillment/persistence/appFulfillmentSchema');
const { applyAppCartSchema } = require('../../app-cart/persistence/appCartSchema');
const { applyAppOrderSchema } = require('../persistence/appOrderSchema');
const { createAppOrderService } = require('../appOrderService');
const { createAppFulfillmentService } = require('../../app-fulfillment/appFulfillmentService');
const { createInventoryService } = require('../inventoryService');
const { createAppOrderRouter } = require('../appOrderRoutes');

async function runSql(db, sql, params = []) { return db.run(sql, params); }

/** Cliente HTTP mínimo */
function makeHttpClient(baseUrl, token, deviceId) {
  return {
    createOrder(payload) {
      return httpCall(baseUrl, 'POST', '/app/v1/orders', payload, token, deviceId);
    },
    listOrders() {
      return httpCall(baseUrl, 'GET', '/app/v1/orders', undefined, token, deviceId);
    },
    getOrder(orderId) {
      return httpCall(baseUrl, 'GET', `/app/v1/orders/${orderId}`, undefined, token, deviceId);
    },
  };
}

function httpCall(baseUrl, method, path, body, token, deviceId) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-device-id': deviceId,
      },
      timeout: 5000,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            resolve({ ok: false, status: res.statusCode, data: parsed });
          } else {
            resolve({ ok: true, status: res.statusCode, data: parsed });
          }
        } catch {
          resolve({ ok: false, status: res.statusCode, data: {} });
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Orders HTTP E2E — Ponta a ponta real', () => {
  let db;
  let app;
  let server;
  let orderService;
  let baseUrl;
  let client;
  let savedOrderId = null; // guardado do teste 1

  before(async () => {
    db = await memoryDb();
    await db.run("PRAGMA foreign_keys=ON");

    // Tabelas master mínimas
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_master_records(id TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, eligibility_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED', updated_at TEXT NOT NULL, deleted_at TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_identity_conflicts(id TEXT PRIMARY KEY, conflict_type TEXT, severity TEXT, status TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_identity_conflict_participants(id TEXT PRIMARY KEY, conflict_id TEXT, participant_type TEXT, participant_id TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_identity_cases(id TEXT PRIMARY KEY, blocking INTEGER)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_identity_case_conflicts(case_id TEXT, conflict_id TEXT)`);

    await applyAppCustomerAccessSchema(db);
    await applyAppSessionSchema(db);
    await applyAppAddressSchema(db);
    await applyAppCartSchema(db);
    await applyAppFulfillmentSchema(db);
    await applyAppOrderSchema(db);

    await runSql(db, `CREATE TABLE IF NOT EXISTS pdv_product_variants (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS pdv_inventory_balances_v2 (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, store_id TEXT NOT NULL, available_qty INTEGER NOT NULL DEFAULT 0, reserved_qty INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT, UNIQUE(variant_id, store_id))`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS pdv_inventory_movements_v2 (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, store_id TEXT NOT NULL, movement_type TEXT NOT NULL, quantity_delta INTEGER NOT NULL, quantity_before INTEGER NOT NULL DEFAULT 0, quantity_after INTEGER NOT NULL DEFAULT 0, origin TEXT, reference_type TEXT, reference_id TEXT, idempotency_key TEXT, actor_user_id TEXT, actor_name TEXT, metadata_json TEXT, created_at TEXT, UNIQUE(variant_id, store_id, idempotency_key))`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS pdv_stores (id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT, city TEXT, state TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT)`);

    const catalogService = { getProduct: () => null, loadProductsForRefresh: async () => [] };
    const fulfillmentService = createAppFulfillmentService({ dbApi: db, catalogService });
    const inventoryService = createInventoryService({ dbApi: db });
    orderService = createAppOrderService({ dbApi: db, fulfillmentService, inventoryService, catalogService });

    app = express();
    app.use(express.json());
    const orderRouter = createAppOrderRouter({ express, orderService });
    app.use('/app/v1', orderRouter);

    await new Promise((resolve) => { server = app.listen(0, resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    client = makeHttpClient(baseUrl, 'account-1', 'device-test-001');
  });

  it('1. criar pedido com entrega — READY_FOR_PAYMENT', async () => {
    const now = new Date().toISOString();
    const acct = 'acct-delivery';
    const addr = 'addr-delivery';
    const cart = 'cart-delivery';
    const snap = JSON.stringify({ name: 'Produto Teste 1' });
    await runSql(db, `INSERT INTO pdv_product_variants (id, product_id, sku, name, created_at) VALUES (?, ?, ?, ?, ?)`, ['variant-1', 'product-1', 'SKU-001', 'Produto Teste 1', now]);
    await runSql(db, `INSERT INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES (?, ?, ?, 10, 0, 1, ?)`, ['bal-delivery', 'variant-1', 'vila', now]);
    await runSql(db, `INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, [acct, 'h1', '***', '', '', 'ACTIVE', 'APPROVED', now, now]);
    await runSql(db, `INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, complement, neighborhood, city, state, delivery_instructions, latitude, longitude, validation_status, is_default, version, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, 1, ?, ?, NULL)`, [addr, acct, 'Casa', 'Joao', '01001000', '01001-000', 'Rua Teste', '123', '', 'Centro', 'Sao Paulo', 'SP', '', 'VALID', now, now]);
    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, ?, ?, 2, 3500, 1, ?, ?)`, [cart, acct, 'ACTIVE', 'BRL', now, now]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, promotional_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, 2, 1000, NULL, 1000, 2000, ?, ?, 1, ?, ?)`, ['item-delivery', cart, 'product-1', 'variant-1', snap, 'in_stock', now, now]);

    const orderClient = makeHttpClient(baseUrl, acct, 'device-test-001');
    const result = await orderClient.createOrder({
      fulfillment_type: 'DELIVERY',
      address_id: addr,
      idempotency_key: 'e2e-http-delivery-001',
    });
    assert.strictEqual(result.ok, true, `Falhou com: ${JSON.stringify(result.data)}`);
    assert.strictEqual(result.data.data.status, 'READY_FOR_PAYMENT');
    assert.ok(result.data.data.id);
    assert.ok(result.data.data.order_number);
    savedOrderId = result.data.data.id; // guardar para teste 4
  });

  it('2. criar pedido com retirada — READY_FOR_PAYMENT', async () => {
    const now = new Date().toISOString();
    const acct = 'acct-pickup';
    const cart = 'cart-pickup';
    const snap = JSON.stringify({ name: 'Produto Teste 1' });
    await runSql(db, `INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, [acct, 'h2', '***', '', '', 'ACTIVE', 'APPROVED', now, now]);
    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, ?, ?, 2, 3500, 1, ?, ?)`, [cart, acct, 'ACTIVE', 'BRL', now, now]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, promotional_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, 2, 1000, NULL, 1000, 2000, ?, ?, 1, ?, ?)`, ['item-pickup', cart, 'product-1', 'variant-1', snap, 'in_stock', now, now]);

    const orderClient = makeHttpClient(baseUrl, acct, 'device-test-002');
    const result = await orderClient.createOrder({
      fulfillment_type: 'PICKUP',
      pickup_store_id: 'vila',
      idempotency_key: 'e2e-http-pickup-001',
    });
    assert.strictEqual(result.ok, true, `Falhou com: ${JSON.stringify(result.data)}`);
    assert.strictEqual(result.data.data.status, 'READY_FOR_PAYMENT');
    assert.strictEqual(result.data.data.fulfillment_type, 'PICKUP');
    assert.strictEqual(result.data.data.pickup_store_id, 'vila');
  });

  it('3. listar pedidos', async () => {
    // Testar para acct-delivery (que tem pedido do teste 1)
    const orderClient = makeHttpClient(baseUrl, 'acct-delivery', 'device-test-001');
    const result = await orderClient.listOrders();
    assert.strictEqual(result.ok, true);
    assert.ok(Array.isArray(result.data.data));
    assert.ok(result.data.data.length >= 1, `Esperava pelo menos 1 pedido para acct-delivery, obteve ${result.data.data.length}`);
  });

  it('4. abrir detalhe', async () => {
    const orderClient = makeHttpClient(baseUrl, 'acct-delivery', 'device-test-001');
    assert.ok(savedOrderId, 'Teste 1 precisa ter guardado o orderId');
    const result = await orderClient.getOrder(savedOrderId);
    assert.strictEqual(result.ok, true, `Falhou com: ${JSON.stringify(result.data)}`);
    assert.ok(result.data.data.order);
    assert.ok(result.data.data.items);
    assert.strictEqual(result.data.data.order.id, savedOrderId);
  });

  it('5. repetir idempotency_key — sem duplicação', async () => {
    const now = new Date().toISOString();
    const acct = 'acct-idem';
    const cart = 'cart-idem';
    const addr = 'addr-idem';
    const snap = JSON.stringify({ name: 'Produto Teste 1' });
    await runSql(db, `INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, [acct, 'h3', '***', '', '', 'ACTIVE', 'APPROVED', now, now]);
    await runSql(db, `INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, complement, neighborhood, city, state, delivery_instructions, latitude, longitude, validation_status, is_default, version, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, 1, ?, ?, NULL)`, [addr, acct, 'Casa', 'Joao', '01001000', '01001-000', 'Rua Teste', '123', '', 'Centro', 'Sao Paulo', 'SP', '', 'VALID', now, now]);
    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, ?, ?, 2, 3500, 1, ?, ?)`, [cart, acct, 'ACTIVE', 'BRL', now, now]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, promotional_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, 2, 1000, NULL, 1000, 2000, ?, ?, 1, ?, ?)`, ['item-idem', cart, 'product-1', 'variant-1', snap, 'in_stock', now, now]);

    const orderClient = makeHttpClient(baseUrl, acct, 'device-test-003');
    const result = await orderClient.createOrder({
      fulfillment_type: 'DELIVERY',
      address_id: addr,
      idempotency_key: 'e2e-http-idempotent-001',
    });
    assert.strictEqual(result.ok, true, `Falhou com: ${JSON.stringify(result.data)}`);

    // Segundo pedido com mesma key — mesmo cart (o service deve detectar idempotency)
    const result2 = await orderClient.createOrder({
      fulfillment_type: 'DELIVERY',
      address_id: addr,
      idempotency_key: 'e2e-http-idempotent-001',
    });
    // A idempotency retorna o pedido existente (não cria duplicata)
    // O pedido retornado deve ter o mesmo orderId do primeiro
    if (result2.ok) {
      assert.strictEqual(result2.data.data.id, result.data.data.id, 'Idempotency deve retornar o mesmo pedido');
    }
    // Ou pode retornar 409 se o backend decidir rejeitar
    assert.ok(result2.ok || result2.status === 409, `Esperava ok ou 409, obteve ok=${result2.ok} status=${result2.status}`);
  });

  it('6. estoque insuficiente — 400', async () => {
    const now = new Date().toISOString();
    const acct = 'acct-stock';
    const addr = 'addr-stock';
    const cart = 'cart-stock';
    const snap = JSON.stringify({ name: 'Produto Teste 1' });
    await runSql(db, `INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, [acct, 'h4', '***', '', '', 'ACTIVE', 'APPROVED', now, now]);
    await runSql(db, `INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, complement, neighborhood, city, state, delivery_instructions, latitude, longitude, validation_status, is_default, version, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, 1, ?, ?, NULL)`, [addr, acct, 'Casa', 'Joao', '01001000', '01001-000', 'Rua Teste', '123', '', 'Centro', 'Sao Paulo', 'SP', '', 'VALID', now, now]);
    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, ?, ?, 2, 3500, 1, ?, ?)`, [cart, acct, 'ACTIVE', 'BRL', now, now]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, promotional_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, 2, 1000, NULL, 1000, 2000, ?, ?, 1, ?, ?)`, ['item-stock', cart, 'product-1', 'variant-stock', snap, 'in_stock', now, now]);
    // Estoque zerado
    await runSql(db, `INSERT INTO pdv_product_variants (id, product_id, sku, name, created_at) VALUES (?, ?, ?, ?, ?)`, ['variant-stock', 'product-1', 'SKU-STOCK', 'Produto Stock', now]);
    await runSql(db, `INSERT INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES (?, ?, ?, 0, 0, 1, ?)`, ['bal-stock', 'variant-stock', 'vila', now]);

    const orderClient = makeHttpClient(baseUrl, acct, 'device-test-004');
    const result = await orderClient.createOrder({
      fulfillment_type: 'DELIVERY',
      address_id: addr,
      idempotency_key: 'e2e-http-stock-001',
      items: [{ variant_id: 'variant-stock', quantity: 9999, unit_price_cents: 100, line_total_cents: 999900 }],
      subtotal_cents: 999900,
      shipping_quote_cents: 0,
      total_cents: 999900,
    });
    assert.strictEqual(result.ok, false);
    assert.ok(result.status >= 400, `Esperava status 4xx, obteve ${result.status}`);
  });

  it('7. sessão expirada — 401', async () => {
    const badClient = makeHttpClient(baseUrl, '', 'device-test-001');
    const result = await badClient.createOrder({
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: 'e2e-http-expired-001',
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, 401);
  });

  it('8. falha de rede — porta sem servidor', async () => {
    const offlineClient = makeHttpClient('http://127.0.0.1:1', 'account-1', 'device-test-001');
    try {
      await offlineClient.createOrder({
        fulfillment_type: 'DELIVERY',
        address_id: 'addr-1',
        idempotency_key: 'e2e-http-offline-001',
      });
      assert.fail('Esperava erro de rede');
    } catch (err) {
      assert.ok(err.message.includes('ECONNREFUSED') || err.message.includes('TIMEOUT'), `Erro esperado de conexão: ${err.message}`);
    }
  });
  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (db) db.close();
  });
});
