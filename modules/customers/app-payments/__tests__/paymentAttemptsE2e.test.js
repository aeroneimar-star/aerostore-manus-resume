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

function seedOrder(db, id, totalCents, reservationIds, expiresAt, version = 1) {
  const now = new Date().toISOString();
  // reservationIds is already a JSON string, so pass it directly
  const reservationIdsJson = typeof reservationIds === 'string' ? reservationIds : JSON.stringify(reservationIds);
  return runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, currency, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES (?, ?, 'account-1', 'DELIVERY', 'addr-1', ?, ?, 'BRL', 'READY_FOR_PAYMENT', ?, '{"store_origin_id":"vila"}', ?, ?, ?, ?, ?)`, [id, id.replace("order-", ""), totalCents, totalCents, `key-${id}`, reservationIdsJson, version, now, now, expiresAt]);
}

function seedReservation(db, resId, storeId, variantId, qty) {
  const movementId = `mv-${resId}`;
  return runSql(db, `INSERT INTO reservation_movements (id, reservation_id, movement_type, quantity_delta, store_id, variant_id, order_id, created_at) VALUES (?, ?, 'RESERVATION_HOLD', ?, ?, ?, ?, ?)`, [movementId, resId, -qty, storeId, variantId, 'order-ctx', NOW_ISO]);
}

function seedInventoryBalance(db, storeId, variantId, qty) {
  return runSql(db, `INSERT INTO inventory_balance (id, store_id, variant_id, reserved_qty, version) VALUES (?, ?, ?, ?, 1)`, [`bal-${storeId}-${variantId}`, storeId, variantId, qty]);
}

describe("Payment Attempts Integration (WASM) — Phase 3.13-B hardening", () => {
  let db;
  let service;
  let fakeTransport;
  let adapter;

  before(async () => {
    db = memoryDb();
    await db.run("PRAGMA foreign_keys=ON");

    await runSql(db, `CREATE TABLE IF NOT EXISTS app_customer_accounts (id TEXT PRIMARY KEY, phone_lookup_hash TEXT, phone_masked TEXT, email_lookup_hash TEXT, email_masked TEXT, account_status TEXT NOT NULL DEFAULT 'ACTIVE', access_status TEXT NOT NULL DEFAULT 'APPROVED', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS app_customer_addresses (id TEXT PRIMARY KEY, account_id TEXT, label TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS app_orders (id TEXT PRIMARY KEY, order_number TEXT NOT NULL, account_id TEXT NOT NULL, fulfillment_type TEXT NOT NULL, address_id TEXT, subtotal_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'BRL', status TEXT NOT NULL, idempotency_key TEXT UNIQUE, snapshot_json TEXT NOT NULL, reservation_ids_json TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS reservation_movements (id TEXT PRIMARY KEY, reservation_id TEXT, movement_type TEXT, quantity_delta INTEGER, store_id TEXT, variant_id TEXT, order_id TEXT, created_at TEXT NOT NULL)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS inventory_balance (id TEXT PRIMARY KEY, store_id TEXT, variant_id TEXT, reserved_qty INTEGER DEFAULT 0, version INTEGER NOT NULL DEFAULT 1)`);

    await applyAppPaymentAttemptSchema(db);
  });

  beforeEach(async () => {
    await runSql(db, "DELETE FROM app_payment_attempts");
    await runSql(db, "DELETE FROM app_orders");
    await runSql(db, "DELETE FROM reservation_movements");
    await runSql(db, "DELETE FROM inventory_balance");

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

    // Seed reservation + inventory balance for tests that need real validation
    await seedReservation(db, "res-1", "vila", "var-1", 1);
    await seedInventoryBalance(db, "vila", "var-1", 5);
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
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t4', '0004', 'account-B', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t4', '{"s":"v"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

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
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t6', '0006', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'CANCELLED', 'key-t6', '{"s":"v"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

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
    // Seed additional reservations for both res-1 and res-2
    await seedReservation(db, "res-2", "vila", "var-1", 1);
    await seedReservation(db, "res-a1", "vila", "var-1", 1);
    await seedReservation(db, "res-b1", "vila", "var-1", 1);

    await seedOrder(db, "order-t11", 1000, '["res-1"]', futureIso(30));

    await service.createPixAttempt("account-1", "order-t11");

    // Alterar reservation_ids para gerar fingerprint diferente (res-2 must exist)
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
    // Fake transport que retorna URL mas sem invoice_slug
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
  // T13. Duas tentativas sem invoice_slug persistidas sem conflito
  // ============================================================
  it("T13: duas tentativas sem invoice_slug persistidas sem conflito", async () => {
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

    // Seed additional reservations for res-a1 and res-b1
    await seedReservation(db, "res-a1", "vila", "var-1", 1);
    await seedReservation(db, "res-b1", "vila", "var-1", 1);

    await seedOrder(db, "order-t13a", 1000, '["res-a1"]', futureIso(30));
    await seedOrder(db, "order-t13b", 2000, '["res-b1"]', futureIso(30));

    await noSlugService.createPixAttempt("account-1", "order-t13a");
    await noSlugService.createPixAttempt("account-1", "order-t13b");

    const attempts = await allSql(db, `SELECT id, provider_reference FROM app_payment_attempts`);
    assert.strictEqual(attempts.length, 2, "Duas tentativas devem existir");
    for (const a of attempts) {
      assert.strictEqual(a.provider_reference, null);
    }
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
    // Criar pedido da conta B
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t24', '0024', 'account-B', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t24', '{"s":"v"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    // Criar attempt com a conta B (usar service direto)
    const bService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: adapter,
      getInfinitePayHandle: () => "test-handle",
    });
    // Para criar, precisamos temporariamente usar account-1 como dono
    // Vamos inserir manualmente um attempt com account_id=B
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
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t25', '0025', 'account-B', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t25', '{"s":"v"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    let err;
    try { await service.listAttemptsByOrder("account-1", "order-t25"); } catch (e) { err = e; }
    assert.ok(err);
    assert.strictEqual(err.code, "ORDER_NOT_FOUND");
  });
});
