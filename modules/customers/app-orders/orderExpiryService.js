"use strict";

const { randomUUID } = require("crypto");

/**
 * orderExpiryService — Responsável por expirar pedidos não pagos
 * e devolver o estoque ao PDV.
 *
 * Contratos:
 * - Pedido READY_FOR_PAYMENT com expires_at <= agora → EXPIRED
 * - Estoque: available_qty += qty, reserved_qty -= qty (RESERVATION_RELEASE)
 * - expired_at registrado no pedido para auditoria
 * - Idempotente: pedidos já EXPIRED são ignorados
 * - Auditável: movimento pdv_inventory_movements_v2 registrado
 * - Concorrente seguro: transação única por pedido, re-leitura dentro de tx
 * - Reinício seguro: query filtra por status + expires_at, não por timer
 * - Isolamento por conta: expira apenas pedidos da conta solicitada (ou todas)
 * - Relógio: Date.now() (UTC)
 * - Todas reservation_ids processadas com agregação por store_id + variant_id
 * - Se movimentos HOLD ausentes: RESERVATION_MOVEMENTS_NOT_FOUND, rollback
 * - Se falha em QUALQUER passo: ROLLBACK completo (saldo + pedido + evento)
 *
 * API:
 *   sweepExpiredOrders({ db, inventoryService, scope })
 *     → { expired: number, released: number, errors: number, errors_details: Array }
 */

function iso(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

function generateId() {
  return randomUUID();
}

/**
 * sweepExpiredOrders — Expira pedidos não pagos e devolve estoque.
 *
 * Regras:
 * 1. Busca pedidos expiráveis fora de transação (leitura)
 * 2. Para CADA pedido, abre uma transação exclusiva
 * 3. Re-leitura dentro da tx para garantir status atual (concorrência)
 * 4. Carrega TODOS movimentos HOLD de TODOS reservation_ids
 * 5. Se reservation_ids > 0 mas zero movimentos HOLD: RESERVATION_MOVEMENTS_NOT_FOUND
 * 6. Agrega movimentos por store_id + variant_id (soma quantidades)
 * 7. Libera estoque via releaseReservation (runner transacional)
 * 8. Atualiza status para EXPIRED com expired_at
 * 9. Registra evento ORDER_EXPIRED
 * 10. COMMIT — se qualquer passo falhar, ROLLBACK
 * 11. Retorna contagem de sucesso/falha
 */
async function sweepExpiredOrders(options = {}) {
  const { db, inventoryService, scope = null, now = new Date() } = options;

  if (!db || !db.run || !db.get || !db.all) {
    throw new Error("SWEEP_DB_REQUIRED");
  }

  if (!inventoryService || typeof inventoryService.releaseReservation !== "function") {
    throw new Error("SWEEP_INVENTORY_SERVICE_REQUIRED");
  }

  const nowIso = iso(now);
  const errorsDetails = [];

  // 1. Buscar pedidos expiráveis (READY_FOR_PAYMENT, expires_at <= agora)
  let query, params;
  if (scope && scope.account_id) {
    query = `SELECT id, account_id, expires_at, reservation_ids_json, updated_at
             FROM app_orders
             WHERE status = 'READY_FOR_PAYMENT'
               AND expires_at IS NOT NULL
               AND expires_at <= ?
               AND account_id = ?`;
    params = [nowIso, scope.account_id];
  } else {
    query = `SELECT id, account_id, expires_at, reservation_ids_json, updated_at
             FROM app_orders
             WHERE status = 'READY_FOR_PAYMENT'
               AND expires_at IS NOT NULL
               AND expires_at <= ?`;
    params = [nowIso];
  }

  const expiredOrders = await db.all(query, params);

  let expiredCount = 0;
  let releasedCount = 0;

  for (const order of expiredOrders) {
    const orderId = order.id;

    // 2. Transação única por pedido
    try {
      await db.run("BEGIN IMMEDIATE");

      // 3. Re-leitura dentro da transação para concorrência
      const reRead = await db.get(
        `SELECT id, status, expires_at, reservation_ids_json, account_id, snapshot_json
         FROM app_orders WHERE id = ? AND status = 'READY_FOR_PAYMENT'`,
        [orderId]
      );

      if (!reRead) {
        // Pedido já foi processado por outro sweep (concorrência) ou status mudou
        await db.run("ROLLBACK");
        continue;
      }

      // Verificar expires_at dentro da tx (pode ter sido atualizado)
      const orderExpiresAt = reRead.expires_at;
      if (orderExpiresAt && orderExpiresAt > nowIso) {
        // TTL foi renovado, não expirar
        await db.run("ROLLBACK");
        continue;
      }

      // 4. Processar TODAS reservation_ids
      const reservationIds = reRead.reservation_ids_json
        ? JSON.parse(reRead.reservation_ids_json)
        : [];

      let stockReleased = false;

      if (reservationIds.length === 0) {
        // Pedido sem reservas não pode ser expirado com segurança
        await db.run("ROLLBACK");
        errorsDetails.push({
          order_id: orderId,
          phase: "reservation_check",
          error: "NO_RESERVATIONS_FOUND",
          message: `Pedido ${orderId} sem reservation_ids`,
        });
        continue;
      }

      if (reservationIds.length > 0) {
        // Carregar TODOS movimentos HOLD de TODOS reservation_ids
        const allHoldMovements = [];
        for (const reservationId of reservationIds) {
          const holdMovements = await db.all(
            `SELECT variant_id, store_id, quantity_delta
             FROM pdv_inventory_movements_v2
             WHERE reference_id = ?
               AND movement_type = 'RESERVATION_HOLD'`,
            [reservationId]
          );
          allHoldMovements.push(...holdMovements);
        }

        // 5. Se reservation_ids existem mas nenhum movimento HOLD foi encontrado:
        //    RESERVATION_MOVEMENTS_NOT_FOUND — rollback, pedido continua READY_FOR_PAYMENT
        if (allHoldMovements.length === 0) {
          await db.run("ROLLBACK");
          errorsDetails.push({
            order_id: orderId,
            phase: "hold_movements_check",
            error: "RESERVATION_MOVEMENTS_NOT_FOUND",
            message: `reservation_ids: ${reservationIds.length} IDs, but zero HOLD movements found`,
          });
          continue;
        }

        // 6. Agregar movimentos por store_id + variant_id
        //    Somar Math.abs(quantity_delta) de movimentos repetidos
        const aggregatedMap = new Map();
        for (const m of allHoldMovements) {
          const key = `${m.store_id}::${m.variant_id}`;
          if (aggregatedMap.has(key)) {
            const existing = aggregatedMap.get(key);
            existing.quantity_total += Math.abs(m.quantity_delta);
          } else {
            aggregatedMap.set(key, {
              store_id: m.store_id,
              variant_id: m.variant_id,
              quantity_total: Math.abs(m.quantity_delta),
            });
          }
        }

        // Agrupar por store_id para releaseReservation
        const itemsByStore = {};
        for (const [, aggregated] of aggregatedMap) {
          const sid = aggregated.store_id;
          if (!itemsByStore[sid]) itemsByStore[sid] = [];
          itemsByStore[sid].push({
            variant_id: aggregated.variant_id,
            quantity: aggregated.quantity_total,
          });
        }

        // 7. Liberar estoque por store usando releaseReservation com runner da tx
        let hasInconsistency = false;
        try {
          let anyReleased = false;
          for (const [storeId, items] of Object.entries(itemsByStore)) {
            const releaseResult = await inventoryService.releaseReservation(
              orderId,
              storeId,
              items,
              { db } // passar db como runner da transação
            );
            if (releaseResult && releaseResult.released) {
              anyReleased = true;
            }
            // Se houve inconsistência (reserved_qty < quantity), fazer rollback
            if (releaseResult && releaseResult.has_inconsistency) {
              hasInconsistency = true;
            }
          }
          stockReleased = anyReleased;
        } catch (releaseErr) {
          await db.run("ROLLBACK");
          errorsDetails.push({
            order_id: orderId,
            phase: "release_reservation",
            error: releaseErr.message,
          });
          continue;
        }

        // Se houve inconsistência no release, rollback antes de marcar EXPIRED
        if (hasInconsistency) {
          await db.run("ROLLBACK");
          errorsDetails.push({
            order_id: orderId,
            phase: "release_reservation",
            error: "RESERVATION_BALANCE_INCONSISTENT",
          });
          continue;
        }
      }

      // 8. Atualizar status para EXPIRED com expired_at
      const orderUpdateResult = await db.run(
        `UPDATE app_orders
         SET status = 'EXPIRED', expired_at = ?, updated_at = ?
         WHERE id = ? AND status = 'READY_FOR_PAYMENT'`,
        [nowIso, nowIso, orderId]
      );

      // 9. Verificar se a atualização foi aplicada (conflito concorrente)
      const updated = await db.get(
        `SELECT id, status FROM app_orders WHERE id = ?`,
        [orderId]
      );

      if (!updated || updated.status !== "EXPIRED") {
        await db.run("ROLLBACK");
        errorsDetails.push({
          order_id: orderId,
          phase: "status_update",
          error: "ORDER_ALREADY_PROCESSED",
        });
        continue;
      }

      // 10. Registrar evento de expiração
      const eventId = generateId();
      await db.run(
        `INSERT INTO app_order_events (id, order_id, event_type, details_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          eventId,
          orderId,
          "ORDER_EXPIRED",
          JSON.stringify({
            reason: "RESERVATION_EXPIRED",
            expires_at: reRead.expires_at,
            expired_at: nowIso,
            stock_released: stockReleased,
            reservation_ids: reservationIds,
          }),
          nowIso,
        ]
      );

      // 11. COMMIT
      await db.run("COMMIT");
      expiredCount++;
      if (stockReleased) releasedCount++;

    } catch (err) {
      // Garantir rollback em caso de erro inesperado
      try { await db.run("ROLLBACK"); } catch (_) {}
      errorsDetails.push({
        order_id: orderId,
        phase: "sweep",
        error: err.message,
      });
    }
  }

  return {
    expired: expiredCount,
    released: releasedCount,
    errors: errorsDetails.length,
    errors_details: errorsDetails,
  };
}

module.exports = { sweepExpiredOrders };
