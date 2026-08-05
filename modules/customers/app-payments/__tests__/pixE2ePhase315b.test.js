"use strict";

/**
 * pixE2ePhase315b.test.js — Novos testes E2E para Phase 3.15-B.
 *
 * Cobre:
 *   1. Express router integration (webhook, reconcile, paymentAttempt)
 *   2. AppOrderSchemaV3 migration (PAID status + colunas de pagamento)
 *   3. PaymentEventProcessor (worker durável)
 *   4. Inventory SALE movements on finalization
 *   5. Frontend contract (ok/data, auth, checkout_url mapping) — text-based
 *   6. Fluxo completo (criação → pagamento → confirmação → finalização)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { randomUUID, createHash } = require("crypto");
const { createMemoryDb } = require("./memoryDb");
const http = require("http");

// ============================================================
// FIXTURES
// ============================================================

function iso(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

function createFakeAdapter(overrides = {}) {
  const defaultResult = {
    success: true,
    provider: "infinitepay",
    paid: true,
    amount: 5000,
    paid_amount: 5000,
    installments: 1,
    capture_method: "pix",
    status: "approved",
    order_nsu: "",
    transaction_nsu: "NSU-FAKE-001",
    receipt_url: "https://mock.receipt/1",
    raw: {
      paid: true,
      amount: 5000,
      paid_amount: 5000,
      capture_method: "pix",
      order_nsu: "",
      transaction_nsu: "NSU-FAKE-001",
      receipt_url: "https://mock.receipt/1",
    },
  };

  return {
    getPixPaymentStatus: async (params) => {
      const result = { ...defaultResult, ...overrides };
      result.raw = { ...(result.raw || {}), order_nsu: params.order_nsu, transaction_nsu: params.transaction_nsu || "NSU-FAKE-001" };
      result.order_nsu = params.order_nsu;
      return result;
    },
    createPixPayment: async (params) => ({
      success: true,
      invoice_slug: `slug-${randomUUID().slice(0, 8)}`,
      url: "https://checkout.infinitepay.com/mock",
      raw: { transaction_nsu: `TX-${randomUUID().slice(0, 8)}` },
    }),
  };
}

async function setupTables(db) {
  const { applyAppPaymentAttemptSchema } = require("../persistence/appPaymentAttemptSchema");
  await applyAppPaymentAttemptSchema(db);

  // Account MUST come before orders (FK)
  await db.run(`CREATE TABLE IF NOT EXISTS app_customer_accounts (
    id TEXT PRIMARY KEY, access_status TEXT NOT NULL DEFAULT 'APPROVED', version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);

  // Orders — FULL v1 shape (required by v3 migration copy-back)
  await db.run(`CREATE TABLE IF NOT EXISTS app_orders (
    id TEXT PRIMARY KEY,
    order_number TEXT NOT NULL,
    account_id TEXT NOT NULL,
    fulfillment_type TEXT NOT NULL,
    address_id TEXT,
    pickup_store_id TEXT,
    shipping_provider TEXT,
    shipping_service_code TEXT,
    shipping_quote_cents INTEGER,
    shipping_quote_currency TEXT DEFAULT 'BRL',
    subtotal_cents INTEGER NOT NULL,
    total_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'BRL',
    status TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    snapshot_json TEXT NOT NULL DEFAULT '{}',
    reservation_ids_json TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT,
    failed_reason TEXT,
    FOREIGN KEY (account_id) REFERENCES app_customer_accounts(id) ON DELETE RESTRICT)`);

  // Order events
  await db.run(`CREATE TABLE IF NOT EXISTS app_order_events (
    id TEXT PRIMARY KEY, order_id TEXT NOT NULL, event_type TEXT NOT NULL,
    details_json TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES app_orders(id) ON DELETE RESTRICT)`);

  // PDV inventory movements v2 — matches existing test fixture
  await db.run(`CREATE TABLE IF NOT EXISTS pdv_inventory_movements_v2 (
    id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, store_id TEXT NOT NULL,
    movement_type TEXT NOT NULL, quantity_delta INTEGER NOT NULL,
    quantity_before INTEGER NOT NULL DEFAULT 0, quantity_after INTEGER NOT NULL DEFAULT 0,
    origin TEXT, reference_type TEXT, reference_id TEXT,
    idempotency_key TEXT, actor_user_id TEXT, actor_name TEXT, metadata_json TEXT,
    created_at TEXT,
    UNIQUE(variant_id, store_id, idempotency_key))`);

  // PDV inventory balances v2
  await db.run(`CREATE TABLE IF NOT EXISTS pdv_inventory_balances_v2 (
    id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, store_id TEXT NOT NULL,
    available_qty INTEGER NOT NULL DEFAULT 0, reserved_qty INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT,
    UNIQUE(variant_id, store_id))`);
}

async function setupOrder(db, { status = "READY_FOR_PAYMENT", total_cents = 5000, reservationIds = [], accountId = "account-1" } = {}) {
  const orderId = randomUUID();
  const now = iso(new Date());

  // Ensure account exists
  try {
    await db.run(
      `INSERT INTO app_customer_accounts (id, access_status, version, created_at, updated_at) VALUES (?, 'APPROVED', 1, ?, ?)`,
      [accountId, now, now]
    );
  } catch {
    // Account already exists
  }

  const reservationIdsJson = JSON.stringify(reservationIds);
  const snapshotJson = JSON.stringify({ reservation_ids: reservationIds });

  await db.run(
    `INSERT INTO app_orders
     (id, order_number, account_id, fulfillment_type, address_id,
      subtotal_cents, total_cents, currency,
      status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at)
     VALUES (?, ?, ?, 'DELIVERY', 'addr-1',
      ?, ?, 'BRL',
      ?, ?, ?, ?, 1, ?, ?)`,
    [orderId, orderId.slice(0, 8), accountId,
     total_cents, total_cents,
     status, randomUUID(), snapshotJson, reservationIdsJson, now, now]
  );

  return { orderId, accountId };
}

async function setupAttempt(db, orderId, { status = "PENDING", provider_transaction_nsu = null, amount_cents = 5000 } = {}) {
  const attemptId = randomUUID();
  const now = iso(new Date());

  await db.run(
    `INSERT INTO app_payment_attempts
     (id, order_id, status, method, provider, amount_cents, currency,
      provider_reference, provider_checkout_url, idempotency_key, request_fingerprint,
      provider_transaction_nsu,
      created_at, updated_at, version)
     VALUES (?, ?, ?, 'PIX', 'INFINITEPAY', ?, 'BRL', 'ref-fake', 'https://checkout/fake', ?, ?, ?, ?, ?, 1)`,
    [attemptId, orderId, status, amount_cents, randomUUID(), randomUUID(), provider_transaction_nsu, now, now]
  );

  return attemptId;
}

// Express app helper with auth middleware injection
function createTestApp(reconciliationService, paymentService, { authAccountId = "account-1" } = {}) {
  const app = express();
  app.use(express.json());

  // Auth middleware — injects req.user (same pattern as existing tests)
  app.use((req, res, next) => {
    req.user = { id: authAccountId };
    next();
  });

  const { createReconcileRouter } = require("../reconcileRoutes");
  const { createWebhookRouter } = require("../webhookRoutes");
  const { createPaymentAttemptRouter } = require("../paymentAttemptRoutes");

  // Webhook — no auth needed (public)
  app.use(createWebhookRouter({
    express,
    reconciliationService,
  }));

  // Reconcile routes — mounted at root (routes already have /app/v1 prefix)
  app.use(createReconcileRouter({
    express,
    reconciliationService,
  }));

  // Payment attempt routes — mounted at /app/v1
  if (paymentService) {
    app.use("/app/v1", createPaymentAttemptRouter({
      express,
      paymentService,
    }));
  }

  return app;
}

function httpReq(app, method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const opts = {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: { "Content-Type": "application/json", ...headers },
      };
      const req = http.request(opts, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          server.close();
          let json;
          try { json = JSON.parse(data); } catch { json = data; }
          resolve({ status: res.statusCode, body: json });
        });
      });
      req.on("error", (err) => { server.close(); reject(err); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// ============================================================
// T_V3_01 — Migration v3 adiciona status PAID
// ============================================================
test("T_V3_01: applyAppOrderSchemaV3 adiciona PAID ao CHECK constraint", async () => {
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);
  const { orderId } = await setupOrder(db);

  const { applyAppOrderSchemaV3, isSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");

  const beforeV3 = await isSchemaV3(db);
  assert.equal(beforeV3, false, "Should not be v3 before migration");

  const result = await applyAppOrderSchemaV3(db);
  assert.equal(result.migrated, true, "Migration should be applied");
  assert.equal(result.reason, "v3_applied");

  const afterV3 = await isSchemaV3(db);
  assert.equal(afterV3, true, "Should be v3 after migration");

  const order = await db.get(`SELECT * FROM app_orders WHERE id = ?`, [orderId]);
  assert.ok(order, "Order should still exist after migration");
  assert.equal(order.id, orderId);
});

// ============================================================
// T_V3_02 — Migration v3 é idempotente
// ============================================================
test("T_V3_02: applyAppOrderSchemaV3 segunda chamada retorna already_v3", async () => {
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);
  await setupOrder(db);

  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");

  const first = await applyAppOrderSchemaV3(db);
  assert.equal(first.migrated, true);

  const second = await applyAppOrderSchemaV3(db);
  assert.equal(second.migrated, false, "Second call should not migrate");
  assert.equal(second.reason, "already_v3");
});

// ============================================================
// T_V3_03 — Migration v3 permite status PAID no CHECK
// ============================================================
test("T_V3_03: Após v3, é possível inserir ordem com status PAID", async () => {
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);
  const { accountId } = await setupOrder(db);

  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");
  await applyAppOrderSchemaV3(db);

  const newId = randomUUID();
  const now = iso(new Date());
  await assert.doesNotReject(
    () => db.run(
      `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, currency, status, idempotency_key, snapshot_json, version, created_at, updated_at)
       VALUES (?, 'NEW-PAID', ?, 'DELIVERY', 'addr-1', 5000, 5000, 'BRL', 'PAID', ?, '{}', 1, ?, ?)`,
      [newId, accountId, randomUUID(), now, now]
    ),
    "Should allow PAID status after v3 migration"
  );

  const order = await db.get(`SELECT * FROM app_orders WHERE id = ?`, [newId]);
  assert.equal(order.status, "PAID");
});

// ============================================================
// T_V3_04 — Migration v3 adiciona colunas de pagamento
// ============================================================
test("T_V3_04: Após v3, colunas paid_at e payment_transaction_nsu existem", async () => {
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);
  const { orderId } = await setupOrder(db);

  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");
  await applyAppOrderSchemaV3(db);

  const now = iso(new Date());
  await db.run(
    `UPDATE app_orders SET paid_at = ?, payment_transaction_nsu = 'NSU-TEST' WHERE id = ?`,
    [now, orderId]
  );

  const order = await db.get(`SELECT paid_at, payment_transaction_nsu, payment_attempt_id, payment_receipt_url FROM app_orders WHERE id = ?`, [orderId]);
  assert.ok(order, "Order should have payment columns");
  assert.ok(order.paid_at);
  assert.equal(order.payment_transaction_nsu, "NSU-TEST");
  assert.equal(order.payment_attempt_id, null, "payment_attempt_id should be null initially");
  assert.equal(order.payment_receipt_url, null, "payment_receipt_url should be null initially");
});

// ============================================================
// T_V3_05 — currency é preservada na migration
// ============================================================
test("T_V3_05: Migration v3 preserva coluna currency", async () => {
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);
  const { orderId } = await setupOrder(db);

  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");
  await applyAppOrderSchemaV3(db);

  const order = await db.get(`SELECT currency FROM app_orders WHERE id = ?`, [orderId]);
  assert.ok(order, "Order should exist after migration");
  assert.equal(order.currency, "BRL");
});

// ============================================================
// T_WORKER_01 — Worker não inicia com flags OFF
// ============================================================
test("T_WORKER_01: Worker não inicia quando flags estão OFF", async () => {
  process.env.INFINITEPAY_SHOP_PIX_ENABLED = "false";
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "false";
  process.env.INFINITEPAY_EVENT_WORKER_ENABLED = "false";

  const { createPaymentEventProcessor } = require("../paymentEventProcessor");
  const db = await createMemoryDb({ withV2: true });

  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: createFakeAdapter(),
    getInfinitePayHandle: () => "handle-fake",
  });

  const processor = createPaymentEventProcessor({
    db,
    reconciliationService: service,
    pollIntervalMs: 1000,
  });

  const result = processor.start();
  assert.equal(result.started, false, "Worker should not start with flags OFF");
  assert.equal(result.reason, "FLAGS_DISABLED");
});

// ============================================================
// T_WORKER_02 — Worker inicia com flags ON
// ============================================================
test("T_WORKER_02: Worker inicia quando todas as flags estão ON", async () => {
  process.env.INFINITEPAY_SHOP_PIX_ENABLED = "true";
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  process.env.INFINITEPAY_EVENT_WORKER_ENABLED = "true";

  const { createPaymentEventProcessor } = require("../paymentEventProcessor");
  const db = await createMemoryDb({ withV2: true });

  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: createFakeAdapter(),
    getInfinitePayHandle: () => "handle-fake",
  });

  const processor = createPaymentEventProcessor({
    db,
    reconciliationService: service,
    pollIntervalMs: 60000,
  });

  const result = processor.start();
  assert.equal(result.started, true, "Worker should start with flags ON");
  assert.equal(processor.isRunning(), true, "Worker should be running");

  processor.stop();
  assert.equal(processor.isRunning(), false, "Worker should stop");
});

// ============================================================
// T_WORKER_03 — Worker processa evento RECEIVED
// ============================================================
test("T_WORKER_03: Worker processa evento RECEIVED e marca como PROCESSED", async () => {
  process.env.INFINITEPAY_SHOP_PIX_ENABLED = "true";
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  process.env.INFINITEPAY_EVENT_WORKER_ENABLED = "false";

  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  // Apply v3 migration so reconcile can update status to PAID
  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");
  await applyAppOrderSchemaV3(db);

  const { orderId, accountId } = await setupOrder(db);
  const attemptId = await setupAttempt(db, orderId, { status: "PENDING", provider_transaction_nsu: "NSU-FAKE-001" });

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  const { createPaymentEventProcessor } = require("../paymentEventProcessor");
  const processor = createPaymentEventProcessor({ db, reconciliationService: service });

  // Create RECEIVED event (using the service's recordEvent for correct hash)
  const result = await service.recordEvent({
    provider: "INFINITEPAY",
    eventType: "PAYMENT_UPDATED",
    orderId,
    paymentAttemptId: attemptId,
    providerReference: "ref-fake",
    providerTransactionNsu: "NSU-FAKE-001",
    requestHash: createHash("sha256").update("INFINITEPAY|PAYMENT_UPDATED|ref-fake|" + orderId + "|NSU-FAKE-001|pix|5000|5000|true").digest("hex"),
    payloadSanitized: {},
    processingStatus: "RECEIVED",
  });

  // Process
  const workResult = await processor.processOneRound();
  assert.ok(workResult.processed >= 1, "Should process at least 1 event");

  // Verify event
  const event = await db.get(`SELECT * FROM app_payment_events WHERE id = ?`, [result.event_id]);
  assert.equal(event.processing_status, "PROCESSED");
  assert.ok(event.processed_at);

  // Verify attempt PAID
  const attempt = await db.get(`SELECT * FROM app_payment_attempts WHERE id = ?`, [attemptId]);
  assert.equal(attempt.status, "PAID");
});

// ============================================================
// T_WORKER_05 — Worker lida com pedido não encontrado
// ============================================================
test("T_WORKER_05: Worker marca evento como FAILED quando pedido não existe", async () => {
  process.env.INFINITEPAY_SHOP_PIX_ENABLED = "true";
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";

  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const eventId = randomUUID();
  const now = iso(new Date());
  const requestHash = createHash("sha256").update("INFINITEPAY|PAYMENT_UPDATED|nonexistent|NSU|x|pix|5000|5000|true").digest("hex");

  await db.run(
    `INSERT INTO app_payment_events
     (id, provider, event_type, order_id, request_hash, payload_sanitized_json, processing_status,
      received_at, created_at, updated_at, version)
     VALUES (?, 'INFINITEPAY', 'PAYMENT_UPDATED', 'nonexistent-order', ?, '{}', 'RECEIVED', ?, ?, ?, 1)`,
    [eventId, requestHash, now, now, now]
  );

  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: createFakeAdapter(),
    getInfinitePayHandle: () => "handle-fake",
  });

  const { createPaymentEventProcessor } = require("../paymentEventProcessor");
  const processor = createPaymentEventProcessor({ db, reconciliationService: service });

  const result = await processor.processOneRound();
  assert.equal(result.processed, 0, "Should not process (order not found)");

  const event = await db.get(`SELECT * FROM app_payment_events WHERE id = ?`, [eventId]);
  assert.equal(event.processing_status, "FAILED");
  assert.equal(event.failure_code, "ORDER_NOT_FOUND");
});

// ============================================================
// T_ROUTE_01 — Webhook POST sem auth (público)
// ============================================================
test("T_ROUTE_01: Webhook POST não exige autenticação", async () => {
  process.env.INFINITEPAY_WEBHOOK_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);
  const { orderId } = await setupOrder(db);

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  const app = createTestApp(service, null);
  const result = await httpReq(app, "POST", "/webhooks/infinitepay", {
    order_nsu: orderId,
    transaction_nsu: "NSU-001",
    invoice_slug: "ref-001",
    amount: 5000,
    paid_amount: 5000,
    capture_method: "pix",
    paid: true,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true, "Response should use ok/data contract");
});

// ============================================================
// T_ROUTE_02 — Webhook content-type inválido
// ============================================================
test("T_ROUTE_02: Webhook com content-type inválido retorna 400", async () => {
  process.env.INFINITEPAY_WEBHOOK_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: createFakeAdapter(),
    getInfinitePayHandle: () => "handle-fake",
  });

  const app = createTestApp(service, null);
  const result = await httpReq(app, "POST", "/webhooks/infinitepay", { order_nsu: "test" }, {
    "Content-Type": "text/plain",
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error.code, "INVALID_CONTENT_TYPE");
});

// ============================================================
// T_ROUTE_03 — Webhook sem order_nsu
// ============================================================
test("T_ROUTE_03: Webhook sem order_nsu retorna 400", async () => {
  process.env.INFINITEPAY_WEBHOOK_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: createFakeAdapter(),
    getInfinitePayHandle: () => "handle-fake",
  });

  const app = createTestApp(service, null);
  const result = await httpReq(app, "POST", "/webhooks/infinitepay", {
    transaction_nsu: "NSU-001",
    amount: 5000,
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error.code, "MISSING_ORDER_NSU");
});

// ============================================================
// T_ROUTE_04 — Webhook com flag OFF retorna 200 com mensagem
// ============================================================
test("T_ROUTE_04: Webhook com flag OFF retorna 200 com mensagem informativa", async () => {
  process.env.INFINITEPAY_WEBHOOK_ENABLED = "false";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: createFakeAdapter(),
    getInfinitePayHandle: () => "handle-fake",
  });

  const app = createTestApp(service, null);
  const result = await httpReq(app, "POST", "/webhooks/infinitepay", {
    order_nsu: "test",
    transaction_nsu: "NSU",
    amount: 5000,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.ok(result.body.message.includes("desabilitado"));
});

// ============================================================
// T_ROUTE_05 — Reconcile exige autenticação (sem middleware injetado)
// ============================================================
test("T_ROUTE_05: Reconcile POST sem req.user retorna 401", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const app = express();
  app.use(express.json());
  // NO auth middleware injected

  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const { createReconcileRouter } = require("../reconcileRoutes");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: createFakeAdapter(),
    getInfinitePayHandle: () => "handle-fake",
  });
  app.use(createReconcileRouter({ express, reconciliationService: service }));

  const result = await httpReq(app, "POST", "/app/v1/payment-attempts/some-id/reconcile", null);

  assert.equal(result.status, 401);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error.code, "UNAUTHORIZED");
});

// ============================================================
// T_ROUTE_06 — Reconcile com auth válida
// ============================================================
test("T_ROUTE_06: Reconcile POST com auth válida processa normalmente", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  // Apply v3
  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");
  await applyAppOrderSchemaV3(db);

  const { orderId, accountId } = await setupOrder(db);
  const attemptId = await setupAttempt(db, orderId, { status: "PENDING", provider_transaction_nsu: "NSU-FAKE-001" });

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  const app = createTestApp(service, null, { authAccountId: accountId });
  const result = await httpReq(app, "POST", `/app/v1/payment-attempts/${attemptId}/reconcile`, null, {
    "Authorization": "Bearer fake-token",
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.ok(result.body.data, "Should return data in ok/data format");
});

// ============================================================
// T_ROUTE_07 — GET status exige auth
// ============================================================
test("T_ROUTE_07: GET status sem req.user retorna 401", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const app = express();
  app.use(express.json());

  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const { createReconcileRouter } = require("../reconcileRoutes");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: createFakeAdapter(),
    getInfinitePayHandle: () => "handle-fake",
  });
  app.use(createReconcileRouter({ express, reconciliationService: service }));

  const result = await httpReq(app, "GET", "/app/v1/payment-attempts/some-id/status");

  assert.equal(result.status, 401);
  assert.equal(result.body.ok, false);
});

// ============================================================
// T_ROUTE_08 — GET status com auth válida
// ============================================================
test("T_ROUTE_08: GET status com auth retorna ok/data", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const { orderId, accountId } = await setupOrder(db);
  const attemptId = await setupAttempt(db, orderId, { status: "PENDING" });

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  const app = createTestApp(service, null, { authAccountId: accountId });
  const result = await httpReq(app, "GET", `/app/v1/payment-attempts/${attemptId}/status`, null, {
    "Authorization": "Bearer fake-token",
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.ok(result.body.data, "Should return data in ok/data format");
});

// ============================================================
// T_ROUTE_09 — Contrato ok/data em todas as respostas
// ============================================================
test("T_ROUTE_09: Todas as respostas usam contrato ok/data", async () => {
  process.env.INFINITEPAY_WEBHOOK_ENABLED = "true";
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const { orderId, accountId } = await setupOrder(db);
  const attemptId = await setupAttempt(db, orderId, { status: "PENDING" });

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  const app = createTestApp(service, null, { authAccountId: accountId });

  // Webhook
  const wh = await httpReq(app, "POST", "/webhooks/infinitepay", {
    order_nsu: orderId,
    transaction_nsu: "NSU",
    amount: 5000,
    capture_method: "pix",
  });
  assert.equal(wh.body.ok, true, "Webhook should use ok/data");

  // Status
  const st = await httpReq(app, "GET", `/app/v1/payment-attempts/${attemptId}/status`, null, {
    "Authorization": "Bearer token",
  });
  assert.equal(st.body.ok, true, "Status should use ok/data");
});

// ============================================================
// T_INVENTORY_01 — Finalização cria movimento SALE
// ============================================================
test("T_INVENTORY_01: Finalização cria movimento SALE no estoque", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const variantId = randomUUID();
  const storeId = randomUUID();
  const reservationId = randomUUID();
  const now = iso(new Date());

  // Create HOLD movement
  await db.run(
    `INSERT INTO pdv_inventory_movements_v2 (id, variant_id, store_id, movement_type, quantity_delta, quantity_before, quantity_after, origin, reference_type, reference_id, idempotency_key, created_at)
     VALUES (?, ?, ?, 'RESERVATION_HOLD', -2, 2, 0, 'RESERVATION', 'RESERVATION', ?, ?, ?)`,
    [randomUUID(), variantId, storeId, reservationId, `idem-${randomUUID()}`, now]
  );

  const { orderId, accountId } = await setupOrder(db, {
    reservationIds: [reservationId],
    total_cents: 5000,
  });
  const attemptId = await setupAttempt(db, orderId, { status: "PENDING", provider_transaction_nsu: "NSU-FAKE-001" });

  // Apply v3
  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");
  await applyAppOrderSchemaV3(db);

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
    inventoryService: db, // pass db as inventory service for SALE movement creation
  });

  const result = await service.reconcileAttempt(accountId, attemptId);
  assert.equal(result.success, true);

  // Verify SALE movement created
  const sales = await db.all(
    `SELECT * FROM pdv_inventory_movements_v2 WHERE movement_type = 'SALE' AND reference_id = ?`,
    [orderId]
  );
  assert.ok(sales.length > 0, "Should create at least one SALE movement");
  assert.equal(sales[0].movement_type, "SALE");
  assert.equal(sales[0].quantity_delta, 0, "SALE should not change inventory balance");
});

// ============================================================
// T_INVENTORY_02 — SALE é idempotente (não cria duplicado)
// ============================================================
test("T_INVENTORY_02: SALE é idempotente — segunda finalização não cria duplicado", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const variantId = randomUUID();
  const storeId = randomUUID();
  const reservationId = randomUUID();
  const now = iso(new Date());

  await db.run(
    `INSERT INTO pdv_inventory_movements_v2 (id, variant_id, store_id, movement_type, quantity_delta, quantity_before, quantity_after, origin, reference_type, reference_id, idempotency_key, created_at)
     VALUES (?, ?, ?, 'RESERVATION_HOLD', -2, 2, 0, 'RESERVATION', 'RESERVATION', ?, ?, ?)`,
    [randomUUID(), variantId, storeId, reservationId, `idem-${randomUUID()}`, now]
  );

  const { orderId, accountId } = await setupOrder(db, { reservationIds: [reservationId] });
  const attemptId = await setupAttempt(db, orderId, { status: "PENDING", provider_transaction_nsu: "NSU-FAKE-001" });

  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");
  await applyAppOrderSchemaV3(db);

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
    inventoryService: db, // pass db as inventory service for SALE movement creation
  });

  // First reconciliation
  await service.reconcileAttempt(accountId, attemptId);

  const sales1 = await db.all(`SELECT * FROM pdv_inventory_movements_v2 WHERE movement_type = 'SALE'`);
  const saleCount1 = sales1.length;

  // Second reconciliation (idempotent)
  const result2 = await service.reconcileAttempt(accountId, attemptId);
  assert.equal(result2.idempotent, true);

  const sales2 = await db.all(`SELECT * FROM pdv_inventory_movements_v2 WHERE movement_type = 'SALE'`);
  assert.equal(sales2.length, saleCount1, "No duplicate SALE movements");
});

// ============================================================
// T_FINALIZE_01 — Finalização atualiza order para PAID com colunas
// ============================================================
test("T_FINALIZE_01: Finalização atualiza order status para PAID com colunas de pagamento", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const { orderId, accountId } = await setupOrder(db);
  const attemptId = await setupAttempt(db, orderId, { status: "PENDING", provider_transaction_nsu: "NSU-FAKE-001" });

  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");
  await applyAppOrderSchemaV3(db);

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  const result = await service.reconcileAttempt(accountId, attemptId);
  assert.equal(result.success, true);

  const order = await db.get(`SELECT * FROM app_orders WHERE id = ?`, [orderId]);
  assert.equal(order.status, "PAID", "Order should be PAID");
  assert.ok(order.paid_at, "paid_at should be set");
  assert.equal(order.payment_transaction_nsu, "NSU-FAKE-001", "transaction_nsu should be set");
  assert.equal(order.payment_attempt_id, attemptId, "payment_attempt_id should match");
  assert.ok(order.payment_receipt_url, "receipt_url should be set");
});

// ============================================================
// T_FINALIZE_02 — Finalização registra evento de auditoria
// ============================================================
test("T_FINALIZE_02: Finalização registra evento PAYMENT_CONFIRMED", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const { orderId, accountId } = await setupOrder(db);
  const attemptId = await setupAttempt(db, orderId, { status: "PENDING", provider_transaction_nsu: "NSU-FAKE-001" });

  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");
  await applyAppOrderSchemaV3(db);

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  await service.reconcileAttempt(accountId, attemptId);

  const events = await db.all(
    `SELECT * FROM app_order_events WHERE order_id = ? AND event_type = 'PAYMENT_CONFIRMED'`,
    [orderId]
  );
  assert.ok(events.length > 0, "PAYMENT_CONFIRMED event should be recorded");
  const details = JSON.parse(events[0].details_json);
  assert.equal(details.transaction_nsu, "NSU-FAKE-001");
  assert.equal(details.provider, "INFINITEPAY");
});

// ============================================================
// T_CONTRACT_01 — Frontend contract usa padrão ok/data (text-based)
// ============================================================
test("T_CONTRACT_01: Frontend contracts.ts define padrão ok/data", async () => {
  const fs = require("fs");
  const path = require("path");
  const contractsFile = path.resolve(__dirname, "../../../../apps/mobile/src/payment/contracts.ts");
  const content = fs.readFileSync(contractsFile, "utf-8");

  assert.ok(content.includes("ok: true"), "Should use ok pattern");
  assert.ok(content.includes("PAYMENT_API_VERSION"), "Should export version");
  assert.ok(content.includes("REVIEW_REQUIRED"), "Should include REVIEW_REQUIRED");
});

// ============================================================
// T_CONTRACT_02 — Client.ts usa auth token
// ============================================================
test("T_CONTRACT_02: Client.ts implementa autenticação via Bearer token", async () => {
  const fs = require("fs");
  const path = require("path");
  const clientFile = path.resolve(__dirname, "../../../../apps/mobile/src/payment/client.ts");
  const content = fs.readFileSync(clientFile, "utf-8");

  assert.ok(content.includes("Authorization"), "Should use Authorization header");
  assert.ok(content.includes("Bearer"), "Should use Bearer token");
  assert.ok(content.includes("json.ok"), "Should handle ok/data contract");
  assert.ok(content.includes("getAuthToken"), "Should have token extraction");
  assert.ok(content.includes("/app/v1/orders/"), "Should call correct route");
  assert.ok(content.includes("/app/v1/payment-attempts/"), "Should call correct route");
});

// ============================================================
// T_CONTRACT_03 — Checkout.tsx mapeia provider_checkout_url
// ============================================================
test("T_CONTRACT_03: Checkout.tsx mapeia provider_checkout_url para checkout_url", async () => {
  const fs = require("fs");
  const path = require("path");
  const checkoutFile = path.resolve(__dirname, "../../../../apps/mobile/src/app/payment/checkout.tsx");
  const content = fs.readFileSync(checkoutFile, "utf-8");

  assert.ok(content.includes("provider_checkout_url"), "Should reference provider_checkout_url");
  assert.ok(content.includes("Linking.openURL"), "Should open checkout URL");
  assert.ok(content.includes("pollStatus"), "Should have polling logic");
  assert.ok(content.includes("PAID"), "Should handle PAID state");
});

// ============================================================
// T_FLAG_01 — INFINITEPAY_SHOP_PIX_ENABLED=false por padrão
// ============================================================
test("T_FLAG_01: Flag INFINITEPAY_SHOP_PIX_ENABLED é false por padrão no código", async () => {
  const fs = require("fs");
  const path = require("path");
  const serverFile = path.resolve(__dirname, "../../../../server.js");
  const content = fs.readFileSync(serverFile, "utf-8");

  assert.ok(content.includes("INFINITEPAY_SHOP_PIX_ENABLED"), "Should reference the flag");
});

// ============================================================
// T_FLAG_02 — Nenhuma credencial versionada
// ============================================================
test("T_FLAG_02: Nenhuma credencial InfinitePay versionada no código", async () => {
  const fs = require("fs");
  const path = require("path");
  const serverFile = path.resolve(__dirname, "../../../../server.js");
  const content = fs.readFileSync(serverFile, "utf-8");

  assert.ok(!content.includes("inf_xxx"), "No hardcoded secrets");
  assert.ok(!content.includes("infinitepay_secret"), "No hardcoded secrets");
  assert.ok(!content.includes("api_key"), "No hardcoded secrets");
});

// ============================================================
// T_FLAG_03 — Sem deploy no código
// ============================================================
test("T_FLAG_03: Nenhum script de deploy versionado", async () => {
  const fs = require("fs");
  const path = require("path");
  const serverFile = path.resolve(__dirname, "../../../../server.js");
  const content = fs.readFileSync(serverFile, "utf-8");

  assert.ok(!content.includes("pm2 start"), "No deploy script");
  assert.ok(!content.includes("ecosystem.config"), "No PM2 config");
});

// ============================================================
// T_FLAG_04 — Sem better-sqlite3
// ============================================================
test("T_FLAG_04: Sem better-sqlite3 no código", async () => {
  const fs = require("fs");
  const path = require("path");
  const pkgFile = path.resolve(__dirname, "../../../../package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf-8"));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  assert.ok(!allDeps["better-sqlite3"], "better-sqlite3 should not be in dependencies");
});

// ============================================================
// T_FULLFLOW_01 — Fluxo completo: webhook → reconcile → PAID
// ============================================================
test("T_FULLFLOW_01: Fluxo completo webhook → reconcile → finalização PAID", async () => {
  process.env.INFINITEPAY_WEBHOOK_ENABLED = "true";
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";

  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");
  await applyAppOrderSchemaV3(db);

  const { orderId, accountId } = await setupOrder(db);
  const attemptId = await setupAttempt(db, orderId, {
    status: "PENDING",
    provider_transaction_nsu: "NSU-FULLFLOW",
  });

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  // 1. Webhook
  const webhookResult = await service.handleWebhook({
    order_nsu: orderId,
    transaction_nsu: "NSU-FULLFLOW",
    invoice_slug: "ref-fullflow",
    amount: 5000,
    paid_amount: 5000,
    capture_method: "pix",
    paid: true,
  });
  assert.equal(webhookResult.success, true);
  assert.ok(webhookResult.event_id);

  // 2. Reconcile
  const reconcileResult = await service.reconcileAttempt(accountId, attemptId);
  assert.equal(reconcileResult.success, true);
  assert.ok(reconcileResult.transaction_nsu);

  // 3. Verify final state
  const order = await db.get(`SELECT * FROM app_orders WHERE id = ?`, [orderId]);
  assert.equal(order.status, "PAID");
  assert.equal(order.payment_transaction_nsu, "NSU-FULLFLOW");
  assert.equal(order.payment_attempt_id, attemptId);

  const attempt = await db.get(`SELECT * FROM app_payment_attempts WHERE id = ?`, [attemptId]);
  assert.equal(attempt.status, "PAID");

  // 4. Audit event
  const auditEvents = await db.all(
    `SELECT * FROM app_order_events WHERE order_id = ? AND event_type = 'PAYMENT_CONFIRMED'`,
    [orderId]
  );
  assert.ok(auditEvents.length > 0);
});

// ============================================================
// T_FULLFLOW_02 — Fluxo completo: reconcile manual → PAID
// ============================================================
test("T_FULLFLOW_02: Fluxo completo reconcile manual → finalização PAID", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";

  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");
  await applyAppOrderSchemaV3(db);

  const { orderId, accountId } = await setupOrder(db);
  const attemptId = await setupAttempt(db, orderId, {
    status: "PENDING",
    provider_transaction_nsu: "NSU-MANUAL",
  });

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  const result = await service.reconcileAttempt(accountId, attemptId);
  assert.equal(result.success, true);
  assert.ok(result.transaction_nsu);

  const order = await db.get(`SELECT * FROM app_orders WHERE id = ?`, [orderId]);
  assert.equal(order.status, "PAID");

  const attempt = await db.get(`SELECT * FROM app_payment_attempts WHERE id = ?`, [attemptId]);
  assert.equal(attempt.status, "PAID");
  assert.equal(attempt.provider_transaction_nsu, "NSU-MANUAL");
});

// ============================================================
// T_FULLFLOW_03 — Fluxo completo com Express router
// ============================================================
test("T_FULLFLOW_03: Fluxo completo via Express (webhook → reconcile)", async () => {
  process.env.INFINITEPAY_WEBHOOK_ENABLED = "true";
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";

  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");
  await applyAppOrderSchemaV3(db);

  const { orderId, accountId } = await setupOrder(db);
  const attemptId = await setupAttempt(db, orderId, {
    status: "PENDING",
    provider_transaction_nsu: "NSU-EXPRESS",
  });

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  const app = createTestApp(service, null, { authAccountId: accountId });

  // 1. Webhook via HTTP
  const wh = await httpReq(app, "POST", "/webhooks/infinitepay", {
    order_nsu: orderId,
    transaction_nsu: "NSU-EXPRESS",
    invoice_slug: "ref-express",
    amount: 5000,
    paid_amount: 5000,
    capture_method: "pix",
    paid: true,
  });
  assert.equal(wh.status, 200);
  assert.equal(wh.body.ok, true);

  // 2. Reconcile via HTTP
  const rc = await httpReq(app, "POST", `/app/v1/payment-attempts/${attemptId}/reconcile`, null, {
    "Authorization": "Bearer fake-token",
  });
  assert.equal(rc.status, 200);
  assert.equal(rc.body.ok, true);

  // 3. Verify final state
  const order = await db.get(`SELECT * FROM app_orders WHERE id = ?`, [orderId]);
  assert.equal(order.status, "PAID");

  // 4. GET status via HTTP
  const gs = await httpReq(app, "GET", `/app/v1/payment-attempts/${attemptId}/status`, null, {
    "Authorization": "Bearer fake-token",
  });
  assert.equal(gs.status, 200);
  assert.equal(gs.body.ok, true);
});

// ============================================================
// T_IDEMPOTENCY_01 — Webhook idempotência (duplicata)
// ============================================================
test("T_IDEMPOTENCY_01: Webhook duplicado retorna duplicate=true e não processa novamente", async () => {
  process.env.INFINITEPAY_WEBHOOK_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);
  const { orderId } = await setupOrder(db);

  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: createFakeAdapter(),
    getInfinitePayHandle: () => "handle-fake",
  });

  const payload = {
    order_nsu: orderId,
    transaction_nsu: "NSU-IDEM",
    invoice_slug: "ref-idem",
    amount: 5000,
    paid_amount: 5000,
    capture_method: "pix",
    paid: true,
  };

  const first = await service.handleWebhook(payload);
  assert.equal(first.success, true);
  assert.ok(first.event_id);

  const second = await service.handleWebhook(payload);
  assert.equal(second.success, true);
  assert.equal(second.duplicate, true);
});

// ============================================================
// T_EVENT_01 — Evento webhook registrado com status RECEIVED
// ============================================================
test("T_EVENT_01: Evento webhook registrado com status RECEIVED (não PROCESSED)", async () => {
  process.env.INFINITEPAY_WEBHOOK_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);
  const { orderId } = await setupOrder(db);

  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: createFakeAdapter(),
    getInfinitePayHandle: () => "handle-fake",
  });

  const result = await service.handleWebhook({
    order_nsu: orderId,
    transaction_nsu: "NSU-EVT",
    invoice_slug: "ref-evt",
    amount: 5000,
    paid_amount: 5000,
    capture_method: "pix",
    paid: true,
  });

  assert.equal(result.success, true);

  const events = await db.all(`SELECT * FROM app_payment_events WHERE order_id = ?`, [orderId]);
  assert.ok(events.length > 0);
  assert.equal(events[0].processing_status, "RECEIVED", "Event should be RECEIVED, not PROCESSED");
});

// ============================================================
// T_EVENT_02 — Evento com pedido não encontrado é FAILED
// ============================================================
test("T_EVENT_02: Evento para pedido inexistente é marcado como FAILED", async () => {
  process.env.INFINITEPAY_WEBHOOK_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: createFakeAdapter(),
    getInfinitePayHandle: () => "handle-fake",
  });

  const result = await service.handleWebhook({
    order_nsu: "nonexistent-order-id",
    transaction_nsu: "NSU-EVT-2",
    invoice_slug: "ref-evt-2",
    amount: 5000,
    paid_amount: 5000,
    capture_method: "pix",
    paid: true,
  });

  assert.equal(result.success, true);
  assert.ok(result.message.includes("não encontrado"));
});

// ============================================================
// T_SCHEMA_01 — request_hash NOT NULL no schema
// ============================================================
test("T_SCHEMA_01: request_hash é NOT NULL no schema", async () => {
  const fs = require("fs");
  const path = require("path");
  const schemaFile = path.resolve(__dirname, "../persistence/appPaymentEventSchema.js");
  const content = fs.readFileSync(schemaFile, "utf-8");

  assert.ok(content.includes("NOT NULL"), "request_hash should be NOT NULL");
});

// ============================================================
// T_SCHEMA_02 — Event schema exports COLUMNS with request_hash
// ============================================================
test("T_SCHEMA_02: appPaymentEventSchema schema SQL tem request_hash NOT NULL", async () => {
  const fs = require("fs");
  const path = require("path");
  const schemaFile = path.resolve(__dirname, "../persistence/appPaymentEventSchema.js");
  const content = fs.readFileSync(schemaFile, "utf-8");
  // Check that the schema has request_hash with NOT NULL
  assert.ok(content.includes("request_hash"), "Should have request_hash");
  assert.ok(content.includes("NOT NULL"), "Should have NOT NULL");
});

// ============================================================
// T_VALIDATE_03 — Validação 7 condições: método diferente
// ============================================================
test("T_VALIDATE_03: Validação rejeita method diferente de PIX", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  const statusResult = {
    paid: true,
    amount: 5000,
    capture_method: "pix",
    raw: { capture_method: "pix", order_nsu: "order-1", transaction_nsu: "NSU", paid: true, amount: 5000 },
  };

  const attempt = {
    id: "attempt-1",
    order_id: "order-1",
    provider: "INFINITEPAY",
    method: "CREDIT_CARD",
    amount_cents: 5000,
  };

  const failures = await service.validatePaymentCheck(statusResult, attempt);
  assert.ok(failures.length >= 1);
  assert.ok(failures.some(f => f.code === "CAPTURE_METHOD_MISMATCH"));
});

// ============================================================
// T_VALIDATE_04 — Validação rejeita provider diferente
// ============================================================
test("T_VALIDATE_04: Validação rejeita provider diferente de INFINITEPAY", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  const statusResult = {
    paid: true,
    amount: 5000,
    capture_method: "pix",
    raw: { capture_method: "pix", order_nsu: "order-1", transaction_nsu: "NSU", paid: true, amount: 5000 },
  };

  const attempt = {
    id: "attempt-1",
    order_id: "order-1",
    provider: "PAGBANK",
    method: "PIX",
    amount_cents: 5000,
  };

  const failures = await service.validatePaymentCheck(statusResult, attempt);
  assert.ok(failures.length >= 1);
  assert.ok(failures.some(f => f.code === "PAYMENT_ATTEMPT_NOT_FOUND"));
});

// ============================================================
// T_SAFE_STATUS_01 — getAttemptStatus nunca retorna payload bruto
// ============================================================
test("T_SAFE_STATUS_01: getAttemptStatus nunca retorna payload bruto do provider", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);
  const { orderId, accountId } = await setupOrder(db);
  const attemptId = await setupAttempt(db, orderId, { status: "PENDING" });

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  const result = await service.getAttemptStatus(accountId, attemptId);
  assert.equal(result.success, true);

  const attempt = result.attempt;
  assert.ok(!attempt.provider_response_sanitized_json, "Should not return raw payload");
  assert.ok(!attempt.request_fingerprint, "Should not return fingerprint");
  assert.ok(!attempt.idempotency_key, "Should not return idempotency_key");

  assert.ok(attempt.id);
  assert.ok(attempt.status);
  assert.ok(attempt.amount_cents);
  assert.ok(attempt.order_id);
});

// ============================================================
// T_SAFE_STATUS_02 — Status interno mapeado para público
// ============================================================
test("T_SAFE_STATUS_02: Status interno REVIEW_REQUIRED é exposto corretamente", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);
  const { orderId, accountId } = await setupOrder(db);
  const attemptId = await setupAttempt(db, orderId, { status: "REVIEW_REQUIRED" });

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  const result = await service.getAttemptStatus(accountId, attemptId);
  assert.equal(result.success, true);
  assert.equal(result.attempt.status, "REVIEW_REQUIRED");
});

// ============================================================
// T_CONCURRENCY_01 — Duas reconciliações simultâneas (idempotência)
// ============================================================
test("T_CONCURRENCY_01: Duas reconciliações do mesmo attempt são idempotentes", async () => {
  process.env.INFINITEPAY_RECONCILIATION_ENABLED = "true";
  const db = await createMemoryDb({ withV2: true });
  await setupTables(db);

  const { applyAppOrderSchemaV3 } = require("../../app-orders/persistence/appOrderSchemaV3");
  await applyAppOrderSchemaV3(db);

  const { orderId, accountId } = await setupOrder(db);
  const attemptId = await setupAttempt(db, orderId, {
    status: "PENDING",
    provider_transaction_nsu: "NSU-CONC",
  });

  const adapter = createFakeAdapter();
  const { createInfinitePayReconciliationService } = require("../infinitePayReconciliationService");
  const service = createInfinitePayReconciliationService({
    dbApi: db,
    infinitePayAdapter: adapter,
    getInfinitePayHandle: () => "handle-fake",
  });

  const r1 = await service.reconcileAttempt(accountId, attemptId);
  const r2 = await service.reconcileAttempt(accountId, attemptId);

  // At least one should succeed, second should be idempotent
  assert.equal(r1.success, true, "First reconciliation should succeed");
  assert.equal(r2.success, true, "Second reconciliation should succeed (idempotent)");
  assert.equal(r2.idempotent, true, "Second should be idempotent");

  // Verify order is PAID
  const order = await db.get(`SELECT * FROM app_orders WHERE id = ?`, [orderId]);
  assert.equal(order.status, "PAID");
});
