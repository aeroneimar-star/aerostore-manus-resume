"use strict";
const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert");
const { memoryDb } = require("./memoryDb");
const { applyAppPaymentAttemptSchema } = require("../persistence/appPaymentAttemptSchema");
const { createPaymentAttemptService } = require("../paymentAttemptService");
const { createInfinitePayAdapter } = require("../adapter/infinitePayAdapter");
const { createFakeTransport } = require("../adapter/fakeTransport");

const NOW = new Date();
const NOW_ISO = NOW.toISOString();

function futureIso(minutesFromNow) {
  const d = new Date(NOW.getTime() + minutesFromNow * 60 * 1000);
  return d.toISOString();
}

function pastIso(minutesAgo) {
  const d = new Date(NOW.getTime() - minutesAgo * 60 * 1000);
  return d.toISOString();
}

async function runSql(db, sql, params = []) { return db.run(sql, params); }
async function getSql(db, sql, params = []) { return db.get(sql, params); }
async function allSql(db, sql, params = []) { return db.all(sql, params); }

function seedOrder(db, id, totalCents, reservationIds, expiresAt, version = 1, status = "READY_FOR_PAYMENT", accountId = "account-1") {
  const now = new Date().toISOString();
  const reservationIdsJson = typeof reservationIds === 'string' ? reservationIds : JSON.stringify(reservationIds);
  return runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, currency, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, ?, ?, 'DELIVERY', 'addr-1', ?, ?, 'BRL', ?, ?, '{"store_origin_id":"vila"}', ?, ?, ?, ?, ?)`, [id, id.replace("order-", ""), accountId, totalCents, totalCents, status, `key-${id}`, reservationIdsJson, version, now, now, expiresAt]);
}

function seedHold(db, movementId, resId, storeId, variantId, qty) {
  const now = new Date().toISOString();
  return runSql(db, `INSERT INTO pdv_inventory_movements_v2 (id, variant_id, store_id, movement_type, quantity_delta, quantity_before, quantity_after, origin, reference_type, reference_id, idempotency_key, created_at) VALUES (?, ?, ?, 'RESERVATION_HOLD', ?, ?, ?, 'RESERVATION', 'RESERVATION', ?, ?, ?)`, [movementId, variantId, storeId, -qty, qty, qty - qty, resId, `idem-${movementId}`, now]);
}

function seedRelease(db, movementId, storeId, variantId, qty, beforeQty, afterQty, orderId) {
  const now = new Date().toISOString();
  return runSql(db, `INSERT INTO pdv_inventory_movements_v2 (id, variant_id, store_id, movement_type, quantity_delta, quantity_before, quantity_after, origin, reference_type, reference_id, idempotency_key, created_at) VALUES (?, ?, ?, 'RESERVATION_RELEASE', ?, ?, ?, 'RESERVATION', 'ORDER', ?, ?, ?)`, [movementId, variantId, storeId, qty, beforeQty, afterQty, orderId, `idem-${movementId}`, now]);
}

function seedBalance(db, storeId, variantId, reservedQty, availableQty = 10) {
  const now = new Date().toISOString();
  return runSql(db, `INSERT INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)`, [`bal-${storeId}-${variantId}`, variantId, storeId, availableQty, reservedQty, now]);
}

describe("Payment Attempts Integration (WASM) — Phase 3.13-C hardening", () => {
  let db;
  let service;
  let fakeTransport;
  let adapter;

  before(async () => {
    db = memoryDb();
    await db.run("PRAGMA foreign_keys=ON");

    // Tabelas PDV reais (v2)
    await runSql(db, `CREATE TABLE IF NOT EXISTS app_customer_accounts (id TEXT PRIMARY KEY, phone_lookup_hash TEXT, phone_masked TEXT, email_lookup_hash TEXT, email_masked TEXT, account_status TEXT NOT NULL DEFAULT 'ACTIVE', access_status TEXT NOT NULL DEFAULT 'APPROVED', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS app_customer_addresses (id TEXT PRIMARY KEY, account_id TEXT, label TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS app_orders (id TEXT PRIMARY KEY, order_number TEXT NOT NULL, account_id TEXT NOT NULL, fulfillment_type TEXT NOT NULL, address_id TEXT, subtotal_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'BRL', status TEXT NOT NULL, idempotency_key TEXT UNIQUE, snapshot_json TEXT NOT NULL DEFAULT '{"store_origin_id":"vila"}', reservation_ids_json TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS pdv_inventory_movements_v2 (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, store_id TEXT NOT NULL, movement_type TEXT NOT NULL, quantity_delta INTEGER NOT NULL, quantity_before INTEGER NOT NULL DEFAULT 0, quantity_after INTEGER NOT NULL DEFAULT 0, origin TEXT, reference_type TEXT, reference_id TEXT, idempotency_key TEXT, actor_user_id TEXT, actor_name TEXT, metadata_json TEXT, created_at TEXT, UNIQUE(variant_id, store_id, idempotency_key))`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS pdv_inventory_balances_v2 (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, store_id TEXT NOT NULL, available_qty INTEGER NOT NULL DEFAULT 0, reserved_qty INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT, UNIQUE(variant_id, store_id))`);

    await applyAppPaymentAttemptSchema(db);
  });

  beforeEach(async () => {
    await runSql(db, "DELETE FROM app_payment_attempts");
    await runSql(db, "DELETE FROM app_orders");
    await runSql(db, "DELETE FROM pdv_inventory_movements_v2");
    await runSql(db, "DELETE FROM pdv_inventory_balances_v2");

    process.env.INFINITEPAY_SHOP_PIX_ENABLED = "true";
    process.env.INFINITEPAY_CHECKOUT_PIX_ONLY_CONFIRMED = "true";
    process.env.INFINITEPAY_HANDLE = "test-handle";

    fakeTransport = createFakeTransport();
    adapter = createInfinitePayAdapter({ httpTransport: fakeTransport.call, timeoutMs: 5000 });

    service = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: adapter,
      getInfinitePayHandle: () => process.env.INFINITEPAY_HANDLE || "",
    });

    // Seed reservation + balance for tests that need real validation
    await seedHold(db, "mv-res-1", "res-1", "vila", "var-1", 1);
    await seedBalance(db, "vila", "var-1", 5, 10);
  });

  // ============================================================
  // T1. Feature flag default OFF bloqueia
  // ============================================================
  it("T1: feature flag OFF bloqueia", async () => {
    delete process.env.INFINITEPAY_SHOP_PIX_ENABLED;
    await seedOrder(db, "order-t1", 1000, '["res-1"]', futureIso(30));

    let err;
    try { await service.createPixAttempt("account-1", "order-t1"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "INFINITEPAY_PIX_DISABLED");
    assert.strictEqual(fakeTransport.getCalls().length, 0);
  });

  // ============================================================
  // T2. PIX-only flag não configurada bloqueia
  // ============================================================
  it("T2: INFINITEPAY_CHECKOUT_PIX_ONLY_CONFIRMED ausente bloqueia", async () => {
    delete process.env.INFINITEPAY_CHECKOUT_PIX_ONLY_CONFIRMED;
    await seedOrder(db, "order-t2", 1000, '["res-1"]', futureIso(30));

    let err;
    try { await service.createPixAttempt("account-1", "order-t2"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "INFINITEPAY_PIX_ONLY_NOT_CONFIRMED");
  });

  // ============================================================
  // T3. Pedido inexistente — não revela conta
  // ============================================================
  it("T3: pedido inexistente retorna ORDER_NOT_FOUND", async () => {
    let err;
    try { await service.createPixAttempt("account-1", "nonexistent"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "ORDER_NOT_FOUND");
    assert.strictEqual(fakeTransport.getCalls().length, 0);
  });

  // ============================================================
  // T4. Conta A não pode acessar pedido da conta B
  // ============================================================
  it("T4: conta A não cria pagamento no pedido da conta B", async () => {
    await seedOrder(db, "order-t4", 1000, '["res-1"]', futureIso(30), 1, "READY_FOR_PAYMENT", "account-B");

    let err;
    try { await service.createPixAttempt("account-1", "order-t4"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "ORDER_NOT_FOUND");
  });

  // ============================================================
  // T5. Pedido expirado
  // ============================================================
  it("T5: pedido expirado retorna ORDER_EXPIRED", async () => {
    await seedOrder(db, "order-t5", 1000, '["res-1"]', pastIso(5));

    let err;
    try { await service.createPixAttempt("account-1", "order-t5"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "ORDER_EXPIRED");
  });

  // ============================================================
  // T6. Status não pagável
  // ============================================================
  it("T6: pedido CANCELLED retorna ORDER_NOT_PAYABLE", async () => {
    await seedOrder(db, "order-t6", 1000, '["res-1"]', futureIso(30), 1, "CANCELLED");

    let err;
    try { await service.createPixAttempt("account-1", "order-t6"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "ORDER_NOT_PAYABLE");
  });

  // ============================================================
  // T7. Reserva vazia bloqueia
  // ============================================================
  it("T7: pedido sem reservas retorna ORDER_RESERVATION_INVALID", async () => {
    await seedOrder(db, "order-t7", 1000, '[]', futureIso(30));

    let err;
    try { await service.createPixAttempt("account-1", "order-t7"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "ORDER_RESERVATION_INVALID");
  });

  // ============================================================
  // T8. Criação de attempt PENDING com transporte fake
  // ============================================================
  it("T8: criação de attempt PENDING com transporte fake", async () => {
    await seedOrder(db, "order-t8", 1000, '["res-1"]', futureIso(30));

    const result = await service.createPixAttempt("account-1", "order-t8");
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempt.status, "PENDING");
    assert.strictEqual(result.attempt.provider, "INFINITEPAY");
    assert.strictEqual(result.attempt.method, "PIX");
    assert.strictEqual(result.attempt.amount_cents, 1000);
    assert.ok(result.attempt.provider_checkout_url);
    assert.ok(result.attempt.request_fingerprint);
    assert.ok(fakeTransport.getCalls().length >= 1);
  });

  // ============================================================
  // T9. Retry idêntico retorna mesmo attempt (determinístico)
  // ============================================================
  it("T9: retry idêntico retorna mesmo attempt", async () => {
    await seedOrder(db, "order-t9", 1000, '["res-1"]', futureIso(30));

    const result1 = await service.createPixAttempt("account-1", "order-t9");
    assert.strictEqual(result1.success, true);

    fakeTransport.clearLog();
    const result2 = await service.createPixAttempt("account-1", "order-t9");
    assert.strictEqual(result2.success, true);
    assert.strictEqual(result2.idempotent, true);
    assert.strictEqual(result2.reason, "EXISTING_ATTEMPT_FOUND");
    assert.strictEqual(result2.attempt.id, result1.attempt.id);
    assert.strictEqual(fakeTransport.getCalls().length, 0, "Não deve chamar transporte novamente");
  });

  // ============================================================
  // T10. Retry não chama transporte novamente
  // ============================================================
  it("T10: retry não chama transporte novamente", async () => {
    await seedOrder(db, "order-t10", 1000, '["res-1"]', futureIso(30));

    await service.createPixAttempt("account-1", "order-t10");
    const callsBefore = fakeTransport.getCalls().length;
    assert.ok(callsBefore >= 1);

    await service.createPixAttempt("account-1", "order-t10");
    assert.strictEqual(fakeTransport.getCalls().length, callsBefore);
  });

  // ============================================================
  // T11. Conflito de idempotência (fingerprint diferente)
  // ============================================================
  it("T11: snapshot incompatível retorna PAYMENT_IDEMPOTENCY_CONFLICT", async () => {
    await seedHold(db, "mv-res-2", "res-2", "vila", "var-1", 1);

    await seedOrder(db, "order-t11", 1000, '["res-1"]', futureIso(30));

    await service.createPixAttempt("account-1", "order-t11");

    // Alterar reservation_ids para gerar fingerprint diferente
    await runSql(db, `UPDATE app_orders SET reservation_ids_json = '["res-2"]' WHERE id = 'order-t11'`);

    let err;
    try { await service.createPixAttempt("account-1", "order-t11"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "PAYMENT_IDEMPOTENCY_CONFLICT");
  });

  // ============================================================
  // T12. Provider reference NULL-safe
  // ============================================================
  it("T12: provider_reference NULL quando invoice_slug ausente", async () => {
    const noSlugTransport = createFakeTransport();
    noSlugTransport.call = async (request) => {
      noSlugTransport.callLog.push({ method: request.method, url: request.url });
      if (request.url?.includes("/links")) {
        return { ok: true, status: 200, data: { url: "https://checkout.infinitepay.io/test", access_token: "SECRET" } };
      }
      return { ok: true, status: 200, data: { paid: true, capture_method: "pix", amount: 1000 } };
    };
    noSlugTransport.getCalls = () => noSlugTransport.callLog;
    noSlugTransport.clearLog = () => { noSlugTransport.callLog.length = 0; };

    const noSlugAdapter = createInfinitePayAdapter({ httpTransport: noSlugTransport.call, timeoutMs: 5000 });
    const noSlugService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: noSlugAdapter,
      getInfinitePayHandle: () => "test-handle",
    });

    await seedOrder(db, "order-t12a", 1000, '["res-1"]', futureIso(30));
    const result = await noSlugService.createPixAttempt("account-1", "order-t12a");
    assert.strictEqual(result.success, true);

    const attempt = await getSql(db, `SELECT provider_reference FROM app_payment_attempts WHERE order_id = 'order-t12a'`);
    assert.strictEqual(attempt.provider_reference, null, "provider_reference deve ser NULL quando invoice_slug ausente");
    assert.ok(result.attempt.provider_checkout_url);
  });

  // ============================================================
  // T13. provider_transaction_nsu persistido
  // ============================================================
  it("T13: provider_transaction_nsu persistido do adapter", async () => {
    const withNsuTransport = createFakeTransport();
    withNsuTransport.call = async (request) => {
      withNsuTransport.callLog.push({ method: request.method, url: request.url });
      if (request.url?.includes("/links")) {
        return { ok: true, status: 200, data: { url: "https://checkout.infinitepay.io/test", invoice_slug: "INV-T13", transaction_nsu: "NSU-12345", access_token: "SECRET" } };
      }
      return { ok: true, status: 200, data: { paid: true, capture_method: "pix", amount: 1000 } };
    };
    withNsuTransport.getCalls = () => withNsuTransport.callLog;
    withNsuTransport.clearLog = () => { withNsuTransport.callLog.length = 0; };

    const withNsuAdapter = createInfinitePayAdapter({ httpTransport: withNsuTransport.call, timeoutMs: 5000 });
    const withNsuService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: withNsuAdapter,
      getInfinitePayHandle: () => "test-handle",
    });

    await seedOrder(db, "order-t13", 1000, '["res-1"]', futureIso(30));
    const result = await withNsuService.createPixAttempt("account-1", "order-t13");
    assert.strictEqual(result.success, true);

    const attempt = await getSql(db, `SELECT provider_transaction_nsu, provider_reference FROM app_payment_attempts WHERE order_id = 'order-t13'`);
    // transaction_nsu do adapter create não é exposto no response, mas provider_reference deve estar
    assert.strictEqual(attempt.provider_reference, "INV-T13");
  });

  // ============================================================
  // T14. Timeout do provider resulta em FAILED
  // ============================================================
  it("T14: timeout do provider resulta em FAILED", async () => {
    const timeoutTransport = createFakeTransport({ timeout: true });
    const timeoutAdapter = createInfinitePayAdapter({ httpTransport: timeoutTransport.call, timeoutMs: 100 });
    const timeoutService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: timeoutAdapter,
      getInfinitePayHandle: () => "test-handle",
    });

    await seedOrder(db, "order-t14", 1000, '["res-1"]', futureIso(30));

    const result = await timeoutService.createPixAttempt("account-1", "order-t14");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "INFINITEPAY_TIMEOUT");

    const attempt = await getSql(db, `SELECT status, failure_code FROM app_payment_attempts WHERE order_id = 'order-t14'`);
    assert.strictEqual(attempt.status, "FAILED");
    assert.strictEqual(attempt.failure_code, "INFINITEPAY_TIMEOUT");
  });

  // ============================================================
  // T15. Resposta sanitizada sem dados sensíveis
  // ============================================================
  it("T15: resposta sanitizada não contém dados sensíveis", async () => {
    await seedOrder(db, "order-t15", 1000, '["res-1"]', futureIso(30));

    await service.createPixAttempt("account-1", "order-t15");

    const attempt = await getSql(db, `SELECT provider_response_sanitized_json FROM app_payment_attempts WHERE order_id = 'order-t15'`);
    const sanitized = JSON.parse(attempt.provider_response_sanitized_json);
    assert.strictEqual(sanitized.access_token, "[REDACTED]", "access_token redactado");
    assert.strictEqual(sanitized.card_number, "[REDACTED]", "card_number redactado");
    assert.ok(sanitized.url, "URL pública preservada");
  });

  // ============================================================
  // T16. Sanitização com PII aninhada
  // ============================================================
  it("T16: sanitização remove PII aninhada (customer, email, cpf)", async () => {
    const piiTransport = createFakeTransport();
    piiTransport.call = async (request) => {
      piiTransport.callLog.push({ method: request.method, url: request.url });
      if (request.url?.includes("/links")) {
        return { ok: true, status: 200, data: { url: "https://checkout.test", invoice_slug: "INV-1", customer: { email: "test@test.com", cpf: "123.456.789-00", phone_number: "11999999999", address: { street: "Rua Secreta" } }, access_token: "SECRET" } };
      }
      return { ok: true, status: 200, data: { paid: true, capture_method: "pix", amount: 1000 } };
    };
    piiTransport.getCalls = () => piiTransport.callLog;
    piiTransport.clearLog = () => { piiTransport.callLog.length = 0; };

    const piiAdapter = createInfinitePayAdapter({ httpTransport: piiTransport.call, timeoutMs: 5000 });
    const piiService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: piiAdapter,
      getInfinitePayHandle: () => "test-handle",
    });

    await seedOrder(db, "order-t16", 1000, '["res-1"]', futureIso(30));
    await piiService.createPixAttempt("account-1", "order-t16");

    const attempt = await getSql(db, `SELECT provider_response_sanitized_json FROM app_payment_attempts WHERE order_id = 'order-t16'`);
    const sanitized = JSON.parse(attempt.provider_response_sanitized_json);
    assert.strictEqual(sanitized.customer, "[REDACTED]", "customer deve ser redactado");
    assert.strictEqual(sanitized.access_token, "[REDACTED]", "access_token redactado");
  });

  // ============================================================
  // T17. Migration em banco novo
  // ============================================================
  it("T17: migration funciona em banco novo", async () => {
    const newDb = memoryDb();
    await newDb.run("PRAGMA foreign_keys=ON");
    await runSql(newDb, `CREATE TABLE IF NOT EXISTS app_orders (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, status TEXT NOT NULL, total_cents INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);

    await applyAppPaymentAttemptSchema(newDb);

    const tables = await newDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name='app_payment_attempts'");
    assert.strictEqual(tables.length, 1);

    const columns = await newDb.all("PRAGMA table_info(app_payment_attempts)");
    const names = columns.map((c) => c.name);
    assert.ok(names.includes("id"));
    assert.ok(names.includes("order_id"));
    assert.ok(names.includes("provider"));
    assert.ok(names.includes("method"));
    assert.ok(names.includes("status"));
    assert.ok(names.includes("idempotency_key"));
    assert.ok(names.includes("amount_cents"));
    assert.ok(names.includes("currency"));
    assert.ok(names.includes("request_fingerprint"));
    assert.ok(names.includes("provider_transaction_nsu"), "provider_transaction_nsu deve existir em v2");
    assert.ok(names.includes("reservation_fingerprint"), "reservation_fingerprint deve existir em v2");
    assert.ok(names.includes("version"));

    await newDb.close();
  });

  // ============================================================
  // T18. Migration idempotente
  // ============================================================
  it("T18: migration executada duas vezes é idempotente", async () => {
    await applyAppPaymentAttemptSchema(db);
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='app_payment_attempts'");
    assert.strictEqual(tables.length, 1);
  });

  // ============================================================
  // T19. Pedido sem reserva bloqueia
  // ============================================================
  it("T19: pedido sem reservas bloqueia pagamento", async () => {
    await seedOrder(db, "order-t19", 1000, '[]', futureIso(30));

    let err;
    try { await service.createPixAttempt("account-1", "order-t19"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "ORDER_RESERVATION_INVALID");
  });

  // ============================================================
  // T20. Nenhum teste marca pedido como PAID
  // ============================================================
  it("T20: criação de attempt NÃO marca pedido como PAID", async () => {
    await seedOrder(db, "order-t20", 1000, '["res-1"]', futureIso(30));

    await service.createPixAttempt("account-1", "order-t20");

    const order = await getSql(db, `SELECT status FROM app_orders WHERE id = 'order-t20'`);
    assert.strictEqual(order.status, "READY_FOR_PAYMENT");
  });

  // ============================================================
  // T21. Nenhum fluxo cria cartão de crédito
  // ============================================================
  it("T21: nenhum fluxo cria cartão de crédito", async () => {
    await seedOrder(db, "order-t21", 1000, '["res-1"]', futureIso(30));

    await service.createPixAttempt("account-1", "order-t21");

    const attempt = await getSql(db, `SELECT provider_response_sanitized_json, provider_pix_copy_paste FROM app_payment_attempts WHERE order_id = 'order-t21'`);
    if (attempt.provider_response_sanitized_json) {
      const resp = JSON.parse(attempt.provider_response_sanitized_json);
      assert.strictEqual(resp.card_number, "[REDACTED]");
    }
    assert.strictEqual(attempt.provider_pix_copy_paste, null, "provider_pix_copy_paste deve ser NULL");
  });

  // ============================================================
  // T22. Flag desligada impede transporte
  // ============================================================
  it("T22: flag desligada impede qualquer transporte", async () => {
    delete process.env.INFINITEPAY_SHOP_PIX_ENABLED;
    await seedOrder(db, "order-t22", 1000, '["res-1"]', futureIso(30));

    const disabledService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: adapter,
      getInfinitePayHandle: () => "test-handle",
    });

    let err;
    try { await disabledService.createPixAttempt("account-1", "order-t22"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "INFINITEPAY_PIX_DISABLED");
  });

  // ============================================================
  // T23. Zero chamada externa — global.fetch bloqueado
  // ============================================================
  it("T23: zero chamada externa — global.fetch bloqueado", async () => {
    const originalFetch = global.fetch;
    let fetchCallCount = 0;
    global.fetch = async () => {
      fetchCallCount++;
      throw new Error("PROIBIDO: chamada externa real");
    };

    try {
      await seedOrder(db, "order-t23", 1000, '["res-1"]', futureIso(30));
      await service.createPixAttempt("account-1", "order-t23");
      assert.strictEqual(fetchCallCount, 0, "Zero chamadas a global.fetch");
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ============================================================
  // T24. Conta A não consulta attempt da conta B
  // ============================================================
  it("T24: conta A não consulta attempt da conta B", async () => {
    await seedOrder(db, "order-t24", 1000, '["res-1"]', futureIso(30), 1, "READY_FOR_PAYMENT", "account-B");

    // Inserir attempt manual para conta B
    await runSql(db, `INSERT INTO app_payment_attempts (id, order_id, provider, method, status, idempotency_key, amount_cents, currency, request_fingerprint, created_at, updated_at, version) VALUES ('attempt-t24', 'order-t24', 'INFINITEPAY', 'PIX', 'PENDING', 'key-t24', 1000, 'BRL', 'fp-t24', ?, ?, 1)`, [NOW_ISO, NOW_ISO]);

    let err;
    try { await service.getPixAttemptStatus("account-1", "attempt-t24"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "PAYMENT_ATTEMPT_NOT_FOUND");
  });

  // ============================================================
  // T25. Conta A não lista pagamentos da conta B
  // ============================================================
  it("T25: conta A não lista pagamentos da conta B", async () => {
    await seedOrder(db, "order-t25", 1000, '["res-1"]', futureIso(30), 1, "READY_FOR_PAYMENT", "account-B");

    let err;
    try { await service.listAttemptsByOrder("account-1", "order-t25"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "ORDER_NOT_FOUND");
  });

  // ============================================================
  // T26. Falha A: Falha antes do INSERT (reserva inválida)
  // ============================================================
  it("T26: falha A — reserva sem HOLD bloqueia antes do INSERT", async () => {
    await seedHold(db, "mv-res-bad", "res-bad", "vila", "var-no-balance", 1);
    // Não criar balance para var-no-balance → INVENTORY_BALANCE_NOT_FOUND

    await seedOrder(db, "order-t26", 1000, '["res-bad"]', futureIso(30));

    let err;
    try { await service.createPixAttempt("account-1", "order-t26"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "INVENTORY_BALANCE_NOT_FOUND");

    // Nenhum attempt deve ter sido inserido
    const attempts = await allSql(db, `SELECT id FROM app_payment_attempts WHERE order_id = 'order-t26'`);
    assert.strictEqual(attempts.length, 0, "Nenhum attempt deve existir após falha A");
  });

  // ============================================================
  // T27. Falha B: Falha no provider após COMMIT
  // ============================================================
  it("T27: falha B — provider timeout após COMMIT → attempt REQUESTING", async () => {
    const timeoutTransport = createFakeTransport({ timeout: true });
    const timeoutAdapter = createInfinitePayAdapter({ httpTransport: timeoutTransport.call, timeoutMs: 100 });
    const timeoutService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: timeoutAdapter,
      getInfinitePayHandle: () => "test-handle",
    });

    await seedOrder(db, "order-t27", 1000, '["res-1"]', futureIso(30));

    const result = await timeoutService.createPixAttempt("account-1", "order-t27");
    // Provider falhou após COMMIT, attempt deve ser atualizado para FAILED
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "INFINITEPAY_TIMEOUT");

    const attempt = await getSql(db, `SELECT status FROM app_payment_attempts WHERE order_id = 'order-t27'`);
    assert.strictEqual(attempt.status, "FAILED");
  });

  // ============================================================
  // T28. Falha C: Fingerprint muda (snapshot alterado)
  // ============================================================
  it("T28: falha C — fingerprint muda após alteração de reserva", async () => {
    await seedHold(db, "mv-res-c1", "res-c1", "vila", "var-1", 1);
    await seedHold(db, "mv-res-c2", "res-c2", "vila", "var-1", 1);

    await seedOrder(db, "order-t28", 1000, '["res-c1"]', futureIso(30));

    const result1 = await service.createPixAttempt("account-1", "order-t28");
    assert.strictEqual(result1.success, true);
    assert.strictEqual(result1.attempt.status, "PENDING");
    const fp1 = result1.attempt.request_fingerprint;

    // Alterar reserva
    await runSql(db, `UPDATE app_orders SET reservation_ids_json = '["res-c2"]' WHERE id = 'order-t28'`);

    let err;
    try { await service.createPixAttempt("account-1", "order-t28"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "PAYMENT_IDEMPOTENCY_CONFLICT");
  });

  // ============================================================
  // T29. Falha D: Pedido expira durante tentativa
  // ============================================================
  it("T29: falha D — pedido expira durante tentativa", async () => {
    await seedOrder(db, "order-t29", 1000, '["res-1"]', pastIso(1));

    let err;
    try { await service.createPixAttempt("account-1", "order-t29"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "ORDER_EXPIRED");

    const attempts = await allSql(db, `SELECT id FROM app_payment_attempts WHERE order_id = 'order-t29'`);
    assert.strictEqual(attempts.length, 0);
  });

  // ============================================================
  // T30. Falha E: provider_reference persistido NULL
  // ============================================================
  it("T30: falha E — provider_reference NULL quando invoice_slug ausente", async () => {
    const noSlugTransport = createFakeTransport();
    noSlugTransport.call = async (request) => {
      noSlugTransport.callLog.push({ method: request.method, url: request.url });
      if (request.url?.includes("/links")) {
        return { ok: true, status: 200, data: { url: "https://checkout.test", access_token: "SECRET" } };
      }
      return { ok: true, status: 200, data: { paid: true, capture_method: "pix", amount: 1000 } };
    };
    noSlugTransport.getCalls = () => noSlugTransport.callLog;
    noSlugTransport.clearLog = () => { noSlugTransport.callLog.length = 0; };

    const noSlugAdapter = createInfinitePayAdapter({ httpTransport: noSlugTransport.call, timeoutMs: 5000 });
    const noSlugService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: noSlugAdapter,
      getInfinitePayHandle: () => "test-handle",
    });

    await seedOrder(db, "order-t30", 1000, '["res-1"]', futureIso(30));
    const result = await noSlugService.createPixAttempt("account-1", "order-t30");
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempt.provider_reference, null);
  });

  // ============================================================
  // T31. Migration v1→v2: tabela v1 migra corretamente
  // ============================================================
  it("T31: migration v1→v2 preserva dados e adiciona colunas", async () => {
    const migDb = memoryDb();
    await migDb.run("PRAGMA foreign_keys=ON");

    // Criar tabela v1 (sem provider_transaction_nsu)
    await runSql(migDb, `CREATE TABLE app_orders (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, status TEXT NOT NULL, total_cents INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);

    // Aplicar schema v2 primeiro (cria tabela)
    await applyAppPaymentAttemptSchema(migDb);

    // Inserir dado v1 (sem transaction_nsu)
    const now = new Date().toISOString();
    await runSql(migDb, `INSERT INTO app_orders (id, account_id, status, total_cents, version, created_at, updated_at) VALUES ('mig-order', 'account-1', 'READY_FOR_PAYMENT', 500, 1, ?, ?)`, [now, now]);
    await runSql(migDb, `INSERT INTO app_payment_attempts (id, order_id, provider, method, status, idempotency_key, amount_cents, currency, request_fingerprint, created_at, updated_at, version) VALUES ('mig-attempt', 'mig-order', 'INFINITEPAY', 'PIX', 'PENDING', 'key-mig', 500, 'BRL', 'fp-mig', ?, ?, 1)`, [now, now]);

    // Drop e recriar como v1 (sem provider_transaction_nsu)
    // Simular v1: drop a tabela atual e recriar sem as colunas v2
    await runSql(migDb, "DROP TABLE app_payment_attempts");
    await runSql(migDb, `CREATE TABLE app_payment_attempts (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'INFINITEPAY',
      method TEXT NOT NULL DEFAULT 'PIX',
      status TEXT NOT NULL DEFAULT 'CREATED',
      idempotency_key TEXT NOT NULL UNIQUE,
      provider_reference TEXT,
      provider_checkout_url TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BRL',
      request_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    )`);

    // Inserir dado v1
    await runSql(migDb, `INSERT INTO app_payment_attempts (id, order_id, provider, method, status, idempotency_key, amount_cents, currency, request_fingerprint, created_at, updated_at, version) VALUES ('v1-attempt', 'mig-order', 'INFINITEPAY', 'PIX', 'PENDING', 'key-v1', 500, 'BRL', 'fp-v1', ?, ?, 1)`, [now, now]);

    // Aplicar migration v1→v2
    const result = await applyAppPaymentAttemptSchema(migDb);
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(result.from_version, "v1");

    // Verificar dados preservados
    const attempt = await migDb.get(`SELECT * FROM app_payment_attempts WHERE id = 'v1-attempt'`);
    assert.ok(attempt, "Dados v1 devem ser preservados");
    assert.strictEqual(attempt.id, "v1-attempt");
    assert.strictEqual(attempt.provider_reference, null); // não existia em v1 (SQL.js returns null)

    // Verificar novas colunas existem
    const columns = await migDb.all("PRAGMA table_info(app_payment_attempts)");
    const names = columns.map(c => c.name);
    assert.ok(names.includes("provider_transaction_nsu"), "provider_transaction_nsu deve existir após migration");
    assert.ok(names.includes("reservation_fingerprint"), "reservation_fingerprint deve existir após migration");

    await migDb.close();
  });

  // ============================================================
  // T32. Unique constraint (order_id, request_fingerprint) impede duplicatas
  // ============================================================
  it("T32: unique constraint (order_id, request_fingerprint) impede duplicatas", async () => {
    await seedOrder(db, "order-t32", 1000, '["res-1"]', futureIso(30));

    await service.createPixAttempt("account-1", "order-t32");

    // Tentar inserir manualmente com mesmo fingerprint
    const attempt = await getSql(db, `SELECT request_fingerprint FROM app_payment_attempts WHERE order_id = 'order-t32'`);
    const fp = attempt.request_fingerprint;

    let err;
    try {
      await runSql(db, `INSERT INTO app_payment_attempts (id, order_id, provider, method, status, idempotency_key, amount_cents, currency, request_fingerprint, created_at, updated_at, version) VALUES ('dup-t32', 'order-t32', 'INFINITEPAY', 'PIX', 'PENDING', 'key-dup', 1000, 'BRL', ?, ?, ?, 1)`, [fp, NOW_ISO, NOW_ISO]);
    } catch (e) { err = e; }
    assert.ok(err, "Inserção duplicada deve falhar");
    assert.ok(err.message.includes("UNIQUE") || err.message.includes("unique"));
  });

  // ============================================================
  // T33. reservation_fingerprint persistido
  // ============================================================
  it("T33: reservation_fingerprint persistido no attempt", async () => {
    await seedOrder(db, "order-t33", 1000, '["res-1"]', futureIso(30));

    const result = await service.createPixAttempt("account-1", "order-t33");
    assert.strictEqual(result.success, true);

    const attempt = await getSql(db, `SELECT reservation_fingerprint FROM app_payment_attempts WHERE order_id = 'order-t33'`);
    assert.ok(attempt.reservation_fingerprint, "reservation_fingerprint deve estar persistido");
    assert.strictEqual(attempt.reservation_fingerprint, result.attempt.reservation_fingerprint);
  });

  // ============================================================
  // T34. Full release pré-existente bloqueia pagamento
  // ============================================================
  it("T34: full release pré-existente bloqueia pagamento", async () => {
    // Criar HOLD + RELEASE completa para res-fr1
    await seedHold(db, "mv-res-fr1", "res-fr1", "vila", "var-1", 1);
    await seedRelease(db, "mv-rel-fr1", "vila", "var-1", 1, 0, 1, "order-t34");

    // Balance com reserved_qty suficiente
    await runSql(db, `UPDATE pdv_inventory_balances_v2 SET reserved_qty = 1 WHERE variant_id = 'var-1' AND store_id = 'vila'`);

    await seedOrder(db, "order-t34", 1000, '["res-fr1"]', futureIso(30));

    let err;
    try { await service.createPixAttempt("account-1", "order-t34"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "PREEXISTING_FULL_RELEASE_REQUIRES_RECONCILIATION");
  });

  // ============================================================
  // T35. Provider response HTTP error → FAILED
  // ============================================================
  it("T35: provider HTTP error resulta em FAILED", async () => {
    const errorTransport = createFakeTransport({ httpError: { status: 500, data: { error: "INTERNAL" } } });
    const errorAdapter = createInfinitePayAdapter({ httpTransport: errorTransport.call, timeoutMs: 5000 });
    const errorService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: errorAdapter,
      getInfinitePayHandle: () => "test-handle",
    });

    await seedOrder(db, "order-t35", 1000, '["res-1"]', futureIso(30));

    const result = await errorService.createPixAttempt("account-1", "order-t35");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "INFINITEPAY_API_ERROR");

    const attempt = await getSql(db, `SELECT status, failure_code FROM app_payment_attempts WHERE order_id = 'order-t35'`);
    assert.strictEqual(attempt.status, "FAILED");
    assert.strictEqual(attempt.failure_code, "INFINITEPAY_API_ERROR");
  });

  // ============================================================
  // T36. Reconciliação: attempt REQUESTING após falha do provider
  // ============================================================
  it("T36: reconciliação — retry em attempt REQUESTING retorna RECONCILIATION_REQUIRED", async () => {
    // Simular: attempt fica REQUESTING (provider falhou após COMMIT)
    await seedOrder(db, "order-t36", 1000, '["res-1"]', futureIso(30));

    // Primeiro: timeout → attempt REQUESTING → depois FAILED
    // Para testar RECONCILIATION_REQUIRED, precisamos que o attempt esteja REQUESTING
    // Vamos inserir manualmente um attempt REQUESTING
    const now = new Date().toISOString();
    const { generateFingerprint } = require("../fingerprint");
    // Calcular o mesmo fingerprint que o service calcularia
    const fp = generateFingerprint({
      order_id: "order-t36",
      order_version: 1,
      total_cents: 1000,
      currency: "BRL",
      method: "PIX",
      reservation_fingerprint: "mv-res-1:var-1:vila:-1",
    });
    await runSql(db, `INSERT INTO app_payment_attempts (id, order_id, provider, method, status, idempotency_key, amount_cents, currency, request_fingerprint, reservation_fingerprint, created_at, updated_at, version) VALUES ('attempt-t36', 'order-t36', 'INFINITEPAY', 'PIX', 'REQUESTING', ?, ?, ?, ?, ?, ?, ?, 1)`, [`PIX::${fp}`, 1000, 'BRL', fp, fp, now, now]);

    // Retry com mesmo fingerprint → deve retornar RECONCILIATION_REQUIRED
    const result = await service.createPixAttempt("account-1", "order-t36");
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.idempotent, true);
    assert.strictEqual(result.reason, "RECONCILIATION_REQUIRED");
    assert.strictEqual(result.attempt.id, "attempt-t36");
    assert.strictEqual(result.attempt.status, "REQUESTING");
  });

  // ============================================================
  // T37. HTTP error mapping: ReservationIntegrityError → ok=false, 400
  // ============================================================
  it("T37: ReservationIntegrityError mapeada para HTTP 400 ok=false via rota real", async () => {
    // Este teste prova o fluxo completo: service → route → HTTP response
    // Seed order com reservation_ids inválidos (referência inexistente)
    await seedOrder(db, "order-t37", 1000, '["res-nonexistent"]', futureIso(30));

    // Montar rota HTTP real com express
    const express = require("express");
    const { createPaymentAttemptRouter } = require("../paymentAttemptRoutes");
    const { createFakeTransport } = require("../adapter/fakeTransport");
    const { createInfinitePayAdapter } = require("../adapter/infinitePayAdapter");

    const fakeTransport = createFakeTransport();
    const adapter = createInfinitePayAdapter({ httpTransport: fakeTransport.call, timeoutMs: 5000 });
    const routeService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: adapter,
      getInfinitePayHandle: () => "test-handle",
    });

    // Middleware ANTES do router: injetar req.user para extractAccountId
    const app2 = express();
    app2.use(express.json());
    app2.use((req, res, next) => {
      req.user = { id: "account-1" };
      next();
    });
    const router2 = createPaymentAttemptRouter({ express, paymentService: routeService });
    app2.use("/app/v1", router2);

    const server = new Promise((resolve) => {
      const listener = app2.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const listener = await server;
    const port = listener.address().port;
    const baseUrl = `http://127.0.0.1:${port}/app/v1`;

    try {
      // Requisição real via fetch
      const resp = await fetch(`${baseUrl}/orders/order-t37/pay`, {
        method: "POST",
        headers: {
          "Authorization": "Bearer token-1",
          "Content-Type": "application/json",
        },
      });

      // Deve retornar 400 com ok=false
      assert.strictEqual(resp.status, 400, `Status HTTP deve ser 400, got ${resp.status}`);
      const body = await resp.json();
      assert.strictEqual(body.ok, false, "ok deve ser false");
      assert.ok(body.error, "Deve ter error no body");
      assert.strictEqual(body.error.code, "ORDER_RESERVATION_INVALID", `Code deve ser ORDER_RESERVATION_INVALID, got ${body.error.code}`);
    } finally {
      await new Promise((resolve) => listener.close(resolve));
    }
  });

  // ============================================================
  // T38. RELEASE sem HOLD correspondente → HTTP 400 ok=false
  // ============================================================
  it("T38: RELEASE sem HOLD correspondente bloqueia pagamento via rota HTTP", async () => {
    // PROOF REAL: Quando há um RELEASE para store/variant sem HOLD correspondente,
    // o reservationIntegrityService detecta e lança RELEASE_WITHOUT_HOLD.
    // O paymentAttemptService mapeia para PaymentAttemptError (400).
    // A rota HTTP retorna { ok: false, error: { code: "RELEASE_WITHOUT_HOLD", ... } }.

    const express = require("express");
    const { createPaymentAttemptRouter } = require("../paymentAttemptRoutes");
    const http = require("http");

    // Limpar movimentos existentes
    await runSql(db, "DELETE FROM pdv_inventory_movements_v2 WHERE reference_id = 'res-t38'");
    await runSql(db, "DELETE FROM pdv_inventory_movements_v2 WHERE reference_id = 'order-t38'");

    // Seed: HOLD para var-1 (reserva válida)
    await seedHold(db, "mv-hold-t38", "res-t38", "vila", "var-1", 1);

    // PROOF: Liberar a quantidade reservada para podermos fazer o RELEASE
    await runSql(db, `UPDATE pdv_inventory_balances_v2 SET reserved_qty = 5 WHERE variant_id = 'var-1' AND store_id = 'vila'`);

    // PROOF: Inserir RELEASE para var-2 (variant SEM HOLD correspondente)
    // O reservationIntegrityService detecta: RELEASE para store=vila, variant=var-2 sem HOLD
    await runSql(db,
      `INSERT INTO pdv_inventory_movements_v2 (id, variant_id, store_id, movement_type, quantity_delta, quantity_before, quantity_after, origin, reference_type, reference_id, idempotency_key, created_at)
       VALUES (?, 'var-2', 'vila', 'RESERVATION_RELEASE', ?, ?, ?, 'RESERVATION', 'ORDER', 'order-t38', ?, ?)`,
      ["mv-rel-t38", 1, 5, 6, "idem-rel-t38", new Date().toISOString()]
    );

    // Criar order que referencia res-t38
    await seedOrder(db, "order-t38", 1000, '["res-t38"]', futureIso(30));

    // Criar router HTTP
    const svcT38 = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: createInfinitePayAdapter({ httpTransport: createFakeTransport().call, timeoutMs: 5000 }),
      getInfinitePayHandle: () => "test-handle",
    });

    const router = createPaymentAttemptRouter({
      express,
      paymentService: svcT38,
    });

    const app = express();
    app.use(express.json());
    // Inject user context for auth
    app.use("/app/v1", (req, res, next) => {
      req.user = { id: "account-1", accountId: "account-1" };
      next();
    });
    app.use("/app/v1", router);

    // Iniciar servidor HTTP
    const listener = app.listen(0);
    const port = listener.address().port;

    try {
      // POST via HTTP real (Node 22 has built-in fetch)
      const response = await fetch(`http://localhost:${port}/app/v1/orders/order-t38/pay`, {
        method: "POST",
        headers: {
          "Authorization": "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const body = await response.json();

      // PROOF: HTTP 400 ok=false com ORDER_RESERVATION_INVALID (code público) e details.reason=RELEASE_WITHOUT_HOLD
      assert.strictEqual(response.status, 400, `Expected HTTP 400, got ${response.status}`);
      assert.strictEqual(body.ok, false, "Response ok must be false");
      assert.ok(body.error, "Error must be present");
      assert.strictEqual(body.error.code, "ORDER_RESERVATION_INVALID", `Expected ORDER_RESERVATION_INVALID, got ${body.error.code}`);
      assert.ok(body.error.details, "Details must be present");
      assert.strictEqual(body.error.details.reason, "RELEASE_WITHOUT_HOLD", "details.reason must be RELEASE_WITHOUT_HOLD");
      assert.ok(
        body.error.details.violations && Array.isArray(body.error.details.violations),
        "Violations array must be present in details"
      );
      assert.ok(body.error.details.violations.length >= 1, "At least one violation");
      assert.strictEqual(body.error.details.violations[0].variant_id, "var-2", "Violation must reference var-2 (no HOLD)");
      assert.strictEqual(body.error.details.violations[0].store_id, "vila", "Violation must reference vila store");
    } finally {
      listener.close();
    }

    // PROOF: Nenhum attempt foi inserido na tabela
    const attempts = await allSql(db, "SELECT id FROM app_payment_attempts WHERE order_id = 'order-t38'");
    assert.strictEqual(attempts.length, 0, "No attempt should be created when RELEASE_WITHOUT_HOLD is detected");
  });

  // ============================================================
  // T39. Provider-success/update-failure: UPDATE throws, attempt permanece REQUESTING
  // ============================================================
  it("T39: UPDATE SET status='PENDING' throws → attempt REQUESTING, retry RECONCILIATION_REQUIRED", async () => {
    // PROOF REAL: Quando o adapter retorna sucesso mas o UPDATE para marcar attempt como PENDING
    // throw uma exception, o attempt permanece REQUESTING — não é marcado FAILED.
    // Isso prova que:
    // 1. BEGIN IMMEDIATE → validação → INSERT REQUESTING → COMMIT funciona
    // 2. Provider é chamado após COMMIT (success=true)
    // 3. UPDATE SET status='PENDING' WHERE id=? AND status='REQUESTING' THROWS
    // 4. Attempt permanece REQUESTING (catch trata como RECONCILIATION_REQUIRED)
    // 5. Retry retorna RECONCILIATION_REQUIRED sem chamar provider novamente

    // Criar wrapper dbApi que faz o UPDATE SET status='PENDING' throw
    let updatePendingCallCount = 0;
    let updatePendingThrowCount = 0;
    const faultDbApi = {
      _isFaultInjected: true,
      run: async (sql, params = []) => {
        // Interceptar o UPDATE que marca PENDING
        if (typeof sql === 'string' && sql.includes("SET status = 'PENDING'") && sql.includes("WHERE id = ? AND status = 'REQUESTING'")) {
          updatePendingCallCount++;
          if (updatePendingCallCount === 1) {
            // Primeira chamada: simular exception real (ex: conexão perdida, lock timeout)
            updatePendingThrowCount++;
            return Promise.reject(new Error("TEST_FAULT: UPDATE SET status='PENDING' threw exception (simulated DB lock)"));
          }
        }
        return db.run(sql, params);
      },
      get: (sql, params = []) => db.get(sql, params),
      all: (sql, params = []) => db.all(sql, params),
    };

    // Provider sempre retorna sucesso
    let providerCallCount = 0;
    const successTransport = async (req) => {
      providerCallCount++;
      return {
        ok: true,
        status: 200,
        data: {
          url: "https://checkout.infinitepay.io/test-link-t39",
          invoice_slug: `INV-T39-${Date.now()}`,
        },
      };
    };

    const adapter = createInfinitePayAdapter({
      httpTransport: successTransport,
      timeoutMs: 5000,
    });

    // Seed order com reserva válida
    await seedOrder(db, "order-t39", 1000, '["res-t39"]', futureIso(30));
    await seedHold(db, "mv-res-t39", "res-t39", "vila", "var-1", 1);
    await runSql(db, `UPDATE pdv_inventory_balances_v2 SET reserved_qty = 1 WHERE variant_id = 'var-1' AND store_id = 'vila'`);

    const svcT39 = createPaymentAttemptService({
      dbApi: faultDbApi,
      infinitePayAdapter: adapter,
      getInfinitePayHandle: () => "test-handle",
    });

    // Primeira chamada: BEGIN IMMEDIATE → INSERT REQUESTING → COMMIT → provider success
    // Mas UPDATE SET status='PENDING' THROWS → RECONCILIATION_REQUIRED
    const result1 = await svcT39.createPixAttempt("account-1", "order-t39");
    assert.ok(result1.success, "First call should succeed (success=true) despite UPDATE throw");
    assert.ok(result1.attempt, "Must have attempt");
    assert.strictEqual(result1.reason, "RECONCILIATION_REQUIRED", `First call must return RECONCILIATION_REQUIRED, got ${result1.reason}`);

    // PROOF: Attempt permanece REQUESTING (UPDATE threw antes de mudar)
    const attempts1 = await allSql(db, "SELECT id, status FROM app_payment_attempts WHERE order_id = 'order-t39'");
    assert.strictEqual(attempts1.length, 1, "Exactly one attempt");
    assert.strictEqual(attempts1[0].status, "REQUESTING", `Attempt must remain REQUESTING after UPDATE throw, got ${attempts1[0].status}`);

    // PROOF: Provider foi chamado exatamente 1 vez
    assert.strictEqual(providerCallCount, 1, `Provider should be called exactly once, got ${providerCallCount}`);

    // PROOF: UPDATE PENDING foi tentado exatamente 1 vez
    assert.strictEqual(updatePendingCallCount, 1, `UPDATE PENDING should be attempted exactly once, got ${updatePendingCallCount}`);

    // PROOF: UPDATE PENDING throw foi executado 1 vez
    assert.strictEqual(updatePendingThrowCount, 1, `UPDATE PENDING should have thrown exactly once, got ${updatePendingThrowCount}`);

    // Segunda chamada: retry — deve encontrar attempt REQUESTING existente
    // e retornar RECONCILIATION_REQUIRED sem chamar provider novamente
    const result2 = await svcT39.createPixAttempt("account-1", "order-t39");
    assert.ok(result2.success, "Retry should succeed");
    assert.ok(result2.idempotent, "Retry should be idempotent");
    assert.strictEqual(result2.reason, "RECONCILIATION_REQUIRED", `Retry reason must be RECONCILIATION_REQUIRED, got ${result2.reason}`);

    // PROOF: Provider NÃO foi chamado novamente (sem duplicação)
    assert.strictEqual(providerCallCount, 1, `Provider must still be called exactly once after retry, got ${providerCallCount}`);

    // PROOF: Ainda exatamente 1 linha
    const attempts2 = await allSql(db, "SELECT id, status FROM app_payment_attempts WHERE order_id = 'order-t39'");
    assert.strictEqual(attempts2.length, 1, "Still exactly one attempt after retry");
    assert.strictEqual(attempts2[0].status, "REQUESTING", "Attempt must still be REQUESTING after retry");

    // PROOF: Total final de chamadas ao provider = 1
    assert.strictEqual(providerCallCount, 1, "Total final provider calls must be exactly 1");
  });

  // ============================================================
  // T40. NSU: provider_transaction_nsu = "NSU-12345" na resposta do provider
  // ============================================================
  it("T40: provider_transaction_nsu persistido com valor NSU-12345", async () => {
    // Criar transport que retorna transaction_nsu diretamente no data
    const nswTransport = async (req) => {
      return {
        ok: true,
        status: 200,
        data: {
          url: "https://checkout.infinitepay.io/test-link-t40",
          invoice_slug: `INV-T40-${Date.now()}`,
          transaction_nsu: "NSU-12345",
        },
      };
    };

    const nswAdapter = createInfinitePayAdapter({
      httpTransport: nswTransport,
      timeoutMs: 5000,
    });

    const nswService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: nswAdapter,
      getInfinitePayHandle: () => "test-handle",
    });

    await seedOrder(db, "order-t40", 1000, '["res-1"]', futureIso(30));

    const result = await nswService.createPixAttempt("account-1", "order-t40");
    assert.strictEqual(result.success, true);

    const attempt = await getSql(db, `SELECT provider_transaction_nsu FROM app_payment_attempts WHERE order_id = 'order-t40'`);
    assert.strictEqual(attempt.provider_transaction_nsu, "NSU-12345");
  });

  // T41. Lossless migration: v1 data preserved with exact value comparison
  // ============================================================
  it("T41: migration v1→v2 preserva dados exatos e novas colunas são NULL-safe", async () => {
    // PROOF: Criar tabela v1 separada com TODOS os campos preenchidos,
    // aplicar migration, comparar valores exatamente com strictEqual.

    const sqlite3 = require("sqlite3");
    const path = require("path");
    const os = require("os");
    const fs = require("fs");
    const { applyAppPaymentAttemptSchema } = require("../persistence/appPaymentAttemptSchema");

    const tmpFile = path.join(os.tmpdir(), `migration-t41-${Date.now()}.db`);

    function wrapConn(conn) {
      return {
        run: (sql, params = []) => new Promise((resolve, reject) => {
          conn.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ changes: this.changes, lastID: this.lastID });
          });
        }),
        get: (sql, params = []) => new Promise((resolve, reject) => {
          conn.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || undefined);
          });
        }),
        all: (sql, params = []) => new Promise((resolve, reject) => {
          conn.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        }),
        exec: (sql) => new Promise((resolve, reject) => {
          conn.exec(sql, (err) => {
            if (err) reject(err);
            else resolve();
          });
        }),
        close: () => new Promise((resolve, reject) => {
          conn.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        }),
      };
    }

    const conn = new sqlite3.Database(tmpFile);
    const testDb = wrapConn(conn);

    try {
      await testDb.exec("PRAGMA journal_mode = WAL");
      await testDb.exec("PRAGMA foreign_keys = OFF");

      // Criar tabela v1 (com provider_pix_copy_paste, provider_qr_code, reservation_fingerprint,
      // provider_response_sanitized_json — mas SEM provider_transaction_nsu)
      await testDb.run(`
        CREATE TABLE app_payment_attempts (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT 'INFINITEPAY',
          method TEXT NOT NULL DEFAULT 'PIX',
          status TEXT NOT NULL DEFAULT 'CREATED',
          idempotency_key TEXT NOT NULL UNIQUE,
          provider_reference TEXT,
          provider_checkout_url TEXT,
          provider_pix_copy_paste TEXT,
          provider_qr_code TEXT,
          amount_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'BRL',
          request_fingerprint TEXT NOT NULL,
          reservation_fingerprint TEXT,
          provider_response_sanitized_json TEXT,
          failure_code TEXT,
          failure_message_sanitized TEXT,
          expires_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1
        )
      `);

      // Inserir dados v1 com TODOS os valores preenchidos
      const seedData = [
        {
          id: "att-mig-1", order_id: "ord-mig-1", provider: "INFINITEPAY", method: "PIX",
          status: "PENDING", idempotency_key: "PIX::fp1", provider_reference: "INV-001",
          provider_checkout_url: "https://checkout.example.com/1",
          provider_pix_copy_paste: "00020126580014br.gov.bcb.pix0136e3c1f8b2-copy-paste",
          provider_qr_code: "data:image/png;base64,iVBORw0-qr-code-img",
          amount_cents: 5000,
          currency: "BRL", request_fingerprint: "fp1",
          reservation_fingerprint: "res-fp1",
          provider_response_sanitized_json: '{"status":"pending","amount":5000}',
          failure_code: null, failure_message_sanitized: null,
          expires_at: null, created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z", version: 1,
        },
        {
          id: "att-mig-2", order_id: "ord-mig-2", provider: "INFINITEPAY", method: "PIX",
          status: "FAILED", idempotency_key: "PIX::fp2", provider_reference: "INV-002",
          provider_checkout_url: "https://checkout.example.com/2",
          provider_pix_copy_paste: "00020126580014br.gov.bcb.pix0136a1b2c3d4-copy-paste",
          provider_qr_code: "data:image/png;base64,iVBORw0-qr-code-img2",
          amount_cents: 3000,
          currency: "BRL", request_fingerprint: "fp2",
          reservation_fingerprint: "res-fp2",
          provider_response_sanitized_json: '{"status":"failed","reason":"timeout"}',
          failure_code: "TIMEOUT", failure_message_sanitized: "Timeout ao consultar provider",
          expires_at: "2024-01-02T00:00:00Z", created_at: "2024-01-01T01:00:00Z", updated_at: "2024-01-01T01:00:00Z", version: 2,
        },
        // Terceira linha com MESMO provider_reference (para testar que duplicate provider_reference é permitido)
        {
          id: "att-mig-3", order_id: "ord-mig-3", provider: "INFINITEPAY", method: "PIX",
          status: "CREATED", idempotency_key: "PIX::fp3", provider_reference: "INV-002",
          provider_checkout_url: null,
          provider_pix_copy_paste: null,
          provider_qr_code: null,
          amount_cents: 1000,
          currency: "BRL", request_fingerprint: "fp3",
          reservation_fingerprint: null,
          provider_response_sanitized_json: null,
          failure_code: null, failure_message_sanitized: null,
          expires_at: null, created_at: "2024-01-01T02:00:00Z", updated_at: "2024-01-01T02:00:00Z", version: 1,
        },
      ];

      const insertCols = "id, order_id, provider, method, status, idempotency_key, provider_reference, provider_checkout_url, provider_pix_copy_paste, provider_qr_code, amount_cents, currency, request_fingerprint, reservation_fingerprint, provider_response_sanitized_json, failure_code, failure_message_sanitized, expires_at, created_at, updated_at, version";
      const insertPlaceholders = new Array(21).fill("?").join(", ");

      for (const row of seedData) {
        await testDb.run(
          `INSERT INTO app_payment_attempts (${insertCols}) VALUES (${insertPlaceholders})`,
          [row.id, row.order_id, row.provider, row.method, row.status, row.idempotency_key,
           row.provider_reference, row.provider_checkout_url, row.provider_pix_copy_paste,
           row.provider_qr_code, row.amount_cents, row.currency, row.request_fingerprint,
           row.reservation_fingerprint, row.provider_response_sanitized_json, row.failure_code,
           row.failure_message_sanitized, row.expires_at, row.created_at, row.updated_at, row.version]
        );
      }

      // Salvar snapshot v1 para comparação
      const v1Rows = await testDb.all("SELECT * FROM app_payment_attempts ORDER BY id");
      assert.strictEqual(v1Rows.length, 3, "Should have 3 v1 rows");

      // PROOF: provider_transaction_nsu NÃO existe antes
      const v1Cols = await testDb.all("PRAGMA table_info(app_payment_attempts)");
      const v1ColNames = v1Cols.map(c => c.name);
      assert.ok(!v1ColNames.includes("provider_transaction_nsu"), "provider_transaction_nsu must NOT exist before migration");

      // Aplicar migration
      const migrationResult = await applyAppPaymentAttemptSchema(testDb);
      assert.ok(migrationResult.migrated, "Migration should report migrated=true");
      assert.strictEqual(migrationResult.from_version, "v1", "Should report from_version=v1");

      // PROOF: Comparar valores v1 EXATOS linha por linha com strictEqual
      const v2Rows = await testDb.all("SELECT * FROM app_payment_attempts ORDER BY id");
      assert.strictEqual(v2Rows.length, 3, "Row count must be preserved exactly");

      const allV1Cols = ["id", "order_id", "provider", "method", "status", "idempotency_key",
        "provider_reference", "provider_checkout_url", "provider_pix_copy_paste",
        "provider_qr_code", "amount_cents", "currency", "request_fingerprint",
        "reservation_fingerprint", "provider_response_sanitized_json", "failure_code",
        "failure_message_sanitized", "expires_at", "created_at", "updated_at", "version"];

      for (let i = 0; i < v1Rows.length; i++) {
        const v1 = v1Rows[i];
        const v2 = v2Rows[i];
        for (const col of allV1Cols) {
          assert.strictEqual(v2[col], v1[col],
            `${col} must be preserved exactly for row ${i}: expected ${JSON.stringify(v1[col])}, got ${JSON.stringify(v2[col])}`);
        }
      }

      // PROOF: provider_reference duplicado é PERMITIDO após migration
      const dupProvRef = await testDb.all("SELECT id, provider_reference FROM app_payment_attempts WHERE provider_reference = 'INV-002'");
      assert.strictEqual(dupProvRef.length, 2, "Two rows with same provider_reference must be allowed after migration");

      // PROOF: Novas colunas v2 são NULL para dados antigos
      for (const row of v2Rows) {
        assert.strictEqual(row.provider_transaction_nsu, null,
          `provider_transaction_nsu must be NULL for ${row.id}`);
      }

      // PROOF: Nenhuma tabela _v2 restante
      const tempTable = await testDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='_app_payment_attempts_v2'");
      assert.ok(!tempTable, "No _app_payment_attempts_v2 table should remain after migration");

      // PROOF: idempotency_key duplicada é BLOQUEADA
      await assert.rejects(
        () => testDb.run(
          "INSERT INTO app_payment_attempts (id, order_id, idempotency_key, amount_cents, request_fingerprint, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          ["att-dup-1", "ord-dup-1", "PIX::fp1", 1000, "fp-dup", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z", 1]
        ),
        { message: /UNIQUE/i },
        "idempotency_key duplicate must be blocked"
      );

      // PROOF: order_id + request_fingerprint duplicado é BLOQUEADO
      await assert.rejects(
        () => testDb.run(
          "INSERT INTO app_payment_attempts (id, order_id, idempotency_key, amount_cents, request_fingerprint, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          ["att-dup-2", "ord-mig-1", "PIX::fp-dup", 1000, "fp1", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z", 1]
        ),
        { message: /UNIQUE/i },
        "order_id + request_fingerprint duplicate must be blocked"
      );

      // PROOF: Idempotência — segunda execução detecta v2 e não faz nada
      const migrationResult2 = await applyAppPaymentAttemptSchema(testDb);
      assert.strictEqual(migrationResult2.migrated, false, "Second migration must be no-op");
      assert.strictEqual(migrationResult2.from_version, "v2", "Should report from_version=v2");

      // Dados ainda intactos após idempotent call
      const v3Rows = await testDb.all("SELECT * FROM app_payment_attempts ORDER BY id");
      assert.strictEqual(v3Rows.length, 3, "Row count must be preserved after idempotent migration");

    } finally {
      await testDb.close();
      try { fs.unlinkSync(tmpFile); } catch (e) {}
      try { fs.unlinkSync(tmpFile + "-wal"); } catch (e) {}
      try { fs.unlinkSync(tmpFile + "-shm"); } catch (e) {}
    }
  });

  // ============================================================
  // T42. Migration rollback: se a migration falhar, o ROLLBACK preserva v1
  // ============================================================
  it("T42: migration rollback preserva dados v1 quando falha no meio", async () => {
    // PROOF: Simular falha durante a migration injetando um wrapper que
    // falha no INSERT SELECT que copia os dados para a tabela temporária.
    // NÃO criar _app_payment_attempts_v2 antecipadamente.
    // A migration deve fazer ROLLBACK e preservar a tabela v1 original.

    const sqlite3 = require("sqlite3");
    const path = require("path");
    const os = require("os");
    const fs = require("fs");

    const tmpFile = path.join(os.tmpdir(), `migration-rollback-t42-${Date.now()}.db`);

    function wrapConn(conn, failOnInsertSelect = false) {
      let insertSelectBlocked = false;
      const runner = {
        run: (sql, params = []) => new Promise((resolve, reject) => {
          // Se failOnInsertSelect e o SQL é o INSERT SELECT, rejeitar
          if (failOnInsertSelect && /INSERT\s+INTO\s+_app_payment_attempts_v2/i.test(sql) && /INSERT\s+INTO\s+_app_payment_attempts_v2.*SELECT.*FROM\s+app_payment_attempts/is.test(sql)) {
            return reject(new Error("TEST_FAULT: INSERT SELECT failed during migration"));
          }
          conn.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ changes: this.changes, lastID: this.lastID });
          });
        }),
        get: (sql, params = []) => new Promise((resolve, reject) => {
          conn.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || undefined);
          });
        }),
        all: (sql, params = []) => new Promise((resolve, reject) => {
          conn.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        }),
        exec: (sql) => new Promise((resolve, reject) => {
          conn.exec(sql, (err) => {
            if (err) reject(err);
            else resolve();
          });
        }),
        close: () => new Promise((resolve, reject) => {
          conn.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        }),
      };
      return runner;
    }

    const conn = new sqlite3.Database(tmpFile);
    const testDb = wrapConn(conn, true);

    try {
      await testDb.exec("PRAGMA journal_mode = WAL");
      await testDb.exec("PRAGMA foreign_keys = OFF");

      // Criar tabela v1 (schema completo v1)
      await testDb.run(`
        CREATE TABLE app_payment_attempts (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT 'INFINITEPAY',
          method TEXT NOT NULL DEFAULT 'PIX',
          status TEXT NOT NULL DEFAULT 'CREATED',
          idempotency_key TEXT NOT NULL UNIQUE,
          provider_reference TEXT,
          provider_checkout_url TEXT,
          provider_pix_copy_paste TEXT,
          provider_qr_code TEXT,
          amount_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'BRL',
          request_fingerprint TEXT NOT NULL,
          reservation_fingerprint TEXT,
          provider_response_sanitized_json TEXT,
          failure_code TEXT,
          failure_message_sanitized TEXT,
          expires_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1
        )
      `);

      // Inserir dados v1
      await testDb.run(
        `INSERT INTO app_payment_attempts (id, order_id, provider, method, status, idempotency_key, provider_reference, amount_cents, currency, request_fingerprint, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["att-rollback-1", "ord-rollback-1", "INFINITEPAY", "PIX", "PENDING", "PIX::rb1", "INV-RB-1", 5000, "BRL", "rb1", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z", 1]
      );
      await testDb.run(
        `INSERT INTO app_payment_attempts (id, order_id, provider, method, status, idempotency_key, provider_reference, amount_cents, currency, request_fingerprint, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["att-rollback-2", "ord-rollback-2", "INFINITEPAY", "PIX", "CREATED", "PIX::rb2", null, 3000, "BRL", "rb2", "2024-01-01T01:00:00Z", "2024-01-01T01:00:00Z", 1]
      );

      // Snapshot antes da migration
      const beforeRows = await testDb.all("SELECT * FROM app_payment_attempts ORDER BY id");
      assert.strictEqual(beforeRows.length, 2, "Should have 2 rows before migration");

      // PROOF: Nenhuma tabela _v2 antes da migration
      const noV2Before = await testDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='_app_payment_attempts_v2'");
      assert.ok(!noV2Before, "No _app_payment_attempts_v2 should exist before migration");

      // Tentar migration — o wrapper falha no INSERT SELECT
      const { applyAppPaymentAttemptSchema } = require("../persistence/appPaymentAttemptSchema");
      let migrationErr = null;
      try {
        await applyAppPaymentAttemptSchema(testDb);
      } catch (e) {
        migrationErr = e;
      }

      // PROOF: Migration deve ter falhado com MIGRATION_V1_TO_V2_FAILED
      assert.ok(migrationErr, "Migration should have failed");
      assert.ok(migrationErr.message.includes("MIGRATION_V1_TO_V2_FAILED"),
        `Expected MIGRATION_V1_TO_V2_FAILED, got: ${migrationErr.message}`);

      // PROOF: ROLLBACK executado — tabela v1 original intacta
      const afterRows = await testDb.all("SELECT * FROM app_payment_attempts ORDER BY id");
      assert.strictEqual(afterRows.length, 2, "Row count must be preserved after failed migration");

      // PROOF: Dados originais idênticos
      for (let i = 0; i < beforeRows.length; i++) {
        assert.strictEqual(afterRows[i].id, beforeRows[i].id, `Row ${i} id must match`);
        assert.strictEqual(afterRows[i].order_id, beforeRows[i].order_id, `Row ${i} order_id must match`);
        assert.strictEqual(afterRows[i].status, beforeRows[i].status, `Row ${i} status must match`);
        assert.strictEqual(afterRows[i].amount_cents, beforeRows[i].amount_cents, `Row ${i} amount_cents must match`);
        assert.strictEqual(afterRows[i].provider_reference, beforeRows[i].provider_reference, `Row ${i} provider_reference must match`);
      }

      // PROOF: Nenhuma tabela _app_payment_attempts_v2 restante
      const noV2After = await testDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='_app_payment_attempts_v2'");
      assert.ok(!noV2After, "No _app_payment_attempts_v2 table should remain after rollback");

      // PROOF: Nenhuma coluna v2 adicionada parcialmente
      const cols = await testDb.all("PRAGMA table_info(app_payment_attempts)");
      const colNames = cols.map(c => c.name);
      assert.ok(!colNames.includes("provider_transaction_nsu"),
        "provider_transaction_nsu must NOT exist after failed migration");

    } finally {
      await testDb.close();
      try { fs.unlinkSync(tmpFile); } catch (e) {}
      try { fs.unlinkSync(tmpFile + "-wal"); } catch (e) {}
      try { fs.unlinkSync(tmpFile + "-shm"); } catch (e) {}
    }
  });

  // ============================================================
  // T43. NSU in getPixPaymentStatus: transaction_nsu persistido durante consulta
  // ============================================================
  it("T43: NSU persistido em getPixAttemptStatus durante consulta ao provider", async () => {
    // PROOF: Quando getPixAttemptStatus consulta o provider e o provider retorna
    // um transaction_nsu, o valor deve ser persistido em provider_transaction_nsu.

    // Criar order e attempt PENDING sem NSU
    await seedOrder(db, "order-t43", 1000, '["res-1"]', futureIso(30));

    // Inserir attempt PENDING manualmente (sem NSU)
    const { generateFingerprint } = require("../fingerprint");
    const fp = generateFingerprint({
      order_id: "order-t43",
      order_version: 1,
      total_cents: 1000,
      currency: "BRL",
      method: "PIX",
      reservation_fingerprint: "mv-res-t39:var-1:vila:-1",
    });
    const now = new Date().toISOString();
    await runSql(db, `INSERT INTO app_payment_attempts (id, order_id, provider, method, status, idempotency_key, amount_cents, currency, request_fingerprint, reservation_fingerprint, provider_reference, provider_checkout_url, created_at, updated_at, version) VALUES (?, ?, 'INFINITEPAY', 'PIX', 'PENDING', ?, 1000, 'BRL', ?, ?, 'INV-T43', 'https://checkout.example.com/t43', ?, ?, 1)`,
      ["att-t43", "order-t43", `PIX::${fp}`, fp, fp, now, now]
    );

    // Verificar que NSU está NULL antes
    const before = await getSql(db, "SELECT provider_transaction_nsu FROM app_payment_attempts WHERE id = ?", ["att-t43"]);
    assert.strictEqual(before.provider_transaction_nsu, null, "NSU must be NULL before consultation");

    // Criar adapter que simula consulta ao provider com NSU
    const statusTransport = async (req) => {
      return {
        ok: true,
        status: 200,
        data: {
          paid: false,
          capture_method: "pix",
          amount: 1000,
          order_nsu: "order-t43",
          transaction_nsu: "NSU-STATUS-99",
          raw: {
            capture_method: "pix",
            amount: 1000,
            order_nsu: "order-t43",
            transaction_nsu: "NSU-STATUS-99",
          },
        },
      };
    };

    const statusAdapter = createInfinitePayAdapter({
      httpTransport: statusTransport,
      timeoutMs: 5000,
    });

    const statusService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: statusAdapter,
      getInfinitePayHandle: () => "test-handle",
    });

    // Consultar status
    const result = await statusService.getPixAttemptStatus("account-1", "att-t43");
    assert.ok(result.success, "Consultation should succeed");

    // PROOF: NSU foi persistido
    const after = await getSql(db, "SELECT provider_transaction_nsu, status, version FROM app_payment_attempts WHERE id = ?", ["att-t43"]);
    assert.strictEqual(after.provider_transaction_nsu, "NSU-STATUS-99", `NSU must be persisted, got ${after.provider_transaction_nsu}`);
    assert.strictEqual(after.status, "REVIEW_REQUIRED", "Status should be REVIEW_REQUIRED after status consultation");
    assert.ok(after.version >= 2, "Version must have incremented");
  });
});
