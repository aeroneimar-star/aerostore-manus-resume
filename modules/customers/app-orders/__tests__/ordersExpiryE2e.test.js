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
const { applyAppOrderSchemaV2 } = require('../persistence/appOrderSchemaV2');
const { createAppOrderService } = require('../appOrderService');
const { createAppFulfillmentService } = require('../../app-fulfillment/appFulfillmentService');
const { createInventoryService } = require('../inventoryService');
const { sweepExpiredOrders } = require('../orderExpiryService');
const { startExpiryScheduler } = require('../orderExpiryScheduler');

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

const NOW = new Date();
const NOW_ISO = NOW.toISOString();

function futureIso(minutesAgo) {
  const d = new Date(NOW.getTime() - minutesAgo * 60 * 1000);
  return d.toISOString();
}

describe('Orders Expiry E2E — 18 testes obrigatórios', () => {
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

    // Aplicar schemas v1 + v2
    await applyAppCustomerAccessSchema(db);
    await applyAppSessionSchema(db);
    await applyAppAddressSchema(db);
    await applyAppCartSchema(db);
    await applyAppFulfillmentSchema(db);
    await applyAppOrderSchema(db);
    await applyAppOrderSchemaV2(db);

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

    const now = NOW_ISO;
    await runSql(db, `INSERT INTO pdv_product_variants (id, product_id, sku, name, created_at) VALUES ('variant-1', 'product-1', 'SKU-001', 'Produto Teste 1', '${now}')`);
    await runSql(db, `INSERT INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES ('balance-1', 'variant-1', 'vila', 10, 0, 1, '${now}')`);
    await runSql(db, `INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, version, created_at, updated_at) VALUES ('account-1', 'hash-1', '***', '', '', 'ACTIVE', 'APPROVED', 1, ?, ?), ('account-2', 'hash-2', '***', '', '', 'ACTIVE', 'APPROVED', 1, ?, ?)`, [now, now, now, now]);
    await runSql(db, `INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, complement, neighborhood, city, state, delivery_instructions, validation_status, is_default, version, created_at, updated_at) VALUES ('addr-1', 'account-1', 'Casa', 'Joao', '01001000', '01001-000', 'Rua Teste', '123', '', 'Centro', 'Sao Paulo', 'SP', '', 'VALID', 0, 1, ?, ?), ('addr-2', 'account-2', 'Casa', 'Maria', '20001000', '20001-000', 'Rua Outro', '456', '', 'Centro', 'Rio de Janeiro', 'RJ', '', 'VALID', 0, 1, ?, ?)`, [now, now, now, now]);
  });

  /**
   * Helper: cria um cart ACTIVE com items para a conta e variante.
   * Retorna { cartId, itemId }.
   */
  async function seedCart(accountId, variantId = 'variant-1', quantity = 2, cartSuffix = '') {
    const now = NOW_ISO;
    const cartId = `cart-${accountId}${cartSuffix}`;
    const itemId = `item-${accountId}${cartSuffix}`;
    await runSql(db, `INSERT OR REPLACE INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 1, 1000, 1, ?, ?)`, [cartId, accountId, now, now]);
    await runSql(db, `INSERT OR REPLACE INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, 'product-1', ?, ?, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [itemId, cartId, variantId, quantity, now, now]);
    return { cartId, itemId };
  }

  // ============================================================
  // T1. Pedido não pago após TTL deve ser expirado
  // ============================================================
  it('T1: pedido não pago após TTL deve ser expirado', async () => {
    await seedCart('account-1');
    const result = await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: 'expiry-t1',
    });
    assert.strictEqual(result.data.status, 'READY_FOR_PAYMENT');
    const orderId = result.data.id;

    // Simular expiração: setar expires_at no passado
    const past = futureIso(31);
    await runSql(db, `UPDATE app_orders SET expires_at = ? WHERE id = ?`, [past, orderId]);

    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweepResult.expired, 1);

    const order = await getSql(db, `SELECT id, status, expired_at FROM app_orders WHERE id = ?`, [orderId]);
    assert.strictEqual(order.status, 'EXPIRED');
    assert.ok(order.expired_at, 'expired_at deve estar preenchido');
  });

  // ============================================================
  // T2. Estoque deve ser devolvido ao PDV após expiração
  // ============================================================
  it('T2: estoque deve ser devolvido ao PDV após expiração', async () => {
    await seedCart('account-1');
    const result = await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: 'expiry-t2',
    });
    const orderId = result.data.id;

    const balanceBefore = await getSql(db, `SELECT available_qty, reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    assert.strictEqual(balanceBefore.available_qty, 8);
    assert.strictEqual(balanceBefore.reserved_qty, 2);

    const past = futureIso(31);
    await runSql(db, `UPDATE app_orders SET expires_at = ? WHERE id = ?`, [past, orderId]);

    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweepResult.expired, 1);

    const balanceAfter = await getSql(db, `SELECT available_qty, reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    assert.strictEqual(balanceAfter.available_qty, 10);
    assert.strictEqual(balanceAfter.reserved_qty, 0);
  });

  // ============================================================
  // T3. Pedido não expirado (antes do TTL) não deve ser afetado
  // ============================================================
  it('T3: pedido não expirado (antes do TTL) não deve ser afetado', async () => {
    await seedCart('account-1');
    const result = await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: 'expiry-t3',
    });
    const orderId = result.data.id;

    // expires_at está no futuro — não expirar
    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweepResult.expired, 0);

    const order = await getSql(db, `SELECT id, status FROM app_orders WHERE id = ?`, [orderId]);
    assert.strictEqual(order.status, 'READY_FOR_PAYMENT');
  });

  // ============================================================
  // T4. Múltiplos pedidos expirados devem ser processados em lote
  // ============================================================
  it('T4: múltiplos pedidos expirados devem ser processados em lote', async () => {
    // Ajustar estoque para suportar 3 pedidos de 1 unidade
    await runSql(db, `UPDATE pdv_inventory_balances_v2 SET available_qty = 10, reserved_qty = 0 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);

    const past = futureIso(31);
    const orderIds = [];

    for (let i = 1; i <= 3; i++) {
      // Criar pedido manualmente para evitar FK constraint (cada pedido precisa de cart único)
      const orderId = `order-t4-${i}`;
      const cartId = `cart-t4-${i}`;
      const itemId = `item-t4-${i}`;
      await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, 'account-1', 'ACTIVE', 'BRL', 1, 1000, 1, ?, ?)`, [cartId, NOW_ISO, NOW_ISO]);
      await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [itemId, cartId, NOW_ISO, NOW_ISO]);

      // Reservar estoque
      const holdResult = await inventoryService.holdReservation(orderId, [{ variant_id: 'variant-1', quantity: 1 }], 'vila', `expiry-t4-${i}`);

      // Criar pedido diretamente (snapshot_json deve conter store_origin_id para o sweep)
      const snapshot = JSON.stringify({ store_origin_id: 'vila', fulfillment_type: 'DELIVERY', address_id: 'addr-1', cart_items: [{ product_id: 'product-1', variant_id: 'variant-1', quantity: 1, name: 'Produto 1', unit_price_cents: 1000 }] });
      await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, ?, 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'READY_FOR_PAYMENT', ?, ?, ?, 1, ?, ?, ?)`, [orderId, `ORD-T4-${i}`, `expiry-t4-${i}`, snapshot, JSON.stringify([holdResult.reservation_id]), NOW_ISO, NOW_ISO, past]);

      // Converter o cart (simular o que createOrder faz)
      await runSql(db, `UPDATE app_carts SET status = 'CONVERTED' WHERE id = ?`, [cartId]);

      orderIds.push(orderId);
    }

    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweepResult.expired, 3);

    for (const oid of orderIds) {
      const order = await getSql(db, `SELECT status FROM app_orders WHERE id = ?`, [oid]);
      assert.strictEqual(order.status, 'EXPIRED');
    }

    const balance = await getSql(db, `SELECT available_qty, reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    assert.strictEqual(balance.available_qty, 10);
    assert.strictEqual(balance.reserved_qty, 0);
  });

  // ============================================================
  // T5. Pedidos já pagos (READY_FOR_PAYMENT → não expirável) não devem ser expirados
  // ============================================================
  it('T5: pedidos já pagos não devem ser expirados', async () => {
    // Criar pedido manualmente com status READY_FOR_PAYMENT e expires_at no passado
    // Nota: READY_FOR_PAYMENT é o status que sweep processa. Para testar "já pago",
    // usamos um status que NÃO é READY_FOR_PAYMENT.
    const orderId = 'order-t5';
    const past = futureIso(31);
    await runSql(db, `INSERT OR REPLACE INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t5', 'account-1', 'CONVERTED', 'BRL', 1, 1000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT OR REPLACE INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t5', 'cart-t5', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    // Usar FAILED como status que não será processado pelo sweep
    await runSql(db, `INSERT OR REPLACE INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-T5', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'FAILED', 't5-key', '[]', '[]', 1, ?, ?, ?)`, [orderId, NOW_ISO, NOW_ISO, past]);

    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweepResult.expired, 0);

    const order = await getSql(db, `SELECT id, status FROM app_orders WHERE id = ?`, [orderId]);
    assert.strictEqual(order.status, 'FAILED');
  });

  // ============================================================
  // T6. Pedidos com failed_reason não devem ser afetados
  // ============================================================
  it('T6: pedidos com failed_reason não devem ser afetados', async () => {
    const orderId = 'order-t6';
    const past = futureIso(31);
    await runSql(db, `INSERT OR REPLACE INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t6', 'account-1', 'CONVERTED', 'BRL', 1, 1000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT OR REPLACE INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t6', 'cart-t6', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT OR REPLACE INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at, failed_reason) VALUES (?, 'ORD-T6', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'FAILED', 't6-key', '{"error":"test"}', '[]', 1, ?, ?, ?, 'STOCK_UNAVAILABLE')`, [orderId, NOW_ISO, NOW_ISO, past]);

    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweepResult.expired, 0);
  });

  // ============================================================
  // T7. Pedido EXPIRED não deve ser re-processado (idempotência do sweep)
  // ============================================================
  it('T7: pedido EXPIRED não deve ser re-processado', async () => {
    const orderId = 'order-t7';
    await runSql(db, `INSERT OR REPLACE INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t7', 'account-1', 'CONVERTED', 'BRL', 1, 1000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT OR REPLACE INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t7', 'cart-t7', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT OR REPLACE INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-T7', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'EXPIRED', 't7-key', '[]', '[]', 1, ?, ?, ?)`, [orderId, NOW_ISO, NOW_ISO, futureIso(31)]);

    const sweep1 = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweep1.expired, 0);

    const sweep2 = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweep2.expired, 0);
  });

  // ============================================================
  // T8. Evento ORDER_EXPIRED deve ser gravado
  // ============================================================
  it('T8: evento ORDER_EXPIRED deve ser gravado', async () => {
    await seedCart('account-1');
    const result = await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: 'expiry-t8',
    });
    const orderId = result.data.id;

    const past = futureIso(31);
    await runSql(db, `UPDATE app_orders SET expires_at = ? WHERE id = ?`, [past, orderId]);

    await sweepExpiredOrders({ db, inventoryService, now: NOW });

    const events = await allSql(db, `SELECT id, order_id, event_type, details_json FROM app_order_events WHERE order_id = ? ORDER BY created_at DESC`, [orderId]);
    assert.ok(events.length >= 1);
    const expireEvent = events.find(e => e.event_type === 'ORDER_EXPIRED');
    assert.ok(expireEvent, 'Evento ORDER_EXPIRED deve existir');
    const details = JSON.parse(expireEvent.details_json);
    assert.strictEqual(details.reason, 'RESERVATION_EXPIRED');
  });

  // ============================================================
  // T9. Movimento RESERVATION_RELEASE deve ser gravado no PDV
  // ============================================================
  it('T9: movimento RESERVATION_RELEASE deve ser gravado no PDV', async () => {
    await seedCart('account-1');
    const result = await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: 'expiry-t9',
    });
    const orderId = result.data.id;

    // Buscar movimentos pelo metadata_json (que contém order_id)
    const movementsBefore = await allSql(db, `SELECT id, movement_type, reference_id FROM pdv_inventory_movements_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    const holdMovements = movementsBefore.filter(m => m.movement_type === 'RESERVATION_HOLD');
    assert.ok(holdMovements.length > 0, 'Deve haver movimento HOLD');

    const past = futureIso(31);
    await runSql(db, `UPDATE app_orders SET expires_at = ? WHERE id = ?`, [past, orderId]);

    await sweepExpiredOrders({ db, inventoryService, now: NOW });

    // Buscar movimentos RELEASE pelo store e variant (mesmo que os HOLD)
    const movementsAfter = await allSql(db, `SELECT id, movement_type, quantity_delta FROM pdv_inventory_movements_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    const releaseMovements = movementsAfter.filter(m => m.movement_type === 'RESERVATION_RELEASE');
    assert.ok(releaseMovements.length > 0, 'Deve haver movimento RESERVATION_RELEASE');
    assert.ok(releaseMovements[0].quantity_delta > 0);
  });

  // ============================================================
  // T10. Sweep com escopo de conta deve afetar apenas aquela conta
  // ============================================================
  it('T10: sweep com escopo de conta deve afetar apenas aquela conta', async () => {
    // account-1: pedido expirado
    await seedCart('account-1');
    const r1 = await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: 'expiry-t10-1',
    });

    // account-2: pedido expirado (manual, sem cart ativo — usar seedCart para account-2)
    await seedCart('account-2');
    const r2 = await orderService.createOrder('account-2', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-2',
      idempotency_key: 'expiry-t10-2',
    });

    // Marcar ambos como expirados
    const past = futureIso(31);
    await runSql(db, `UPDATE app_orders SET expires_at = ? WHERE id = ?`, [past, r1.data.id]);
    await runSql(db, `UPDATE app_orders SET expires_at = ? WHERE id = ?`, [past, r2.data.id]);

    // Sweep apenas para account-1
    const sweepResult = await sweepExpiredOrders({
      db,
      inventoryService,
      now: NOW,
      scope: { account_id: 'account-1' },
    });

    assert.strictEqual(sweepResult.expired, 1);
    const order1 = await getSql(db, `SELECT status FROM app_orders WHERE id = ?`, [r1.data.id]);
    assert.strictEqual(order1.status, 'EXPIRED');
    const order2 = await getSql(db, `SELECT status FROM app_orders WHERE id = ?`, [r2.data.id]);
    assert.strictEqual(order2.status, 'READY_FOR_PAYMENT', 'account-2 não deve ser afetado');
  });

  // ============================================================
  // T11. Sweep sem escopo deve afetar todas as contas
  // ============================================================
  it('T11: sweep sem escopo deve afetar todas as contas', async () => {
    await seedCart('account-1');
    const r1 = await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: 'expiry-t11-1',
    });
    await seedCart('account-2');
    const r2 = await orderService.createOrder('account-2', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-2',
      idempotency_key: 'expiry-t11-2',
    });

    const past = futureIso(31);
    await runSql(db, `UPDATE app_orders SET expires_at = ? WHERE id = ?`, [past, r1.data.id]);
    await runSql(db, `UPDATE app_orders SET expires_at = ? WHERE id = ?`, [past, r2.data.id]);

    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweepResult.expired, 2);
  });

  // ============================================================
  // T12. Pedido sem expires_at não deve ser afetado
  // ============================================================
  it('T12: pedido sem expires_at não deve ser afetado', async () => {
    const orderId = 'order-t12';
    await runSql(db, `INSERT OR REPLACE INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t12', 'account-1', 'CONVERTED', 'BRL', 1, 1000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT OR REPLACE INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t12', 'cart-t12', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    // Pedido sem expires_at (NULL)
    await runSql(db, `INSERT OR REPLACE INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at) VALUES (?, 'ORD-T12', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'READY_FOR_PAYMENT', 't12-key', '[]', '[]', 1, ?, ?)`, [orderId, NOW_ISO, NOW_ISO]);

    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweepResult.expired, 0);
  });

  // ============================================================
  // T13. Pedidos com READY_FOR_PAYMENT mas expires_at = NULL não devem ser afetados
  // ============================================================
  it('T13: READY_FOR_PAYMENT sem expires_at deve ser ignorado', async () => {
    const orderId = 'order-t13';
    await runSql(db, `INSERT OR REPLACE INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t13', 'account-1', 'CONVERTED', 'BRL', 1, 1000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT OR REPLACE INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t13', 'cart-t13', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT OR REPLACE INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-T13', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'READY_FOR_PAYMENT', 't13-key', '[]', '[]', 1, ?, ?, NULL)`, [orderId, NOW_ISO, NOW_ISO]);

    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweepResult.expired, 0);
  });

  // ============================================================
  // T14. Sweep vazio (sem pedidos expiráveis) deve retornar zeros
  // ============================================================
  it('T14: sweep vazio deve retornar zeros', async () => {
    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweepResult.expired, 0);
    assert.strictEqual(sweepResult.released, 0);
    assert.strictEqual(sweepResult.errors, 0);
  });

  // ============================================================
  // T15. db nulo deve rejeitar sweep
  // ============================================================
  it('T15: db nulo deve rejeitar sweep', async () => {
    let error;
    try {
      await sweepExpiredOrders({ db: null, inventoryService });
    } catch (e) { error = e; }
    assert.ok(error, 'Deveria ter lancado erro');
    assert.ok(error.message.includes('DB_REQUIRED'));
  });

  // ============================================================
  // T16. Per-reservation_id: reserva-A tem HOLD, reserva-B não tem → recusado
  // ============================================================
  it('T16: per-reservation_id — reserva-A tem HOLD mas reserva-B não tem → recusado', async () => {
    const orderId = 'order-t16';
    const past = futureIso(31);

    // Criar 2 variantes
    await runSql(db, `INSERT OR REPLACE INTO pdv_product_variants (id, product_id, sku, name, created_at) VALUES ('variant-2', 'product-1', 'SKU-002', 'Produto 2', '${NOW_ISO}')`);
    await runSql(db, `INSERT OR REPLACE INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES ('balance-2', 'variant-2', 'vila', 10, 0, 1, '${NOW_ISO}')`);

    // Reserva A: criar HOLD real via holdReservation
    const holdA = await inventoryService.holdReservation(orderId, [{ variant_id: 'variant-1', quantity: 1 }], 'vila', 'expiry-t16-a');

    // Reserva B: NÃO criar HOLD — apenas usar um fake reservation_id
    const fakeReservationId = 'fake-reservation-b-t16';

    await runSql(db, `INSERT OR REPLACE INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t16', 'account-1', 'CONVERTED', 'BRL', 2, 2000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    const snapshotT16 = JSON.stringify({ store_origin_id: 'vila', fulfillment_type: 'DELIVERY' });
    await runSql(db, `INSERT OR REPLACE INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-T16', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'READY_FOR_PAYMENT', 't16-key', ?, ?, 1, ?, ?, ?)`, [orderId, snapshotT16, JSON.stringify([holdA.reservation_id, fakeReservationId]), NOW_ISO, NOW_ISO, past]);

    // Salvar estado original dos saldos
    const balanceOrig = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);

    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });

    // Deve registrar exatamente 1 erro (reserva-B sem HOLD)
    assert.strictEqual(sweepResult.errors, 1);
    assert.strictEqual(sweepResult.errors_details.length, 1);
    assert.strictEqual(sweepResult.errors_details[0].error, 'RESERVATION_MOVEMENTS_NOT_FOUND');
    assert.strictEqual(sweepResult.errors_details[0].reservation_id, fakeReservationId);

    // Pedido deve permanecer READY_FOR_PAYMENT (rollback)
    const order = await getSql(db, `SELECT id, status, expired_at FROM app_orders WHERE id = ?`, [orderId]);
    assert.strictEqual(order.status, 'READY_FOR_PAYMENT');
    assert.strictEqual(order.expired_at, null);

    // Nenhum movimento RELEASE deve ter sido gravado
    const releases = await allSql(db, `SELECT id FROM pdv_inventory_movements_v2 WHERE reference_id = ? AND movement_type = 'RESERVATION_RELEASE'`, [orderId]);
    assert.strictEqual(releases.length, 0);

    // Nenhum evento ORDER_EXPIRED
    const events = await allSql(db, `SELECT id FROM app_order_events WHERE order_id = ? AND event_type = 'ORDER_EXPIRED'`, [orderId]);
    assert.strictEqual(events.length, 0);

    // Saldo de variant-1 deve estar inalterado (HOLD de reserva-A ainda válido)
    const balanceAfter = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    assert.strictEqual(balanceAfter.available_qty, balanceOrig.available_qty);
    assert.strictEqual(balanceAfter.reserved_qty, balanceOrig.reserved_qty);
    assert.strictEqual(balanceAfter.version, balanceOrig.version);
  });

  // ============================================================
  // T17. releaseReservation idempotente (double-release)
  // ============================================================
  it('T17: releaseReservation deve ser idempotente (double-release)', async () => {
    await seedCart('account-1');
    const result = await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: 'expiry-t17',
    });
    const orderId = result.data.id;

    // Liberar manualmente
    const release1 = await inventoryService.releaseReservation(orderId, 'vila', [{ variant_id: 'variant-1', quantity: 2 }]);
    assert.strictEqual(release1.released, true);

    // Liberar novamente (deve ser idempotente)
    const release2 = await inventoryService.releaseReservation(orderId, 'vila', [{ variant_id: 'variant-1', quantity: 2 }]);
    assert.strictEqual(release2.released, false);
    assert.strictEqual(release2.reason, 'ALREADY_RELEASED');
    assert.strictEqual(release2.idempotent, true);

    // Estoque não deve ser duplamente devolvido
    const balance = await getSql(db, `SELECT available_qty, reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    assert.strictEqual(balance.available_qty, 10);
    assert.strictEqual(balance.reserved_qty, 0);
  });

  // ============================================================
  // T18. Scheduler inicia e para sem erro
  // ============================================================
  it('T18: scheduler deve iniciar e parar sem erro', async () => {
    const origEnv = process.env.ORDER_EXPIRY_ENABLED;
    process.env.ORDER_EXPIRY_ENABLED = 'true';
    const scheduler = startExpiryScheduler({ db, inventoryService });
    assert.strictEqual(scheduler.isRunning, true);

    // Aguardar um tick
    await new Promise(resolve => setTimeout(resolve, 200));

    scheduler.stop();
    assert.strictEqual(scheduler.isRunning, false);
    process.env.ORDER_EXPIRY_ENABLED = origEnv;
  });

  // ============================================================
  // T19. Sweep processa múltiplas reservas de stores diferentes por pedido
  // ============================================================
  it('T19: sweep processa múltiplas reservas de stores diferentes por pedido', async () => {
    // Criar saldo em store diferente
    await runSql(db, `INSERT INTO pdv_product_variants (id, product_id, sku, name, created_at) VALUES ('variant-2', 'product-1', 'SKU-002', 'Produto Teste 2', '${NOW_ISO}')`);
    await runSql(db, `INSERT INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES ('balance-2', 'variant-2', 'vila', 10, 0, 1, '${NOW_ISO}')`);
    await runSql(db, `INSERT INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES ('balance-3', 'variant-1', 'marginal', 5, 0, 1, '${NOW_ISO}')`);

    // Reservar em 2 stores diferentes
    const hold1 = await inventoryService.holdReservation('order-t19', [{ variant_id: 'variant-1', quantity: 2 }], 'vila', 'expiry-t19-1');
    const hold2 = await inventoryService.holdReservation('order-t19', [{ variant_id: 'variant-1', quantity: 1 }], 'marginal', 'expiry-t19-2');

    const orderId = 'order-t19';
    const past = futureIso(31);
    const snapshot = JSON.stringify({ store_origin_id: 'vila', fulfillment_type: 'DELIVERY' });
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-T19', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'READY_FOR_PAYMENT', 't19-key', ?, ?, 1, ?, ?, ?)`, [orderId, snapshot, JSON.stringify([hold1.reservation_id, hold2.reservation_id]), NOW_ISO, NOW_ISO, past]);

    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweepResult.expired, 1);
    assert.strictEqual(sweepResult.released, 1);

    // Verificar que ambas stores tiveram estoque liberado
    const bal1 = await getSql(db, `SELECT available_qty, reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    assert.strictEqual(bal1.available_qty, 10); // 8 + 2 liberados
    assert.strictEqual(bal1.reserved_qty, 0);

    const bal3 = await getSql(db, `SELECT available_qty, reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'marginal'`);
    assert.strictEqual(bal3.available_qty, 5); // 4 + 1 liberado
    assert.strictEqual(bal3.reserved_qty, 0);
  });

  // ============================================================
  // T20. Validação estrita: release_quantity_total < hold_quantity_total → rollback
  // ============================================================
  it('T20: validação estrita — reserved_qty < quantity sem RELEASE pré-existente → rollback', async () => {
    const orderId = 'order-t20';
    const past = futureIso(31);
    const snapshot = JSON.stringify({ store_origin_id: 'vila', fulfillment_type: 'DELIVERY' });

    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t20', 'account-1', 'CONVERTED', 'BRL', 1, 1000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t20', 'cart-t20', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);

    const holdResult = await inventoryService.holdReservation(orderId, [{ variant_id: 'variant-1', quantity: 1 }], 'vila', 'expiry-t20');
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-T20', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'READY_FOR_PAYMENT', 't20-key', ?, ?, 1, ?, ?, ?)`, [orderId, snapshot, JSON.stringify([holdResult.reservation_id]), NOW_ISO, NOW_ISO, past]);

    // Corromper: resetar reserved_qty para 0 SEM inserir chave RELEASE (sem idempotência)
    // Isso causa reserved_qty(0) < quantity(1) no releaseReservation
    await runSql(db, `UPDATE pdv_inventory_balances_v2 SET reserved_qty = 0 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);

    // Salvar estado original após corrupção
    const balanceBefore = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);

    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });

    // EXIGIR EXATAMENTE:
    assert.strictEqual(sweepResult.errors, 1, 'Exatamente 1 erro');
    assert.strictEqual(sweepResult.errors_details[0].error, 'RELEASE_INCONSISTENCY', 'Erro deve ser RELEASE_INCONSISTENCY');
    assert.strictEqual(sweepResult.expired, 0, 'Zero pedidos expirados');
    assert.strictEqual(sweepResult.released, 0, 'Zero pedidos liberados');

    // Pedido deve permanecer READY_FOR_PAYMENT
    const order = await getSql(db, `SELECT status, expired_at FROM app_orders WHERE id = ?`, [orderId]);
    assert.strictEqual(order.status, 'READY_FOR_PAYMENT');
    assert.strictEqual(order.expired_at, null);

    // Saldo exatamente inalterado
    const balanceAfter = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    assert.strictEqual(balanceAfter.available_qty, balanceBefore.available_qty, 'available_qty exatamente inalterado');
    assert.strictEqual(balanceAfter.reserved_qty, balanceBefore.reserved_qty, 'reserved_qty exatamente inalterado');
    assert.strictEqual(balanceAfter.version, balanceBefore.version, 'version exatamente inalterado');

    // Zero RELEASE
    const releases = await allSql(db, `SELECT id FROM pdv_inventory_movements_v2 WHERE reference_id = ? AND movement_type = 'RESERVATION_RELEASE'`, [orderId]);
    assert.strictEqual(releases.length, 0, 'Zero movimentos RELEASE');

    // Zero ORDER_EXPIRED
    const events = await allSql(db, `SELECT id FROM app_order_events WHERE order_id = ? AND event_type = 'ORDER_EXPIRED'`, [orderId]);
    assert.strictEqual(events.length, 0, 'Zero eventos ORDER_EXPIRED');
  });

  // ============================================================
  // T21. Validação de movimentos HOLD antes do release
  // ============================================================
  it('T21: sweep valida movimentos HOLD antes do release', async () => {
    const orderId = 'order-t21';
    const past = futureIso(31);
    const snapshot = JSON.stringify({ store_origin_id: 'vila', fulfillment_type: 'DELIVERY' });

    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t21', 'account-1', 'CONVERTED', 'BRL', 1, 1000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t21', 'cart-t21', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);

    const holdResult = await inventoryService.holdReservation(orderId, [{ variant_id: 'variant-1', quantity: 1 }], 'vila', 'expiry-t21');
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-T21', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'READY_FOR_PAYMENT', 't21-key', ?, ?, 1, ?, ?, ?)`, [orderId, snapshot, JSON.stringify([holdResult.reservation_id]), NOW_ISO, NOW_ISO, past]);

    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweepResult.expired, 1);
    assert.strictEqual(sweepResult.released, 1);

    // Verificar que o movimento HOLD existe com reference_id = reservation_id
    const holds = await allSql(db, `SELECT movement_type, reference_id, quantity_delta FROM pdv_inventory_movements_v2 WHERE movement_type = 'RESERVATION_HOLD' AND reference_id = ?`, [holdResult.reservation_id]);
    assert.ok(holds.length > 0, 'Movimento HOLD deve existir com reference_id = reservation_id');

    // Verificar que o movimento RELEASE foi criado com reference_id = orderId
    const releases = await allSql(db, `SELECT movement_type, reference_id, quantity_delta FROM pdv_inventory_movements_v2 WHERE movement_type = 'RESERVATION_RELEASE' AND reference_id = ?`, [orderId]);
    assert.ok(releases.length > 0, 'Movimento RELEASE deve existir com reference_id = order_id');
  });

  // ============================================================
  // T22A. Fault injection A: erro no SEGUNDO UPDATE de saldo (2 variantes)
  // ============================================================
  it('T22A: fault injection — erro no segundo UPDATE de saldo deve fazer rollback integral', async () => {
    const orderId = 'order-t22a';
    const past = futureIso(31);
    const snapshot = JSON.stringify({ store_origin_id: 'vila', fulfillment_type: 'DELIVERY' });

    // Criar segunda variante
    await runSql(db, `INSERT OR REPLACE INTO pdv_product_variants (id, product_id, sku, name, created_at) VALUES ('variant-2', 'product-1', 'SKU-002', 'Produto 2', '${NOW_ISO}')`);
    await runSql(db, `INSERT OR REPLACE INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES ('balance-2', 'variant-2', 'vila', 8, 0, 1, '${NOW_ISO}')`);

    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t22a', 'account-1', 'CONVERTED', 'BRL', 2, 2000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t22a-1', 'cart-t22a', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t22a-2', 'cart-t22a', 'product-1', 'variant-2', 1, 1000, 1000, 1000, '{"name":"Produto 2"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);

    // Reservar 2 variantes
    const hold1 = await inventoryService.holdReservation(orderId, [{ variant_id: 'variant-1', quantity: 1 }], 'vila', 'expiry-t22a-1');
    const hold2 = await inventoryService.holdReservation(orderId, [{ variant_id: 'variant-2', quantity: 1 }], 'vila', 'expiry-t22a-2');

    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-T22A', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 2000, 2000, 'READY_FOR_PAYMENT', 't22a-key', ?, ?, 1, ?, ?, ?)`, [orderId, snapshot, JSON.stringify([hold1.reservation_id, hold2.reservation_id]), NOW_ISO, NOW_ISO, past]);

    // Salvar estado original dos saldos
    const balanceOrig1 = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    const balanceOrig2 = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-2' AND store_id = 'vila'`);

    // Criar inventoryService com proxy que lança erro no segundo UPDATE de saldo
    const updateCallCount = { count: 0 };
    const proxyDb = {
      run: async (sql, params = []) => {
        if (sql.trim().startsWith('UPDATE pdv_inventory_balances_v2')) {
          updateCallCount.count++;
          if (updateCallCount.count === 2) {
            throw new Error('TEST_UPDATE_FAILURE');
          }
        }
        return db.run(sql, params);
      },
      get: (sql, params = []) => db.get(sql, params),
      all: (sql, params = []) => db.all(sql, params),
    };
    const faultInventory = createInventoryService({ dbApi: proxyDb });

    const sweepResult = await sweepExpiredOrders({ db: proxyDb, inventoryService: faultInventory, now: NOW });

    // EXIGIR EXATAMENTE:
    assert.strictEqual(sweepResult.errors, 1, 'Exatamente 1 erro');
    assert.strictEqual(sweepResult.expired, 0, 'Zero pedidos expirados');
    assert.strictEqual(sweepResult.released, 0, 'Zero pedidos liberados');

    const order = await getSql(db, `SELECT status, expired_at FROM app_orders WHERE id = ?`, [orderId]);
    assert.strictEqual(order.status, 'READY_FOR_PAYMENT');
    assert.strictEqual(order.expired_at, null);

    // Ambos saldos inalterados
    const balanceAfter1 = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    const balanceAfter2 = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-2' AND store_id = 'vila'`);
    assert.strictEqual(balanceAfter1.available_qty, balanceOrig1.available_qty);
    assert.strictEqual(balanceAfter1.reserved_qty, balanceOrig1.reserved_qty);
    assert.strictEqual(balanceAfter1.version, balanceOrig1.version);
    assert.strictEqual(balanceAfter2.available_qty, balanceOrig2.available_qty);
    assert.strictEqual(balanceAfter2.reserved_qty, balanceOrig2.reserved_qty);
    assert.strictEqual(balanceAfter2.version, balanceOrig2.version);

    // Zero RELEASE
    const releases = await allSql(db, `SELECT id FROM pdv_inventory_movements_v2 WHERE reference_id = ? AND movement_type = 'RESERVATION_RELEASE'`, [orderId]);
    assert.strictEqual(releases.length, 0);

    // Zero ORDER_EXPIRED
    const events = await allSql(db, `SELECT id FROM app_order_events WHERE order_id = ? AND event_type = 'ORDER_EXPIRED'`, [orderId]);
    assert.strictEqual(events.length, 0);
  });

  // ============================================================
  // T22B. Fault injection B: erro no SEGUNDO INSERT RELEASE (2 variantes)
  // ============================================================
  it('T22B: fault injection — erro no segundo INSERT RELEASE deve fazer rollback', async () => {
    const orderId = 'order-t22b';
    const past = futureIso(31);
    const snapshot = JSON.stringify({ store_origin_id: 'vila', fulfillment_type: 'DELIVERY' });

    // Criar segunda variante
    await runSql(db, `INSERT OR REPLACE INTO pdv_product_variants (id, product_id, sku, name, created_at) VALUES ('variant-3', 'product-1', 'SKU-003', 'Produto 3', '${NOW_ISO}')`);
    await runSql(db, `INSERT OR REPLACE INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES ('balance-3', 'variant-3', 'vila', 8, 0, 1, '${NOW_ISO}')`);

    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t22b', 'account-1', 'CONVERTED', 'BRL', 2, 2000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t22b-1', 'cart-t22b', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t22b-2', 'cart-t22b', 'product-1', 'variant-3', 1, 1000, 1000, 1000, '{"name":"Produto 3"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);

    // Reservar 2 variantes
    const hold1 = await inventoryService.holdReservation(orderId, [{ variant_id: 'variant-1', quantity: 1 }], 'vila', 'expiry-t22b-1');
    const hold2 = await inventoryService.holdReservation(orderId, [{ variant_id: 'variant-3', quantity: 1 }], 'vila', 'expiry-t22b-2');

    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-T22B', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 2000, 2000, 'READY_FOR_PAYMENT', 't22b-key', ?, ?, 1, ?, ?, ?)`, [orderId, snapshot, JSON.stringify([hold1.reservation_id, hold2.reservation_id]), NOW_ISO, NOW_ISO, past]);

    // Salvar estado original
    const balanceOrig1 = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    const balanceOrig2 = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-3' AND store_id = 'vila'`);

    // Criar proxy que lança erro no SEGUNDO INSERT de movimento (primeiro RELEASE funciona, segundo falha)
    const insertCallCount = { count: 0 };
    const proxyDb = {
      run: async (sql, params = []) => {
        if (sql.trim().startsWith('INSERT INTO pdv_inventory_movements_v2')) {
          insertCallCount.count++;
          if (insertCallCount.count === 2) {
            throw new Error('TEST_RELEASE_INSERT_FAILURE');
          }
        }
        return db.run(sql, params);
      },
      get: (sql, params = []) => db.get(sql, params),
      all: (sql, params = []) => db.all(sql, params),
    };
    const faultInventory = createInventoryService({ dbApi: proxyDb });

    const sweepResult = await sweepExpiredOrders({ db: proxyDb, inventoryService: faultInventory, now: NOW });

    // EXIGIR EXATAMENTE:
    assert.strictEqual(sweepResult.errors, 1, 'Exatamente 1 erro');
    assert.strictEqual(sweepResult.expired, 0, 'Zero pedidos expirados');
    assert.strictEqual(sweepResult.released, 0, 'Zero pedidos liberados');

    const order = await getSql(db, `SELECT status, expired_at FROM app_orders WHERE id = ?`, [orderId]);
    assert.strictEqual(order.status, 'READY_FOR_PAYMENT');
    assert.strictEqual(order.expired_at, null);

    // Ambos saldos inalterados
    const balanceAfter1 = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    const balanceAfter2 = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-3' AND store_id = 'vila'`);
    assert.strictEqual(balanceAfter1.available_qty, balanceOrig1.available_qty);
    assert.strictEqual(balanceAfter1.reserved_qty, balanceOrig1.reserved_qty);
    assert.strictEqual(balanceAfter2.available_qty, balanceOrig2.available_qty);
    assert.strictEqual(balanceAfter2.reserved_qty, balanceOrig2.reserved_qty);

    // Zero RELEASE persistido
    const releases = await allSql(db, `SELECT id FROM pdv_inventory_movements_v2 WHERE reference_id = ? AND movement_type = 'RESERVATION_RELEASE'`, [orderId]);
    assert.strictEqual(releases.length, 0);

    // Zero ORDER_EXPIRED
    const events = await allSql(db, `SELECT id FROM app_order_events WHERE order_id = ? AND event_type = 'ORDER_EXPIRED'`, [orderId]);
    assert.strictEqual(events.length, 0);
  });

  // ============================================================
  // T22C. Fault injection C: erro no UPDATE app_orders
  // ============================================================
  it('T22C: fault injection — erro no UPDATE app_orders deve fazer rollback integral', async () => {
    const orderId = 'order-t22c';
    const past = futureIso(31);
    const snapshot = JSON.stringify({ store_origin_id: 'vila', fulfillment_type: 'DELIVERY' });

    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t22c', 'account-1', 'CONVERTED', 'BRL', 1, 1000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t22c', 'cart-t22c', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);

    const holdResult = await inventoryService.holdReservation(orderId, [{ variant_id: 'variant-1', quantity: 1 }], 'vila', 'expiry-t22c');
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-T22C', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'READY_FOR_PAYMENT', 't22c-key', ?, ?, 1, ?, ?, ?)`, [orderId, snapshot, JSON.stringify([holdResult.reservation_id]), NOW_ISO, NOW_ISO, past]);

    // Salvar estado original
    const balanceOrig = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);

    // Criar proxy que lança erro no UPDATE de app_orders
    const proxyDb = {
      run: async (sql, params = []) => {
        if (sql.trim().startsWith('UPDATE app_orders')) {
          throw new Error('TEST_ORDER_UPDATE_FAILURE');
        }
        return db.run(sql, params);
      },
      get: (sql, params = []) => db.get(sql, params),
      all: (sql, params = []) => db.all(sql, params),
    };
    const faultInventory = createInventoryService({ dbApi: proxyDb });

    const sweepResult = await sweepExpiredOrders({ db: proxyDb, inventoryService: faultInventory, now: NOW });

    // EXIGIR EXATAMENTE:
    assert.strictEqual(sweepResult.errors, 1, 'Exatamente 1 erro');
    assert.strictEqual(sweepResult.expired, 0, 'Zero pedidos expirados');
    assert.strictEqual(sweepResult.released, 0, 'Zero pedidos liberados');

    const order = await getSql(db, `SELECT status, expired_at FROM app_orders WHERE id = ?`, [orderId]);
    assert.strictEqual(order.status, 'READY_FOR_PAYMENT');
    assert.strictEqual(order.expired_at, null);

    // Saldo inalterado
    const balanceAfter = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    assert.strictEqual(balanceAfter.available_qty, balanceOrig.available_qty);
    assert.strictEqual(balanceAfter.reserved_qty, balanceOrig.reserved_qty);
    assert.strictEqual(balanceAfter.version, balanceOrig.version);

    // Zero RELEASE
    const releases = await allSql(db, `SELECT id FROM pdv_inventory_movements_v2 WHERE reference_id = ? AND movement_type = 'RESERVATION_RELEASE'`, [orderId]);
    assert.strictEqual(releases.length, 0);

    // Zero ORDER_EXPIRED
    const events = await allSql(db, `SELECT id FROM app_order_events WHERE order_id = ? AND event_type = 'ORDER_EXPIRED'`, [orderId]);
    assert.strictEqual(events.length, 0);
  });

  // ============================================================
  // T22D. Fault injection D: erro no INSERT app_order_events
  // ============================================================
  it('T22D: fault injection — erro no INSERT events deve fazer rollback integral', async () => {
    const orderId = 'order-t22d';
    const past = futureIso(31);
    const snapshot = JSON.stringify({ store_origin_id: 'vila', fulfillment_type: 'DELIVERY' });

    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t22d', 'account-1', 'CONVERTED', 'BRL', 1, 1000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t22d', 'cart-t22d', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);

    const holdResult = await inventoryService.holdReservation(orderId, [{ variant_id: 'variant-1', quantity: 1 }], 'vila', 'expiry-t22d');
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-T22D', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'READY_FOR_PAYMENT', 't22d-key', ?, ?, 1, ?, ?, ?)`, [orderId, snapshot, JSON.stringify([holdResult.reservation_id]), NOW_ISO, NOW_ISO, past]);

    // Salvar estado original
    const balanceOrig = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);

    // Criar proxy que lança erro no INSERT INTO app_order_events
    const proxyDb = {
      run: async (sql, params = []) => {
        if (sql.trim().startsWith('INSERT INTO app_order_events')) {
          throw new Error('TEST_EVENTS_INSERT_FAILURE');
        }
        return db.run(sql, params);
      },
      get: (sql, params = []) => db.get(sql, params),
      all: (sql, params = []) => db.all(sql, params),
    };
    const faultInventory = createInventoryService({ dbApi: proxyDb });

    const sweepResult = await sweepExpiredOrders({ db: proxyDb, inventoryService: faultInventory, now: NOW });

    // EXIGIR EXATAMENTE:
    assert.strictEqual(sweepResult.errors, 1, 'Exatamente 1 erro');
    assert.strictEqual(sweepResult.expired, 0, 'Zero pedidos expirados');
    assert.strictEqual(sweepResult.released, 0, 'Zero pedidos liberados');

    const order = await getSql(db, `SELECT status, expired_at FROM app_orders WHERE id = ?`, [orderId]);
    assert.strictEqual(order.status, 'READY_FOR_PAYMENT');
    assert.strictEqual(order.expired_at, null);

    // Saldo inalterado
    const balanceAfter = await getSql(db, `SELECT available_qty, reserved_qty, version FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    assert.strictEqual(balanceAfter.available_qty, balanceOrig.available_qty);
    assert.strictEqual(balanceAfter.reserved_qty, balanceOrig.reserved_qty);
    assert.strictEqual(balanceAfter.version, balanceOrig.version);

    // Zero RELEASE
    const releases = await allSql(db, `SELECT id FROM pdv_inventory_movements_v2 WHERE reference_id = ? AND movement_type = 'RESERVATION_RELEASE'`, [orderId]);
    assert.strictEqual(releases.length, 0);

    // Zero ORDER_EXPIRED
    const events = await allSql(db, `SELECT id FROM app_order_events WHERE order_id = ? AND event_type = 'ORDER_EXPIRED'`, [orderId]);
    assert.strictEqual(events.length, 0);
  });

  // ============================================================
  // T23. Concorrência real: 2 conexões SQLite em arquivo temporário executam sweep simultaneamente
  // ============================================================
  it('T23: concorrência real — 2 conexões SQLite em arquivo temporário, sweep simultâneo', async () => {
    // Importar sqlite3 para criar conexões reais
    const sqlite3 = require('sqlite3');
    const path = require('path');
    const os = require('os');
    const fs = require('fs');

    // Criar arquivo SQLite temporário
    const tmpDir = os.tmpdir();
    const dbFile = path.join(tmpDir, `concurrency-test-${Date.now()}.db`);

    // Criar conexão A (sweep executor)
    const connectionA = new sqlite3.Database(dbFile);
    const dbA = {
      run: (sql, params = []) => new Promise((resolve, reject) => {
        connectionA.run(sql, params, function(error) { error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID }); });
      }),
      get: (sql, params = []) => new Promise((resolve, reject) => {
        connectionA.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
      }),
      all: (sql, params = []) => new Promise((resolve, reject) => {
        connectionA.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
      }),
      close: () => new Promise((resolve, reject) => {
        connectionA.close((error) => error ? reject(error) : resolve());
      }),
    };

    // Criar conexão B (sweep concorrente)
    const connectionB = new sqlite3.Database(dbFile);
    const dbB = {
      run: (sql, params = []) => new Promise((resolve, reject) => {
        connectionB.run(sql, params, function(error) { error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID }); });
      }),
      get: (sql, params = []) => new Promise((resolve, reject) => {
        connectionB.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
      }),
      all: (sql, params = []) => new Promise((resolve, reject) => {
        connectionB.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
      }),
      close: () => new Promise((resolve, reject) => {
        connectionB.close((error) => error ? reject(error) : resolve());
      }),
    };

    const NOW_ISO_CONC = '2026-08-03T00:00:00.000Z';

    // Criar schema mínimo no dbA
    await dbA.run(`CREATE TABLE IF NOT EXISTS customer_master_records(id TEXT PRIMARY KEY, phone_lookup_hash TEXT, phone_masked TEXT, email_lookup_hash TEXT, email_masked TEXT, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT)`);
    await dbA.run(`CREATE TABLE IF NOT EXISTS customer_identity_conflict_participants(id TEXT PRIMARY KEY, conflict_id TEXT, participant_type TEXT, participant_id TEXT)`);
    await dbA.run(`CREATE TABLE IF NOT EXISTS customer_identity_cases(id TEXT PRIMARY KEY, blocking INTEGER)`);
    await dbA.run(`CREATE TABLE IF NOT EXISTS customer_identity_case_conflicts(case_id TEXT, conflict_id TEXT)`);

    // Criar tabela app_customer_accounts antes dos schemas (FK reference)
    await dbA.run(`CREATE TABLE IF NOT EXISTS app_customer_accounts(id TEXT PRIMARY KEY, phone_lookup_hash TEXT, phone_masked TEXT, email_lookup_hash TEXT, email_masked TEXT, account_status TEXT, access_status TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT, updated_at TEXT)`);
    await dbA.run(`INSERT INTO app_customer_accounts(id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, version, created_at, updated_at) VALUES ('account-1', 'hash-1', '***', '', '', 'ACTIVE', 'APPROVED', 1, ?, ?)`, [NOW_ISO_CONC, NOW_ISO_CONC]);

    await applyAppCustomerAccessSchema(dbA);
    await applyAppSessionSchema(dbA);
    await applyAppAddressSchema(dbA);
    await applyAppCartSchema(dbA);
    await applyAppFulfillmentSchema(dbA);
    await applyAppOrderSchema(dbA);
    await applyAppOrderSchemaV2(dbA);

    // Tabelas PDV
    await dbA.run(`CREATE TABLE IF NOT EXISTS pdv_product_variants (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT)`);
    await dbA.run(`CREATE TABLE IF NOT EXISTS pdv_inventory_balances_v2 (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, store_id TEXT NOT NULL, available_qty INTEGER NOT NULL DEFAULT 0, reserved_qty INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT, UNIQUE(variant_id, store_id))`);
    await dbA.run(`CREATE TABLE IF NOT EXISTS pdv_inventory_movements_v2 (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, store_id TEXT NOT NULL, movement_type TEXT NOT NULL, quantity_delta INTEGER NOT NULL, quantity_before INTEGER NOT NULL DEFAULT 0, quantity_after INTEGER NOT NULL DEFAULT 0, origin TEXT, reference_type TEXT, reference_id TEXT, idempotency_key TEXT, actor_user_id TEXT, actor_name TEXT, metadata_json TEXT, created_at TEXT, UNIQUE(variant_id, store_id, idempotency_key))`);
    await dbA.run(`CREATE TABLE IF NOT EXISTS pdv_product_variants_v2 (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT)`);

    // Criar inventário services separados para A e B
    const inventoryA = createInventoryService({ dbApi: dbA });
    const inventoryB = createInventoryService({ dbApi: dbB });

    // Configurar busy_timeout para concorrência
    await dbA.run('PRAGMA busy_timeout = 5000');
    await dbB.run('PRAGMA busy_timeout = 5000');
    await dbA.run(`INSERT INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES ('conc-bal-1', 'variant-1', 'vila', 10, 0, 1, ?)`, [NOW_ISO_CONC]);
    await dbA.run(`INSERT INTO pdv_product_variants (id, product_id, sku, name, created_at) VALUES ('variant-1', 'product-1', 'SKU-001', 'Produto', ?)`, [NOW_ISO_CONC]);

    // Criar pedido expirável
    const orderId = 'order-conc';
    const past = futureIso(31);
    const snapshot = JSON.stringify({ store_origin_id: 'vila', fulfillment_type: 'DELIVERY' });

    await dbA.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-conc', 'account-1', 'CONVERTED', 'BRL', 1, 1000, 1, ?, ?)`, [NOW_ISO_CONC, NOW_ISO_CONC]);
    await dbA.run(`INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-conc', 'cart-conc', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO_CONC, NOW_ISO_CONC]);

    const holdResult = await inventoryA.holdReservation(orderId, [{ variant_id: 'variant-1', quantity: 1 }], 'vila', 'expiry-conc');
    await dbA.run(`INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-CONC', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'READY_FOR_PAYMENT', 'conc-key', ?, ?, 1, ?, ?, ?)`, [orderId, snapshot, JSON.stringify([holdResult.reservation_id]), NOW_ISO_CONC, NOW_ISO_CONC, past]);

    // Executar sweep simultâneo com 2 conexões
    const results = await Promise.allSettled([
      sweepExpiredOrders({ db: dbA, inventoryService: inventoryA, now: NOW }),
      sweepExpiredOrders({ db: dbB, inventoryService: inventoryB, now: NOW }),
    ]);

    // Pelo menos um deve ter expirado, o outro deve ter falhado (busy ou concorrência)
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    const totalExpired = fulfilled.reduce((sum, r) => sum + (r.value?.expired || 0), 0);
    const totalReleased = fulfilled.reduce((sum, r) => sum + (r.value?.released || 0), 0);
    const totalErrors = fulfilled.reduce((sum, r) => sum + (r.value?.errors || 0), 0) + rejected.length;

    // Verificar estado final via dbA
    const order = await dbA.get(`SELECT status, expired_at FROM app_orders WHERE id = ?`, [orderId]);
    const balance = await dbA.get(`SELECT available_qty, reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    const releases = await dbA.all(`SELECT id FROM pdv_inventory_movements_v2 WHERE reference_id = ? AND movement_type = 'RESERVATION_RELEASE'`, [orderId]);
    const events = await dbA.all(`SELECT id FROM app_order_events WHERE order_id = ? AND event_type = 'ORDER_EXPIRED'`, [orderId]);

    // EXIGIR:
    assert.strictEqual(order.status, 'EXPIRED', 'Pedido deve estar EXPIRED');
    assert.ok(order.expired_at, 'expired_at deve existir');
    assert.strictEqual(balance.reserved_qty, 0, 'reserved_qty deve ser 0');
    assert.strictEqual(balance.available_qty, 10, 'available_qty deve ser 10');
    assert.strictEqual(releases.length, 1, 'Exatamente 1 movimento RELEASE');
    assert.strictEqual(events.length, 1, 'Exatamente 1 evento ORDER_EXPIRED');

    // Limpar arquivo temporário
    dbA.close && await dbA.close();
    dbB.close && await dbB.close();
    try { fs.unlinkSync(dbFile); } catch (_) {}
  });

  // ============================================================
  // T24. Múltiplas reservas (multi-variant) em um único pedido
  // ============================================================
  it('T24: múltiplas reservas (multi-variant) em um único pedido', async () => {
    // Criar segunda variante
    await runSql(db, `INSERT INTO pdv_product_variants (id, product_id, sku, name, created_at) VALUES ('variant-2', 'product-1', 'SKU-002', 'Produto Teste 2', '${NOW_ISO}')`);
    await runSql(db, `INSERT INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES ('balance-2', 'variant-2', 'vila', 8, 0, 1, '${NOW_ISO}')`);

    const orderId = 'order-t24';
    const past = futureIso(31);
    const snapshot = JSON.stringify({ store_origin_id: 'vila', fulfillment_type: 'DELIVERY' });

    // Criar cart com 2 itens
    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t24', 'account-1', 'ACTIVE', 'BRL', 2, 2000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t24a', 'cart-t24', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t24b', 'cart-t24', 'product-1', 'variant-2', 1, 1000, 1000, 1000, '{"name":"Produto 2"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);

    // Reservar 2 variantes
    const hold1 = await inventoryService.holdReservation(orderId, [{ variant_id: 'variant-1', quantity: 1 }], 'vila', 'expiry-t24-1');
    const hold2 = await inventoryService.holdReservation(orderId, [{ variant_id: 'variant-2', quantity: 1 }], 'vila', 'expiry-t24-2');

    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-T24', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 2000, 2000, 'READY_FOR_PAYMENT', 't24-key', ?, ?, 1, ?, ?, ?)`, [orderId, snapshot, JSON.stringify([hold1.reservation_id, hold2.reservation_id]), NOW_ISO, NOW_ISO, past]);

    const balanceBefore1 = await getSql(db, `SELECT available_qty, reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    const balanceBefore2 = await getSql(db, `SELECT available_qty, reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-2' AND store_id = 'vila'`);

    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.strictEqual(sweepResult.expired, 1);
    assert.strictEqual(sweepResult.released, 1);

    const balanceAfter1 = await getSql(db, `SELECT available_qty, reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-1' AND store_id = 'vila'`);
    const balanceAfter2 = await getSql(db, `SELECT available_qty, reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id = 'variant-2' AND store_id = 'vila'`);

    // Ambas variantes devem ter estoque restaurado
    assert.strictEqual(balanceAfter1.available_qty, 10);
    assert.strictEqual(balanceAfter1.reserved_qty, 0);
    assert.strictEqual(balanceAfter2.available_qty, 8);
    assert.strictEqual(balanceAfter2.reserved_qty, 0);
  });

  // ============================================================
  // T25. Sweep com JSON malformado não bloqueia processamento de outros pedidos
  // ============================================================
  it('T25: pedido com reservation_ids_json malformado não bloqueia sweep dos demais', async () => {
    const past = futureIso(31);
    const snapshot = JSON.stringify({ store_origin_id: 'vila', fulfillment_type: 'DELIVERY' });

    // Pedido 1: válido (será expirado com sucesso)
    await seedCart('account-1');
    const r1 = await orderService.createOrder('account-1', {
      fulfillment_type: 'DELIVERY',
      address_id: 'addr-1',
      idempotency_key: 'expiry-t25-1',
    });
    await runSql(db, `UPDATE app_orders SET expires_at = ? WHERE id = ?`, [past, r1.data.id]);

    // Pedido 2: reservation_ids_json malformado (JSON inválido)
    const orderIdBad = 'order-t25-bad';
    await runSql(db, `INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES ('cart-t25b', 'account-1', 'CONVERTED', 'BRL', 1, 1000, 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    await runSql(db, `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES ('item-t25b', 'cart-t25b', 'product-1', 'variant-1', 1, 1000, 1000, 1000, '{"name":"Produto 1"}', 'in_stock', 1, ?, ?)`, [NOW_ISO, NOW_ISO]);
    // JSON malformado: não é um array válido
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, 'ORD-T25B', 'account-1', 'DELIVERY', 'addr-1', NULL, 'flat_rate', 'standard', 0, 'BRL', 1000, 1000, 'READY_FOR_PAYMENT', 't25b-key', ?, 'not-valid-json', 1, ?, ?, ?)`, [orderIdBad, snapshot, NOW_ISO, NOW_ISO, past]);

    // Sweep deve processar pedido 1 com sucesso e registrar erro no pedido 2
    const sweepResult = await sweepExpiredOrders({ db, inventoryService, now: NOW });
    assert.ok(sweepResult.expired >= 1, 'Pelo menos um pedido deve ser expirado');
    assert.ok(sweepResult.errors >= 1, 'Pelo menos um erro deve ser registrado');

    // Pedido 1 deve estar EXPIRED (processado com sucesso)
    const order1 = await getSql(db, `SELECT status FROM app_orders WHERE id = ?`, [r1.data.id]);
    assert.strictEqual(order1.status, 'EXPIRED', 'Pedido válido deve estar EXPIRED');

    // Pedido 2 deve permanecer READY_FOR_PAYMENT (erro de JSON malformado)
    const order2 = await getSql(db, `SELECT status FROM app_orders WHERE id = ?`, [orderIdBad]);
    assert.strictEqual(order2.status, 'READY_FOR_PAYMENT', 'Pedido com JSON malformado deve permanecer READY_FOR_PAYMENT');
  });
});
