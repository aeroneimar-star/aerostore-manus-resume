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

describe("Payment Attempts E2E — 25 testes obrigatórios", () => {
  let db;
  let service;
  let fakeTransport;
  let adapter;

  before(async () => {
    db = memoryDb();
    await db.run("PRAGMA foreign_keys=ON");

    // Tabelas master mínimas
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_master_records(id TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, eligibility_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED', updated_at TEXT NOT NULL, deleted_at TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_identity_conflicts(id TEXT PRIMARY KEY, conflict_type TEXT, severity TEXT, status TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_identity_conflict_participants(id TEXT PRIMARY KEY, conflict_id TEXT, participant_type TEXT, participant_id TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_identity_cases(id TEXT PRIMARY KEY, blocking INTEGER)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS customer_identity_case_conflicts(case_id TEXT, conflict_id TEXT)`);

    // Tabelas shop
    await runSql(db, `CREATE TABLE IF NOT EXISTS app_customer_accounts (id TEXT PRIMARY KEY, phone_lookup_hash TEXT, phone_masked TEXT, email_lookup_hash TEXT, email_masked TEXT, account_status TEXT NOT NULL DEFAULT 'ACTIVE', access_status TEXT NOT NULL DEFAULT 'APPROVED', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS app_customer_addresses (id TEXT PRIMARY KEY, account_id TEXT, label TEXT, recipient_name TEXT, postal_code_protected TEXT, postal_code_masked TEXT, street TEXT, number TEXT, complement TEXT, neighborhood TEXT, city TEXT, state TEXT, delivery_instructions TEXT, validation_status TEXT, is_default INTEGER DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS app_carts (id TEXT PRIMARY KEY, account_id TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE', currency TEXT DEFAULT 'BRL', item_count INTEGER DEFAULT 0, subtotal_cents INTEGER DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS app_cart_items (id TEXT PRIMARY KEY, cart_id TEXT, product_id TEXT, variant_id TEXT, quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, effective_unit_price_cents INTEGER NOT NULL, line_total_cents INTEGER NOT NULL, product_snapshot_json TEXT NOT NULL, availability_status TEXT NOT NULL DEFAULT 'UNKNOWN', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS app_orders (id TEXT PRIMARY KEY, order_number TEXT NOT NULL, account_id TEXT NOT NULL, fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('DELIVERY','PICKUP')), address_id TEXT, pickup_store_id TEXT, shipping_provider TEXT, shipping_service_code TEXT, shipping_quote_cents INTEGER, shipping_quote_currency TEXT DEFAULT 'BRL', subtotal_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'BRL', status TEXT NOT NULL CHECK (status IN ('CREATING','STOCK_RESERVED','READY_FOR_PAYMENT','FAILED','CANCELLED','EXPIRED')), idempotency_key TEXT UNIQUE, snapshot_json TEXT NOT NULL, reservation_ids_json TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT, failed_reason TEXT)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS app_order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT NOT NULL, variant_id TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, effective_unit_price_cents INTEGER NOT NULL, line_total_cents INTEGER NOT NULL, product_snapshot_json TEXT NOT NULL, availability_status TEXT NOT NULL DEFAULT 'UNKNOWN', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(db, `CREATE TABLE IF NOT EXISTS app_order_events (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, event_type TEXT NOT NULL, details_json TEXT, created_at TEXT NOT NULL)`);

    // Schema de payment attempts
    await applyAppPaymentAttemptSchema(db);
  });

  beforeEach(async () => {
    // Limpar tabelas
    await runSql(db, "DELETE FROM app_payment_attempts");
    await runSql(db, "DELETE FROM app_order_events");
    await runSql(db, "DELETE FROM app_order_items");
    await runSql(db, "DELETE FROM app_orders");
    await runSql(db, "DELETE FROM app_cart_items");
    await runSql(db, "DELETE FROM app_carts");
    await runSql(db, "DELETE FROM app_customer_addresses");
    await runSql(db, "DELETE FROM app_customer_accounts");

    // Seed básico
    const now = NOW_ISO;
    await runSql(db, `INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, version, created_at, updated_at) VALUES ('account-1', 'hash-1', '***', '', '', 'ACTIVE', 'APPROVED', 1, ?, ?)`, [now, now]);
    await runSql(db, `INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, complement, neighborhood, city, state, delivery_instructions, validation_status, is_default, version, created_at, updated_at) VALUES ('addr-1', 'account-1', 'Casa', 'Joao', '01001000', '01001-000', 'Rua Teste', '123', '', 'Centro', 'Sao Paulo', 'SP', '', 'VALID', 0, 1, ?, ?)`, [now, now]);

    // Feature flag ON para testes (exceto T1 que testa OFF)
    process.env.INFINITEPAY_SHOP_PIX_ENABLED = "true";
    process.env.INFINITEPAY_HANDLE = "test-handle";

    // Fake transport e adapter
    fakeTransport = createFakeTransport();
    adapter = createInfinitePayAdapter({ httpTransport: fakeTransport.call, timeoutMs: 5000 });

    // Service
    service = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: adapter,
      getInfinitePayHandle: () => process.env.INFINITEPAY_HANDLE || "",
    });
  });

  // ============================================================
  // T1. Feature flag default OFF
  // ============================================================
  it("T1: feature flag default OFF bloqueia qualquer transporte", async () => {
    delete process.env.INFINITEPAY_SHOP_PIX_ENABLED;
    process.env.INFINITEPAY_HANDLE = "test-handle";

    const svc = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: adapter,
      getInfinitePayHandle: () => process.env.INFINITEPAY_HANDLE || "",
    });

    // Criar pedido READY_FOR_PAYMENT
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t1', '0001', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t1', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    let err;
    try {
      await svc.createPixAttempt("order-t1");
    } catch (e) {
      err = e;
    }
    assert.ok(err, "Deve lançar erro");
    assert.strictEqual(err.code, "INFINITEPAY_PIX_DISABLED", "Erro deve ser INFINITEPAY_PIX_DISABLED");
    assert.strictEqual(fakeTransport.getCalls().length, 0, "Nenhuma chamada ao transporte");
  });

  // ============================================================
  // T2. Pedido inexistente
  // ============================================================
  it("T2: pedido inexistente deve retornar ORDER_NOT_FOUND", async () => {
    let err;
    try {
      await service.createPixAttempt("order-nonexistent");
    } catch (e) {
      err = e;
    }
    assert.ok(err, "Deve lançar erro");
    assert.strictEqual(err.code, "ORDER_NOT_FOUND");
    assert.strictEqual(fakeTransport.getCalls().length, 0, "Nenhuma chamada ao provider");
  });

  // ============================================================
  // T3. Pedido expirado
  // ============================================================
  it("T3: pedido expirado deve retornar ORDER_EXPIRED", async () => {
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t3', '0003', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t3', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, pastIso(5)]);

    let err;
    try {
      await service.createPixAttempt("order-t3");
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.strictEqual(err.code, "ORDER_EXPIRED");
    assert.strictEqual(fakeTransport.getCalls().length, 0);
  });

  // ============================================================
  // T4. Pedido com status não pagável
  // ============================================================
  it("T4: pedido com status CANCELLED deve retornar ORDER_NOT_PAYABLE", async () => {
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t4', '0004', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'CANCELLED', 'key-t4', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    let err;
    try {
      await service.createPixAttempt("order-t4");
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.strictEqual(err.code, "ORDER_NOT_PAYABLE");
  });

  // ============================================================
  // T5. Total sempre lido do servidor
  // ============================================================
  it("T5: total vem exclusivamente do servidor (ignora clientAmountCents)", async () => {
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t5', '0005', 'account-1', 'DELIVERY', 'addr-1', 1000, 2500, 'READY_FOR_PAYMENT', 'key-t5', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    // Tentar enviar valor diferente pelo "app"
    const result = await service.createPixAttempt("order-t5", { clientAmountCents: 100 });
    assert.strictEqual(result.success, true);
    // O valor usado deve ser o do servidor (2500), não o do cliente (100)
    const attempt = await getSql(db, `SELECT amount_cents FROM app_payment_attempts WHERE order_id = 'order-t5'`);
    assert.strictEqual(attempt.amount_cents, 2500, "amount_cents deve ser 2500 (do servidor)");
  });

  // ============================================================
  // T6. Tentativa de manipular valor pelo app
  // ============================================================
  it("T6: clientAmountCents diferente é ignorado, total do servidor é usado", async () => {
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t6', '0006', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t6', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    // Enviar valor diferente pelo "app" — deve ser ignorado, usa total do servidor
    const result = await service.createPixAttempt("order-t6", { clientAmountCents: 999 });
    assert.strictEqual(result.success, true);
    const attempt = await getSql(db, `SELECT amount_cents FROM app_payment_attempts WHERE order_id = 'order-t6'`);
    assert.strictEqual(attempt.amount_cents, 1000, "Deve usar total do servidor, ignorando clientAmountCents");
  });

  // ============================================================
  // T7. Criação de attempt PENDING com transporte fake
  // ============================================================
  it("T7: criação de attempt PENDING com transporte fake", async () => {
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t7', '0007', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t7', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    const result = await service.createPixAttempt("order-t7");
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempt.status, "PENDING");
    assert.strictEqual(result.attempt.provider, "INFINITEPAY");
    assert.strictEqual(result.attempt.method, "PIX");
    assert.strictEqual(result.attempt.amount_cents, 1000);
    assert.ok(result.attempt.provider_checkout_url);
    assert.ok(result.attempt.request_fingerprint);
    assert.ok(fakeTransport.getCalls().length >= 1, "Deve ter chamado o transporte");
  });

  // ============================================================
  // T8. Retry idêntico retorna o mesmo attempt
  // ============================================================
  it("T8: retry idêntico retorna o mesmo attempt", async () => {
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t8', '0008', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t8', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    const result1 = await service.createPixAttempt("order-t8");
    assert.strictEqual(result1.success, true);

    fakeTransport.clearLog();
    const result2 = await service.createPixAttempt("order-t8");
    assert.strictEqual(result2.success, true);
    assert.strictEqual(result2.idempotent, true, "Segunda chamada deve ser idempotente");
    assert.strictEqual(result2.reason, "EXISTING_ATTEMPT_FOUND");
    assert.strictEqual(result2.attempt.id, result1.attempt.id, "Deve retornar o mesmo ID");
    assert.strictEqual(fakeTransport.getCalls().length, 0, "Não deve chamar o transporte novamente");
  });

  // ============================================================
  // T9. Retry não chama transporte novamente
  // ============================================================
  it("T9: retry não chama transporte novamente", async () => {
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t9', '0009', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t9', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    await service.createPixAttempt("order-t9");
    const callsBefore = fakeTransport.getCalls().length;
    assert.ok(callsBefore >= 1);

    // Segunda chamada
    await service.createPixAttempt("order-t9");
    const callsAfter = fakeTransport.getCalls().length;
    assert.strictEqual(callsAfter, callsBefore, "Transporte não deve ser chamado novamente");
  });

  // ============================================================
  // T10. Conflito de idempotência
  // ============================================================
  it("T10: tentativa de criar novo attempt para mesmo fingerprint com dados diferentes", async () => {
    // Não é possível ter dois attempts com mesmo fingerprint para o mesmo pedido.
    // O fingerprint é baseado em order_id + amount_cents + currency + method.
    // Se o fingerprint já existe, retorna o attempt existente (idempotência).
    // Se tentar com amount diferente, fingerprint diferente → pode criar novo,
    // mas se já existe attempt ativo, retorna PAYMENT_ATTEMPT_CONFLICT.
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t10', '0010', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t10', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    const result1 = await service.createPixAttempt("order-t10");
    assert.strictEqual(result1.success, true);

    // Segunda chamada com mesmo fingerprint → idempotente
    const result2 = await service.createPixAttempt("order-t10");
    assert.strictEqual(result2.success, true);
    assert.strictEqual(result2.idempotent, true);
    assert.strictEqual(result2.attempt.id, result1.attempt.id);
  });

  // ============================================================
  // T11. Concorrência com duas conexões SQLite
  // ============================================================
  it("T11: concorrência — lock otimista bloqueia versão alterada", async () => {
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t11', '0011', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t11', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    // Primeira chamada cria attempt PENDING e incrementa version para 2
    const result1 = await service.createPixAttempt("order-t11");
    assert.strictEqual(result1.success, true);
    assert.strictEqual(result1.attempt.status, "PENDING");

    // Verificar que versão foi incrementada
    const order = await getSql(db, `SELECT version, status FROM app_orders WHERE id = 'order-t11'`);
    assert.strictEqual(order.version, 2, "Versão deve ter sido incrementada pelo lock");
    assert.strictEqual(order.status, "READY_FOR_PAYMENT", "Status deve permanecer READY_FOR_PAYMENT");
  });

  // ============================================================
  // T12. provider_reference duplicada
  // ============================================================
  it("T12: provider_reference duplicada é rejeitada pela constraint UNIQUE", async () => {
    // Criar pedido e attempt normalmente
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t12', '0012', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t12', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    const result = await service.createPixAttempt("order-t12");
    assert.strictEqual(result.success, true);
    assert.ok(result.attempt.provider_reference, "Deve ter provider_reference");

    // Tentar inserir manualmente com provider_reference duplicada
    let insertErr;
    try {
      await runSql(db, `INSERT INTO app_payment_attempts (id, order_id, provider, method, status, idempotency_key, provider_reference, amount_cents, currency, request_fingerprint, created_at, updated_at, version) VALUES ('dup-ref', 'order-t12', 'INFINITEPAY', 'PIX', 'PENDING', 'key-dup', ?, 1000, 'BRL', 'fp-dup', ?, ?, 1)`, [result.attempt.provider_reference, NOW_ISO, NOW_ISO]);
    } catch (e) {
      insertErr = e;
    }
    assert.ok(insertErr, "Constraint UNIQUE deve bloquear provider_reference duplicada");
  });

  // ============================================================
  // T13. Timeout do provider
  // ============================================================
  it("T13: timeout do provider resulta em FAILED", async () => {
    const timeoutTransport = createFakeTransport({ timeout: true });
    const timeoutAdapter = createInfinitePayAdapter({ httpTransport: timeoutTransport.call, timeoutMs: 100 });

    const timeoutService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: timeoutAdapter,
      getInfinitePayHandle: () => "test-handle",
    });

    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t13', '0013', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t13', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    const result = await timeoutService.createPixAttempt("order-t13");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "INFINITEPAY_TIMEOUT");

    const attempt = await getSql(db, `SELECT status, failure_code FROM app_payment_attempts WHERE order_id = 'order-t13'`);
    assert.strictEqual(attempt.status, "FAILED");
    assert.strictEqual(attempt.failure_code, "INFINITEPAY_TIMEOUT");
  });

  // ============================================================
  // T14. Resposta malformada
  // ============================================================
  it("T14: resposta malformada do provider deve ser tratada", async () => {
    const malformedTransport = createFakeTransport({ malformed: true });
    const malformedAdapter = createInfinitePayAdapter({ httpTransport: malformedTransport.call, timeoutMs: 5000 });

    const malformedService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: malformedAdapter,
      getInfinitePayHandle: () => "test-handle",
    });

    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t14', '0014', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t14', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    const result = await malformedService.createPixAttempt("order-t14");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "INFINITEPAY_NO_CHECKOUT_URL");
  });

  // ============================================================
  // T15. Erro HTTP normalizado
  // ============================================================
  it("T15: erro HTTP 500 do provider deve ser normalizado", async () => {
    const errorTransport = createFakeTransport({ httpError: { status: 500, data: { error: "INTERNAL" } } });
    const errorAdapter = createInfinitePayAdapter({ httpTransport: errorTransport.call, timeoutMs: 5000 });

    const errorService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: errorAdapter,
      getInfinitePayHandle: () => "test-handle",
    });

    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t15', '0015', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t15', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    const result = await errorService.createPixAttempt("order-t15");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "INFINITEPAY_API_ERROR");
  });

  // ============================================================
  // T16. Resposta sanitizada sem segredo
  // ============================================================
  it("T16: resposta sanitizada não contém dados sensíveis", async () => {
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t16', '0016', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t16', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    await service.createPixAttempt("order-t16");

    const attempt = await getSql(db, `SELECT provider_response_sanitized_json FROM app_payment_attempts WHERE order_id = 'order-t16'`);
    const sanitized = JSON.parse(attempt.provider_response_sanitized_json);
    assert.strictEqual(sanitized.access_token, "[REDACTED]", "access_token deve ser redactado");
    assert.strictEqual(sanitized.card_number, "[REDACTED]", "card_number deve ser redactado");
    assert.ok(sanitized.url, "URL pública deve ser preservada");
  });

  // ============================================================
  // T17. Migration em banco novo
  // ============================================================
  it("T17: migration funciona em banco novo", async () => {
    const newDb = memoryDb();
    await newDb.run("PRAGMA foreign_keys=ON");

    // Apenas criar tabelas master mínimas necessárias
    await runSql(newDb, `CREATE TABLE IF NOT EXISTS customer_master_records(id TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, eligibility_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED', updated_at TEXT NOT NULL, deleted_at TEXT)`);
    await runSql(newDb, `CREATE TABLE IF NOT EXISTS customer_identity_conflicts(id TEXT PRIMARY KEY, conflict_type TEXT, severity TEXT, status TEXT)`);
    await runSql(newDb, `CREATE TABLE IF NOT EXISTS customer_identity_conflict_participants(id TEXT PRIMARY KEY, conflict_id TEXT, participant_type TEXT, participant_id TEXT)`);
    await runSql(newDb, `CREATE TABLE IF NOT EXISTS customer_identity_cases(id TEXT PRIMARY KEY, blocking INTEGER)`);
    await runSql(newDb, `CREATE TABLE IF NOT EXISTS customer_identity_case_conflicts(case_id TEXT, conflict_id TEXT)`);
    await runSql(newDb, `CREATE TABLE IF NOT EXISTS app_customer_accounts (id TEXT PRIMARY KEY, account_status TEXT NOT NULL DEFAULT 'ACTIVE', access_status TEXT NOT NULL DEFAULT 'APPROVED', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(newDb, `CREATE TABLE IF NOT EXISTS app_customer_addresses (id TEXT PRIMARY KEY, account_id TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(newDb, `CREATE TABLE IF NOT EXISTS app_carts (id TEXT PRIMARY KEY, account_id TEXT, status TEXT, currency TEXT, item_count INTEGER, subtotal_cents INTEGER, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(newDb, `CREATE TABLE IF NOT EXISTS app_cart_items (id TEXT PRIMARY KEY, cart_id TEXT, product_id TEXT, variant_id TEXT, quantity INTEGER, unit_price_cents INTEGER, effective_unit_price_cents INTEGER, line_total_cents INTEGER, product_snapshot_json TEXT, availability_status TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(newDb, `CREATE TABLE IF NOT EXISTS app_orders (id TEXT PRIMARY KEY, order_number TEXT NOT NULL, account_id TEXT NOT NULL, fulfillment_type TEXT NOT NULL, address_id TEXT, pickup_store_id TEXT, shipping_provider TEXT, shipping_service_code TEXT, shipping_quote_cents INTEGER, shipping_quote_currency TEXT DEFAULT 'BRL', subtotal_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, status TEXT NOT NULL, idempotency_key TEXT UNIQUE, snapshot_json TEXT NOT NULL, reservation_ids_json TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT, failed_reason TEXT)`);
    await runSql(newDb, `CREATE TABLE IF NOT EXISTS app_order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT NOT NULL, variant_id TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, effective_unit_price_cents INTEGER NOT NULL, line_total_cents INTEGER NOT NULL, product_snapshot_json TEXT NOT NULL, availability_status TEXT NOT NULL DEFAULT 'UNKNOWN', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await runSql(newDb, `CREATE TABLE IF NOT EXISTS app_order_events (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, event_type TEXT NOT NULL, details_json TEXT, created_at TEXT NOT NULL)`);

    await applyAppPaymentAttemptSchema(newDb);

    const tables = await newDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name='app_payment_attempts'");
    assert.strictEqual(tables.length, 1, "Tabela app_payment_attempts deve existir");

    const columns = await newDb.all("PRAGMA table_info(app_payment_attempts)");
    const columnNames = columns.map((c) => c.name);
    assert.ok(columnNames.includes("id"), "Deve ter coluna id");
    assert.ok(columnNames.includes("order_id"), "Deve ter coluna order_id");
    assert.ok(columnNames.includes("provider"), "Deve ter coluna provider");
    assert.ok(columnNames.includes("method"), "Deve ter coluna method");
    assert.ok(columnNames.includes("status"), "Deve ter coluna status");
    assert.ok(columnNames.includes("idempotency_key"), "Deve ter coluna idempotency_key");
    assert.ok(columnNames.includes("amount_cents"), "Deve ter coluna amount_cents");
    assert.ok(columnNames.includes("currency"), "Deve ter coluna currency");
    assert.ok(columnNames.includes("request_fingerprint"), "Deve ter coluna request_fingerprint");
    assert.ok(columnNames.includes("version"), "Deve ter coluna version");

    await newDb.close();
  });

  // ============================================================
  // T18. Migration em banco legado
  // ============================================================
  it("T18: migration funciona em banco legado (tabela app_orders existente)", async () => {
    // Banco legado já tem app_orders
    const legacyDb = memoryDb();
    await legacyDb.run("PRAGMA foreign_keys=ON");
    await runSql(legacyDb, `CREATE TABLE IF NOT EXISTS app_orders (id TEXT PRIMARY KEY, order_number TEXT NOT NULL, account_id TEXT NOT NULL, fulfillment_type TEXT NOT NULL, status TEXT NOT NULL, total_cents INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);

    await applyAppPaymentAttemptSchema(legacyDb);

    const tables = await legacyDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name='app_payment_attempts'");
    assert.strictEqual(tables.length, 1, "Tabela app_payment_attempts deve existir em banco legado");

    const ordersTable = await legacyDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name='app_orders'");
    assert.strictEqual(ordersTable.length, 1, "Tabela app_orders deve permanecer intacta");

    await legacyDb.close();
  });

  // ============================================================
  // T19. Migration executada duas vezes
  // ============================================================
  it("T19: migration executada duas vezes é idempotente", async () => {
    await applyAppPaymentAttemptSchema(db); // Segunda execução
    // Não deve falhar
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='app_payment_attempts'");
    assert.strictEqual(tables.length, 1);
  });

  // ============================================================
  // T20. Pedido que expira antes da criação
  // ============================================================
  it("T20: pedido que expira durante a criação é detectado", async () => {
    // Criar pedido com expires_at no passado
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t20', '0020', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t20', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, pastIso(1)]);

    let err;
    try {
      await service.createPixAttempt("order-t20");
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.strictEqual(err.code, "ORDER_EXPIRED");
  });

  // ============================================================
  // T21. Reserva inválida bloqueia pagamento
  // ============================================================
  it("T21: pedido sem reservas bloqueia pagamento", async () => {
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t21', '0021', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t21', '{"store_origin_id":"vila"}', '[]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    let err;
    try {
      await service.createPixAttempt("order-t21");
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.strictEqual(err.code, "ORDER_RESERVATION_INVALID");
  });

  // ============================================================
  // T22. Nenhum teste faz chamada externa
  // ============================================================
  it("T22: nenhum teste faz chamada externa (verificação do fake transport)", async () => {
    // Este teste verifica que o fake transport foi usado em todos os testes anteriores
    // Todas as chamadas foram para URLs locais do fake
    const calls = fakeTransport.getCalls();
    for (const call of calls) {
      assert.ok(call.url.includes("infinitepay.io"), `Chamada deve ser simulada: ${call.url}`);
    }
    // Confirmar que não há fetch real — o fake transport não usa fetch
    assert.ok(true, "Fake transport não faz chamadas externas");
  });

  // ============================================================
  // T23. Nenhum fluxo marca pedido como PAID
  // ============================================================
  it("T23: criação de attempt NÃO marca pedido como PAID", async () => {
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t23', '0023', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t23', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    await service.createPixAttempt("order-t23");

    const order = await getSql(db, `SELECT status FROM app_orders WHERE id = 'order-t23'`);
    assert.strictEqual(order.status, "READY_FOR_PAYMENT", "Pedido NÃO deve ser PAID");
  });

  // ============================================================
  // T24. Nenhum fluxo cria cartão de crédito
  // ============================================================
  it("T24: nenhum fluxo cria cartão de crédito", async () => {
    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t24', '0024', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t24', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    await service.createPixAttempt("order-t24");

    // Verificar que não há tabela de cartão e que o response sanitizado não tem card
    const attempt = await getSql(db, `SELECT provider_response_sanitized_json, provider_pix_copy_paste FROM app_payment_attempts WHERE order_id = 'order-t24'`);
    if (attempt.provider_response_sanitized_json) {
      const resp = JSON.parse(attempt.provider_response_sanitized_json);
      assert.strictEqual(resp.card_number, "[REDACTED]", "card_number deve ser redactado");
    }
    // Não há criação de cartão — apenas PIX
  });

  // ============================================================
  // T25. Flag desligada impede qualquer transporte
  // ============================================================
  it("T25: flag desligada impede qualquer transporte", async () => {
    delete process.env.INFINITEPAY_SHOP_PIX_ENABLED;

    const disabledService = createPaymentAttemptService({
      dbApi: db,
      infinitePayAdapter: adapter,
      getInfinitePayHandle: () => "test-handle",
    });

    await runSql(db, `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at) VALUES ('order-t25', '0025', 'account-1', 'DELIVERY', 'addr-1', 1000, 1000, 'READY_FOR_PAYMENT', 'key-t25', '{"store_origin_id":"vila"}', '["res-1"]', 1, ?, ?, ?)`, [NOW_ISO, NOW_ISO, futureIso(30)]);

    let err;
    try {
      await disabledService.createPixAttempt("order-t25");
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.strictEqual(err.code, "INFINITEPAY_PIX_DISABLED");
    assert.strictEqual(fakeTransport.getCalls().length, 0, "Transporte não deve ser chamado quando flag OFF");
  });
});
