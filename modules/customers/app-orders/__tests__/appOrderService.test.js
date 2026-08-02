"use strict";

const { describe, it, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const { randomUUID } = require("crypto");
const { memoryDb } = require("../../master/__tests__/memoryDb");
const { applyAppCustomerAccessSchema } = require("../../app-access/persistence/appCustomerAccessSchema");
const { applyAppPhoneVerificationSchema } = require("../../app-auth/persistence/appPhoneVerificationSchema");
const { applyAppSessionSchema } = require("../../app-auth/persistence/appSessionSchema");
const { applyAppCartSchema } = require("../../app-cart/persistence/appCartSchema");
const { applyAppAddressSchema } = require("../../app-address/persistence/appAddressSchema");
const { applyAppFulfillmentSchema } = require("../../app-fulfillment/persistence/appFulfillmentSchema");
const { applyAppOrderSchema } = require("../persistence/appOrderSchema");
const { createAppOrderService } = require("../appOrderService");
const { orderDto, orderItemDto, reservationDto, eventDto, formatCentsBrl, envelope, assertAllowList, AppOrderError, FORBIDDEN_KEYS } = require("../appOrderDto");

function iso(date) { return date.toISOString(); }
function clock() { return new Date(); }

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
  await applyAppOrderSchema(db);

  const accountId = randomUUID();
  const now = iso(clock());
  await db.run(`INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, phone_verified_at, version, created_at, updated_at) VALUES (?, '', '', '', '', 'ACTIVE', 'APPROVED', ?, 1, ?, ?)`, [accountId, now, now, now]);

  const cartId = randomUUID();
  await db.run(`INSERT INTO app_carts (id, account_id, status, created_at, updated_at) VALUES (?, ?, 'ACTIVE', ?, ?)`, [cartId, accountId, now, now]);

  const productSnapshot = JSON.stringify({ name: "Camiseta Basica", variant: "P/Preta" });
  const itemId = randomUUID();
  await db.run(`INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, promotional_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, [itemId, cartId, "prod-1", "var-1", 2, 2500, null, 2500, 5000, productSnapshot, "in_stock", now, now]);

  const addressId = randomUUID();
  await db.run(`INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, complement, neighborhood, city, state, delivery_instructions, validation_status, is_default, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALID', 1, 1, ?, ?)`, [addressId, accountId, "Casa", "Joao Silva", "01001000", "01001-000", "Rua Teste", "100", "", "Centro", "Sao Paulo", "SP", "Entregar na portaria", now, now]);

  await db.run(`INSERT INTO app_cart_fulfillment (id, cart_id, account_id, fulfillment_type, address_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, shipping_status, version, created_at, updated_at) VALUES (?, ?, ?, 'DELIVERY', ?, 'melhorenvio', 'pac', 1500, 'BRL', 'CALCULATED', 1, ?, ?)`, [randomUUID(), cartId, accountId, addressId, now, now]);

  const service = createAppOrderService({
    dbApi: db,
    catalogService: { loadProductsForRefresh: async () => [] },
    fulfillmentService: null,
    recordAudit: async (event) => EVENTS.push(event)
  });

  return { db, service, accountId, cartId, itemId, addressId };
}

describe("app-order: DTO", () => {
  it("1 — orderDto returns expected shape", () => {
    const dto = orderDto({ id: "o1", order_number: "AERO-2026-000000001", account_id: "acc", fulfillment_type: "DELIVERY", status: "AWAITING_PAYMENT", total_cents: 5000, subtotal_cents: 4500, shipping_quote_cents: 500, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    assert.strictEqual(dto.orderNumber, "AERO-2026-000000001");
    assert.strictEqual(dto.status, "AWAITING_PAYMENT");
    assert.strictEqual(dto.totalCents, 5000);
    assert.strictEqual(dto.totalFormatted, "R$\u00A050,00");
  });

  it("2 — orderItemDto returns expected shape", () => {
    const dto = orderItemDto({ id: "i1", product_id: "p1", variant_id: "v1", product_name: "Camiseta", variant_name: "P/Preta", quantity: 2, unit_price_cents: 2500, effective_unit_price_cents: 2500, line_total_cents: 5000, version: 1, created_at: new Date().toISOString() });
    assert.strictEqual(dto.productName, "Camiseta");
    assert.strictEqual(dto.quantity, 2);
    assert.strictEqual(dto.lineTotalCents, 5000);
  });

  it("3 — reservationDto returns expected shape", () => {
    const dto = reservationDto({ id: "r1", status: "ACTIVE", quantity: 2, expires_at: "2026-01-01T00:00:00.000Z" });
    assert.strictEqual(dto.status, "ACTIVE");
    assert.strictEqual(dto.quantity, 2);
  });

  it("4 — eventDto returns expected shape", () => {
    const dto = eventDto({ id: "e1", event_type: "ORDER_CREATED", details_json: '{"x":1}' });
    assert.strictEqual(dto.eventType, "ORDER_CREATED");
    assert.deepStrictEqual(dto.details, { x: 1 });
  });

  it("5 — formatCentsBrl formats correctly", () => {
    assert.strictEqual(formatCentsBrl(1000), "R$\u00A010,00");
    assert.strictEqual(formatCentsBrl(0), "R$\u00A00,00");
    assert.strictEqual(formatCentsBrl(null), "R$\u00A00,00");
  });

  it("6 — envelope returns success wrapper", () => {
    const e = envelope({ test: true });
    assert.strictEqual(e.success, true);
    assert.strictEqual(e.data.test, true);
    assert.ok(e.meta);
  });

  it("7 — assertAllowList throws on forbidden field", () => {
    assert.throws(() => assertAllowList({ cost: 100 }), { name: "Error", message: /FORBIDDEN_FIELD/ });
    assert.throws(() => assertAllowList({ payment_method: "pix" }), { name: "Error", message: /FORBIDDEN_FIELD/ });
    assert.throws(() => assertAllowList({ nested: { pix_code: "abc" } }), { name: "Error", message: /FORBIDDEN_FIELD/ });
  });

  it("8 — assertAllowList allows clean object", () => {
    assert.doesNotThrow(() => assertAllowList({ name: "test", price: 100, quantity: 1 }));
  });
});

describe("app-order: service", () => {
  let ctx;

  beforeEach(async () => {
    EVENTS.length = 0;
    ctx = await fixture();
  });

  after(async () => { if (ctx?.db) ctx.db.close(); });

  it("9 — createOrder creates order with AWAITING_PAYMENT status", async () => {
    const result = await ctx.service.createOrder(ctx.accountId, {});
    assert.strictEqual(result.data.order.status, "AWAITING_PAYMENT");
    assert.ok(result.data.order.orderNumber.startsWith("AERO-2026-"));
    assert.strictEqual(result.data.duplicate, false);
  });

  it("10 — createOrder creates stock reservations", async () => {
    const result = await ctx.service.createOrder(ctx.accountId, {});
    const orderId = result.data.order.id;
    const reservations = await ctx.db.all(`SELECT * FROM app_stock_reservations WHERE order_id = ?`, [orderId]);
    assert.ok(reservations.length >= 1);
    for (const r of reservations) {
      assert.strictEqual(r.status, "ACTIVE");
      assert.ok(r.expires_at);
    }
  });

  it("11 — createOrder creates order items", async () => {
    const result = await ctx.service.createOrder(ctx.accountId, {});
    const orderId = result.data.order.id;
    const items = await ctx.db.all(`SELECT * FROM app_order_items WHERE order_id = ?`, [orderId]);
    assert.ok(items.length >= 1);
    assert.strictEqual(items[0].product_id, "prod-1");
  });

  it("12 — createOrder creates order events", async () => {
    const result = await ctx.service.createOrder(ctx.accountId, {});
    const orderId = result.data.order.id;
    const events = await ctx.db.all(`SELECT * FROM app_order_events WHERE order_id = ?`, [orderId]);
    assert.ok(events.length >= 2); // ORDER_CREATED + STOCK_RESERVED
  });

  it("13 — duplicate order returns existing (idempotency)", async () => {
    // Fixture separada para idempotency (cart não foi convertido ainda)
    const idemCtx = await fixture();
    const key = "idem-test-123";
    const result1 = await idemCtx.service.createOrder(idemCtx.accountId, { idempotencyKey: key });
    // Criar novo cart para o segundo pedido (o primeiro foi CONVERTED)
    const now = new Date().toISOString();
    const newCartId = randomUUID();
    await idemCtx.db.run(`INSERT INTO app_carts (id, account_id, status, created_at, updated_at) VALUES (?, ?, 'ACTIVE', ?, ?)`, [newCartId, idemCtx.accountId, now, now]);
    const newItemId = randomUUID();
    const snap = JSON.stringify({ name: "Camiseta Basica", variant: "P/Preta" });
    await idemCtx.db.run(`INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, promotional_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`, [newItemId, newCartId, "prod-1", "var-1", 2, 2500, null, 2500, 5000, snap, "in_stock", now, now]);
    const result2 = await idemCtx.service.createOrder(idemCtx.accountId, { idempotencyKey: key });
    assert.strictEqual(result2.data.duplicate, true);
    assert.strictEqual(result1.data.order.id, result2.data.order.id);
  });

  it("14 — empty cart rejects", async () => {
    await ctx.db.run(`DELETE FROM app_cart_items WHERE id = ?`, [ctx.itemId]);
    await assert.rejects(() => ctx.service.createOrder(ctx.accountId, {}), (err) => {
      assert.strictEqual(err.code, "CART_EMPTY");
      return true;
    });
  });

  it("15 — invalid account rejects", async () => {
    await assert.rejects(() => ctx.service.createOrder("invalid-id", {}), (err) => {
      assert.strictEqual(err.code, "INVALID_ACCOUNT_ID");
      return true;
    });
  });

  it("16 — session not APPROVED rejects", async () => {
    await ctx.db.run(`UPDATE app_customer_accounts SET access_status = 'PENDING_APPROVAL' WHERE id = ?`, [ctx.accountId]);
    await assert.rejects(() => ctx.service.createOrder(ctx.accountId, {}), (err) => {
      assert.strictEqual(err.code, "ACCESS_NOT_APPROVED");
      return true;
    });
  });

  it("17 — address required rejects when null", async () => {
    await ctx.db.run(`UPDATE app_cart_fulfillment SET address_id = NULL WHERE account_id = ?`, [ctx.accountId]);
    await assert.rejects(() => ctx.service.createOrder(ctx.accountId, {}), (err) => {
      assert.strictEqual(err.code, "ADDRESS_REQUIRED");
      return true;
    });
  });

  it("18 — address not found rejects when referenced address is gone", async () => {
    // Archive o endereço para que archived_at IS NULL falhe
    await ctx.db.run(`UPDATE app_customer_addresses SET archived_at = ? WHERE id = ?`, [new Date().toISOString(), ctx.addressId]);
    await assert.rejects(() => ctx.service.createOrder(ctx.accountId, {}), (err) => {
      assert.strictEqual(err.code, "ADDRESS_NOT_FOUND");
      return true;
    });
  });

  it("19 — stock insufficient rejects", async () => {
    await ctx.db.run(`UPDATE app_cart_items SET availability_status = 'out_of_stock' WHERE id = ?`, [ctx.itemId]);
    await assert.rejects(() => ctx.service.createOrder(ctx.accountId, {}), (err) => {
      assert.strictEqual(err.code, "STOCK_INSUFFICIENT");
      return true;
    });
  });

  it("20 — snapshot is immutable JSON", async () => {
    const result = await ctx.service.createOrder(ctx.accountId, {});
    const snapshot = JSON.parse(result.data.order.snapshotJson);
    assert.ok(snapshot.orderId);
    assert.ok(snapshot.orderNumber);
    assert.ok(snapshot.items.length > 0);
    assert.strictEqual(snapshot.totalCents, result.data.order.totalCents);
  });

  it("21 — expiration sets status to EXPIRED and releases reservations", async () => {
    const result = await ctx.service.createOrder(ctx.accountId, {});
    const orderId = result.data.order.id;
    const expired = await ctx.service.expireOrder(ctx.accountId, orderId);
    assert.strictEqual(expired.data.expired, true);
    const order = await ctx.db.get(`SELECT * FROM app_orders WHERE id = ?`, [orderId]);
    assert.strictEqual(order.status, "EXPIRED");
    const reservations = await ctx.db.all(`SELECT * FROM app_stock_reservations WHERE order_id = ?`, [orderId]);
    for (const r of reservations) {
      assert.strictEqual(r.status, "EXPIRED");
    }
  });

  it("22 — release sets status to CANCELLED and releases reservations", async () => {
    const result = await ctx.service.createOrder(ctx.accountId, {});
    const orderId = result.data.order.id;
    const released = await ctx.service.releaseOrder(ctx.accountId, orderId);
    assert.strictEqual(released.data.released, true);
    const order = await ctx.db.get(`SELECT * FROM app_orders WHERE id = ?`, [orderId]);
    assert.strictEqual(order.status, "CANCELLED");
  });

  it("23 — release reservation (ACTIVE → RELEASED)", async () => {
    const result = await ctx.service.createOrder(ctx.accountId, {});
    const orderId = result.data.order.id;
    const before = await ctx.db.all(`SELECT * FROM app_stock_reservations WHERE order_id = ? AND status = 'ACTIVE'`, [orderId]);
    assert.ok(before.length > 0);
    await ctx.service.releaseOrder(ctx.accountId, orderId);
    const after = await ctx.db.all(`SELECT * FROM app_stock_reservations WHERE order_id = ? AND status = 'RELEASED'`, [orderId]);
    assert.ok(after.length > 0);
  });

  it("24 — order not found returns error", async () => {
    await assert.rejects(() => ctx.service.getOrder(ctx.accountId, "nonexistent"), (err) => {
      assert.strictEqual(err.code, "ORDER_NOT_FOUND");
      return true;
    });
  });

  it("25 — listOrders returns orders for account", async () => {
    await ctx.service.createOrder(ctx.accountId, {});
    const result = await ctx.service.listOrders(ctx.accountId);
    assert.ok(result.data.count >= 1);
    assert.ok(Array.isArray(result.data.orders));
  });

  it("26 — FORBIDDEN_KEYS blocks PII payment fields", () => {
    const forbidden = ["payment_method", "payment_status", "payment_id", "transaction_id", "pix_code", "pix_payload", "card_number", "card_token", "infinitepay_id"];
    for (const key of forbidden) {
      assert.ok(FORBIDDEN_KEYS.has(key), `FORBIDDEN_KEYS should contain ${key}`);
    }
  });

  it("27 — order number follows AERO-YYYY-XXXXXXXXX pattern", async () => {
    const result = await ctx.service.createOrder(ctx.accountId, {});
    const number = result.data.order.orderNumber;
    assert.match(number, /^AERO-\d{4}-\d{9}$/);
  });

  it("28 — fulfillment_type DELIVERY stores address_id", async () => {
    const result = await ctx.service.createOrder(ctx.accountId, {});
    assert.strictEqual(result.data.order.fulfillmentType, "DELIVERY");
    assert.ok(result.data.order.addressId);
  });

  it("29 — fulfillment_type PICKUP stores pickup_store_id", async () => {
    await ctx.db.run(`UPDATE app_cart_fulfillment SET fulfillment_type = 'PICKUP', address_id = NULL, pickup_store_id = 'vila' WHERE account_id = ?`, [ctx.accountId]);
    const result = await ctx.service.createOrder(ctx.accountId, {});
    assert.strictEqual(result.data.order.fulfillmentType, "PICKUP");
    assert.strictEqual(result.data.order.pickupStoreId, "vila");
    assert.strictEqual(result.data.order.shippingQuoteCents, 0);
  });

  it("30 — rollback on error cleans up", async () => {
    // Replace db.run to simulate failure on order insert
    const originalRun = ctx.db.run.bind(ctx.db);
    let callCount = 0;
    ctx.db.run = async (sql, params) => {
      callCount++;
      // Fail on order_items insert
      if (typeof sql === 'string' && sql.includes('INSERT INTO app_order_items')) throw new Error("Simulated DB error");
      return originalRun(sql, params);
    };
    await assert.rejects(() => ctx.service.createOrder(ctx.accountId, {}));
    // Verify no orphaned events
    const orphanedEvents = await ctx.db.all(`SELECT e.* FROM app_order_events e LEFT JOIN app_orders o ON e.order_id = o.id WHERE o.id IS NULL`);
    assert.strictEqual(orphanedEvents.length, 0);
  });
});

describe("app-order: schema", () => {
  it("30 — applyAppOrderSchema creates tables idempotently", async () => {
    const db = memoryDb();
    await db.run("PRAGMA foreign_keys=ON");
    await db.run(`CREATE TABLE IF NOT EXISTS customer_master_records(id TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, eligibility_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED', updated_at TEXT NOT NULL, deleted_at TEXT)`);
    await applyAppCustomerAccessSchema(db);
    await applyAppOrderSchema(db);
    const result2 = await applyAppOrderSchema(db);
    assert.strictEqual(result2.ready, true);
    db.close();
  });

  it("31 — applyAppOrderSchema fails without prerequisite", async () => {
    const db = memoryDb();
    await db.run("PRAGMA foreign_keys=ON");
    await assert.rejects(() => applyAppOrderSchema(db), { message: /MISSING_PREREQ/ });
    db.close();
  });
});
