"use strict";

/**
 * infinitePayReconciliationService — Reconciliação e finalização de pagamento PIX.
 *
 * Responsabilidades:
 *   1. Validar webhook payload (sem marcar PAID)
 *   2. Consultar payment_check via adapter (confirmação definitiva)
 *   3. Finalizar atomicamente: tentativa PAID + pedido PAID + baixa estoque (SALE)
 *   4. Idempotência: webhook duplicado e reconcile simultâneo
 *
 * CONTRATOS DE RAZÃO DE FALHA:
 *   CAPTURE_METHOD_MISMATCH
 *   AMOUNT_MISMATCH
 *   ORDER_NSU_MISMATCH
 *   TRANSACTION_NSU_MISMATCH
 *   PAYMENT_NOT_CONFIRMED
 *   PAYMENT_ATTEMPT_NOT_FOUND
 *   PAYMENT_RECONCILIATION_REQUIRED
 *   FINALIZATION_FAILED
 *   ORDER_ALREADY_PAID
 *
 * PROIBIÇÕES:
 *   - Nunca marcar PAID sem payment_check confirmado
 *   - Nunca baixar estoque sem validação completa
 *   - Nunca fazer HTTP dentro da transação
 *   - Nunca criar segunda baixa de estoque
 */

const { randomUUID, createHash } = require("crypto");
const { sanitizeResponse, sanitizeFailureMessage } = require("./sanitizeResponse");

const RECONCILIATION_ENABLED_FLAG = "INFINITEPAY_RECONCILIATION_ENABLED";

function iso(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

class ReconciliationError extends Error {
  constructor(code, message, { status = 400, details = null } = {}) {
    super(message);
    this.name = "ReconciliationError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function createInfinitePayReconciliationService(options = {}) {
  const db = options.dbApi;
  const infinitePayAdapter = options.infinitePayAdapter;
  const getInfinitePayHandle = options.getInfinitePayHandle || (() => process.env.INFINITEPAY_HANDLE || "");
  const getRedirectUrl = options.getRedirectUrl || (() => process.env.INFINITEPAY_REDIRECT_URL || "");
  const getWebhookUrl = options.getWebhookUrl || (() => process.env.INFINITEPAY_WEBHOOK_URL || "");
  const inventoryService = options.inventoryService || null;

  if (!db) {
    throw new Error("DB_API_REQUIRED for reconciliationService");
  }
  if (!infinitePayAdapter) {
    throw new Error("INFINITEPAY_ADAPTER_REQUIRED for reconciliationService");
  }

  // Singleton transactionRunner compartilhado pelo dbApi
  const { createTransactionRunner } = require("./transactionRunner");
  const _runnerCache = global.__transactionRunnerCache || (global.__transactionRunnerCache = new WeakMap());
  let transactionRunner = options.transactionRunner || null;
  if (!transactionRunner) {
    if (!_runnerCache.has(db)) {
      _runnerCache.set(db, createTransactionRunner(db));
    }
    transactionRunner = _runnerCache.get(db);
  }

  // ============================================================
  // FEATURE FLAGS
  // ============================================================
  function isReconciliationEnabled() {
    return process.env[RECONCILIATION_ENABLED_FLAG] === "true";
  }

  function ensureReconciliationEnabled() {
    if (!isReconciliationEnabled()) {
      throw new ReconciliationError(
        "RECONCILIATION_DISABLED",
        "Reconciliação desabilitada. Configure INFINITEPAY_RECONCILIATION_ENABLED=true.",
        { status: 403 }
      );
    }
  }

  // ============================================================
  // EVENT RECORDING
  // ============================================================
  async function recordEvent(params) {
    const {
      provider,
      eventType,
      orderId,
      paymentAttemptId,
      providerReference,
      providerTransactionNsu,
      requestHash,
      payloadSanitized,
      processingStatus = "RECEIVED",
      failureCode = null,
      failureMessage = null,
      receivedAt,
    } = params;

    const now = iso(new Date());
    const id = randomUUID();

    const result = await db.run(
      `INSERT OR IGNORE INTO app_payment_events
       (id, provider, event_type, order_id, payment_attempt_id,
        provider_reference, provider_transaction_nsu, request_hash,
        payload_sanitized_json, processing_status, failure_code,
        failure_message_sanitized, received_at, processed_at,
        created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        id,
        provider,
        eventType,
        orderId || null,
        paymentAttemptId || null,
        providerReference || null,
        providerTransactionNsu || null,
        requestHash || null,
        JSON.stringify(payloadSanitized || {}),
        processingStatus,
        failureCode || null,
        failureMessage || null,
        receivedAt || now,
        processingStatus === "PROCESSED" ? now : null,
        now,
        now,
      ]
    );

    return { id, event_id: id, inserted: (result?.changes || 0) > 0 };
  }

  async function findExistingEvent(requestHash, provider) {
    return db.get(
      `SELECT * FROM app_payment_events
       WHERE request_hash = ? AND provider = ?
       LIMIT 1`,
      [requestHash, provider]
    );
  }

  // ============================================================
  // PAYMENT_CHECK VALIDATION (7 condições)
  // ============================================================
  async function validatePaymentCheck(statusResult, attempt) {
    const reasons = [];

    // 1. paid === true
    if (!statusResult.paid) {
      reasons.push({ code: "PAYMENT_NOT_CONFIRMED", message: "Provider reportou paid=false" });
    }

    // 2. capture_method === "pix"
    const rawCapture = (statusResult.raw?.capture_method || "").toLowerCase();
    if (rawCapture && rawCapture !== "pix") {
      reasons.push({
        code: "CAPTURE_METHOD_MISMATCH",
        message: `capture_method=${rawCapture}, esperado=pix`,
      });
    }
    if (!rawCapture) {
      reasons.push({
        code: "CAPTURE_METHOD_MISMATCH",
        message: "capture_method ausente na resposta do provider",
      });
    }

    // 3. order_nsu === attempt.order_id
    const rawOrderNsu = statusResult.raw?.order_nsu || "";
    if (rawOrderNsu && rawOrderNsu !== attempt.order_id) {
      reasons.push({
        code: "ORDER_NSU_MISMATCH",
        message: `order_nsu=${rawOrderNsu}, local=${attempt.order_id}`,
      });
    }

    // 4. amount === attempt.amount_cents
    const rawAmount = statusResult.amount || statusResult.raw?.amount || 0;
    if (rawAmount !== attempt.amount_cents) {
      reasons.push({
        code: "AMOUNT_MISMATCH",
        message: `provider_amount=${rawAmount}, local=${attempt.amount_cents}`,
      });
    }

    // 5. transaction_nsu válido
    const rawTxNsu = statusResult.raw?.transaction_nsu || "";
    if (!rawTxNsu) {
      reasons.push({
        code: "TRANSACTION_NSU_MISMATCH",
        message: "transaction_nsu ausente na resposta do provider",
      });
    }

    // 6. provider === INFINITEPAY
    if (attempt.provider !== "INFINITEPAY") {
      reasons.push({
        code: "PAYMENT_ATTEMPT_NOT_FOUND",
        message: `provider=${attempt.provider}, esperado=INFINITEPAY`,
      });
    }

    // 7. method === PIX
    if (attempt.method !== "PIX") {
      reasons.push({
        code: "CAPTURE_METHOD_MISMATCH",
        message: `attempt_method=${attempt.method}, esperado=PIX`,
      });
    }

    return reasons;
  }

  // ============================================================
  // WEBHOOK HANDLING
  // ============================================================
  async function handleWebhook(body) {
    if (!body || typeof body !== "object") {
      return {
        success: false,
        statusCode: 400,
        error: "INVALID_PAYLOAD",
        message: "Payload inválido",
      };
    }

    const orderNsu = body.order_nsu || "";
    const transactionNsu = body.transaction_nsu || "";
    const providerReference = body.invoice_slug || "";
    const amount = body.amount || 0;
    const paidAmount = body.paid_amount || 0;
    const captureMethod = (body.capture_method || "").toLowerCase();
    const installments = body.installments || 1;
    const receiptUrl = body.receipt_url || "";
    const eventType = body.event_type || "PAYMENT_UPDATED";

    if (!orderNsu) {
      return {
        success: false,
        statusCode: 400,
        error: "MISSING_ORDER_NSU",
        message: "order_nsu obrigatório no webhook",
      };
    }

    // Sanitizar payload
    const sanitized = sanitizeResponse(body);

    // Calcular request_hash para idempotência (hash canônico estendido)
    const hashInput = [
      "INFINITEPAY",
      eventType,
      providerReference || "",
      orderNsu || "",
      transactionNsu || "",
      captureMethod || "",
      String(amount || 0),
      String(paidAmount || 0),
      String(Boolean(body.paid)),
    ].join("|");
    const requestHash = createHash("sha256").update(hashInput).digest("hex");

    // Detectar evento duplicado
    const existingEvent = await findExistingEvent(requestHash, "INFINITEPAY");
    if (existingEvent) {
      // Registrar evento duplicado para trilha de auditoria
      // Usar requestHash diferente (sufixo DUPLICATE) para contornar UNIQUE constraint
      const duplicateHash = createHash("sha256").update(requestHash + "|DUPLICATE|" + iso(new Date())).digest("hex");
      try {
        await recordEvent({
          provider: "INFINITEPAY",
          eventType: "DUPLICATE_DETECTED",
          orderId: orderNsu,
          providerReference,
          providerTransactionNsu: transactionNsu,
          requestHash: duplicateHash,
          payloadSanitized: { original_event_id: existingEvent.id },
          processingStatus: "DUPLICATE",
          receivedAt: iso(new Date()),
        });
      } catch {
        // Ignorar erro de registro de duplicata
      }
      return {
        success: true,
        statusCode: 200,
        duplicate: true,
        message: "Evento já processado",
      };
    }

    // Registrar evento recebido (status RECEIVED, não PROCESSED)
    const eventRecord = await recordEvent({
      provider: "INFINITEPAY",
      eventType,
      orderId: orderNsu,
      providerReference,
      providerTransactionNsu: transactionNsu,
      requestHash,
      payloadSanitized: sanitized,
      processingStatus: "RECEIVED",
      receivedAt: iso(new Date()),
    });

    // Localizar pedido (para registrar no evento)
    const order = await db.get(
      `SELECT * FROM app_orders WHERE id = ?`,
      [orderNsu]
    );

    if (!order) {
      // Pedido não encontrado — marcar evento como FAILED
      await db.run(
        `UPDATE app_payment_events
         SET processing_status = 'FAILED', failure_code = ?, failure_message_sanitized = ?,
             processed_at = ?, updated_at = ?, version = version + 1
         WHERE id = ?`,
        ["ORDER_NOT_FOUND", `Pedido ${orderNsu} não encontrado`, iso(new Date()), iso(new Date()), eventRecord.id]
      );
      return {
        success: true,
        statusCode: 200,
        event_id: eventRecord.id,
        message: "Pedido não encontrado — evento registrado para retry",
      };
    }

    // Retornar rápido — processamento definitivo pelo worker ou reconcile manual
    return {
      success: true,
      statusCode: 200,
      event_id: eventRecord.id,
      message: "Webhook registrado para processamento assíncrono",
    };
  }

  // ============================================================
  // PAYMENT_CHECK (Consulta de status via adapter)
  // ============================================================
  async function checkPaymentStatus(attempt) {
    const handle = getInfinitePayHandle();
    if (!handle) {
      throw new ReconciliationError(
        "INFINITEPAY_HANDLE_MISSING",
        "Handle InfinitePay não configurado",
        { status: 500 }
      );
    }

    const result = await infinitePayAdapter.getPixPaymentStatus({
      handle,
      order_nsu: attempt.order_id,
      transaction_nsu: attempt.provider_transaction_nsu || "",
      slug: attempt.provider_reference || "",
    });

    return result;
  }

  // ============================================================
  // ATOMIC FINALIZATION
  // ============================================================
  async function finalizePayment(attempt, statusResult) {
    const transactionNsu = statusResult.raw?.transaction_nsu || "";
    const receiptUrl = statusResult.raw?.receipt_url || "";
    const sanitized = sanitizeResponse(statusResult.raw || {});
    const now = iso(new Date());

    try {
      const result = await transactionRunner.withImmediateTransaction(async (runner) => {
        // 1. Reler pedido
        const order = await runner.get(
          `SELECT * FROM app_orders WHERE id = ?`,
          [attempt.order_id]
        );

        if (!order) {
          throw new ReconciliationError(
            "ORDER_NOT_FOUND",
            "Pedido não encontrado durante finalização",
            { status: 404 }
          );
        }

        // 2. Reler tentativa
        const currentAttempt = await runner.get(
          `SELECT * FROM app_payment_attempts WHERE id = ?`,
          [attempt.id]
        );

        if (!currentAttempt) {
          throw new ReconciliationError(
            "PAYMENT_ATTEMPT_NOT_FOUND",
            "Tentativa não encontrada durante finalização",
            { status: 404 }
          );
        }

        // 3. Verificar account/order match
        if (currentAttempt.order_id !== order.id) {
          throw new ReconciliationError(
            "ORDER_NSU_MISMATCH",
            "Tentativa não pertence ao pedido",
            { status: 400 }
          );
        }

        // 4. Verificar se já está PAID (idempotência com mesmo NSU)
        if (order.status === "PAID" && currentAttempt.provider_transaction_nsu === transactionNsu) {
          return { type: "idempotent", order_id: order.id };
        }

        // 5. Verificar se já está PAID com outro NSU
        if (order.status === "PAID") {
          throw new ReconciliationError(
            "ORDER_ALREADY_PAID",
            "Pedido já está PAID com outro transaction_nsu",
            { status: 409 }
          );
        }

        // 6. Verificar se tentativa já está PAID
        if (currentAttempt.status === "PAID") {
          return { type: "idempotent", order_id: order.id };
        }

        // 7. Verificar transaction_nsu
        if (!transactionNsu) {
          throw new ReconciliationError(
            "TRANSACTION_NSU_MISMATCH",
            "transaction_nsu ausente no payment_check",
            { status: 400 }
          );
        }

        // 8. Verificar valor
        const providerAmount = statusResult.amount || statusResult.raw?.amount || 0;
        if (providerAmount !== order.total_cents) {
          throw new ReconciliationError(
            "AMOUNT_MISMATCH",
            `Valor divergente: provider=${providerAmount}, order=${order.total_cents}`,
            { status: 400 }
          );
        }

        // 9. Verificar reserva — ler snapshot para obter reservation_ids
        let reservationIds = [];
        let storeId = null;
        try {
          const snapshot = order.snapshot_json ? JSON.parse(order.snapshot_json) : {};
          reservationIds = snapshot.reservation_ids || [];
          storeId = snapshot.store_id || snapshot.storeId || null;
        } catch (e) {
          throw new ReconciliationError(
            "RESERVATION_INVALID",
            "Snapshot do pedido inválido — não é possível verificar reserva",
            { status: 400 }
          );
        }

        // 10. Finalizar estoque (conversão HOLD → SALE)
        // O inventoryService já tem releaseReservation, mas precisamos de SALE.
        // SALE = confirmar que a reserva se tornou venda.
        // Padrão: criar movimento SALE com quantity_delta = 0 (estoque já está reserved,
        // não precisa mudar disponível, apenas marcar como vendido).
        if (inventoryService && reservationIds.length > 0) {
          const saleKey = `SALE::${order.id}`;
          // Verificar idempotência da venda
          const existingSale = await runner.get(
            `SELECT id FROM pdv_inventory_movements_v2
             WHERE idempotency_key = ? AND movement_type = 'SALE'`,
            [saleKey]
          );

          if (!existingSale) {
            // Para cada reserva, encontrar os movimentos HOLD e criar SALE correspondentes
            for (const reservationId of reservationIds) {
              // Buscar movimentos HOLD para esta reserva
              const holdMovements = await runner.all(
                `SELECT * FROM pdv_inventory_movements_v2
                 WHERE reference_id = ? AND movement_type = 'RESERVATION_HOLD'`,
                [reservationId]
              );

              for (const hold of holdMovements) {
                const quantity = Math.abs(hold.quantity_delta);
                const saleId = randomUUID();
                const now2 = iso(new Date());

                await runner.run(
                  `INSERT INTO pdv_inventory_movements_v2
                   (id, variant_id, store_id, movement_type, quantity_delta, quantity_before,
                    quantity_after, origin, reference_type, reference_id, idempotency_key,
                    actor_user_id, actor_name, metadata_json, created_at)
                   VALUES (?, ?, ?, 'SALE', 0, ?, ?, 'app_order_shop', 'ORDER', ?, ?, ?, 'system', ?, ?)`,
                  [
                    saleId,
                    hold.variant_id,
                    hold.store_id,
                    hold.quantity_before, // quantity_before (sem mudança de saldo)
                    hold.quantity_before, // quantity_after (sem mudança de saldo)
                    order.id,
                    saleKey,
                    null,
                    JSON.stringify({
                      order_id: order.id,
                      attempt_id: currentAttempt.id,
                      transaction_nsu: transactionNsu,
                      reservation_id: reservationId,
                      hold_movement_id: hold.id,
                    }),
                    now2,
                  ]
                );
              }
            }
          }
        }

        // 11. Marcar tentativa como PAID com colunas de persistência
        await runner.run(
          `UPDATE app_payment_attempts
           SET status = 'PAID', provider_transaction_nsu = ?,
               provider_response_sanitized_json = ?,
               updated_at = ?, version = version + 1
           WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
          [transactionNsu, JSON.stringify(sanitized), now, currentAttempt.id]
        );

        // 12. Verificar se o UPDATE foi efetivo
        const updatedAttempt = await runner.get(
          `SELECT * FROM app_payment_attempts WHERE id = ?`,
          [currentAttempt.id]
        );

        if (updatedAttempt.status !== "PAID") {
          throw new ReconciliationError(
            "FINALIZATION_FAILED",
            "Falha ao marcar tentativa como PAID — concorrência detectada",
            { status: 409 }
          );
        }

        // 13. Atualizar order status para PAID (v3 schema)
        // Salvar colunas de pagamento diretamente na tabela
        await runner.run(
          `UPDATE app_orders
           SET status = 'PAID',
               paid_at = ?,
               payment_attempt_id = ?,
               payment_transaction_nsu = ?,
               payment_receipt_url = ?,
               failed_reason = NULL,
               updated_at = ?, version = version + 1
           WHERE id = ? AND status = 'READY_FOR_PAYMENT'`,
          [now, currentAttempt.id, transactionNsu, receiptUrl, now, order.id]
        );

        // 14. Verificar se o UPDATE foi efetivo
        const updatedOrder = await runner.get(
          `SELECT * FROM app_orders WHERE id = ?`,
          [order.id]
        );

        if (updatedOrder.status !== "PAID") {
          throw new ReconciliationError(
            "FINALIZATION_FAILED",
            "Falha ao marcar pedido como PAID — status não mudou. Verificar migration v3.",
            { status: 409, details: { current_status: updatedOrder?.status } }
          );
        }

        // 15. Registrar auditoria
        const eventId = randomUUID();
        await runner.run(
          `INSERT INTO app_order_events (id, order_id, event_type, details_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [eventId, order.id, "PAYMENT_CONFIRMED", JSON.stringify({
            attempt_id: currentAttempt.id,
            transaction_nsu: transactionNsu,
            receipt_url: receiptUrl,
            paid_at: now,
            provider: "INFINITEPAY",
          }), now]
        );

        // COMMIT
        await runner.commit();

        return {
          type: "finalized",
          order_id: order.id,
          attempt_id: currentAttempt.id,
          transaction_nsu: transactionNsu,
          receipt_url: receiptUrl,
        };
      });

      if (result.type === "idempotent") {
        return {
          success: true,
          idempotent: true,
          message: "Pagamento já finalizado com mesmo transaction_nsu",
        };
      }

      return {
        success: true,
        order_id: result.order_id,
        attempt_id: result.attempt_id,
        transaction_nsu: result.transaction_nsu,
        receipt_url: result.receipt_url,
      };
    } catch (err) {
      if (err instanceof ReconciliationError) throw err;
      // Falha durante finalização — ROLLBACK automático pelo transactionRunner
      // Tentativa fica REVIEW_REQUIRED
      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'REVIEW_REQUIRED', updated_at = ?, version = version + 1
         WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
        [iso(new Date()), attempt.id]
      );
      throw new ReconciliationError(
        "FINALIZATION_FAILED",
        `Falha durante finalização: ${err.message || "erro desconhecido"}`,
        { status: 500, details: { original_error: err.message } }
      );
    }
  }

  // ============================================================
  // RECONCILIATION (Manual + Webhook-triggered)
  // ============================================================
  async function reconcileAttempt(accountId, attemptId, options = {}) {
    ensureReconciliationEnabled();

    // Buscar attempt com autorização por conta
    const attempt = await db.get(
      `SELECT pa.*, o.account_id, o.total_cents, o.status as order_status
       FROM app_payment_attempts pa
       INNER JOIN app_orders o ON pa.order_id = o.id
       WHERE pa.id = ?`,
      [attemptId]
    );

    if (!attempt) {
      throw new ReconciliationError(
        "PAYMENT_ATTEMPT_NOT_FOUND",
        "Tentativa não encontrada.",
        { status: 404 }
      );
    }

    if (attempt.account_id !== accountId) {
      throw new ReconciliationError(
        "PAYMENT_ATTEMPT_NOT_FOUND",
        "Tentativa não encontrada.",
        { status: 404 }
      );
    }

    // Se já PAID, retornar idempotente
    if (attempt.status === "PAID") {
      return {
        success: true,
        idempotent: true,
        message: "Pagamento já finalizado",
        attempt: { id: attempt.id, status: "PAID" },
      };
    }

    // 1. Consultar payment_check
    const statusResult = await checkPaymentStatus(attempt);

    if (!statusResult.success) {
      // Provider indisponível — REVIEW_REQUIRED
      const now = iso(new Date());
      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'REVIEW_REQUIRED', updated_at = ?, version = version + 1
         WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
        [now, attemptId]
      );
      return {
        success: true,
        attempt: { id: attemptId, status: "REVIEW_REQUIRED" },
        reason: "PAYMENT_RECONCILIATION_REQUIRED",
        message: "Provider indisponível para confirmação",
      };
    }

    // 2. Validar payment_check (7 condições)
    const failures = await validatePaymentCheck(statusResult, attempt);

    if (failures.length > 0) {
      const sanitized = sanitizeResponse(statusResult.raw || {});
      const now = iso(new Date());
      const reason = failures[0].code;
      const message = failures.map(f => f.message).join("; ");

      await db.run(
        `UPDATE app_payment_attempts
         SET status = 'REVIEW_REQUIRED', provider_response_sanitized_json = ?,
             failure_code = ?, failure_message_sanitized = ?,
             updated_at = ?, version = version + 1
         WHERE id = ? AND status NOT IN ('PAID', 'EXPIRED', 'CANCELLED')`,
        [JSON.stringify(sanitized), reason, sanitizeFailureMessage(message), now, attemptId]
      );

      return {
        success: true,
        attempt: { id: attemptId, status: "REVIEW_REQUIRED" },
        reason,
        message,
      };
    }

    // 3. Finalizar atomicamente (sem HTTP dentro da transação)
    return finalizePayment(attempt, statusResult);
  }

  // ============================================================
  // GET ATTEMPT (Safe public status)
  // ============================================================
  async function getAttemptStatus(accountId, attemptId) {
    const attempt = await db.get(
      `SELECT pa.*, o.status as order_status, o.order_number
       FROM app_payment_attempts pa
       INNER JOIN app_orders o ON pa.order_id = o.id
       WHERE pa.id = ? AND o.account_id = ?`,
      [attemptId, accountId]
    );

    if (!attempt) {
      throw new ReconciliationError(
        "PAYMENT_ATTEMPT_NOT_FOUND",
        "Tentativa não encontrada.",
        { status: 404 }
      );
    }

    // Retornar estado público seguro — NÃO retornar payload bruto
    const safeStatus = attempt.status;
    const validStatuses = ["REQUESTING", "PENDING", "REVIEW_REQUIRED", "PAID", "FAILED", "CANCELLED", "EXPIRED"];
    const exposedStatus = validStatuses.includes(safeStatus) ? safeStatus : "PENDING";

    return {
      success: true,
      attempt: {
        id: attempt.id,
        order_id: attempt.order_id,
        order_number: attempt.order_number || null,
        provider: attempt.provider,
        method: attempt.method,
        status: exposedStatus,
        provider_checkout_url: attempt.provider_checkout_url || null,
        amount_cents: attempt.amount_cents,
        currency: attempt.currency,
        provider_reference: attempt.provider_reference || null,
        provider_transaction_nsu: attempt.provider_transaction_nsu || null,
        receipt_url: attempt.receipt_url || null,
        created_at: attempt.created_at,
        updated_at: attempt.updated_at,
        expires_at: attempt.expires_at || null,
      },
    };
  }

  // ============================================================
  // EXPORTS
  // ============================================================
  return {
    handleWebhook,
    reconcileAttempt,
    checkPaymentStatus,
    validatePaymentCheck,
    finalizePayment,
    getAttemptStatus,
    recordEvent,
    isReconciliationEnabled,
    ReconciliationError,
    getRedirectUrl,
    getWebhookUrl,
  };
}

module.exports = {
  createInfinitePayReconciliationService,
  ReconciliationError,
};
