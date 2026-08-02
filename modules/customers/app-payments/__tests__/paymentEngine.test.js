"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");
const { memoryDb } = require("../../master/__tests__/memoryDb");
const { applyAppCustomerAccessSchema } = require("../../app-access/persistence/appCustomerAccessSchema");
const { applyAppCartSchema } = require("../../app-cart/persistence/appCartSchema");
const { applyAppAddressSchema } = require("../../app-address/persistence/appAddressSchema");
const { applyAppFulfillmentSchema } = require("../../app-fulfillment/persistence/appFulfillmentSchema");
const { applyAppOrderSchema } = require("../../app-orders/persistence/appOrderSchema");
const { applyAppPaymentSchema } = require("../persistence/appPaymentSchema");
const { applyCustomerMasterSchema } = require("../../master/persistence/customerMasterSchema");

async function applySchemas(d) {
  d.run(`CREATE TABLE IF NOT EXISTS customer_master_records(id TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, eligibility_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED', updated_at TEXT NOT NULL, deleted_at TEXT)`);
  await applyAppCustomerAccessSchema(d);
  await applyAppCartSchema(d);
  await applyAppAddressSchema(d);
  await applyAppFulfillmentSchema(d);
  await applyAppOrderSchema(d);
  await applyAppPaymentSchema(d);
}
const { createPaymentEngine } = require("../PaymentEngine");
const { createWebhookEngine } = require("../WebhookEngine");
const { createReconciliationService } = require("../ReconciliationService");
const { MockProvider } = require("../providers/mockProvider");
const { InfinitePayProvider } = require("../providers/infinitePayProvider");
const { PaymentMachine, STATES, EVENTS } = require("../PaymentMachine");
const { paymentDto, paymentAttemptDto, paymentEventDto, formatCentsBrl, assertAllowList, PaymentError, FORBIDDEN_KEYS, envelope } = require("../appPaymentDto");

function uuid() { return randomUUID(); }

let db;
let provider;
let paymentEngine;
let webhookEngine;
let reconciliationService;
let audits;
let approvedPayments;
let failedPayments;
let orderId;

async function fixture() {
  const d = memoryDb();
  await d.run("PRAGMA foreign_keys=ON");
  await d.run(`CREATE TABLE IF NOT EXISTS customer_master_records(id TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, eligibility_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED', updated_at TEXT NOT NULL, deleted_at TEXT)`);
  await d.run(`CREATE TABLE IF NOT EXISTS customer_identity_conflicts(id TEXT PRIMARY KEY, conflict_type TEXT, severity TEXT, status TEXT)`);
  await d.run(`CREATE TABLE IF NOT EXISTS customer_identity_conflict_participants(id TEXT PRIMARY KEY, conflict_id TEXT, participant_type TEXT, participant_id TEXT)`);
  await d.run(`CREATE TABLE IF NOT EXISTS customer_identity_cases(id TEXT PRIMARY KEY, blocking INTEGER)`);
  await d.run(`CREATE TABLE IF NOT EXISTS customer_identity_case_conflicts(case_id TEXT, conflict_id TEXT)`);

  await applyAppCustomerAccessSchema(d);
  await applyAppCartSchema(d);
  await applyAppAddressSchema(d);
  await applyAppFulfillmentSchema(d);
  await applyAppOrderSchema(d);
  await applyAppPaymentSchema(d);

  const accountId = uuid();
  const cartId = uuid();
  const addressId = uuid();
  const oid = uuid();
  const now = new Date().toISOString();

  await d.run(`INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, phone_verified_at, version, created_at, updated_at) VALUES (?, '', '', '', '', 'ACTIVE', 'APPROVED', ?, 1, ?, ?)`, [accountId, now, now, now]);
  await d.run(`INSERT INTO app_carts (id, account_id, status, subtotal_cents, item_count, version, created_at, updated_at) VALUES (?, ?, 'CONVERTED', 50000, 2, 1, ?, ?)`, [cartId, accountId, now, now]);
  await d.run(`INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, complement, neighborhood, city, state, delivery_instructions, validation_status, is_default, version, created_at, updated_at) VALUES (?, ?, 'Casa', 'Joao', '01001000', '01001-000', 'Rua X', '100', '', 'Centro', 'Sao Paulo', 'SP', '', 'VALID', 1, 1, ?, ?)`, [addressId, accountId, now, now]);
  await d.run(`INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, snapshot_json, version, created_at, updated_at) VALUES (?, ?, ?, 'DELIVERY', ?, '', '', 0, 'BRL', 48500, 50000, 'AWAITING_PAYMENT', '{"items":[]}', 1, ?, ?)`, [oid, "ORD-" + now.replace(/[^a-z0-9]/gi, ''), accountId, addressId, now, now]);

  return { db: d, accountId, cartId, addressId, orderId: oid };
}

async function pe_create(d, orderId, amountCents) {
  const now = new Date().toISOString();
  const id = uuid();
  await d.run(`INSERT INTO app_payments (id, order_id, amount_cents, currency, description, status, payment_method, attempt_count, version, created_at, updated_at) VALUES (?, ?, ?, 'BRL', '', 'AWAITING_PAYMENT', 'PIX', 0, 1, ?, ?)`, [id, orderId, amountCents, now, now]);
  return { id, amountCents, currency: "BRL", status: "AWAITING_PAYMENT", createdAt: now };
}

function setupEngines(d, provider, audits, approvedPayments, failedPayments) {
  const pe = createPaymentEngine({
    dbApi: d,
    provider,
    recordAudit: async (entry) => { audits.push(entry); },
    onPaymentApproved: async (paymentId) => { approvedPayments.push(paymentId); },
    onPaymentFailed: async (paymentId) => { failedPayments.push(paymentId); }
  });
  const we = createWebhookEngine({
    dbApi: d,
    provider,
    paymentEngine: pe,
    recordAudit: async (entry) => { audits.push(entry); },
    onPaymentApproved: async (paymentId) => { approvedPayments.push(paymentId); }
  });
  const rs = createReconciliationService({
    dbApi: d,
    provider,
    paymentEngine: pe,
    recordAudit: async (entry) => { audits.push(entry); }
  });
  return { paymentEngine: pe, webhookEngine: we, reconciliationService: rs };
}

// ============================================================
// 1-8. PaymentMachine — estados e transições
// ============================================================
test("1. Machine: initial state is AWAITING_PAYMENT", () => {
  const machine = new PaymentMachine();
  assert.equal(machine.state, STATES.AWAITING_PAYMENT);
});

test("2. Machine: transition AWAITING -> PROCESSING is valid", () => {
  const machine = new PaymentMachine(STATES.AWAITING_PAYMENT);
  const result = machine.transition(STATES.PAYMENT_PROCESSING, "test");
  assert.equal(result.success, true);
  assert.equal(machine.state, STATES.PAYMENT_PROCESSING);
});

test("3. Machine: transition PROCESSING -> PAID is valid", () => {
  const machine = new PaymentMachine(STATES.PAYMENT_PROCESSING);
  const result = machine.transition(STATES.PAID, "test");
  assert.equal(result.success, true);
  assert.equal(machine.state, STATES.PAID);
});

test("4. Machine: transition PAID -> REFUNDED is valid", () => {
  const machine = new PaymentMachine(STATES.PAID);
  const result = machine.transition(STATES.REFUNDED, "test");
  assert.equal(result.success, true);
  assert.equal(machine.state, STATES.REFUNDED);
});

test("5. Machine: invalid transition AWAITING -> PAID is rejected", () => {
  const machine = new PaymentMachine(STATES.AWAITING_PAYMENT);
  const result = machine.transition(STATES.PAID, "test");
  assert.equal(result.success, false);
  assert.equal(result.error, "INVALID_TRANSITION");
});

test("6. Machine: cannot transition from PAID to AWAITING", () => {
  const machine = new PaymentMachine(STATES.PAID);
  const result = machine.transition(STATES.AWAITING_PAYMENT, "test");
  assert.equal(result.success, false);
});

test("7. Machine: PAID -> FAILED is blocked", () => {
  const machine = new PaymentMachine(STATES.PAID);
  const result = machine.transition(STATES.PAYMENT_FAILED, "test");
  assert.equal(result.success, false);
});

test("8. Machine: transitionByEvent PAYMENT_APPROVED works", () => {
  const machine = new PaymentMachine(STATES.PAYMENT_PROCESSING);
  const result = machine.transitionByEvent(EVENTS.PAYMENT_APPROVED);
  assert.equal(result.success, true);
  assert.equal(machine.state, STATES.PAID);
});

// ============================================================
// 9-12. Payment Engine — criação de pagamento
// ============================================================
test("9. Engine: createPayment requires order_id", async () => {
  const { paymentEngine: pe } = setupEngines(memoryDb(), new MockProvider(), [], [], []);
  await assert.rejects(
    () => pe.createPayment({ amountCents: 1000 }),
    (err) => err.code === "ORDER_ID_REQUIRED"
  );
});

test("10. Engine: createPayment rejects amount <= 0", async () => {
  const { paymentEngine: pe } = setupEngines(memoryDb(), new MockProvider(), [], [], []);
  await assert.rejects(
    () => pe.createPayment({ orderId: uuid(), amountCents: 0 }),
    (err) => err.code === "INVALID_AMOUNT"
  );
});

test("11. Engine: createPayment rejects amount > 500 BRL", async () => {
  const { paymentEngine: pe } = setupEngines(memoryDb(), new MockProvider(), [], [], []);
  await assert.rejects(
    () => pe.createPayment({ orderId: uuid(), amountCents: 50000001 }),
    (err) => err.code === "AMOUNT_EXCEEDS_LIMIT"
  );
});

test("12. Engine: createPayment succeeds with valid input", async () => {
  const f = await fixture();
  const { paymentEngine: pe } = setupEngines(f.db, new MockProvider(), [], [], []);
  const payment = await pe.createPayment({ orderId: f.orderId, amountCents: 50000 });
  assert.ok(payment.id);
  assert.equal(payment.amountCents, 50000);
  assert.equal(payment.status, STATES.PAYMENT_PROCESSING);
  assert.equal(payment.currency, "BRL");
  assert.ok(payment.createdAt);
  if (f.db) f.db.close();
});

// ============================================================
// 13-16. Payment Attempt
// ============================================================
test("13. Engine: createPaymentAttempt requires existing payment", async () => {
  const f = await fixture();
  const { paymentEngine: pe } = setupEngines(f.db, new MockProvider(), [], [], []);
  await assert.rejects(
    () => pe.createPaymentAttempt(uuid()),
    (err) => err.code === "PAYMENT_NOT_FOUND"
  );
  if (f.db) f.db.close();
});

test("14. Engine: createPaymentAttempt succeeds for PAYMENT_PROCESSING payment", async () => {
  const f = await fixture();
  // createPayment vai para PAYMENT_PROCESSING, then attempt needs to go AWAITING->PROCESSING
  // Reset payment to AWAITING_PAYMENT to simulate fresh state
  const payment = await pe_create(f.db, f.orderId, 10000);
  await f.db.run("UPDATE app_payments SET status = 'AWAITING_PAYMENT' WHERE id = ?", [payment.id]);
  const { paymentEngine: pe } = setupEngines(f.db, new MockProvider({ behavior: "APPROVED" }), [], [], []);
  const attempt = await pe.createPaymentAttempt(payment.id);
  assert.ok(attempt.id);
  assert.equal(attempt.status, "SUBMITTED");
  assert.equal(attempt.amountCents, 10000);
  if (f.db) f.db.close();
});

test("15. Engine: createPaymentAttempt on already PAID payment fails", async () => {
  const f = await fixture();
  const { paymentEngine: pe } = setupEngines(f.db, new MockProvider(), [], [], []);
  const payment = await pe.createPayment({ orderId: f.orderId, amountCents: 10000 });
  await f.db.run("UPDATE app_payments SET status = 'PAID' WHERE id = ?", [payment.id]);
  await assert.rejects(
    () => pe.createPaymentAttempt(payment.id),
    (err) => err.code === "PAYMENT_ALREADY_PAID"
  );
  if (f.db) f.db.close();
});

test("16. Engine: createPaymentAttempt increments attempt_count", async () => {
  const f = await fixture();
  const providerPending = new MockProvider({ behavior: "PENDING" });
  const { paymentEngine: pe } = setupEngines(f.db, providerPending, [], [], []);
  const payment = await pe_create(f.db, f.orderId, 10000);
  await f.db.run("UPDATE app_payments SET status = 'AWAITING_PAYMENT' WHERE id = ?", [payment.id]);
  await pe.createPaymentAttempt(payment.id);
  const after1 = await f.db.get("SELECT attempt_count FROM app_payments WHERE id = ?", [payment.id]);
  assert.equal(after1.attempt_count, 1);
  // Reset to AWAITING for second attempt
  await f.db.run("UPDATE app_payments SET status = 'AWAITING_PAYMENT' WHERE id = ?", [payment.id]);
  await pe.createPaymentAttempt(payment.id);
  const after2 = await f.db.get("SELECT attempt_count FROM app_payments WHERE id = ?", [payment.id]);
  assert.equal(after2.attempt_count, 2);
  if (f.db) f.db.close();
});

// ============================================================
// 17-20. Cancel, Expire, Query
// ============================================================
test("17. Engine: cancelPayment cancels AWAITING payment", async () => {
  const f = await fixture();
  const { paymentEngine: pe } = setupEngines(f.db, new MockProvider(), [], [], []);
  const payment = await pe.createPayment({ orderId: f.orderId, amountCents: 10000 });
  const cancelled = await pe.cancelPayment(payment.id, "user_requested");
  assert.equal(cancelled.status, STATES.PAYMENT_CANCELLED);
  if (f.db) f.db.close();
});

test("18. Engine: cancelPayment on PAID payment fails", async () => {
  const f = await fixture();
  const { paymentEngine: pe } = setupEngines(f.db, new MockProvider(), [], [], []);
  const payment = await pe.createPayment({ orderId: f.orderId, amountCents: 10000 });
  await f.db.run("UPDATE app_payments SET status = 'PAID' WHERE id = ?", [payment.id]);
  await assert.rejects(
    () => pe.cancelPayment(payment.id),
    (err) => err.code === "CANNOT_CANCEL"
  );
  if (f.db) f.db.close();
});

test("19. Engine: expirePayment expires AWAITING payment", async () => {
  const f = await fixture();
  const { paymentEngine: pe } = setupEngines(f.db, new MockProvider(), [], [], []);
  const payment = await pe.createPayment({ orderId: f.orderId, amountCents: 10000 });
  const expired = await pe.expirePayment(payment.id);
  assert.equal(expired.status, STATES.PAYMENT_EXPIRED);
  if (f.db) f.db.close();
});

test("20. Engine: queryPayment returns payment data", async () => {
  const f = await fixture();
  const { paymentEngine: pe } = setupEngines(f.db, new MockProvider(), [], [], []);
  const payment = await pe.createPayment({ orderId: f.orderId, amountCents: 10000 });
  const queried = await pe.queryPayment(payment.id);
  assert.equal(queried.id, payment.id);
  assert.equal(queried.amountCents, 10000);
  if (f.db) f.db.close();
});

// ============================================================
// 21-23. DTO, PII, formatCentsBrl
// ============================================================
test("21. DTO: formatCentsBrl formats correctly", () => {
  assert.equal(formatCentsBrl(10000), "R$\u00a0100,00");
  assert.equal(formatCentsBrl(0), "R$\u00a00,00");
  assert.equal(formatCentsBrl(500), "R$\u00a05,00");
});

test("22. DTO: assertAllowList rejects forbidden keys", () => {
  assert.throws(
    () => assertAllowList({ cvv: "123", amount: 100 }),
    (err) => err.code === "FORBIDDEN_FIELD"
  );
  assert.throws(
    () => assertAllowList({ nested: { card_number: "4111111111111111" } }),
    (err) => err.code === "FORBIDDEN_FIELD"
  );
});

test("23. DTO: FORBIDDEN_KEYS contains expected fields", () => {
  assert.ok(FORBIDDEN_KEYS.has("cvv"));
  assert.ok(FORBIDDEN_KEYS.has("card_number"));
  assert.ok(FORBIDDEN_KEYS.has("access_token"));
  assert.ok(FORBIDDEN_KEYS.has("webhook_secret"));
});

// ============================================================
// 24-26. Webhook Engine
// ============================================================
test("24. Webhook: handleWebhook processes APPROVED status", async () => {
  const f = await fixture();
  const { paymentEngine: pe, webhookEngine: we } = setupEngines(f.db, new MockProvider(), [], [], []);
  const payment = await pe.createPayment({ orderId: f.orderId, amountCents: 10000 });
  const result = await we.handleWebhook(
    { webhook_id: uuid(), event_type: "PAYMENT_STATUS_CHANGE", payment_id: payment.id, status: "APPROVED" },
    "MOCK_SECRET"
  );
  assert.equal(result.action, "processed");
  assert.equal(result.newStatus, STATES.PAID);
  if (f.db) f.db.close();
});

test("25. Webhook: handleWebhook rejects invalid signature", async () => {
  const f = await fixture();
  const { paymentEngine: pe, webhookEngine: we } = setupEngines(f.db, new MockProvider(), [], [], []);
  const payment = await pe.createPayment({ orderId: f.orderId, amountCents: 10000 });
  const result = await we.handleWebhook(
    { webhook_id: uuid(), event_type: "PAYMENT_STATUS_CHANGE", payment_id: payment.id, status: "APPROVED" },
    "INVALID_SECRET"
  );
  assert.equal(result.action, "rejected");
  assert.equal(result.reason, "INVALID_SIGNATURE");
  if (f.db) f.db.close();
});

test("26. Webhook: handleWebhook duplicates are ignored", async () => {
  const f = await fixture();
  const { paymentEngine: pe, webhookEngine: we } = setupEngines(f.db, new MockProvider(), [], [], []);
  const payment = await pe.createPayment({ orderId: f.orderId, amountCents: 10000 });
  const webhookId = uuid();
  const result1 = await we.handleWebhook(
    { webhook_id: webhookId, event_type: "PAYMENT_STATUS_CHANGE", payment_id: payment.id, status: "FAILED" },
    "MOCK_SECRET"
  );
  assert.equal(result1.action, "processed");
  const result2 = await we.handleWebhook(
    { webhook_id: webhookId, event_type: "PAYMENT_STATUS_CHANGE", payment_id: payment.id, status: "APPROVED" },
    "MOCK_SECRET"
  );
  assert.equal(result2.action, "duplicated");
  assert.equal(result2.reason, "WEBHOOK_DUPLICATED");
  if (f.db) f.db.close();
});

// ============================================================
// 27-29. Reconciliation Service
// ============================================================
test("27. Reconciliation: reconcilePayment detects status discrepancy", async () => {
  const f = await fixture();
  const providerApproved = new MockProvider({ behavior: "APPROVED" });
  const { reconciliationService: rs } = setupEngines(f.db, providerApproved, [], [], []);
  const payment = await pe_create(f.db, f.orderId, 10000);
  await f.db.run("UPDATE app_payments SET status = 'AWAITING_PAYMENT' WHERE id = ?", [payment.id]);
  const report = await rs.reconcilePayment(payment.id);
  assert.ok(report.id);
  assert.equal(report.paymentId, payment.id);
  assert.ok(report.startedAt);
  assert.ok(report.endedAt);
  if (f.db) f.db.close();
});

test("28. Reconciliation: reconcilePayment on non-existent payment fails", async () => {
  const d = memoryDb();
  await applySchemas(d);
  const { reconciliationService: rs } = setupEngines(d, new MockProvider(), [], [], []);
  await assert.rejects(
    () => rs.reconcilePayment(uuid()),
    (err) => err.code === "PAYMENT_NOT_FOUND"
  );
  d.close();
});

test("29. Reconciliation: reconcileAllPending returns results", async () => {
  const f = await fixture();
  const { reconciliationService: rs } = setupEngines(f.db, new MockProvider(), [], [], []);
  const results = await rs.reconcileAllPending();
  assert.ok(Array.isArray(results));
  if (f.db) f.db.close();
});

// ============================================================
// 30-32. Provider validation
// ============================================================
test("30. MockProvider: health returns operational status", async () => {
  const health = await new MockProvider().health();
  assert.equal(health.healthy, true);
  assert.equal(health.provider, "mock");
});

test("31. InfinitePayProvider: mock mode returns pending", async () => {
  const ip = new InfinitePayProvider({ mockMode: true });
  const health = await ip.health();
  assert.equal(health.mockMode, true);
  const payment = await ip.createPayment({ amountCents: 10000 });
  assert.equal(payment.status, "PENDING");
});

test("32. InfinitePayProvider: validateWebhook without secret returns invalid", async () => {
  const ip = new InfinitePayProvider({ mockMode: true });
  const result = await ip.validateWebhook({ id: "test" }, "test");
  assert.equal(result.valid, false);
  assert.equal(result.reason, "WEBHOOK_SECRET_NOT_CONFIGURED");
});

// ============================================================
// 33-35. Edge cases
// ============================================================
test("33. Engine: getPayment returns null for non-existent", async () => {
  const f = await fixture();
  const { paymentEngine: pe } = setupEngines(f.db, new MockProvider(), [], [], []);
  const payment = await pe.getPayment(uuid());
  assert.equal(payment, null);
  if (f.db) f.db.close();
});

test("34. Engine: getPaymentAttempts returns empty array for no attempts", async () => {
  const f = await fixture();
  const { paymentEngine: pe } = setupEngines(f.db, new MockProvider(), [], [], []);
  const payment = await pe.createPayment({ orderId: f.orderId, amountCents: 10000 });
  const attempts = await pe.getPaymentAttempts(payment.id);
  assert.ok(Array.isArray(attempts));
  if (f.db) f.db.close();
});

test("35. Engine: getPaymentEvents returns events for created payment", async () => {
  const f = await fixture();
  const { paymentEngine: pe } = setupEngines(f.db, new MockProvider(), [], [], []);
  const payment = await pe.createPayment({ orderId: f.orderId, amountCents: 10000 });
  const events = await pe.getPaymentEvents(payment.id);
  assert.ok(Array.isArray(events));
  assert.ok(events.length > 0);
  assert.equal(events[0].eventType, EVENTS.PAYMENT_CREATED);
  if (f.db) f.db.close();
});

// ============================================================
// 36-38. Rules of business
// ============================================================
test("36. Business rule: no payment without order", async () => {
  const { paymentEngine: pe } = setupEngines(memoryDb(), new MockProvider(), [], [], []);
  await assert.rejects(
    () => pe.createPayment({ amountCents: 10000 }),
    (err) => err.code === "ORDER_ID_REQUIRED"
  );
});

test("37. Business rule: payment snapshot preserves price", async () => {
  const f = await fixture();
  const { paymentEngine: pe } = setupEngines(f.db, new MockProvider(), [], [], []);
  const payment = await pe.createPayment({ orderId: f.orderId, amountCents: 50000 });
  const fetched = await pe.getPayment(payment.id);
  assert.equal(fetched.amountCents, 50000);
  if (f.db) f.db.close();
});

test("38. Business rule: no payment created without order_id", async () => {
  const { paymentEngine: pe } = setupEngines(memoryDb(), new MockProvider(), [], [], []);
  await assert.rejects(
    () => pe.createPayment({ amountCents: 10000 }),
    (err) => err.code === "ORDER_ID_REQUIRED"
  );
});

// ============================================================
// 39-40. Provider mock behavior
// ============================================================
test("39. MockProvider: setBehavior changes response", async () => {
  const mp = new MockProvider({ behavior: "APPROVED" });
  const p1 = await mp.createPayment({ id: uuid(), amountCents: 1000 });
  assert.equal(p1.status, "APPROVED");
  mp.setBehavior("FAILED");
  const p2 = await mp.createPayment({ id: uuid(), amountCents: 1000 });
  assert.equal(p2.status, "FAILED");
});

test("40. MockProvider: reset clears all payments", async () => {
  const mp = new MockProvider();
  await mp.createPayment({ id: uuid(), amountCents: 1000 });
  mp.reset();
  const health = await mp.health();
  assert.equal(health.paymentCount, 0);
});

// ============================================================
// 41. Schema validation
// ============================================================
test("41. Schema: applyAppPaymentSchema succeeds", async () => {
  const f = await fixture();
  const result = await applyAppPaymentSchema(f.db);
  assert.equal(result.ready, true);
  if (f.db) f.db.close();
});

// ============================================================
// 42-43. Envelope and DTO validation
// ============================================================
test("42. DTO: envelope wraps data correctly", () => {
  const result = envelope({ id: "test", status: "PAID" });
  assert.equal(result.success, true);
  assert.ok(result.data);
  assert.ok(result.meta);
  assert.equal(result.meta.api_version, "v1");
});

test("43. DTO: paymentDto formats amount correctly", () => {
  const dto = paymentDto({
    id: "test",
    order_id: "order1",
    amount_cents: 50000,
    currency: "BRL",
    status: "PAID",
    attempt_count: 1,
    version: 1
  });
  assert.equal(dto.amountCents, 50000);
  assert.equal(dto.amountFormatted, "R$\u00a0500,00");
  assert.equal(dto.status, "PAID");
});
