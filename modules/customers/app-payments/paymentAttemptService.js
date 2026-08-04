"use strict";
const { randomUUID } = require("crypto");
const { generateFingerprint } = require("./fingerprint");
const { sanitizeResponse, sanitizeFailureMessage } = require("./sanitizeResponse");
const {
  isAllowedTransition,
  isTerminalState,
  isPayableStatus,
} = require("./paymentAttemptStates");
const { createReservationIntegrityService, ReservationIntegrityError } = require("../app-orders/reservationIntegrityService");

const FEATURE_FLAG = "INFINITEPAY_SHOP_PIX_ENABLED";
const PIX_ONLY_FLAG = "INFINITEPAY_CHECKOUT_PIX_ONLY_CONFIRMED";

function iso(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

function generateId() {
  return randomUUID();
}

function isFeatureEnabled() {
  return process.env[FEATURE_FLAG] === "true";
}

function isPixOnlyConfirmed() {
  return process.env[PIX_ONLY_FLAG] === "true";
}

class PaymentAttemptError extends Error {
  constructor(code, message, { status = 400, details = null } = {}) {
    super(message);
    this.name = "PaymentAttemptError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function createPaymentAttemptService(options = {}) {
  const db = options.dbApi;
  const infinitePayAdapter = options.infinitePayAdapter;
  const getInfinitePayHandle = options.getInfinitePayHandle || (() => process.env.INFINITEPAY_HANDLE || "");
  const reservationIntegrityService = options.reservationIntegrityService || createReservationIntegrityService();

  if (!db) {
    throw new Error("DB_API_REQUIRED for paymentAttemptService");
  }

  // Singleton transactionRunner: compartilhar entre todos os services
  // que usam o mesmo dbApi, para evitar interleaving de transações.
  const { createTransactionRunner } = require("./transactionRunner");
  // Usar cache global por dbApi para garantir singleton entre services
  const _runnerCache = global.__transactionRunnerCache || (global.__transactionRunnerCache = new WeakMap());
  let transactionRunner = options.transactionRunner || null;
  if (!transactionRunner) {
    // Criar runner compartilhado pelo dbApi
    if (!_runnerCache.has(db)) {
      _runnerCache.set(db, createTransactionRunner(db));
    }
    transactionRunner = _runnerCache.get(db);
  }

  // ============================================================
  // FEATURE FLAG CHECK
  // ============================================================
  function ensureFeatureEnabled() {
    if (!isFeatureEnabled()) {
      throw new PaymentAttemptError(
        "INFINITEPAY_PIX_DISABLED",
        "InfinitePay PIX desabilitado. Configure INFINITEPAY_SHOP_PIX_ENABLED=true para ativar.",
        { status: 403 }
      );
    }
  }

  function ensureAdapterConfigured() {
    const handle = getInfinitePayHandle();
    if (!handle) {
      throw new PaymentAttemptError(
        "INFINITEPAY_HANDLE_MISSING",
        "INFINITEPAY_HANDLE não configurado no processo.",
        { status: 400 }
      );
    }
    if (!infinitePayAdapter) {
      throw new PaymentAttemptError(
        "INFINITEPAY_ADAPTER_MISSING",
        "Adapter InfinitePay não injetado.",
        { status: 500 }
      );
    }
    return handle;
  }

  function ensurePixOnlyConfirmed() {
    if (!isPixOnlyConfirmed()) {
      throw new PaymentAttemptError(
        "INFINITEPAY_PIX_ONLY_NOT_CONFIRMED",
        "INFINITEPAY_CHECKOUT_PIX_ONLY_CONFIRMED não configurado. O checkout InfinitePay deve ter cartão desativado.",
        { status: 403 }
      );
    }
  }

  // ============================================================
  // VALIDAÇÃO DO PEDIDO COM AUTORIZAÇÃO POR CONTA
  // ============================================================
  async function validateOrder(runner, accountId, orderId) {
    const order = await runner.get(
      `SELECT id, account_id, status, total_cents, currency, expires_at,
              reservation_ids_json, version, snapshot_json
       FROM app_orders WHERE id = ?`,
      [orderId]
    );

    if (!order) {
      throw new PaymentAttemptError("ORDER_NOT_FOUND", "Pedido não encontrado.", { status: 404 });
    }

    if (order.account_id !== accountId) {
      throw new PaymentAttemptError("ORDER_NOT_FOUND", "Pedido não encontrado.", { status: 404 });
    }

    if (!isPayableStatus(order.status)) {
      throw new PaymentAttemptError(
        "ORDER_NOT_PAYABLE",
        `Pedido não está em estado pagável. Status atual: ${order.status}`,
        { status: 400, details: { current_status: order.status } }
      );
    }

    if (order.expires_at && new Date(order.expires_at) <= new Date()) {
      throw new PaymentAttemptError(
        "ORDER_EXPIRED",
        `Pedido expirou em ${order.expires_at}.`,
        { status: 410, details: { expired_at: order.expires_at } }
      );
    }

    if (!order.total_cents || order.total_cents <= 0) {
      throw new PaymentAttemptError("ORDER_TOTAL_INVALID", "Pedido não possui total válido.", { status: 400 });
    }

    if (order.currency !== "BRL") {
      throw new PaymentAttemptError(
        "ORDER_TOTAL_INVALID",
        `Pedido não é em BRL. Moeda: ${order.currency}`,
        { status: 400 }
      );
    }

    return order;
  }

  // ============================================================
  // IDEMPOTÊNCIA — Consulta de attempt existente
  // ============================================================
  async function findExistingAttempt(runner, orderId, fingerprint) {
    const row = await runner.get(
      `SELECT id, status, request_fingerprint, amount_cents, provider_reference,
              provider_transaction_nsu, provider_checkout_url, idempotency_key, created_at, updated_at
       FROM app_payment_attempts
       WHERE order_id = ? AND request_fingerprint = ?
       ORDER BY created_at DESC LIMIT 1`,
      [orderId, fingerprint]
    );
    return row;
  }

  // ============================================================
  // CRIAÇÃO DE PAYMENT ATTEMPT — Fluxo atomic local-first com BEGIN IMMEDIATE
  // ============================================================
  async function createPixAttempt(accountId, orderId, params = {}) {
    ensureFeatureEnabled();
    ensurePixOnlyConfirmed();
    const handle = ensureAdapterConfigured();

    // Transação serializada via transactionRunner (singleton por dbApi)
    // BEGIN IMMEDIATE → validação local → INSERT → COMMIT
    // Somente após COMMIT chama o provider
    let attemptId = generateId();
    let now = iso(new Date());
    let idempotencyKey = "";
    let fingerprint = "";
    let amountCents = 0;
    let reservationFingerprint = "";
    let existingResult = null;

    try {
      existingResult = await transactionRunner.withImmediateTransaction(async (runner) => {
        // 1. Reler pedido por id + account_id dentro da transação
        const order = await validateOrder(runner, accountId, orderId);
        amountCents = order.total_cents;

        // 2. Validar reserva usando o service compartilhado (tabelas reais PDV)
        let reservationResult;
        try {
          reservationResult = await reservationIntegrityService.validateReservationIntegrity(runner, order);
        } catch (integrityErr) {
          if (integrityErr instanceof ReservationIntegrityError) {
            throw new PaymentAttemptError(
              integrityErr.code,
              integrityErr.message,
              { status: 400, details: integrityErr.details }
            );
          }
          throw integrityErr;
        }

        // 4. Fingerprint real de reserva
        fingerprint = generateFingerprint({
          order_id: order.id,
          order_version: order.version,
          total_cents: amountCents,
          currency: order.currency,
          method: "PIX",
          reservation_fingerprint: reservationResult.reservationFingerprint,
        });
        reservationFingerprint = reservationResult.reservationFingerprint;

        // Idempotency key determinística
        idempotencyKey = `PIX::${fingerprint}`;

        // 5. Verificar attempt existente com mesmo fingerprint
        const existing = await findExistingAttempt(runner, orderId, fingerprint);
        if (existing) {
          // Já existe attempt com mesmo fingerprint — retornar existente (callback retorna, runner faz commit)
          return { type: "existing", attempt: existing };
        }

        // 6. Verificar conflito: attempt ativo com fingerprint diferente
        const existingActiveAttempt = await runner.get(
          `SELECT id, request_fingerprint, status FROM app_payment_attempts
           WHERE order_id = ? AND status IN ('PENDING', 'REQUESTING')
           ORDER BY created_at DESC LIMIT 1`,
          [orderId]
        );
        if (existingActiveAttempt && existingActiveAttempt.request_fingerprint !== fingerprint) {
          throw new PaymentAttemptError(
            "PAYMENT_IDEMPOTENCY_CONFLICT",
            "Fingerprint incompatível com tentativa existente.",
            { status: 409 }
          );
        }

        // 7. Inserir REQUESTING dentro da transação
        await runner.run(
          `INSERT INTO app_payment_attempts
           (id, order_id, provider, method, status, idempotency_key, amount_cents, currency,
            request_fingerprint, reservation_fingerprint, expires_at, created_at, updated_at, version)
           VALUES (?, ?, 'INFINITEPAY', 'PIX', 'REQUESTING', ?, ?, 'BRL', ?, ?, NULL, ?, ?, 1)`,
          [attemptId, orderId, idempotencyKey, amountCents, fingerprint, reservationResult.reservationFingerprint, now, now]
        );

        // 8. COMMIT — transação fechada antes de chamar o provider
        await runner.commit();
        return { type: "created", attemptId };
      });
    } catch (err) {
      if (err instanceof PaymentAttemptError) throw err;
      // UNIQUE constraint violada → attempt já existe (race condition)
      if (err.message && (err.message.includes("UNIQUE") || err.message.includes("unique"))) {
        const existing = await findExistingAttempt(db, orderId, fingerprint);
        if (existing) {
          if (existing.status === "REQUESTING") {
            return {
              success: true,
              attempt: existing,
              idempotent: true,
              reason: "RECONCILIATION_REQUIRED",
            };
          }
          if (existing.status === "FAILED") {
            return {
              success: true,
              attempt: existing,
              idempotent: true,
              reason: "EXISTING_FAILED_ATTEMPT",
            };
          }
          return {
            success: true,
            attempt: existing,
            idempotent: true,
            reason: "EXISTING_ATTEMPT_FOUND",
          };
        }
      }
      throw err;
    }

    // Processar resultado da transação
    if (existingResult && existingResult.type === "existing") {
      const existing = existingResult.attempt;
      if (existing.status === "REQUESTING") {
        return {
          success: true,
          attempt: existing,
          idempotent: true,
          reason: "RECONCILIATION_REQUIRED",
        };
      }
      if (existing.status === "FAILED") {
        return {
          success: true,
          attempt: existing,
          idempotent: true,
          reason: "EXISTING_FAILED_ATTEMPT",
        };
      }
      return {
        success: true,
        attempt: existing,
        idempotent: true,
        reason: "EXISTING_ATTEMPT_FOUND",
      };
    }

    // ============================================================
    // Somente após COMMIT chama o provider (transação já fechada)
    // ============================================================
    let adapterResult;
    try {
      adapterResult = await infinitePayAdapter.createPixPayment({
        handle,
        order_nsu: orderId,
        items: [{
          quantity: 1,
          price: amountCents,
          description: `Pedido ${orderId}`,
        }],
        amount_cents: amountCents,
      });
    } catch (adapterErr) {
      // Falha na chamada ao provider → attempt permanece REQUESTING
      // Retornar RECONCILIATION_REQUIRED para que o retry trate
      return {
        success: true,
        attempt_id: attemptId,
        attempt: await findExistingAttempt(db, orderId, fingerprint),
        idempotent: true,
        reason: "RECONCILIATION_REQUIRED",
      };
    }

    // Processar resposta do adapter
    if (!adapterResult.success) {
      // Falha no provider → atualizar para FAILED
      const sanitized = sanitizeResponse(adapterResult.details || adapterResult);
      const failureCode = adapterResult.error || "INFINITEPAY_API_ERROR";
      const failureMessage = sanitizeFailureMessage(adapterResult.message || "Erro desconhecido");
      const now2 = iso(new Date());

      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'FAILED', failure_code = ?, failure_message_sanitized = ?,
             provider_response_sanitized_json = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND status = 'REQUESTING'`,
        [failureCode, failureMessage, JSON.stringify(sanitized), now2, attemptId]
      );

      return {
        success: false,
        error: failureCode,
        message: failureMessage,
        attempt_id: attemptId,
      };
    }

    // Atualizar para PENDING com provider_reference NULL-safe e transaction_nsu
    const providerReference = adapterResult.invoice_slug || null;
    const providerTransactionNsu = adapterResult.raw?.transaction_nsu || adapterResult.transaction_nsu || null;
    const checkoutUrl = adapterResult.url || "";
    const sanitizedRaw = sanitizeResponse(adapterResult.raw || {});
    const now3 = iso(new Date());

    let updateResult;
    try {
      updateResult = await db.run(
        `UPDATE app_payment_attempts
         SET status = 'PENDING', provider_reference = ?, provider_transaction_nsu = ?,
             provider_checkout_url = ?, provider_response_sanitized_json = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND status = 'REQUESTING'`,
        [providerReference, providerTransactionNsu, checkoutUrl, JSON.stringify(sanitizedRaw), now3, attemptId]
      );
    } catch (updateErr) {
      // UPDATE throw (exceção) → attempt permanece REQUESTING, provider já foi chamado
      // Retornar RECONCILIATION_REQUIRED para que o retry trate
      return {
        success: true,
        attempt_id: attemptId,
        attempt: await findExistingAttempt(db, orderId, fingerprint),
        idempotent: true,
        reason: "RECONCILIATION_REQUIRED",
      };
    }

    // Se update falhou (attempt não mais REQUESTING), não re-chamar provider
    if (updateResult.changes === 0) {
      return {
        success: true,
        attempt: await findExistingAttempt(db, orderId, fingerprint),
        idempotent: true,
        reason: "RECONCILIATION_REQUIRED",
      };
    }

    return {
      success: true,
      attempt: {
        id: attemptId,
        order_id: orderId,
        provider: "INFINITEPAY",
        method: "PIX",
        status: "PENDING",
        idempotency_key: idempotencyKey,
        provider_reference: providerReference,
        provider_transaction_nsu: providerTransactionNsu,
        provider_checkout_url: checkoutUrl,
        provider_pix_copy_paste: null,
        amount_cents: amountCents,
        currency: "BRL",
        request_fingerprint: fingerprint,
        reservation_fingerprint: reservationFingerprint,
      },
    };
  }

  // ============================================================
  // CONSULTA DE STATUS COM AUTORIZAÇÃO E CONTRATO PIX
  // ============================================================
  async function getPixAttemptStatus(accountId, attemptId) {
    ensureFeatureEnabled();
    ensurePixOnlyConfirmed();
    const handle = ensureAdapterConfigured();

    // Buscar attempt com JOIN para verificar account_id
    const attempt = await db.get(
      `SELECT pa.* FROM app_payment_attempts pa
       INNER JOIN app_orders o ON pa.order_id = o.id
       WHERE pa.id = ? AND o.account_id = ?`,
      [attemptId, accountId]
    );

    if (!attempt) {
      throw new PaymentAttemptError(
        "PAYMENT_ATTEMPT_NOT_FOUND",
        "Tentativa não encontrada.",
        { status: 404 }
      );
    }

    // Se já terminal, não consultar
    if (isTerminalState(attempt.status)) {
      return {
        success: true,
        attempt,
        from_cache: true,
      };
    }

    // Se REQUESTING: não consultar provider, retornar RECONCILIATION_REQUIRED
    if (attempt.status === "REQUESTING") {
      return {
        success: true,
        attempt,
        from_cache: false,
        reason: "RECONCILIATION_REQUIRED",
      };
    }

    // Consultar provider
    const statusResult = await infinitePayAdapter.getPixPaymentStatus({
      handle,
      order_nsu: attempt.order_id,
      transaction_nsu: attempt.provider_transaction_nsu || "",
      slug: attempt.provider_reference || "",
    });

    if (!statusResult.success) {
      return {
        success: false,
        error: statusResult.error,
        message: statusResult.message,
      };
    }

    // Contrato PIX: validações
    const rawCaptureMethod = (statusResult.raw?.capture_method || "").toLowerCase();
    const rawAmount = statusResult.amount || statusResult.raw?.amount || 0;
    const now = iso(new Date());

    // capture_method ausente → REVIEW_REQUIRED
    if (!rawCaptureMethod) {
      const sanitized = sanitizeResponse(statusResult.raw || {});
      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'REVIEW_REQUIRED', provider_response_sanitized_json = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
        [JSON.stringify(sanitized), now, attemptId]
      );
      return {
        success: true,
        attempt: { ...attempt, status: "REVIEW_REQUIRED" },
        from_cache: false,
        review_reason: "capture_method_ausente",
      };
    }

    // capture_method diferente de pix → REVIEW_REQUIRED
    if (rawCaptureMethod !== "pix") {
      const sanitized = sanitizeResponse(statusResult.raw || {});
      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'REVIEW_REQUIRED', provider_response_sanitized_json = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
        [JSON.stringify(sanitized), now, attemptId]
      );
      return {
        success: true,
        attempt: { ...attempt, status: "REVIEW_REQUIRED" },
        from_cache: false,
        review_reason: `capture_method_inesperado: ${rawCaptureMethod}`,
      };
    }

    // amount ausente → REVIEW_REQUIRED
    if (!rawAmount) {
      const sanitized = sanitizeResponse(statusResult.raw || {});
      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'REVIEW_REQUIRED', provider_response_sanitized_json = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
        [JSON.stringify(sanitized), now, attemptId]
      );
      return {
        success: true,
        attempt: { ...attempt, status: "REVIEW_REQUIRED" },
        from_cache: false,
        review_reason: "amount_ausente",
      };
    }

    // amount diferente de amount_cents → REVIEW_REQUIRED
    if (rawAmount !== attempt.amount_cents) {
      const sanitized = sanitizeResponse(statusResult.raw || {});
      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'REVIEW_REQUIRED', provider_response_sanitized_json = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
        [JSON.stringify(sanitized), now, attemptId]
      );
      return {
        success: true,
        attempt: { ...attempt, status: "REVIEW_REQUIRED" },
        from_cache: false,
        review_reason: `amount_mismatch: provider=${rawAmount}, local=${attempt.amount_cents}`,
      };
    }

    // order_nsu diferente → REVIEW_REQUIRED
    const rawOrderNsu = statusResult.raw?.order_nsu || "";
    if (rawOrderNsu && rawOrderNsu !== attempt.order_id) {
      const sanitized = sanitizeResponse(statusResult.raw || {});
      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'REVIEW_REQUIRED', provider_response_sanitized_json = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
        [JSON.stringify(sanitized), now, attemptId]
      );
      return {
        success: true,
        attempt: { ...attempt, status: "REVIEW_REQUIRED" },
        from_cache: false,
        review_reason: `order_nsu_mismatch: provider=${rawOrderNsu}, local=${attempt.order_id}`,
      };
    }

    // Persistir transaction_nsu quando retornado
    const transactionNsu = statusResult.raw?.transaction_nsu || null;
    if (transactionNsu && transactionNsu !== attempt.provider_transaction_nsu) {
      await db.run(
        `UPDATE app_payment_attempts
         SET provider_transaction_nsu = ?, updated_at = ?, version = version + 1
         WHERE id = ?`,
        [transactionNsu, now, attemptId]
      );
    }

    // Nesta fase: mesmo paid=true, capture_method=pix, amount correto
    // → REVIEW_REQUIRED (confirmação definitiva ficará para webhook/conciliação)
    // provider_pix_copy_paste permanece NULL
    // O pedido nunca deve ser marcado PAID nesta fase
    const sanitized = sanitizeResponse(statusResult.raw || {});
    await db.run(
      `UPDATE app_payment_attempts
       SET status = 'REVIEW_REQUIRED', provider_response_sanitized_json = ?,
           updated_at = ?, version = version + 1
       WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
      [JSON.stringify(sanitized), now, attemptId]
    );

    return {
      success: true,
      attempt: { ...attempt, status: "REVIEW_REQUIRED" },
      from_cache: false,
    };
  }

  // ============================================================
  // LISTAR ATTEMPTS POR PEDIDO COM AUTORIZAÇÃO
  // ============================================================
  async function listAttemptsByOrder(accountId, orderId) {
    const order = await db.get(
      `SELECT id FROM app_orders WHERE id = ? AND account_id = ?`,
      [orderId, accountId]
    );

    if (!order) {
      throw new PaymentAttemptError("ORDER_NOT_FOUND", "Pedido não encontrado.", { status: 404 });
    }

    const rows = await db.all(
      `SELECT id, order_id, provider, method, status, idempotency_key,
              provider_reference, provider_transaction_nsu, provider_checkout_url, amount_cents, currency,
              request_fingerprint, reservation_fingerprint, failure_code, failure_message_sanitized,
              expires_at, created_at, updated_at, version
       FROM app_payment_attempts WHERE order_id = ?
       ORDER BY created_at DESC`,
      [orderId]
    );
    return { success: true, attempts: rows };
  }

  return {
    createPixAttempt,
    getPixAttemptStatus,
    listAttemptsByOrder,
    validateOrder,
    PaymentAttemptError,
    isFeatureEnabled,
  };
}

module.exports = { createPaymentAttemptService, PaymentAttemptError };
