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

function iso(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

function generateId() {
  return randomUUID();
}

function isFeatureEnabled() {
  return process.env[FEATURE_FLAG] === "true";
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

  // ============================================================
  // VALIDAÇÃO DO PEDIDO
  // ============================================================
  async function validateOrder(orderId) {
    const order = await db.get(
      `SELECT id, status, total_cents, currency, expires_at, reservation_ids_json, version
       FROM app_orders WHERE id = ?`,
      [orderId]
    );

    if (!order) {
      throw new PaymentAttemptError(
        "ORDER_NOT_FOUND",
        `Pedido ${orderId} não encontrado.`,
        { status: 404 }
      );
    }

    // Status deve ser READY_FOR_PAYMENT
    if (!isPayableStatus(order.status)) {
      throw new PaymentAttemptError(
        "ORDER_NOT_PAYABLE",
        `Pedido ${orderId} não está em estado pagável. Status atual: ${order.status}`,
        { status: 400, details: { current_status: order.status } }
      );
    }

    // Expiração
    if (order.expires_at && new Date(order.expires_at) <= new Date()) {
      throw new PaymentAttemptError(
        "ORDER_EXPIRED",
        `Pedido ${orderId} expirou em ${order.expires_at}.`,
        { status: 410, details: { expired_at: order.expires_at } }
      );
    }

    // Total vem exclusivamente do backend
    if (!order.total_cents || order.total_cents <= 0) {
      throw new PaymentAttemptError(
        "ORDER_TOTAL_INVALID",
        `Pedido ${orderId} não possui total válido.`,
        { status: 400 }
      );
    }

    // Currency = BRL
    if (order.currency !== "BRL") {
      throw new PaymentAttemptError(
        "ORDER_TOTAL_INVALID",
        `Pedido ${orderId} não é em BRL. Moeda: ${order.currency}`,
        { status: 400 }
      );
    }

    // Reserva válida
    let reservationIds = [];
    try {
      reservationIds = JSON.parse(order.reservation_ids_json || "[]");
    } catch {
      reservationIds = [];
    }

    if (reservationIds.length === 0) {
      throw new PaymentAttemptError(
        "ORDER_RESERVATION_INVALID",
        `Pedido ${orderId} não possui reservas de estoque.`,
        { status: 400 }
      );
    }

    // Verificar integridade da reserva
    for (const resId of reservationIds) {
      if (!resId || typeof resId !== "string") {
        throw new PaymentAttemptError(
          "ORDER_RESERVATION_INVALID",
          `Pedido ${orderId} possui reserva inválida.`,
          { status: 400 }
        );
      }
    }

    return order;
  }

  // ============================================================
  // IDEMPOTÊNCIA — Consulta de attempt existente
  // ============================================================
  async function findExistingAttempt(orderId, fingerprint) {
    const row = await db.get(
      `SELECT id, status, request_fingerprint, amount_cents, provider_reference, idempotency_key
       FROM app_payment_attempts
       WHERE order_id = ? AND request_fingerprint = ?
       ORDER BY created_at DESC LIMIT 1`,
      [orderId, fingerprint]
    );
    return row;
  }

  // ============================================================
  // CONCORRÊNCIA — Lock otimista via versão
  // ============================================================
  async function lockOrderForPayment(orderId, currentVersion) {
    const result = await db.run(
      `UPDATE app_orders SET version = version + 1
       WHERE id = ? AND version = ? AND status = 'READY_FOR_PAYMENT'`,
      [orderId, currentVersion]
    );
    if (result.changes === 0) {
      throw new PaymentAttemptError(
        "ORDER_RESERVATION_INVALID",
        `Pedido ${orderId} mudou de estado durante a operação.`,
        { status: 409 }
      );
    }
    return result;
  }

  // ============================================================
  // CRIAÇÃO DE PAYMENT ATTEMPT
  // ============================================================
  async function createPixAttempt(orderId, params = {}) {
    ensureFeatureEnabled();
    const handle = ensureAdapterConfigured();

    // 1. Validar pedido (re-leitura)
    const order = await validateOrder(orderId);

    // 2. Nenhum valor do app substitui o total
    const amountCents = order.total_cents;

    // 3. Ignora clientAmountCents — total vem exclusivamente do servidor
    // Se client tentou enviar valor diferente, simplesmente usa o do servidor

    // 4. Lock otimista do pedido
    await lockOrderForPayment(orderId, order.version);

    // 5. Gerar fingerprint determinístico (independente da versão do pedido)
    const fingerprint = generateFingerprint({
      order_id: order.id,
      amount_cents: amountCents,
      currency: order.currency,
      method: "PIX",
    });

    // 6. Verificar idempotência
    const existing = await findExistingAttempt(orderId, fingerprint);
    if (existing) {
      // Retry idêntico: retorna o mesmo attempt
      return {
        success: true,
        attempt: existing,
        idempotent: true,
        reason: "EXISTING_ATTEMPT_FOUND",
      };
    }

    // 7. Verificar se já existe attempt ativo para o pedido
    const activeAttempt = await db.get(
      `SELECT id, status FROM app_payment_attempts
       WHERE order_id = ? AND status IN ('REQUESTING', 'PENDING')
       ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    );
    if (activeAttempt) {
      throw new PaymentAttemptError(
        "PAYMENT_ATTEMPT_CONFLICT",
        `Já existe tentativa ativa para o pedido ${orderId}.`,
        { status: 409, details: { existing_id: activeAttempt.id, existing_status: activeAttempt.status } }
      );
    }

    // 8. Criar attempt local com status CREATED
    const attemptId = generateId();
    const now = iso(new Date());
    const expiresAt = params.expires_at || null;
    const idempotencyKey = `PIX::${orderId}::${fingerprint}::${Date.now()}`;

    await db.run(
      `INSERT INTO app_payment_attempts
       (id, order_id, provider, method, status, idempotency_key, amount_cents, currency,
        request_fingerprint, expires_at, created_at, updated_at, version)
       VALUES (?, ?, 'INFINITEPAY', 'PIX', 'REQUESTING', ?, ?, 'BRL', ?, ?, ?, ?, 1)`,
      [attemptId, orderId, idempotencyKey, amountCents, fingerprint, expiresAt, now, now]
    );

    // 9. Chamar adapter (COM transporte real ou fake)
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

    // 10. Processar resposta do adapter
    if (!adapterResult.success) {
      // Falha: atualizar para FAILED
      const sanitized = sanitizeResponse(adapterResult.details || adapterResult);
      const failureCode = adapterResult.error || "INFINITEPAY_API_ERROR";
      const failureMessage = sanitizeFailureMessage(adapterResult.message || "Erro desconhecido");

      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'FAILED', failure_code = ?, failure_message_sanitized = ?,
             provider_response_sanitized_json = ?, updated_at = ?, version = version + 1
         WHERE id = ?`,
        [failureCode, failureMessage, JSON.stringify(sanitized), now, attemptId]
      );

      return {
        success: false,
        error: failureCode,
        message: failureMessage,
        attempt_id: attemptId,
      };
    }

    // 11. Sucesso: atualizar para PENDING com dados do provider
    const sanitizedRaw = sanitizeResponse(adapterResult.raw || {});
    const pixCopyPaste = adapterResult.url || "";

    await db.run(
      `UPDATE app_payment_attempts
       SET status = 'PENDING', provider_reference = ?, provider_checkout_url = ?,
           provider_pix_copy_paste = ?, provider_response_sanitized_json = ?,
           updated_at = ?, version = version + 1
       WHERE id = ?`,
      [
        adapterResult.invoice_slug || "",
        adapterResult.url || "",
        pixCopyPaste,
        JSON.stringify(sanitizedRaw),
        now,
        attemptId,
      ]
    );

    return {
      success: true,
      attempt: {
        id: attemptId,
        order_id: orderId,
        provider: "INFINITEPAY",
        method: "PIX",
        status: "PENDING",
        idempotency_key: idempotencyKey,
        provider_reference: adapterResult.invoice_slug || "",
        provider_checkout_url: adapterResult.url || "",
        provider_pix_copy_paste: pixCopyPaste,
        amount_cents: amountCents,
        currency: "BRL",
        request_fingerprint: fingerprint,
      },
    };
  }

  // ============================================================
  // CONSULTA DE STATUS
  // ============================================================
  async function getPixAttemptStatus(attemptId) {
    ensureFeatureEnabled();
    const handle = ensureAdapterConfigured();

    const attempt = await db.get(
      `SELECT * FROM app_payment_attempts WHERE id = ?`,
      [attemptId]
    );

    if (!attempt) {
      throw new PaymentAttemptError(
        "PAYMENT_ATTEMPT_NOT_FOUND",
        `Tentativa ${attemptId} não encontrada.`,
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

    // Estado desconhecido vira REVIEW_REQUIRED
    const rawStatus = (statusResult.raw?.status || "").toUpperCase();
    let newStatus = attempt.status;
    if (rawStatus && !["PAID", "PENDING", "EXPIRED", "FAILED"].includes(rawStatus)) {
      newStatus = "REVIEW_REQUIRED";
    } else if (statusResult.paid) {
      newStatus = "PAID";
    }

    if (newStatus !== attempt.status && isAllowedTransition(attempt.status, newStatus)) {
      const now = iso(new Date());
      await db.run(
        `UPDATE app_payment_attempts
         SET status = ?, provider_response_sanitized_json = ?, updated_at = ?, version = version + 1
         WHERE id = ?`,
        [newStatus, JSON.stringify(sanitizeResponse(statusResult.raw || {})), now, attemptId]
      );
      attempt.status = newStatus;
      attempt.version = (attempt.version || 1) + 1;
      attempt.updated_at = now;
    }

    return {
      success: true,
      attempt,
      from_cache: false,
    };
  }

  // ============================================================
  // LISTAR ATTEMPTS POR PEDIDO
  // ============================================================
  async function listAttemptsByOrder(orderId) {
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
