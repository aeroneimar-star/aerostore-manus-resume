"use strict";

/**
 * orderExpiryScheduler — Scheduler para expiração periódica de pedidos.
 *
 * Regras:
 * - Roda no server.js via setInterval
 * - Intervalo configurável via ORDER_EXPIRY_INTERVAL_MS (padrão: 60.000ms = 1 min)
 *   Mínimo: 10.000ms (10s), Máximo: 3.600.000ms (1h)
 * - Default OFF: só ativa se ORDER_EXPIRY_ENABLED === "true"
 * - Concorrência segura: o sweep usa BEGIN IMMEDIATE + re-leitura
 * - Reinício seguro: não depende de timer próprio, consulta DB a cada tick
 * - Logs: start, end, errors
 *
 * Uso:
 *   const scheduler = startExpiryScheduler({ db, inventoryService });
 *   // ... server running ...
 *   scheduler.stop();
 */

const DEFAULT_INTERVAL_MS = 60_000; // 1 minuto
const MIN_INTERVAL_MS = 10_000;     // 10 segundos
const MAX_INTERVAL_MS = 3_600_000;  // 1 hora

function startExpiryScheduler(options = {}) {
  const { db, inventoryService, env = process.env } = options;

  // Validar habilitação: apenas "true" (string exata)
  const enabledRaw = env.ORDER_EXPIRY_ENABLED;
  const isEnabled = enabledRaw === "true";

  // Validar intervalo
  let intervalMs = Number(env.ORDER_EXPIRY_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  if (isNaN(intervalMs) || intervalMs < MIN_INTERVAL_MS) {
    intervalMs = MIN_INTERVAL_MS;
  }
  if (intervalMs > MAX_INTERVAL_MS) {
    intervalMs = MAX_INTERVAL_MS;
  }

  if (!isEnabled) {
    console.log("[orderExpiryScheduler] Scheduler disabled (ORDER_EXPIRY_ENABLED !== 'true')");
    return { stop: () => {}, isRunning: false };
  }

  if (!db || !inventoryService) {
    throw new Error("ORDER_EXPIRY_SCHEDULER: db e inventoryService são obrigatórios");
  }

  const { sweepExpiredOrders } = require("./orderExpiryService");

  let running = false;
  let intervalId = null;
  let _isRunning = true;

  async function tick() {
    if (running) return; // prevent overlap
    running = true;
    try {
      const result = await sweepExpiredOrders({
        db,
        inventoryService,
      });
      console.log(
        `[orderExpiryScheduler] sweep complete: expired=${result.expired}, released=${result.released}, errors=${result.errors}`
      );
      if (result.errors > 0) {
        console.error("[orderExpiryScheduler] sweep errors:", JSON.stringify(result.errors_details));
      }
    } catch (err) {
      console.error("[orderExpiryScheduler] sweep failed:", err.message);
    } finally {
      running = false;
    }
  }

  console.log(`[orderExpiryScheduler] Starting with interval=${intervalMs}ms`);
  intervalId = setInterval(tick, intervalMs);
  // Run immediately on start
  tick().catch((err) => {
    console.error("[orderExpiryScheduler] initial tick failed:", err.message);
  });

  return {
    stop: () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
      running = false;
      _isRunning = false;
      console.log("[orderExpiryScheduler] Stopped");
    },
    get isRunning() {
      return _isRunning && intervalId !== null;
    },
  };
}

module.exports = { startExpiryScheduler, MIN_INTERVAL_MS, MAX_INTERVAL_MS };
