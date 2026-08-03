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
 * - Per-reservation_id: CADA ID deve ter pelo menos 1 movimento HOLD válido
 * - Validação de release: release_quantity_total === hold_quantity_total
 *   - release_quantity_total < hold_quantity_total → PARTIAL_RESERVATION_RELEASE, rollback
 *   - release_quantity_total > hold_quantity_total → RESERVATION_RELEASE_OVERFLOW, rollback
 *   - quantity_delta = 0 nunca comprova liberação
 * - releaseReservation NÃO cria saldo (INVENTORY_BALANCE_NOT_FOUND se ausente)
 * - Se qualquer passo falhar: ROLLBACK completo (saldo + pedido + evento)
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
 * 4. Para CADA reservation_id:
 *    a. Busca movimentos RESERVATION_HOLD
 *    b. Exige pelo menos 1 movimento válido (variant_id, store_id, quantity_delta)
 *    c. Se nenhum HOLD: RESERVATION_MOVEMENTS_NOT_FOUND, rollback
 * 5. Agrega movimentos por store_id + variant_id (soma quantidades)
 * 6. Calcula hold_quantity_total por (orderId + storeId + variantId)
 * 7. Verifica release_quantity_total já existente (exclui delta=0)
 *    - release_quantity_total === hold_quantity_total: já liberado, pula
 *    - release_quantity_total < hold_quantity_total: PARTIAL_RESERVATION_RELEASE, rollback
 *    - release_quantity_total > hold_quantity_total: RESERVATION_RELEASE_OVERFLOW, rollback
 * 8. Libera estoque via releaseReservation (runner transacional)
 *    - releaseReservation NÃO cria saldo (INVENTORY_BALANCE_NOT_FOUND se ausente)
 * 9. Atualiza status para EXPIRED com expired_at
 * 10. Registra evento ORDER_EXPIRED
 * 11. COMMIT — se qualquer passo falhar, ROLLBACK
 * 12. Retorna contagem de sucesso/falha
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

      // 4. Processar TODAS reservation_ids — PER-RESERVATION_ID
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

      // 4a. Para CADA reservation_id: exigir pelo menos 1 movimento HOLD válido
      const perReservationHoldMovements = []; // [{reservation_id, movements: [...]}]
      for (const reservationId of reservationIds) {
        const holdMovements = await db.all(
          `SELECT variant_id, store_id, quantity_delta
           FROM pdv_inventory_movements_v2
           WHERE reference_id = ?
             AND movement_type = 'RESERVATION_HOLD'`,
          [reservationId]
        );

        // Exigir pelo menos um movimento HOLD para este reservation_id
        if (!holdMovements || holdMovements.length === 0) {
          await db.run("ROLLBACK");
          errorsDetails.push({
            order_id: orderId,
            reservation_id: reservationId,
            phase: "per_reservation_hold_check",
            error: "RESERVATION_MOVEMENTS_NOT_FOUND",
            message: `Reservation ${reservationId} não possui nenhum movimento RESERVATION_HOLD`,
          });
          // Sair do loop de pedidos — este pedido está com erro
          stockReleased = null; // marca como erro
          break;
        }

        // Validar variant_id, store_id e quantity_delta para cada movimento
        for (const m of holdMovements) {
          if (!m.variant_id || !m.store_id || m.quantity_delta === undefined || m.quantity_delta === null) {
            await db.run("ROLLBACK");
            errorsDetails.push({
              order_id: orderId,
              reservation_id: reservationId,
              phase: "movement_validation",
              error: "INVALID_HOLD_MOVEMENT",
              message: `Movimento HOLD incompleto: variant_id=${m.variant_id}, store_id=${m.store_id}, delta=${m.quantity_delta}`,
            });
            stockReleased = null;
            break;
          }
        }

        if (stockReleased === null) break;

        perReservationHoldMovements.push({
          reservation_id: reservationId,
          movements: holdMovements,
        });
      }

      // Se houve erro no loop per-reservation_id, pular este pedido
      if (stockReleased === null) {
        continue;
      }

      // 5. Agregar todos os movimentos HOLD por (store_id, variant_id)
      const allHoldMovements = [];
      for (const { movements } of perReservationHoldMovements) {
        allHoldMovements.push(...movements);
      }

      const aggregatedMap = new Map();
      for (const m of allHoldMovements) {
        const key = `${m.store_id}::${m.variant_id}`;
        if (aggregatedMap.has(key)) {
          const existing = aggregatedMap.get(key);
          existing.hold_quantity_total += Math.abs(m.quantity_delta);
        } else {
          aggregatedMap.set(key, {
            store_id: m.store_id,
            variant_id: m.variant_id,
            hold_quantity_total: Math.abs(m.quantity_delta),
          });
        }
      }

      // 6. Verificar release_quantity_total já existente por (orderId + storeId + variantId)
      //    Excluir movimentos com quantity_delta = 0 (não comprovam liberação)
      const releaseValidationMap = new Map();
      for (const [key, aggregated] of aggregatedMap) {
        const { store_id: sid, variant_id: vid } = aggregated;
        const existingReleases = await db.all(
          `SELECT quantity_delta FROM pdv_inventory_movements_v2
           WHERE movement_type = 'RESERVATION_RELEASE'
             AND reference_id = ?
             AND variant_id = ?
             AND store_id = ?
             AND quantity_delta != 0`,
          [orderId, vid, sid]
        );

        const releaseQuantityTotal = (existingReleases || []).reduce(
          (sum, r) => sum + Math.abs(r.quantity_delta || 0),
          0
        );

        releaseValidationMap.set(key, {
          ...aggregated,
          release_quantity_total: releaseQuantityTotal,
        });
      }

      // 7. Validar release: apenas liberar o que NÃO foi já liberado
      //    - release_quantity_total === hold_quantity_total: já liberado, pula este store+variant
      //    - release_quantity_total < hold_quantity_total: liberar a diferença
      //    - release_quantity_total > hold_quantity_total: RESERVATION_RELEASE_OVERFLOW, rollback
      let overflowDetected = false;
      const itemsByStore = {};
      let hasPendingRelease = false;

      for (const [key, validation] of releaseValidationMap) {
        const { store_id: sid, variant_id: vid, hold_quantity_total, release_quantity_total } = validation;

        if (release_quantity_total > hold_quantity_total) {
          overflowDetected = true;
          errorsDetails.push({
            order_id: orderId,
            store_id: sid,
            variant_id: vid,
            phase: "release_validation",
            error: "RESERVATION_RELEASE_OVERFLOW",
            message: `release_quantity_total(${release_quantity_total}) > hold_quantity_total(${hold_quantity_total})`,
          });
        } else if (release_quantity_total < hold_quantity_total) {
          // Liberar a diferença
          const qtyToRelease = hold_quantity_total - release_quantity_total;
          if (!itemsByStore[sid]) itemsByStore[sid] = [];
          itemsByStore[sid].push({
            variant_id: vid,
            quantity: qtyToRelease,
          });
          hasPendingRelease = true;
        }
        // release_quantity_total === hold_quantity_total: já liberado, não faz nada
      }

      if (overflowDetected) {
        await db.run("ROLLBACK");
        errorsDetails.push({
          order_id: orderId,
          phase: "release_validation",
          error: "RESERVATION_RELEASE_OVERFLOW",
          message: "Overflow detectado em pelo menos um store+variant",
        });
        continue;
      }

      if (hasPendingRelease) {
        // 8. Liberar estoque por store usando releaseReservation com runner da tx
        try {
          let anyReleased = false;
          let inconsistencyFound = false;
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
            // Se houve inconsistência, rollback e sair do loop de pedidos
            if (releaseResult && releaseResult.has_inconsistency) {
              inconsistencyFound = true;
              break;
            }
          }
          if (inconsistencyFound) {
            await db.run("ROLLBACK");
            errorsDetails.push({
              order_id: orderId,
              phase: "release_reservation",
              error: "RELEASE_INCONSISTENCY",
              message: "Inconsistência detectada durante releaseReservation",
            });
            continue;
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
      } else {
        // Todos os items já foram liberados (release_quantity_total === hold_quantity_total)
        stockReleased = true;
      }

      // 9. Atualizar status para EXPIRED com expired_at
      const orderUpdateResult = await db.run(
        `UPDATE app_orders
         SET status = 'EXPIRED', expired_at = ?, updated_at = ?
         WHERE id = ? AND status = 'READY_FOR_PAYMENT'`,
        [nowIso, nowIso, orderId]
      );

      // 10. Verificar se a atualização foi aplicada (conflito concorrente)
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

      // 11. Registrar evento de expiração
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

      // 12. COMMIT
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
