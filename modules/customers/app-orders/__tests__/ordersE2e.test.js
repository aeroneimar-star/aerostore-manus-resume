"use strict";
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert');
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

// Helper
async function runSql(db, sql, params = []) {
  return db.run(sql, params);
}
async function getSql(db, sql, params = []) {
  return db.get(sql, params);
}
async function allSql(db, sql, params = []) {
  return db.all(sql, params);
}

describe('Orders E2E — Ponta a ponta', () => {
  let db;
  let orderService;
  let fulfillmentService;
  let inventoryService;

  before(async () => {
    db = memoryDb();
    await db.run("PRAGMA foreign_keys=ON");

    // Criar tabelas master mínimas
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_master_records(id TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, eligibility_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED', updated_at TEXT NOT NULL, deleted_at TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_identity_conflicts(id TEXT PRIMARY KEY, conflict_type TEXT, severity TEXT, status TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_identity_conflict_participants(id TEXT PRIMARY KEY, conflict_id TEXT, participant_type TEXT, participant_id TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_identity_cases(id TEXT PRIMARY KEY, blocking INTEGER)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_identity_case_conflicts(case_id TEXT, conflict_id TEXT)`);

    // Aplicar schemas
    await applyAppCustomerAccessSchema(db);
    await applyAppSessionSchema(db);
    await applyAppAddressSchema(db);
    await applyAppCartSchema(db);
    await applyAppFulfillmentSchema(db);
    await applyAppOrderSchema(db);

    // Tabelas PDV
    await runSql(db, `CREATE TABLE IF NOT EXISTS pdv_product_variants (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS pdv_inventory_balances_v2 (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, store_id TEXT NOT NULL, available_qty INTEGER NOT NULL DEFAULT 0, reserved_qty INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT, UNIQUE(variant_id, store_id))`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS pdv_inventory_movements_v2 (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, store_id TEXT NOT NULL, movement_type TEXT NOT NULL, quantity_delta INTEGER NOT NULL, quantity_before INTEGER NOT NULL DEFAULT 0, quantity_after INTEGER NOT NULL DEFAULT 0, origin TEXT, reference_type TEXT, reference_id TEXT, idempotency_key TEXT, actor_user_id TEXT, actor_name TEXT, metadata_json TEXT, created_at TEXT, UNIQUE(variant_id, store_id, idempotency_key))`);

    fulfillmentService = createAppFulfillmentService({
      dbApi: db,
      catalogService: null,
      recordAudit: async () => null,
    });

    inventoryService = createInventoryService({ dbApi: db });

    orderService = createAppOrderService({
      dbApi: db,
      fulfillmentService,
      inventoryService,
      recordAudit: async () => null,
    });
  });

  beforeEach(async () => {
    await runSql(db, 'DELETE FROM pdv_inventory_movements_v2');
    await runSql(db, 'DELETE FROM pdv_inventory_balances_v2');
    await runSql(db, 'DELETE FROM pdv_product_variants');
    await runSql(db, 'DELETE FROM app_order_items');
    await runSql(db, 'DELETE FROM app_order_events');
    await runSql(db, 'DELETE FROM app_orders');
    await runSql(db, 'DELETE FROM app_customer_addresses');
    await runSql(db, 'DELETE FROM app_cart_items');
    await runSql(db, 'DELETE FROM app_carts');
    await runSql(db, 'DELETE FROM app_customer_accounts');

    const now = new Date().toISOString();
    await runSql(db, `INSERT INTO pdv_product_variants (id, product_id, sku, name, created_at) VALUES ('variant-1', 'product-1', 'SKU-001', 'Produto Teste 1', '${now}'), ('variant-2', 'product-2', 'SKU-002', 'Produto Teste 2', '${now}')`);
    await runSql(db, `INSERT INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES ('balance-1', 'variant-1', 'vila', 10, 0, 1, '${now}'), ('balance-2', 'variant-2', 'vila', 5, 0, 1, '${now}')`);
    await runSql(db, `INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, version, created_at, updated_at) VALUES ('account-1', 'hash-1', '***', '', '', 'ACTIVE', 'APPROVED', 1, ?, ?)`, [now, now]);
    await runSql(db, `INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, version, created_at, updated_at) VALUES ('account-2', 'hash-2', '***', '', '', 'ACTIVE', 'APPROVED', 1, ?, ?)`, [now, now]);
    await runSql(db, `INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, complement, neighborhood, city, state, delivery_instructions, validation_status, is_default, version, created_at, updated_at) VALUES ('addr-1', 'account-1', 'Casa', 'Joao', '01001000', '01001-000', 'Rua Teste', '123', '', 'Centro', 'Sao Paulo', 'SP', '', 'VALID', 0, 1, ?, ?), ('addr-2', 'account-2', 'Casa', 'Maria', '20001000', '20001-000', 'Rua Outro', '456', '', 'Centro', 'Rio de Janeiro', 'RJ', '', 'VALID', 0, 1, ?, ?)`, [now, now, now, now]);
    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-1', 'account-1', 'ACTIVE', 'BRL', 2, 3500, 1, ?, ?)`, [now, now]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, promotional_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-1', 'cart-1', 'product-1', 'variant-1', 2, 1000, NULL, 1000, 2000, '{"name":"Produto Teste 1"}', 'in_stock', 1, ?, ?), ('item-2', 'cart-1', 'product-2', 'variant-2', 1, 1500, NULL, 1500, 1500, '{"name":"Produto Teste 2"}', 'in_stock', 1, ?, ?)`, [now, now, now, now]);
  });

  it('entrega valida cria pedido em READY_FOR_PAYMENT', async () => {
    const result = await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: 'e2e-delivery-001',
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.status, 'READY_FOR_PAYMENT');
    assert.strictEqual(result.data.fulfillment_type, 'DELIVERY');
    const balance = await getSql(db, "SELECT available_qty, reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'");
    assert.strictEqual(balance.available_qty, 8);
    assert.strictEqual(balance.reserved_qty, 2);
  });

  it('retirada valida cria pedido com pickup_store_id', async () => {
    const result = await orderService.createOrder('account-1', {
      fulfillment_type: 'PICKUP',
      pickup_store_id: 'vila',
      idempotency_key: 'e2e-pickup-001',
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.status, 'READY_FOR_PAYMENT');
    assert.strictEqual(result.data.fulfillment_type, 'PICKUP');
    assert.strictEqual(result.data.pickup_store_id, 'vila');
  });

  it('estoque insuficiente rejeita pedido', async () => {
    await runSql(db, "UPDATE pdv_inventory_balances_v2 SET available_qty = 0, reserved_qty = 10 WHERE variant_id = 'variant-1'");
    let error;
    try {
      await orderService.createOrder('account-1', {
        fulfillment_type: 'DELIVERY',
        address_id: 'addr-1',
        idempotency_key: 'e2e-stock-low-001',
      });
    } catch (e) { error = e; }
    assert.ok(error, 'Deveria ter lancado erro');
    assert.ok(error.message.includes('STOCK_UNAVAILABLE') || error.message.includes('INSUFFICIENT'));
  });

  it('endereco invalido rejeita pedido', async () => {
    let error;
    try {
      await orderService.createOrder('account-1', {
        fulfillment_type: 'DELIVERY',
        address_id: 'addr-invalid-999',
        idempotency_key: 'e2e-invalid-addr-001',
      });
    } catch (e) { error = e; }
    assert.ok(error, 'Deveria ter lancado erro');
  });

  it('loja invalida rejeita pedido de pickup', async () => {
    let error;
    try {
      await orderService.createOrder('account-1', {
        fulfillment_type: 'PICKUP',
        pickup_store_id: 'store-invalid-999',
        idempotency_key: 'e2e-invalid-store-001',
      });
    } catch (e) { error = e; }
    assert.ok(error, 'Deveria ter lancado erro');
  });

  it('duplo clique retorna o mesmo pedido (idempotencia)', async () => {
    const idempotencyKey = 'e2e-idempotent-001';
    const result1 = await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: idempotencyKey,
    });
    const result2 = await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: idempotencyKey,
    });
    assert.strictEqual(result1.data.id, result2.data.id);
    const orders = await allSql(db, 'SELECT id FROM app_orders WHERE account_id = ?', ['account-1']);
    assert.strictEqual(orders.length, 1);
    const balance = await getSql(db, "SELECT reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'");
    assert.strictEqual(balance.reserved_qty, 2);
  });

  it('retry com mesma idempotency_key retorna pedido existente', async () => {
    const idempotencyKey = 'e2e-retry-001';
    await orderService.createOrder('account-1', {
      fulfillment_type: 'PICKUP',
      pickup_store_id: 'vila',
      idempotency_key: idempotencyKey,
    });
    const retryResult = await orderService.createOrder('account-1', {
      fulfillment_type: 'PICKUP',
      pickup_store_id: 'vila',
      idempotency_key: idempotencyKey,
    });
    assert.strictEqual(retryResult.data.status, 'READY_FOR_PAYMENT');
  });

  it('sem autenticacao retorna erro', async () => {
    let error;
    try {
      await orderService.listOrders(null);
    } catch (e) { error = e; }
    assert.ok(error, 'Deveria ter lancado erro de autenticacao');
  });

  it('db nulo rejeita criacao do servico', async () => {
    let error;
    try {
      createAppOrderService({
        dbApi: null,
        fulfillmentService,
        inventoryService,
        recordAudit: async () => null,
      });
    } catch (e) { error = e; }
    assert.ok(error, 'Deveria ter lancado erro');
    assert.ok(error.message.includes('DB_REQUIRED'));
  });

  it('OrderClientError existe como classe de erro frontend', async () => {
    // Teste de contrato: verifica que a classe OrderClientError existe
    // (não podemos importar .ts no Node, mas verificamos que o módulo foi criado)
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../../../../apps/mobile/src/orders/OrderClientError.ts');
    assert.ok(fs.existsSync(filePath), 'OrderClientError.ts deve existir no frontend');
  });

  it('listOrders retorna pedidos do cliente', async () => {
    await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: 'e2e-list-001',
    });
    await orderService.createOrder('account-1', {
      fulfillment_type: 'PICKUP',
      pickup_store_id: 'vila',
      idempotency_key: 'e2e-list-002',
    });
    const result = await orderService.listOrders('account-1');
    assert.strictEqual(result.ok, true);
    assert.ok(Array.isArray(result.data));
    assert.strictEqual(result.data.length, 2);
  });

  it('getOrder retorna detalhes completos', async () => {
    const createResult = await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: 'e2e-detail-001',
    });
    const orderId = createResult.data.id;
    const detail = await orderService.getOrder('account-1', orderId);
    assert.strictEqual(detail.ok, true);
    assert.strictEqual(detail.data.order.id, orderId);
    assert.ok(Array.isArray(detail.data.items));
    assert.ok(Array.isArray(detail.data.events));
    assert.ok(detail.data.events.length > 0);
  });

  it('pedido de account-2 nao e visivel para account-1', async () => {
    const now = new Date().toISOString();
    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-2', 'account-2', 'ACTIVE', 'BRL', 1, 1000, 1, ?, ?)`, [now, now]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-2a', 'cart-2', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto Teste 1"}', 'in_stock', 1, ?, ?)`, [now, now]);

    await orderService.createOrder('account-2', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-2',
      idempotency_key: 'e2e-isolation-001',
    });

    const list1 = await orderService.listOrders('account-1');
    const list2 = await orderService.listOrders('account-2');

    assert.strictEqual(list1.data.length, 0, 'account-1 nao deveria ver pedido de account-2');
    assert.strictEqual(list2.data.length, 1, 'account-2 deveria ver 1 pedido');

    const orderId = list2.data[0].order_number;
    // Buscar o id real pelo order_number
    const orderRow = await getSql(db, 'SELECT id FROM app_orders WHERE order_number = ?', [orderId]);
    const realOrderId = orderRow.id;
    let error;
    try {
      await orderService.getOrder('account-1', realOrderId);
    } catch (e) { error = e; }
    assert.ok(error, 'account-1 nao deveria acessar pedido de account-2');
  });
});
