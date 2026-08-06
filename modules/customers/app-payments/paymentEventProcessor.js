"use strict";

/**
 * paymentEventProcessor — Processador durável de eventos de pagamento.
 *
 * Busca eventos em status RECEIVED ou RETRY_REQUIRED e executa payment_check.
 * Usa polling interno controlado no staging.
 *
 * CLAIM/LOCK ATÔMICO:
 *   UPDATE ... WHERE id=? AND processing_status IN ('RECEIVED','RETRY_REQUIRED')
 *   Se changes=0 → outro worker já reclamou (idempotente, SKIP).
 *
 * RETRY:
 *   retry_count é incrementado no momento do mark-failed.
 *   Se retry_count >= maxRetries → status = FAILED (sem retry).
 *   LOCK_EXPIRES_AT: se locked_at > 2min ago → reclaims como RETRY_REQUIRED.
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
const LOCK_EXPIRY_MS = 120000; // 2 minutos

function iso(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

function createPaymentEventProcessor(options = {}) {
  const db = options.db;
  const reconciliationService = options.reconciliationService;
  const pollIntervalMs = options.pollIntervalMs || POLL_INTERVAL_MS;
  const maxRetries = options.maxRetries || MAX_RETRIES;
  const lockExpiryMs = options.lockExpiryMs || LOCK_EXPIRY_MS;

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
   * claimEvent — ATOMIC UPDATE: reclama um evento para processamento.
   * Usa lock_token = UUID único. Retorna null se outro worker já reclamou.
   * Também faz reclaim de eventos locked há mais de lockExpiryMs.
   */
  async function claimEvent() {
    const now = iso(new Date());
    const lockToken = randomUUID();
    const lockExpiresAt = iso(new Date(Date.now() + lockExpiryMs));

    // Tentar reclamar um evento RECEIVED
    const claimReceived = await db.run(
      `UPDATE app_payment_events
       SET processing_status = 'PROCESSING',
           locked_at = ?, lock_token = ?, lock_expires_at = ?,
           retry_count = COALESCE(retry_count, 0) + 1,
           updated_at = ?
       WHERE id = (
         SELECT id FROM app_payment_events
         WHERE processing_status = 'RECEIVED'
         ORDER BY received_at ASC
         LIMIT 1
       ) AND processing_status = 'RECEIVED'`,
      [now, lockToken, lockExpiresAt, now]
    );

    if ((claimReceived?.changes || 0) > 0) {
      const event = await db.get(
        `SELECT * FROM app_payment_events WHERE lock_token = ?`,
        [lockToken]
      );
      return event || null;
    }

    // Tentar reclaim de evento RETRY_REQUIRED com lock expirado
    const reclaimSql = `
      UPDATE app_payment_events
      SET processing_status = 'RECEIVED',
          lock_token = NULL, locked_at = NULL, lock_expires_at = NULL,
          updated_at = ?
      WHERE processing_status = 'RETRY_REQUIRED'
        AND datetime(locked_at) < datetime('now', '-${Math.ceil(lockExpiryMs / 60000)} minutes')
        AND retry_count < ?
    `;
    await db.run(reclaimSql, [now, maxRetries]);

    // Tentar reclamar novamente após reclaim
    const claimRetry = await db.run(
      `UPDATE app_payment_events
       SET processing_status = 'PROCESSING',
           locked_at = ?, lock_token = ?, lock_expires_at = ?,
           updated_at = ?
       WHERE id = (
         SELECT id FROM app_payment_events
         WHERE processing_status = 'RECEIVED'
         ORDER BY received_at ASC
         LIMIT 1
       ) AND processing_status = 'RECEIVED'`,
      [now, lockToken, lockExpiresAt, now]
    );

    if ((claimRetry?.changes || 0) > 0) {
      const event = await db.get(
        `SELECT * FROM app_payment_events WHERE lock_token = ?`,
        [lockToken]
      );
      return event || null;
    }

    return null; // Nenhum evento para processar
  }

  /**
   * processEvent — Processa um evento já reclamado (locked).
   * 1. Localiza pedido e tentativa
   * 2. Executa reconciliation (payment_check + finalization)
   * 3. Marca como PROCESSED ou FAILED/RETRY_REQUIRED
   */
  async function processEvent(event) {
    const now = iso(new Date());

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
               lock_token = NULL, locked_at = NULL, lock_expires_at = NULL,
               processed_at = ?, updated_at = ?
           WHERE id = ? AND processing_status = 'PROCESSING' AND lock_token = ?`,
          [now, now, event.id, event.lock_token]
        );
        return { eventId: event.id, status: "FAILED", reason: "ORDER_NOT_FOUND" };
      }

      // Localizar tentativa de pagamento
      const attempt = await db.get(
        `SELECT * FROM app_payment_attempts WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`,
        [event.order_id]
      );

      if (!attempt) {
        await db.run(
          `UPDATE app_payment_events
           SET processing_status = 'FAILED',
               failure_code = 'ATTEMPT_NOT_FOUND',
               failure_message_sanitized = 'Tentativa de pagamento não encontrada',
               lock_token = NULL, locked_at = NULL, lock_expires_at = NULL,
               processed_at = ?, updated_at = ?
           WHERE id = ? AND processing_status = 'PROCESSING' AND lock_token = ?`,
          [now, now, event.id, event.lock_token]
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
             lock_token = NULL, locked_at = NULL, lock_expires_at = NULL,
             processed_at = ?, updated_at = ?
         WHERE id = ? AND processing_status = 'PROCESSING' AND lock_token = ?`,
        [now, now, event.id, event.lock_token]
      );

      return { eventId: event.id, status: "PROCESSED", result };
    } catch (err) {
      // Falha — decidir entre RETRY_REQUIRED e FAILED
      const failureCode = err.code || "PROCESSING_ERROR";
      const failureMsg = err.message || "Erro desconhecido";
      const retryCount = event.retry_count || 1;

      if (retryCount < maxRetries) {
        await db.run(
          `UPDATE app_payment_events
           SET processing_status = 'RETRY_REQUIRED',
               failure_code = ?, failure_message_sanitized = ?,
               lock_token = NULL, locked_at = NULL, lock_expires_at = NULL,
               updated_at = ?
           WHERE id = ? AND processing_status = 'PROCESSING' AND lock_token = ?`,
          [failureCode, failureMsg, now, event.id, event.lock_token]
        );
        return { eventId: event.id, status: "RETRY_REQUIRED", reason: failureCode };
      } else {
        await db.run(
          `UPDATE app_payment_events
           SET processing_status = 'FAILED',
               failure_code = ?, failure_message_sanitized = ?,
               lock_token = NULL, locked_at = NULL, lock_expires_at = NULL,
               processed_at = ?, updated_at = ?
           WHERE id = ? AND processing_status = 'PROCESSING' AND lock_token = ?`,
          [failureCode, failureMsg, now, now, event.id, event.lock_token]
        );
        return { eventId: event.id, status: "FAILED", reason: failureCode };
      }
    }
  }

  /**
   * processBatch — Processa eventos pendentes (claim + process).
   * Usa claim atômico para evitar double-processing.
   */
  async function processBatch() {
    if (processingCurrent) return { processed: 0, reason: "CONCURRENT_SKIP" };

    processingCurrent = true;
    try {
      let processed = 0;
      while (true) {
        const event = await claimEvent();
        if (!event) break; // Nenhum evento para processar
        const result = await processEvent(event);
        if (result.status === "PROCESSED") {
          processed++;
        }
        // Pequeno delay para evitar starvation de outros workers
        await new Promise(r => setTimeout(r, 50));
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
    claimEvent,
    start,
    stop,
    isRunning,
    isEnabled,
  };
}

module.exports = { createPaymentEventProcessor };
