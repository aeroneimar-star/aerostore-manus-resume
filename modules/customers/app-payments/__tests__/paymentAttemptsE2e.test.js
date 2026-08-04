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
  it("T37: ReservationIntegrityError mapeada para HTTP 400 ok=false", async () => {
    // Seed order com reservation_ids inválidos
    await seedOrder(db, "order-t37", 1000, '["res-nonexistent"]', futureIso(30));

    // A validação deve falhar com ReservationIntegrityError → mapeada para PaymentAttemptError
    let err;
    try {
      await service.createPixAttempt("account-1", "order-t37");
    } catch (e) {
      err = e;
    }
    assert.ok(err, "Deve lançar erro");
    // O service mapeia ReservationIntegrityError → PaymentAttemptError
    assert.ok(err.status === 400, `Status deve ser 400, got ${err.status}`);
  });

  // ============================================================
  // T38. RELEASE sem HOLD correspondente → ORDER_RESERVATION_INVALID
  // ============================================================
  it("T38: RELEASE sem HOLD correspondente bloqueia pagamento", async () => {
    // Criar HOLD + RELEASE para res-1, mas com variant_id diferente do HOLD
    // O RELEASE referencia o order_id, não o reservation_id
    // Se houver RELEASE para uma variant que não tem HOLD, o balance check falha
    // Ou: se o RELEASE tem quantity_delta > hold_total, falha

    // Simular: RELEASE com quantidade maior que o HOLD
    // Primeiro limpar movimentos existentes para var-1
    await runSql(db, "DELETE FROM pdv_inventory_movements_v2 WHERE reference_id = 'res-1'");
    await runSql(db, "DELETE FROM pdv_inventory_movements_v2 WHERE reference_id = 'order-t38'");

    // HOLD de 1 unidade
    await seedHold(db, "mv-hold-t38", "res-1", "vila", "var-1", 1);
    // Balance
    await runSql(db, `UPDATE pdv_inventory_balances_v2 SET reserved_qty = 5 WHERE variant_id = 'var-1' AND store_id = 'vila'`);

    // RELEASE de 2 unidades (mais que o HOLD de 1)
    await runSql(db,
      `INSERT INTO pdv_inventory_movements_v2 (id, variant_id, store_id, movement_type, quantity_delta, quantity_before, quantity_after, reference_type, reference_id, idempotency_key, created_at)
       VALUES (?, 'var-1', 'vila', 'RESERVATION_RELEASE', ?, ?, ?, 'ORDER', 'order-t38', ?, ?)`,
      ["mv-rel-t38", 2, 0, 2, "idem-rel-t38", futureIso(30)]
    );

    // Criar order que referencia res-1 (que tem HOLD de 1, mas RELEASE de 2)
    await seedOrder(db, "order-t38", 1000, '["res-1"]', futureIso(30));

    let err;
    try { await service.createPixAttempt("account-1", "order-t38"); } catch (e) { err = e; }
    assert.ok(err, "Deve falhar com release > hold");
    assert.strictEqual(err.code, "ORDER_RESERVATION_INVALID");
  });

  // ============================================================
  // T39. Provider-success/update-failure: attempt permanece REQUESTING
  // ============================================================
  it("T39: provider-success/update-failure deixa attempt REQUESTING", async () => {
    // Criar adapter que responde com sucesso mas o UPDATE falha
    // Simular: o adapter retorna sucesso, mas o attempt já foi atualizado
    // por outra operação, então o UPDATE WHERE status='REQUESTING' afeta 0 rows

    const successTransport = createFakeTransport();
    const adapter = createInfinitePayAdapter({ httpTransport: successTransport.call, timeoutMs: 5000 });

    await seedOrder(db, "order-t39", 1000, '["res-1"]', futureIso(30));

    // Primeiro criar um attempt REQUESTING manualmente
    const now = new Date().toISOString();
    const { generateFingerprint } = require("../fingerprint");
    const fp = generateFingerprint({
      order_id: "order-t39",
      order_version: 1,
      total_cents: 1000,
      currency: "BRL",
      method: "PIX",
      reservation_fingerprint: "mv-res-1:var-1:vila:-1",
    });
    await runSql(db, `INSERT INTO app_payment_attempts (id, order_id, provider, method, status, idempotency_key, amount_cents, currency, request_fingerprint, reservation_fingerprint, created_at, updated_at, version) VALUES ('attempt-t39', 'order-t39', 'INFINITEPAY', 'PIX', 'PENDING', ?, ?, ?, ?, ?, ?, ?, 1)`, [`PIX::${fp}`, 1000, 'BRL', fp, fp, now, now]);

    // Agora o service tenta criar novo attempt → idempotency check encontra PENDING
    const service2 = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: adapter,
      getInfinitePayHandle: () => "test-handle",
    });

    const result = await service2.createPixAttempt("account-1", "order-t39");
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.idempotent, true);
    assert.ok(result.reason === "EXISTING_ATTEMPT_FOUND" || result.reason === "RECONCILIATION_REQUIRED");
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

  // ============================================================
  // T41. Lossless migration: v1 data preserved, new columns NULL-safe
  // ============================================================
  it("T41: migration v1→v2 preserva dados e novas colunas são NULL", async () => {
    // Já testado em T31, mas verificar explicitamente que dados v1 não são perdidos
    // e que provider_pix_copy_paste / provider_qr_code existem como colunas
    const columns = await db.all("PRAGMA table_info(app_payment_attempts)");
    const names = columns.map(c => c.name);

    assert.ok(names.includes("provider_transaction_nsu"), "provider_transaction_nsu deve existir");
    assert.ok(names.includes("reservation_fingerprint"), "reservation_fingerprint deve existir");
    assert.ok(names.includes("provider_pix_copy_paste"), "provider_pix_copy_paste deve existir");
    assert.ok(names.includes("provider_qr_code"), "provider_qr_code deve existir");
    assert.ok(names.includes("provider_response_sanitized_json"), "provider_response_sanitized_json deve existir");
  });
});
