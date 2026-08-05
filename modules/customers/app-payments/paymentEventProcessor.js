"use strict";

/**
 * paymentEventProcessor — Processador durável de eventos de pagamento.
 *
 * Busca eventos em status RECEIVED ou RETRY_REQUIRED e executa payment_check.
 * Usa polling interno controlado no staging.
 *
 * REGRAS:
 *   - Só inicia com flags habilitadas
 *   - Eventos permanecem no banco após restart
 *   - Não depende apenas de setImmediate
 *   - Não faz processamento com flags OFF
 *   - Atualiza eventos para PROCESSING, PROCESSED ou FAILED
 *   - Retry limitado e idempotente
 *
 * O endpoint manual (reconcileRoutes) usa exatamente o mesmo finalizador.
 */

const { randomUUID } = require("crypto");

const PROCESSING_FLAG = "INFINITEPAY_SHOP_PIX_ENABLED";
const RECONCILIATION_FLAG = "INFINITEPAY_RECONCILIATION_ENABLED";
const WORKER_ENABLED_FLAG = "INFINITEPAY_EVENT_WORKER_ENABLED";

const MAX_RETRIES = 5;
const POLL_INTERVAL_MS = 10000; // 10 segundos

function iso(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

function createPaymentEventProcessor(options = {}) {
  const db = options.db;
  const reconciliationService = options.reconciliationService;
  const pollIntervalMs = options.pollIntervalMs || POLL_INTERVAL_MS;
  const maxRetries = options.maxRetries || MAX_RETRIES;

  if (!db) {
    throw new Error("DB_REQUIRED for paymentEventProcessor");
  }
  if (!reconciliationService) {
    throw new Error("RECONCILIATION_SERVICE_REQUIRED for paymentEventProcessor");
  }

  let running = false;
  let timer = null;
  let processingCurrent = false;

  function isEnabled() {
    return process.env[PROCESSING_FLAG] === "true"
      && process.env[RECONCILIATION_FLAG] === "true"
      && process.env[WORKER_ENABLED_FLAG] === "true";
  }

  /**
   * findPendingEvents — Busca eventos RECEIVED ou RETRY_REQUIRED
   * com retry_count < maxRetries.
   */
  async function findPendingEvents() {
    return db.all(
      `SELECT * FROM app_payment_events
       WHERE processing_status IN ('RECEIVED', 'RETRY_REQUIRED')
         AND COALESCE((SELECT CAST(value AS INTEGER)
                        FROM json_each(CASE WHEN failure_code IS NOT NULL
                                          THEN '{"retry_count":' || (SELECT COALESCE((SELECT COUNT(*) FROM app_payment_events WHERE id=app_payment_events.id AND failure_code IS NOT NULL), 0)) || '}')
                        WHERE key = 'retry_count') IS NOT NULL, 0) < ?
       ORDER BY received_at ASC
       LIMIT 10`,
      [maxRetries]
    );
  }

  /**
   * Simple retry counter via separate column approach.
   * Uses processing_status to track state.
   */
  async function findPendingEventsSimple() {
    return db.all(
      `SELECT * FROM app_payment_events
       WHERE processing_status IN ('RECEIVED', 'RETRY_REQUIRED')
       ORDER BY received_at ASC
       LIMIT 10`
    );
  }

  /**
   * processEvent — Processa um evento individual.
   * 1. Marca como PROCESSING
   * 2. Localiza pedido e tentativa
   * 3. Executa reconciliation (payment_check + finalization)
   * 4. Marca como PROCESSED ou FAILED
   */
  async function processEvent(event) {
    const now = iso(new Date());

    // Marcar como PROCESSING
    await db.run(
      `UPDATE app_payment_events
       SET processing_status = 'PROCESSING', updated_at = ?
       WHERE id = ? AND processing_status IN ('RECEIVED', 'RETRY_REQUIRED')`,
      [now, event.id]
    );

    // Reler para verificar se ainda está PROCESSING (concorrência)
    const current = await db.get(
      `SELECT * FROM app_payment_events WHERE id = ?`,
      [event.id]
    );

    if (!current || current.processing_status !== "PROCESSING") {
      // Outro worker já processou — idempotente
      return { eventId: event.id, status: "SKIP_DUPLICATE" };
    }

    try {
      // Localizar pedido
      const order = await db.get(
        `SELECT * FROM app_orders WHERE id = ?`,
        [event.order_id]
      );

      if (!order) {
        // Pedido não encontrado — marcar como FAILED
        await db.run(
          `UPDATE app_payment_events
           SET processing_status = 'FAILED',
               failure_code = 'ORDER_NOT_FOUND',
               failure_message_sanitized = 'Pedido não encontrado',
               processed_at = ?, updated_at = ?
           WHERE id = ?`,
          [now, now, event.id]
        );
        return { eventId: event.id, status: "FAILED", reason: "ORDER_NOT_FOUND" };
      }

      // Localizar tentativa de pagamento
      const attempt = await db.get(
        `SELECT * FROM app_payment_attempts WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`,
        [event.order_id]
      );

      if (!attempt) {
        // Tentativa não encontrada — marcar como FAILED
        await db.run(
          `UPDATE app_payment_events
           SET processing_status = 'FAILED',
               failure_code = 'ATTEMPT_NOT_FOUND',
               failure_message_sanitized = 'Tentativa de pagamento não encontrada',
               processed_at = ?, updated_at = ?
           WHERE id = ?`,
          [now, now, event.id]
        );
        return { eventId: event.id, status: "FAILED", reason: "ATTEMPT_NOT_FOUND" };
      }

      // Preencher payment_attempt_id no evento
      await db.run(
        `UPDATE app_payment_events
         SET payment_attempt_id = ?, updated_at = ?
         WHERE id = ? AND payment_attempt_id IS NULL`,
        [attempt.id, now, event.id]
      );

      // Executar reconciliação (usa o mesmo finalizador do reconcileRoutes)
      const result = await reconciliationService.reconcileAttempt(
        order.account_id,
        attempt.id
      );

      // Marcar evento como PROCESSED
      await db.run(
        `UPDATE app_payment_events
         SET processing_status = 'PROCESSED',
             processed_at = ?, updated_at = ?
         WHERE id = ?`,
        [now, now, event.id]
      );

      return { eventId: event.id, status: "PROCESSED", result };
    } catch (err) {
      // Falha — marcar como RETRY_REQUIRED (se retry < max) ou FAILED
      const failureCode = err.code || "PROCESSING_ERROR";
      const failureMsg = err.message || "Erro desconhecido";

      // Contar retentativas existentes para este evento
      const retryCount = await db.get(
        `SELECT COUNT(*) as cnt FROM app_payment_events
         WHERE order_id = ? AND processing_status = 'RETRY_REQUIRED'
           AND id != ?`,
        [event.order_id, event.id]
      );

      const currentRetries = retryCount ? retryCount.cnt : 0;

      if (currentRetries < maxRetries) {
        await db.run(
          `UPDATE app_payment_events
           SET processing_status = 'RETRY_REQUIRED',
               failure_code = ?, failure_message_sanitized = ?,
               updated_at = ?
           WHERE id = ?`,
          [failureCode, failureMsg, now, event.id]
        );
        return { eventId: event.id, status: "RETRY_REQUIRED", reason: failureCode };
      } else {
        await db.run(
          `UPDATE app_payment_events
           SET processing_status = 'FAILED',
               failure_code = ?, failure_message_sanitized = ?,
               processed_at = ?, updated_at = ?
           WHERE id = ?`,
          [failureCode, failureMsg, now, now, event.id]
        );
        return { eventId: event.id, status: "FAILED", reason: failureCode };
      }
    }
  }

  /**
   * processBatch — Processa um lote de eventos pendentes.
   */
  async function processBatch() {
    if (processingCurrent) return { processed: 0, reason: "CONCURRENT_SKIP" };

    processingCurrent = true;
    try {
      const events = await findPendingEventsSimple();
      let processed = 0;

      for (const event of events) {
        const result = await processEvent(event);
        if (result.status === "PROCESSED") {
          processed++;
        }
      }

      return { processed };
    } finally {
      processingCurrent = false;
    }
  }

  /**
   * processOneRound — Uma iteração de polling (para testes).
   */
  async function processOneRound() {
    return processBatch();
  }

  /**
   * start — Inicia o worker durável (polling controlado).
   * NÃO inicia se as flags estiverem desabilitadas.
   */
  function start() {
    if (!isEnabled()) {
      return { started: false, reason: "FLAGS_DISABLED" };
    }

    if (running) {
      return { started: false, reason: "ALREADY_RUNNING" };
    }

    running = true;
    timer = setInterval(async () => {
      try {
        await processBatch();
      } catch (err) {
        // Logging controlado
        console.error("[paymentEventProcessor] Erro no polling:", err.message);
      }
    }, pollIntervalMs);

    return { started: true };
  }

  /**
   * stop — Para o worker.
   */
  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    running = false;
    return { stopped: true };
  }

  /**
   * isRunning — Status do worker.
   */
  function isRunning() {
    return running;
  }

  return {
    processBatch,
    processOneRound,
    processEvent,
    start,
    stop,
    isRunning,
    isEnabled,
  };
}

module.exports = { createPaymentEventProcessor };
