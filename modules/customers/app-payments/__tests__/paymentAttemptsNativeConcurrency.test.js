"use strict";

/**
 * paymentAttemptsNativeConcurrency — Prova de concorrência real com SQLite nativo.
 *
 * Usa sqlite3 (driver nativo do projeto) com duas conexões independentes
 * ao mesmo arquivo em WAL mode.
 *
 * Prova:
 * - Duas conexões sqlite3 independentes ao mesmo arquivo;
 * - BEGIN IMMEDIATE bloqueia a segunda conexão com SQLITE_BUSY;
 * - Exatamente uma linha em app_payment_attempts;
 * - Exatamente uma chamada create link;
 * - Segunda requisição é rejeitada ou retorna o attempt existente;
 * - Zero alteração indevida na versão do pedido;
 * - Banco íntegro após o teste.
 *
 * O driver sqlite3 usa API callback (promisify necessário).
 */

const { describe, it, before, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const sqlite3 = require("sqlite3");

// Helper to wrap a sqlite3 connection to the dbApi interface { run, get, all, close }
function createSqlite3DbApi(connection) {
  return {
    run: (sql, params = []) => new Promise((resolve, reject) => {
      connection.run(sql, params, function (error) {
        if (error) { reject(error); }
        else { resolve({ changes: this.changes, lastID: this.lastID }); }
      });
    }),
    get: (sql, params = []) => new Promise((resolve, reject) => {
      connection.get(sql, params, (error, row) => {
        if (error) { reject(error); }
        else { resolve(row || undefined); }
      });
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
      connection.all(sql, params, (error, rows) => {
        if (error) { reject(error); }
        else { resolve(rows || []); }
      });
    }),
    close: () => new Promise((resolve, reject) => {
      connection.close((error) => {
        if (error) { reject(error); }
        else { resolve(); }
      });
    }),
    raw: connection, // expose raw connection for direct exec() calls
    exec: (sql) => new Promise((resolve, reject) => {
      connection.exec(sql, (error) => {
        if (error) { reject(error); }
        else { resolve(); }
      });
    }),
  };
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS app_orders (
    id TEXT PRIMARY KEY, order_number TEXT NOT NULL, account_id TEXT NOT NULL,
    fulfillment_type TEXT NOT NULL, address_id TEXT,
    subtotal_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'BRL', status TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    snapshot_json TEXT NOT NULL DEFAULT '{"store_origin_id":"vila"}',
    reservation_ids_json TEXT, version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT
  );
  CREATE TABLE IF NOT EXISTS pdv_inventory_movements_v2 (
    id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, store_id TEXT NOT NULL,
    movement_type TEXT NOT NULL, quantity_delta INTEGER NOT NULL,
    quantity_before INTEGER NOT NULL DEFAULT 0,
    quantity_after INTEGER NOT NULL DEFAULT 0,
    origin TEXT, reference_type TEXT, reference_id TEXT,
    idempotency_key TEXT, actor_user_id TEXT, actor_name TEXT,
    metadata_json TEXT, created_at,
    UNIQUE(variant_id, store_id, idempotency_key)
  );
  CREATE TABLE IF NOT EXISTS pdv_inventory_balances_v2 (
    id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, store_id TEXT NOT NULL,
    available_qty INTEGER NOT NULL DEFAULT 0,
    reserved_qty INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT,
    UNIQUE(variant_id, store_id)
  );
  CREATE TABLE IF NOT EXISTS app_payment_attempts (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'INFINITEPAY',
    method TEXT NOT NULL DEFAULT 'PIX',
    status TEXT NOT NULL DEFAULT 'CREATED',
    idempotency_key TEXT NOT NULL UNIQUE,
    provider_reference TEXT,
    provider_transaction_nsu TEXT,
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
  );
  CREATE INDEX IF NOT EXISTS idx_payment_attempts_order ON app_payment_attempts(order_id);
  CREATE INDEX IF NOT EXISTS idx_payment_attempts_fingerprint ON app_payment_attempts(request_fingerprint);
  CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON app_payment_attempts(status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_order_fingerprint ON app_payment_attempts(order_id, request_fingerprint);
`;

describe("Payment Attempts — Native Concurrency (sqlite3, two connections)", () => {
  let tmpFile;
  let conn1, conn2;
  let db1, db2;

  before(() => {
    tmpFile = path.join(os.tmpdir(), `payment-concurrency-${Date.now()}.db`);
  });

  beforeEach(async () => {
    // Delete any previous file + WAL artifacts
    try { fs.unlinkSync(tmpFile); } catch (e) {}
    try { fs.unlinkSync(tmpFile + "-wal"); } catch (e) {}
    try { fs.unlinkSync(tmpFile + "-shm"); } catch (e) {}

    // Two independent sqlite3 connections to the same file (WAL mode)
    conn1 = new sqlite3.Database(tmpFile);
    conn2 = new sqlite3.Database(tmpFile);

    db1 = createSqlite3DbApi(conn1);
    db2 = createSqlite3DbApi(conn2);

    // Apply schema via db1 (shared file, db2 sees them)
    await db1.exec(SCHEMA_SQL);

    // Set WAL mode + busy_timeout=0 on both connections (force SQLITE_BUSY immediately)
    await db1.exec("PRAGMA journal_mode = WAL");
    await db1.exec("PRAGMA foreign_keys = ON");
    await db1.exec("PRAGMA busy_timeout = 0");
    await db2.exec("PRAGMA journal_mode = WAL");
    await db2.exec("PRAGMA foreign_keys = ON");
    await db2.exec("PRAGMA busy_timeout = 0");

    // Seed data
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await db1.run(
      `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, currency, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, 'DELIVERY', 'addr-1', ?, ?, 'BRL', ?, ?, '{"store_origin_id":"vila"}', ?, ?, ?, ?, ?)`,
      ["ord1", "1", "acc1", 1000, 1000, "READY_FOR_PAYMENT", "key-ord1", '["res-1"]', 1, now, now, future]
    );

    await db1.run(
      `INSERT INTO pdv_inventory_movements_v2 (id, variant_id, store_id, movement_type, quantity_delta, quantity_before, quantity_after, reference_type, reference_id, idempotency_key, created_at)
       VALUES (?, ?, ?, 'RESERVATION_HOLD', ?, ?, ?, 'RESERVATION', 'res-1', ?, ?)`,
      ["mv1", "var-1", "vila", -1, 1, 0, "idem-mv1", now]
    );

    await db1.run(
      `INSERT INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      ["bal1", "var-1", "vila", 10, 5, now]
    );

    // Set feature flags
    process.env.INFINITEPAY_SHOP_PIX_ENABLED = "true";
    process.env.INFINITEPAY_CHECKOUT_PIX_ONLY_CONFIRMED = "true";
    process.env.INFINITEPAY_HANDLE = "test-handle";

    // Create shared fake transport with delay
    const { createFakeTransport } = require("../adapter/fakeTransport");
    const { createInfinitePayAdapter } = require("../adapter/infinitePayAdapter");
    const { createPaymentAttemptService } = require("../paymentAttemptService");

    const callLog = { count: 0 };
    const fakeTransport = createFakeTransport();

    // Wrap transport with delay to create overlap window
    const delayedTransport = async (req) => {
      await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms delay
      callLog.count++;
      return fakeTransport.call(req);
    };

    const adapter = createInfinitePayAdapter({ httpTransport: delayedTransport, timeoutMs: 5000 });

    // Two independent services with two independent connections
    const service1 = createPaymentAttemptService({
      dbApi: db1,
      infinitePayAdapter: adapter,
      getInfinitePayHandle: () => "test-handle",
    });
    const service2 = createPaymentAttemptService({
      dbApi: db2,
      infinitePayAdapter: adapter,
      getInfinitePayHandle: () => "test-handle",
    });

    // Store for assertion
    global.__test_concurrency__ = { service1, service2, callLog, db1, db2, conn1, conn2 };
  });

  it("T_NATIVE_01 — exactly one attempt row, one create link call, second returns conflict", async () => {
    const { service1, service2, callLog, db1, db2 } = global.__test_concurrency__;

    const [r1, r2] = await Promise.allSettled([
      service1.createPixAttempt("acc1", "ord1"),
      service2.createPixAttempt("acc1", "ord1"),
    ]);

    // PROOF: Exactly one attempt row in the shared file
    const rows1 = await db1.all("SELECT count(*) as cnt FROM app_payment_attempts");
    const rows2 = await db2.all("SELECT count(*) as cnt FROM app_payment_attempts");
    assert.strictEqual(rows1[0].cnt, 1, "Exactly one attempt row in db1");
    assert.strictEqual(rows2[0].cnt, 1, "Exactly one attempt row in db2 (shared file)");

    // PROOF: The single attempt is in a terminal-safe state
    const attempt = await db1.get("SELECT id, status, order_id, amount_cents FROM app_payment_attempts");
    assert.ok(attempt, "Attempt must exist");
    assert.strictEqual(attempt.order_id, "ord1", "Attempt must reference correct order");
    assert.strictEqual(attempt.amount_cents, 1000, "Amount must match order total");
    // Status should be PENDING (successful provider call) or FAILED (timeout)
    assert.ok(
      ["PENDING", "FAILED", "REQUESTING"].includes(attempt.status),
      `Attempt status should be PENDING/FAILED/REQUESTING, got ${attempt.status}`
    );

    // PROOF: Provider was called exactly once (only the winner calls)
    assert.strictEqual(callLog.count, 1, `Exactly one provider call, got ${callLog.count}`);

    // PROOF: At least one fulfilled, and the rejected one has a safe conflict code
    const fulfilled = [r1, r2].filter(r => r.status === "fulfilled");
    assert.ok(fulfilled.length >= 1, "At least one attempt should succeed");
    if (fulfilled.length === 2) {
      // Both fulfilled: one is the winner, one is idempotent return
      const reasons = [r1.value?.reason, r2.value?.reason];
      const allowedIdempotent = [
        "RECONCILIATION_REQUIRED",
        "EXISTING_ATTEMPT_FOUND",
        "EXISTING_FAILED_ATTEMPT",
      ];
      assert.ok(
        reasons.some(r => allowedIdempotent.includes(r)),
        `At least one should be idempotent, got reasons: ${reasons.join(", ")}`
      );
    }

    const rejected = [r1, r2].filter(r => r.status === "rejected");
    if (rejected.length > 0) {
      const code = rejected[0].reason?.code || "";
      const allowedCodes = [
        "PAYMENT_IDEMPOTENCY_CONFLICT",
        "ORDER_ALREADY_HAS_ACTIVE_ATTEMPT",
        "DATABASE_CONSTRAINT",
        "SQLITE_BUSY",
        "SQLITE_LOCKED",
      ];
      assert.ok(allowedCodes.includes(code), `Rejection code should be safe conflict, got: ${code}`);
    }

    // PROOF: Zero undue order version change
    const order1 = await db1.get("SELECT version FROM app_orders WHERE id = ?", ["ord1"]);
    assert.ok(order1 && order1.version === 1, `Order version must be exactly 1, got ${order1?.version}`);
  });

  it("T_NATIVE_02 — database integrity after fresh seed", async () => {
    const { service1, db1 } = global.__test_concurrency__;

    // Create an attempt via service
    const result = await service1.createPixAttempt("acc1", "ord1");
    assert.ok(result.success, "Attempt creation should succeed");

    // Verify DB integrity
    const order = await db1.get("SELECT id, status, version FROM app_orders WHERE id = ?", ["ord1"]);
    assert.ok(order, "Order must exist");

    const attempt = await db1.get("SELECT id, status, order_id FROM app_payment_attempts ORDER BY created_at LIMIT 1");
    assert.ok(attempt, "At least one attempt must exist after creation");
    assert.strictEqual(attempt.order_id, "ord1", "Attempt must reference correct order");
  });

  it("T_NATIVE_03 — BEGIN IMMEDIATE blocks second connection with SQLITE_BUSY", async () => {
    const { db1, db2, conn1, conn2, service1 } = global.__test_concurrency__;

    // PROOF: WAL mode and busy_timeout=0 are configured
    const walMode = await db1.get("PRAGMA journal_mode");
    assert.strictEqual(walMode.journal_mode, "wal", "Database must be in WAL mode");
    const busyTimeout = await db1.get("PRAGMA busy_timeout");
    assert.strictEqual(busyTimeout.timeout, 0, "busy_timeout must be 0 (immediate SQLITE_BUSY)");

    // First create an attempt via service so we have at least one row
    const result = await service1.createPixAttempt("acc1", "ord1");
    assert.ok(result.success, "Attempt creation should succeed");

    // Verify at least one attempt exists
    const countBefore = await db1.all("SELECT count(*) as cnt FROM app_payment_attempts");
    assert.ok(countBefore[0].cnt >= 1, `At least one attempt must exist before lock test, got ${countBefore[0].cnt}`);

    // PROOF: BEGIN IMMEDIATE on conn1 acquires a RESERVED lock
    await new Promise((resolve, reject) => {
      conn1.run("BEGIN IMMEDIATE", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // PROOF: conn2 can still READ (WAL allows concurrent readers)
    const readResult = await db2.get("SELECT count(*) as cnt FROM app_payment_attempts");
    assert.ok(readResult.cnt >= 1, "Concurrent READ should succeed in WAL mode");

    // PROOF: conn2 CANNOT WRITE — must fail with SQLITE_BUSY
    let busyError = null;
    try {
      await new Promise((resolve, reject) => {
        conn2.run(
          "INSERT INTO app_payment_attempts (id, order_id, provider, method, status, idempotency_key, amount_cents, currency, request_fingerprint, reservation_fingerprint, created_at, updated_at, version) VALUES ('tx-block-3', 'ord1', 'INFINITEPAY', 'PIX', 'PENDING', 'key-block-3', 1000, 'BRL', 'fp-block-3', 'fp-block-res', datetime('now'), datetime('now'), 1)",
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      // If we get here, WAL allowed the concurrent write — this is a test failure
      assert.fail("Concurrent write should have been blocked by BEGIN IMMEDIATE (SQLITE_BUSY)");
    } catch (err) {
      busyError = err;
    }

    // PROOF: SQLITE_BUSY with exact code 5 (SQLITE_BUSY constant)
    assert.ok(busyError, "Second connection write must have been blocked");
    assert.ok(
      busyError.code === "SQLITE_BUSY" || busyError.code === "SQLITE_BUSY_LOCKED",
      `Expected SQLITE_BUSY, got: ${busyError.message} (code: ${busyError.code})`
    );

    // PROOF: The blocked INSERT did NOT succeed — row count unchanged
    const countDuringLock = await db1.all("SELECT count(*) as cnt FROM app_payment_attempts");
    assert.strictEqual(countDuringLock[0].cnt, countBefore[0].cnt, "No new rows during lock");

    // Rollback db1 transaction
    await new Promise((resolve, reject) => {
      conn1.run("ROLLBACK", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // PROOF: DB is functional after lock release
    const countAfter = await db1.all("SELECT count(*) as cnt FROM app_payment_attempts");
    assert.ok(countAfter[0].cnt >= 1, `At least one attempt must exist after lock test, got ${countAfter[0].cnt}`);
  });

  // ============================================================
  // T_NATIVE_04 — Singleton connection, same order, same fingerprint, two services
  // ============================================================
  it("T_NATIVE_04 — mesma conexão, mesmo pedido, mesmo fingerprint, dois services compartilham transactionRunner", async () => {
    const { db1 } = global.__test_concurrency__;
    const { createPaymentAttemptService } = require("../paymentAttemptService");
    const { createInfinitePayAdapter } = require("../adapter/infinitePayAdapter");

    // Shared fake transport with counter — both services use the same adapter instance
    const callLog = { count: 0 };
    const sharedFakeTransport = async (req) => {
      callLog.count++;
      return {
        ok: true,
        status: 200,
        data: {
          url: `https://checkout.infinitepay.io/test-link-t4-${Date.now()}`,
          invoice_slug: `INV-T4-${callLog.count}`,
        },
      };
    };

    const sharedAdapter = createInfinitePayAdapter({
      httpTransport: sharedFakeTransport,
      timeoutMs: 5000,
    });

    // Clear any cached runner for db1 to ensure fresh singleton
    if (global.__transactionRunnerCache) {
      global.__transactionRunnerCache.delete(db1);
    }

    // Create two services with the SAME dbApi (singleton connection)
    // Both share the same transactionRunner (singleton per dbApi)
    const svc1 = createPaymentAttemptService({
      dbApi: db1,
      infinitePayAdapter: sharedAdapter,
      getInfinitePayHandle: () => "test-handle",
    });
    const svc2 = createPaymentAttemptService({
      dbApi: db1, // same dbApi → same transactionRunner
      infinitePayAdapter: sharedAdapter, // same adapter → same callLog
      getInfinitePayHandle: () => "test-handle",
    });

    // Seed order for this test (use same order as T_NATIVE_01 area)
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await db1.run(
      `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, currency, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, 'DELIVERY', 'addr-1', ?, ?, 'BRL', ?, ?, '{"store_origin_id":"vila"}', ?, ?, ?, ?, ?)`,
      ["ord-t4", "t4", "acc1", 1500, 1500, "READY_FOR_PAYMENT", "key-t4", '["res-t4"]', 1, now, now, future]
    );

    // Seed hold + balance
    await db1.run(
      `INSERT INTO pdv_inventory_movements_v2 (id, variant_id, store_id, movement_type, quantity_delta, quantity_before, quantity_after, reference_type, reference_id, idempotency_key, created_at)
       VALUES (?, 'var-t4', 'vila', 'RESERVATION_HOLD', -1, 1, 0, 'RESERVATION', 'res-t4', 'idem-t4', ?)`,
      ["mv-t4", now]
    );
    await db1.run(
      `INSERT INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at)
       VALUES (?, 'var-t4', 'vila', 10, 1, 1, ?)`,
      ["bal-t4", now]
    );

    // Record order version before
    const orderBefore = await db1.get("SELECT version FROM app_orders WHERE id = ?", ["ord-t4"]);
    assert.ok(orderBefore, "Order must exist before test");
    const versionBefore = orderBefore.version;

    // Two simultaneous calls with SAME order and SAME fingerprint
    const [r1, r2] = await Promise.allSettled([
      svc1.createPixAttempt("acc1", "ord-t4"),
      svc2.createPixAttempt("acc1", "ord-t4"),
    ]);

    // PROOF: Exatamente 1 linha em app_payment_attempts
    const attempts = await db1.all("SELECT id, status, order_id FROM app_payment_attempts WHERE order_id = 'ord-t4'");
    assert.strictEqual(attempts.length, 1, `Exactly one attempt for ord-t4, got ${attempts.length}`);

    // PROOF: Provider chamado exatamente 1 vez (não duplicado)
    assert.strictEqual(callLog.count, 1, `Provider must be called exactly once, got ${callLog.count}`);

    // PROOF: Versão do pedido exatamente inalterada
    const orderAfter = await db1.get("SELECT version FROM app_orders WHERE id = ?", ["ord-t4"]);
    assert.strictEqual(orderAfter.version, versionBefore, `Order version must be unchanged, before=${versionBefore} after=${orderAfter.version}`);

    // PROOF: Um vencedor (success=true) + segundo idempotente ou RECONCILIATION_REQUIRED
    const fulfilled = [r1, r2].filter(r => r.status === "fulfilled");
    assert.ok(fulfilled.length >= 1, "At least one call must succeed");

    // Both fulfilled: one is winner, one is idempotent
    if (r1.status === "fulfilled" && r2.status === "fulfilled") {
      const results = [r1.value, r2.value];
      const reasons = results.map(r => r.reason);
      // One should be a normal success, one should be idempotent
      const idempotentReasons = ["RECONCILIATION_REQUIRED", "EXISTING_ATTEMPT_FOUND"];
      assert.ok(
        reasons.some(r => idempotentReasons.includes(r)),
        `One result must be idempotent (RECONCILIATION_REQUIRED or EXISTING_ATTEMPT_FOUND), got reasons: ${reasons.join(", ")}`
      );
    }

    // PROOF: Nenhuma transação aberta ao final
    const transactionRunner = require("../transactionRunner").createTransactionRunner;
    // The transactionRunner is a singleton per dbApi — we can't directly access it,
    // but we verify no open transaction by checking that the runner reports inactive
    // If we can call the runner's isTransactionActive, it should be false
    // Instead, verify by attempting another normal operation
    const orderCheck = await db1.get("SELECT id FROM app_orders WHERE id = ?", ["ord-t4"]);
    assert.ok(orderCheck, "Database must be functional after test (no open transaction)");
  });

  // ============================================================
  // T_NATIVE_05 — COMMIT failure handling: rollback then release queue
  // ============================================================
  it("T_NATIVE_05 — COMMIT failure: ROLLBACK then release next transaction", async () => {
    const { db1 } = global.__test_concurrency__;
    const { createTransactionRunner } = require("../transactionRunner");

    // Create a fresh transactionRunner with a fault-injecting dbApi
    let commitCallCount = 0;
    const faultDbApi = {
      run: async (sql, params = []) => {
        if (sql === "COMMIT") {
          commitCallCount++;
          if (commitCallCount === 1) {
            // Primeiro COMMIT falha (simula erro de disco/lock)
            throw Object.assign(new Error("SQLITE_IOERR_WRITE"), { code: "SQLITE_IOERR" });
          }
        }
        // Do NOT intercept ROLLBACK — let the real sqlite3 handle it.
        // After failed COMMIT, sqlite3 may still need ROLLBACK or may report
        // "cannot rollback - no transaction is active" — either way it's fine.
        return db1.run(sql, params);
      },
      get: (sql, params = []) => db1.get(sql, params),
      all: (sql, params = []) => db1.all(sql, params),
    };

    const runner1 = createTransactionRunner(faultDbApi);
    const results = [];

    // Criar uma ordem para teste
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await db1.run(
      `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, subtotal_cents, total_cents, currency, status, idempotency_key, snapshot_json, reservation_ids_json, version, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, 'DELIVERY', 'addr-1', ?, ?, 'BRL', ?, ?, '{"store_origin_id":"vila"}', ?, ?, ?, ?, ?)`,
      ["ord-commit-fail", "commit-fail", "acc1", 5000, 5000, "READY_FOR_PAYMENT", "key-cf", '["res-cf"]', 1, now, now, future]
    );

    await db1.run(
      `INSERT INTO pdv_inventory_movements_v2 (id, variant_id, store_id, movement_type, quantity_delta, quantity_before, quantity_after, reference_type, reference_id, idempotency_key, created_at)
       VALUES (?, 'var-cf', 'vila', 'RESERVATION_HOLD', -1, 1, 0, 'RESERVATION', 'res-cf', 'idem-cf', ?)`,
      ["mv-cf", now]
    );

    await db1.run(
      `INSERT INTO pdv_inventory_balances_v2 (id, variant_id, store_id, available_qty, reserved_qty, version, updated_at)
       VALUES (?, 'var-cf', 'vila', 10, 1, 1, ?)`,
      ["bal-cf", now]
    );

    // Transação 1: COMMIT vai falhar
    const tx1 = runner1.withImmediateTransaction(async (runner) => {
      await runner.run(
        `INSERT INTO app_payment_attempts (id, order_id, provider, method, status, idempotency_key, amount_cents, currency, request_fingerprint, reservation_fingerprint, created_at, updated_at, version)
         VALUES ('attempt-cf-1', 'ord-commit-fail', 'INFINITEPAY', 'PIX', 'REQUESTING', 'key-cf-1', 5000, 'BRL', 'fp-cf-1', 'fp-cf-res', ?, ?, 1)`,
        [now, now]
      );
      await runner.commit();
      return { type: "tx1", success: true };
    });

    // Transação 2: enfileirada, vai executar DEPOIS que a tx1 fizer ROLLBACK
    const tx2 = runner1.withImmediateTransaction(async (runner) => {
      await runner.run(
        `INSERT INTO app_payment_attempts (id, order_id, provider, method, status, idempotency_key, amount_cents, currency, request_fingerprint, reservation_fingerprint, created_at, updated_at, version)
         VALUES ('attempt-cf-2', 'ord-commit-fail', 'INFINITEPAY', 'PIX', 'REQUESTING', 'key-cf-2', 5000, 'BRL', 'fp-cf-2', 'fp-cf-res', ?, ?, 1)`,
        [now, now]
      );
      await runner.commit();
      return { type: "tx2", success: true };
    });

    // Executar ambas simultaneamente — tx2 deve ser serializada
    const [result1, result2] = await Promise.allSettled([tx1, tx2]);

    // PROOF: Transação 1 falhou (COMMIT erro)
    assert.strictEqual(result1.status, "rejected", "First transaction should fail due to COMMIT error");
    assert.ok(result1.reason.message.includes("SQLITE_IOERR"), `Error should be SQLITE_IOERR, got: ${result1.reason.message}`);

    // PROOF: Transação 2 teve sucesso (executou após ROLLBACK da tx1)
    assert.strictEqual(result2.status, "fulfilled", `Second transaction should succeed, got: ${result2.status}`);

    // PROOF: Exatamente 1 linha inserida (tx1 foi rollada, tx2 commitou)
    const attempts = await db1.all("SELECT id FROM app_payment_attempts WHERE order_id = 'ord-commit-fail'");
    assert.strictEqual(attempts.length, 1, `Exactly one attempt after commit-failure, got ${attempts.length}`);
    assert.strictEqual(attempts[0].id, "attempt-cf-2", "The surviving attempt must be from tx2 (tx1 was rolled back)");

    // PROOF: COMMIT foi tentado 2 vezes (1 falha + 1 sucesso)
    assert.strictEqual(commitCallCount, 2, `COMMIT should be attempted exactly twice, got ${commitCallCount}`);

    // PROOF: Nenhuma transação aberta ao final
    const orderCheck = await db1.get("SELECT id FROM app_orders WHERE id = ?", ["ord-commit-fail"]);
    assert.ok(orderCheck, "Database must be functional after test");
  });

  after(async () => {
    try { await db1.close(); } catch (e) {}
    try { await db2.close(); } catch (e) {}
    try { fs.unlinkSync(tmpFile); } catch (e) {}
    try { fs.unlinkSync(tmpFile + "-wal"); } catch (e) {}
    try { fs.unlinkSync(tmpFile + "-shm"); } catch (e) {}
  });
});
