"use strict";
const { randomUUID } = require("crypto");
const { generateFingerprint } = require("./fingerprint");
const { sanitizeResponse, sanitizeFailureMessage } = require("./sanitizeResponse");
const {
  isAllowedTransition,
  isTerminalState,
  isPayableStatus,
} = require("./paymentAttemptStates");

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

  if (!db) {
    throw new Error("DB_API_REQUIRED for paymentAttemptService");
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
  async function validateOrder(accountId, orderId) {
    const order = await db.get(
      `SELECT id, account_id, status, total_cents, currency, expires_at,
              reservation_ids_json, version, snapshot_json
       FROM app_orders WHERE id = ?`,
      [orderId]
    );

    if (!order) {
      throw new PaymentAttemptError(
        "ORDER_NOT_FOUND",
        "Pedido não encontrado.",
        { status: 404 }
      );
    }

    // Autorização por conta: não revelar se pertence a outra conta
    if (order.account_id !== accountId) {
      throw new PaymentAttemptError(
        "ORDER_NOT_FOUND",
        "Pedido não encontrado.",
        { status: 404 }
      );
    }

    // Status deve ser READY_FOR_PAYMENT
    if (!isPayableStatus(order.status)) {
      throw new PaymentAttemptError(
        "ORDER_NOT_PAYABLE",
        `Pedido não está em estado pagável. Status atual: ${order.status}`,
        { status: 400, details: { current_status: order.status } }
      );
    }

    // Expiração
    if (order.expires_at && new Date(order.expires_at) <= new Date()) {
      throw new PaymentAttemptError(
        "ORDER_EXPIRED",
        `Pedido expirou em ${order.expires_at}.`,
        { status: 410, details: { expired_at: order.expires_at } }
      );
    }

    // Total vem exclusivamente do backend
    if (!order.total_cents || order.total_cents <= 0) {
      throw new PaymentAttemptError(
        "ORDER_TOTAL_INVALID",
        "Pedido não possui total válido.",
        { status: 400 }
      );
    }

    // Currency = BRL
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
  // VALIDAÇÃO REAL DE RESERVA (reutiliza lógica de Phase 3.7)
  // ============================================================
  async function validateReservationIntegrity(order) {
    let reservationIds = [];
    try {
      reservationIds = JSON.parse(order.reservation_ids_json || "[]");
    } catch {
      reservationIds = [];
    }

    if (reservationIds.length === 0) {
      throw new PaymentAttemptError(
        "ORDER_RESERVATION_INVALID",
        "Pedido não possui reservas de estoque.",
        { status: 400 }
      );
    }

    // Verificar cada reservation_id: existe e tem HOLD válido
    const errors = [];
    let totalHoldByStoreVariant = {};

    for (const resId of reservationIds) {
      if (!resId || typeof resId !== "string") {
        errors.push("reservation_id inválido");
        continue;
      }

      const movement = await db.get(
        `SELECT id, reservation_id, movement_type, quantity_delta, store_id, variant_id,
                order_id, created_at
         FROM reservation_movements WHERE reservation_id = ? ORDER BY created_at ASC`,
        [resId]
      );

      if (!movement) {
        errors.push(`reservation_id ${resId} não encontrado`);
        continue;
      }

      // Deve ser HOLD (quantity_delta < 0)
      if (movement.movement_type !== "RESERVATION_HOLD") {
        errors.push(`reservation_id ${resId} não é HOLD`);
        continue;
      }

      if (movement.quantity_delta >= 0) {
        errors.push(`reservation_id ${resId} tem delta >= 0`);
        continue;
      }

      // Verificar saldo: reserved_qty deve suportar a quantidade reservada
      const balance = await db.get(
        `SELECT id, reserved_qty FROM inventory_balance
         WHERE store_id = ? AND variant_id = ?`,
        [movement.store_id, movement.variant_id]
      );

      if (balance) {
        const absDelta = Math.abs(movement.quantity_delta);
        if (balance.reserved_qty < absDelta) {
          errors.push(`saldo insuficiente para reserva ${resId}`);
        }
      }

      // Agregar total HOLD por store+variant
      const key = `${movement.store_id}::${movement.variant_id}`;
      totalHoldByStoreVariant[key] = (totalHoldByStoreVariant[key] || 0) + Math.abs(movement.quantity_delta);
    }

    if (errors.length > 0) {
      throw new PaymentAttemptError(
        "ORDER_RESERVATION_INVALID",
        "Reservas inválidas detectadas.",
        { status: 400, details: { errors: errors.slice(0, 5) } }
      );
    }

    return { reservationIds, totalHoldByStoreVariant };
  }

  // ============================================================
  // IDEMPOTÊNCIA — Consulta de attempt existente
  // ============================================================
  async function findExistingAttempt(orderId, fingerprint) {
    const row = await db.get(
      `SELECT id, status, request_fingerprint, amount_cents, provider_reference,
              provider_checkout_url, idempotency_key, created_at, updated_at
       FROM app_payment_attempts
       WHERE order_id = ? AND request_fingerprint = ?
       ORDER BY created_at DESC LIMIT 1`,
      [orderId, fingerprint]
    );
    return row;
  }

  // ============================================================
  // CRIAÇÃO DE PAYMENT ATTEMPT — Fluxo atomic local-first
  // ============================================================
  async function createPixAttempt(accountId, orderId, params = {}) {
    ensureFeatureEnabled();
    ensurePixOnlyConfirmed();
    const handle = ensureAdapterConfigured();

    // 1. Validar pedido com autorização por conta
    const order = await validateOrder(accountId, orderId);

    // 2. Validar integridade da reserva (real, não apenas JSON não vazio)
    const { reservationIds, totalHoldByStoreVariant } = await validateReservationIntegrity(order);

    // 3. Nenhum valor do app substitui o total
    const amountCents = order.total_cents;

    // 4. Gerar fingerprint determinístico INCLUINDO snapshot/version da reserva
    const fingerprint = generateFingerprint({
      order_id: order.id,
      order_version: order.version,
      amount_cents: amountCents,
      currency: order.currency,
      method: "PIX",
      reservation_version: reservationIds.sort().join("::"),
    });

    // 5. Chave idempotência determinística: PIX::<fingerprint>
    const idempotencyKey = `PIX::${fingerprint}`;

    // 6. Verificar se já existe tentativa PENDING/REQUESTING para este pedido com fingerprint diferente
    const existingActiveAttempt = await db.get(
      `SELECT id, request_fingerprint, amount_cents, status FROM app_payment_attempts
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

    // 7. Tentar INSERT local com REQUESTING (atomic local-first)
    const attemptId = generateId();
    const now = iso(new Date());

    let insertResult;
    try {
      insertResult = await db.run(
        `INSERT INTO app_payment_attempts
         (id, order_id, provider, method, status, idempotency_key, amount_cents, currency,
          request_fingerprint, expires_at, created_at, updated_at, version)
         VALUES (?, ?, 'INFINITEPAY', 'PIX', 'REQUESTING', ?, ?, 'BRL', ?, NULL, ?, ?, 1)`,
        [attemptId, orderId, idempotencyKey, amountCents, fingerprint, now, now]
      );
    } catch (err) {
      // Constraint UNIQUE violada: retry idêntico
      if (err.message && (err.message.includes("UNIQUE") || err.message.includes("unique"))) {
        const existing = await findExistingAttempt(orderId, fingerprint);
        if (existing) {
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

    // 7. Somente o vencedor chama o provider
    // 8. Atualizar attempt com resposta do provider
    const adapterResult = await infinitePayAdapter.createPixPayment({
      handle,
      order_nsu: orderId,
      items: [{
        quantity: 1,
        price: amountCents,
        description: `Pedido ${orderId}`,
      }],
      amount_cents: amountCents,
    });

    // 9. Processar resposta do adapter
    if (!adapterResult.success) {
      // Falha: atualizar para FAILED com lock otimista
      const sanitized = sanitizeResponse(adapterResult.details || adapterResult);
      const failureCode = adapterResult.error || "INFINITEPAY_API_ERROR";
      const failureMessage = sanitizeFailureMessage(adapterResult.message || "Erro desconhecido");

      const updateResult = await db.run(
        `UPDATE app_payment_attempts
         SET status = 'FAILED', failure_code = ?, failure_message_sanitized = ?,
             provider_response_sanitized_json = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND status = 'REQUESTING'`,
        [failureCode, failureMessage, JSON.stringify(sanitized), now, attemptId]
      );

      return {
        success: false,
        error: failureCode,
        message: failureMessage,
        attempt_id: attemptId,
      };
    }

    // 10. Validar contrato PIX: capture_method deve ser pix
    // 11. NÃO marcar como PAID nesta fase — usar REVIEW_REQUIRED
    // 12. provider_pix_copy_paste deve permanecer NULL
    // 13. URL só em provider_checkout_url
    // 14. provider_reference: NULL-safe (não string vazia)
    const providerReference = adapterResult.invoice_slug || null;
    const checkoutUrl = adapterResult.url || "";
    const sanitizedRaw = sanitizeResponse(adapterResult.raw || {});

    const updateResult = await db.run(
      `UPDATE app_payment_attempts
       SET status = 'PENDING', provider_reference = ?, provider_checkout_url = ?,
           provider_response_sanitized_json = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND status = 'REQUESTING'`,
      [providerReference, checkoutUrl, JSON.stringify(sanitizedRaw), now, attemptId]
    );

    // Se update falhou (attempt não mais REQUESTING), não re-chamar provider
    if (updateResult.changes === 0) {
      // Tentativa concorrente já atualizou — reconciliação necessária
      return {
        success: true,
        attempt: await findExistingAttempt(orderId, fingerprint),
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
        provider_checkout_url: checkoutUrl,
        provider_pix_copy_paste: null,
        amount_cents: amountCents,
        currency: "BRL",
        request_fingerprint: fingerprint,
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

    // Consultar provider
    const statusResult = await infinitePayAdapter.getPixPaymentStatus({
      handle,
      order_nsu: attempt.order_id,
      transaction_nsu: attempt.provider_reference || "",
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

    // capture_method diferente de pix → REVIEW_REQUIRED
    if (rawCaptureMethod && rawCaptureMethod !== "pix") {
      // credit_card ou outro → REVIEW_REQUIRED
      const sanitized = sanitizeResponse(statusResult.raw || {});
      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'REVIEW_REQUIRED', provider_response_sanitized_json = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
        [JSON.stringify(sanitized), iso(new Date()), attemptId]
      );
      return {
        success: true,
        attempt: { ...attempt, status: "REVIEW_REQUIRED" },
        from_cache: false,
        review_reason: `capture_method_inesperado: ${rawCaptureMethod}`,
      };
    }

    // capture_method ausente → REVIEW_REQUIRED
    if (!rawCaptureMethod) {
      const sanitized = sanitizeResponse(statusResult.raw || {});
      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'REVIEW_REQUIRED', provider_response_sanitized_json = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
        [JSON.stringify(sanitized), iso(new Date()), attemptId]
      );
      return {
        success: true,
        attempt: { ...attempt, status: "REVIEW_REQUIRED" },
        from_cache: false,
        review_reason: "capture_method_ausente",
      };
    }

    // amount deve coincidir exatamente com amount_cents do attempt
    if (rawAmount && rawAmount !== attempt.amount_cents) {
      const sanitized = sanitizeResponse(statusResult.raw || {});
      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'REVIEW_REQUIRED', provider_response_sanitized_json = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
        [JSON.stringify(sanitized), iso(new Date()), attemptId]
      );
      return {
        success: true,
        attempt: { ...attempt, status: "REVIEW_REQUIRED" },
        from_cache: false,
        review_reason: `amount_mismatch: provider=${rawAmount}, local=${attempt.amount_cents}`,
      };
    }

    // order_nsu deve coincidir com order_id
    const rawOrderNsu = statusResult.raw?.order_nsu || "";
    if (rawOrderNsu && rawOrderNsu !== attempt.order_id) {
      const sanitized = sanitizeResponse(statusResult.raw || {});
      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'REVIEW_REQUIRED', provider_response_sanitized_json = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
        [JSON.stringify(sanitized), iso(new Date()), attemptId]
      );
      return {
        success: true,
        attempt: { ...attempt, status: "REVIEW_REQUIRED" },
        from_cache: false,
        review_reason: `order_nsu_mismatch: provider=${rawOrderNsu}, local=${attempt.order_id}`,
      };
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
      [JSON.stringify(sanitized), iso(new Date()), attemptId]
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
    // Verificar que o pedido pertence à conta
    const order = await db.get(
      `SELECT id FROM app_orders WHERE id = ? AND account_id = ?`,
      [orderId, accountId]
    );

    if (!order) {
      throw new PaymentAttemptError(
        "ORDER_NOT_FOUND",
        "Pedido não encontrado.",
        { status: 404 }
      );
    }

    const rows = await db.all(
      `SELECT id, order_id, provider, method, status, idempotency_key,
              provider_reference, provider_checkout_url, amount_cents, currency,
              request_fingerprint, failure_code, failure_message_sanitized,
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
