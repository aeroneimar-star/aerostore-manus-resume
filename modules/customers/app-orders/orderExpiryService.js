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
 * - Idempotência cumulativa: RELEASE::orderId::storeId::variantId::TARGET::holdTotal
 * - Sinal dos movimentos: HOLD < 0, RELEASE > 0
 * - Reservation IDs duplicados: rejeitar com DUPLICATE_RESERVATION_ID
 * - Validação pós-release: reconsultar HOLD/RELEASE/saldo antes de EXPIRED
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
 * 4. Validar reservation_ids: rejeitar duplicados (DUPLICATE_RESERVATION_ID)
 * 5. Para CADA reservation_id:
 *    a. Busca movimentos RESERVATION_HOLD
 *    b. Exige pelo menos 1 movimento válido (variant_id, store_id, quantity_delta)
 *    c. Validar sinal: HOLD quantity_delta < 0
 *    d. Se nenhum HOLD: RESERVATION_MOVEMENTS_NOT_FOUND, rollback
 * 6. Agrega movimentos por store_id + variant_id (soma quantidades)
 * 7. Calcula hold_quantity_total por (orderId + storeId + variantId)
 * 8. Verifica release_quantity_total já existente (exclui delta=0, delta<0)
 *    - release_quantity_total === hold_quantity_total: já liberado, pula
 *    - release_quantity_total < hold_quantity_total: liberar a diferença
 *    - release_quantity_total > hold_quantity_total: RESERVATION_RELEASE_OVERFLOW, rollback
 * 9. Libera estoque via releaseReservation (runner transacional, chave TARGET cumulativa)
 * 10. Validação pós-release: reconsultar HOLD/RELEASE/saldo
 *     - Se release_total !== hold_total: RELEASE_TOTAL_MISMATCH, rollback
 *     - Se reserved_qty não reflete liberação: rollback
 * 11. Atualiza status para EXPIRED com expired_at
 * 12. Registra evento ORDER_EXPIRED
 * 13. COMMIT — se qualquer passo falhar, ROLLBACK
 * 14. Retorna contagem de sucesso/falha
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
        await db.run("ROLLBACK");
        continue;
      }

      // Verificar expires_at dentro da tx (pode ter sido atualizado)
      const orderExpiresAt = reRead.expires_at;
      if (orderExpiresAt && orderExpiresAt > nowIso) {
        await db.run("ROLLBACK");
        continue;
      }

      // 4. Processar reservation_ids
      const rawReservationIds = reRead.reservation_ids_json
        ? JSON.parse(reRead.reservation_ids_json)
        : [];

      let stockReleased = false;

      if (rawReservationIds.length === 0) {
        await db.run("ROLLBACK");
        errorsDetails.push({
          order_id: orderId,
          phase: "reservation_check",
          error: "NO_RESERVATIONS_FOUND",
          message: `Pedido ${orderId} sem reservation_ids`,
        });
        continue;
      }

      // 4a. Rejeitar reservation_ids duplicados
      const uniqueIds = new Set(rawReservationIds);
      if (uniqueIds.size !== rawReservationIds.length) {
        await db.run("ROLLBACK");
        errorsDetails.push({
          order_id: orderId,
          phase: "duplicate_reservation_check",
          error: "DUPLICATE_RESERVATION_ID",
          message: `Pedido ${orderId} possui reservation_ids duplicados`,
          violations: rawReservationIds.filter((id, idx) => rawReservationIds.indexOf(id) !== idx),
        });
        continue;
      }

      const reservationIds = rawReservationIds;

      // 4b. Para CADA reservation_id: exigir pelo menos 1 movimento HOLD válido
      const perReservationHoldMovements = [];
      const orderViolations = []; // todas violações deste pedido (single-error)

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
          orderViolations.push({
            reservation_id: reservationId,
            error: "RESERVATION_MOVEMENTS_NOT_FOUND",
            message: `Reservation ${reservationId} não possui nenhum movimento RESERVATION_HOLD`,
          });
          stockReleased = null;
          break;
        }

        // Validar variant_id, store_id e quantity_delta para cada movimento
        for (const m of holdMovements) {
          if (!m.variant_id || !m.store_id || m.quantity_delta === undefined || m.quantity_delta === null) {
            orderViolations.push({
              reservation_id: reservationId,
              error: "INVALID_HOLD_MOVEMENT",
              message: `Movimento HOLD incompleto: variant_id=${m.variant_id}, store_id=${m.store_id}, delta=${m.quantity_delta}`,
            });
            stockReleased = null;
            break;
          }

          // LOOP 3 — Validar sinal do HOLD: quantity_delta DEVE ser < 0
          if (typeof m.quantity_delta !== 'number' || m.quantity_delta >= 0) {
            orderViolations.push({
              reservation_id: reservationId,
              error: "INVALID_HOLD_SIGN",
              message: `HOLD com quantity_delta=${m.quantity_delta} (deve ser < 0)`,
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

      // Se houve violação no loop per-reservation_id, rollback com single-error
      if (stockReleased === null) {
        await db.run("ROLLBACK");
        errorsDetails.push({
          order_id: orderId,
          phase: "per_reservation_hold_check",
          error: orderViolations[0].error,
          reservation_id: orderViolations[0].reservation_id,
          violations: orderViolations,
          message: orderViolations[0].message,
        });
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

      // LOOP 1 — Verificar release_quantity_total já existente por (orderId + storeId + variantId)
      //    Consultar TODOS movimentos RESERVATION_RELEASE sem filtro de sinal
      const releaseValidationMap = new Map();
      const invalidReleaseViolations = []; // violações de sinal para rejeição

      for (const [key, aggregated] of aggregatedMap) {
        const { store_id: sid, variant_id: vid } = aggregated;

        // LOOP 1: buscar TODOS movimentos RELEASE sem filtrar por sinal
        const allExistingReleases = await db.all(
          `SELECT id, quantity_delta, quantity_before, quantity_after
           FROM pdv_inventory_movements_v2
           WHERE movement_type = 'RESERVATION_RELEASE'
             AND reference_id = ?
             AND variant_id = ?
             AND store_id = ?`,
          [orderId, vid, sid]
        );

        let validReleaseTotal = 0;

        for (const r of allExistingReleases) {
          // Validar cada movimento RELEASE
          const reasons = [];

          if (typeof r.quantity_delta !== 'number' || r.quantity_delta <= 0) {
            reasons.push(`quantity_delta=${r.quantity_delta} (deve ser > 0)`);
          }

          if (typeof r.quantity_before !== 'number' || r.quantity_before < 0) {
            reasons.push(`quantity_before=${r.quantity_before} (deve ser >= 0)`);
          }

          if (typeof r.quantity_after !== 'number' || r.quantity_after < 0) {
            reasons.push(`quantity_after=${r.quantity_after} (deve ser >= 0)`);
          }

          if (typeof r.quantity_delta === 'number' &&
              typeof r.quantity_before === 'number' &&
              typeof r.quantity_after === 'number' &&
              (r.quantity_after - r.quantity_before) !== r.quantity_delta) {
            reasons.push(`quantity_after - quantity_before (${r.quantity_after} - ${r.quantity_before} = ${r.quantity_after - r.quantity_before}) !== quantity_delta (${r.quantity_delta})`);
          }

          if (reasons.length > 0) {
            invalidReleaseViolations.push({
              movement_id: r.id,
              store_id: sid,
              variant_id: vid,
              quantity_delta: r.quantity_delta,
              reason: reasons.join('; '),
            });
          } else {
            // Válido: somar ao total
            validReleaseTotal += r.quantity_delta;
          }
        }

        releaseValidationMap.set(key, {
          ...aggregated,
          release_quantity_total: validReleaseTotal,
        });
      }

      // LOOP 1: Se houver RELEASEs inválidos, rollback com single-error
      if (invalidReleaseViolations.length > 0) {
        await db.run("ROLLBACK");
        errorsDetails.push({
          order_id: orderId,
          phase: "release_movement_validation",
          error: "INVALID_RELEASE_MOVEMENT",
          violations: invalidReleaseViolations,
          message: `${invalidReleaseViolations.length} movimento(s) RELEASE inválido(s) detectado(s)`,
        });
        continue;
      }

      // 7. Validar release: apenas liberar o que NÃO foi já liberado
      let overflowDetected = false;
      const overflowViolations = [];
      const itemsByStore = {};
      let hasPendingRelease = false;

      for (const [key, validation] of releaseValidationMap) {
        const { store_id: sid, variant_id: vid, hold_quantity_total, release_quantity_total } = validation;

        if (release_quantity_total > hold_quantity_total) {
          overflowDetected = true;
          overflowViolations.push({
            store_id: sid,
            variant_id: vid,
            hold_quantity_total,
            release_quantity_total,
          });
        } else if (release_quantity_total < hold_quantity_total) {
          const qtyToRelease = hold_quantity_total - release_quantity_total;
          if (!itemsByStore[sid]) itemsByStore[sid] = [];
          itemsByStore[sid].push({
            variant_id: vid,
            quantity: qtyToRelease,
            hold_total: hold_quantity_total, // passar para chave TARGET cumulativa
          });
          hasPendingRelease = true;
        }
      }

      // 7a. Se overflow: rollback com single-error (uma entrada com todas as violations)
      if (overflowDetected) {
        await db.run("ROLLBACK");
        errorsDetails.push({
          order_id: orderId,
          phase: "release_validation",
          error: "RESERVATION_RELEASE_OVERFLOW",
          violations: overflowViolations,
          message: `Overflow detectado: release > hold em ${overflowViolations.length} variante(s)`,
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

      // LOOP 2 — Validação pós-release POR (store_id, variant_id) com saldo
      const postReleaseViolations = [];

      for (const [key, aggregated] of aggregatedMap) {
        const { store_id: sid, variant_id: vid } = aggregated;

        // Reconsultar HOLD total para esta combinação
        const holdSum = await db.get(
          `SELECT COALESCE(SUM(ABS(quantity_delta)), 0) as total
           FROM pdv_inventory_movements_v2
           WHERE movement_type = 'RESERVATION_HOLD'
             AND reference_id IN (${reservationIds.map(() => '?').join(',')})
             AND store_id = ?
             AND variant_id = ?
             AND quantity_delta < 0`,
          [...reservationIds, sid, vid]
        );
        const holdTotal = holdSum?.total || 0;

        // Reconsultar RELEASE total para esta combinação (válidos apenas: delta > 0)
        const releaseSum = await db.get(
          `SELECT COALESCE(SUM(quantity_delta), 0) as total
           FROM pdv_inventory_movements_v2
           WHERE movement_type = 'RESERVATION_RELEASE'
             AND reference_id = ?
             AND store_id = ?
             AND variant_id = ?
             AND quantity_delta > 0`,
          [orderId, sid, vid]
        );
        const releaseTotal = releaseSum?.total || 0;

        // Reconsultar saldo atual
        const balanceRow = await db.get(
          `SELECT available_qty, reserved_qty, version
           FROM pdv_inventory_balances_v2
           WHERE variant_id = ? AND store_id = ?`,
          [vid, sid]
        );

        const pendingQuantity = holdTotal - releaseTotal;

        if (pendingQuantity > 0) {
          // Esperar: saldo reflete a liberação pendente
          // available_qty após release = available_before + pending
          // reserved_qty após release = reserved_before - pending
          // version após release = version_before + 1
          // release_total DEVE ser === hold_total
          if (releaseTotal !== holdTotal) {
            postReleaseViolations.push({
              store_id: sid,
              variant_id: vid,
              error: "POST_RELEASE_BALANCE_MISMATCH",
              hold_total: holdTotal,
              release_total: releaseTotal,
              pending_quantity: pendingQuantity,
              available_qty: balanceRow?.available_qty,
              reserved_qty: balanceRow?.reserved_qty,
              version: balanceRow?.version,
              message: `RELEASE=${releaseTotal} !== HOLD=${holdTotal} para store=${sid}, variant=${vid}`,
            });
          }
        }

        // Quando pending_quantity === 0: releases históricos devem ter sinal válido
        // (já validado no LOOP 1, mas verificamos consistência)
        if (pendingQuantity === 0 && releaseTotal !== holdTotal) {
          postReleaseViolations.push({
            store_id: sid,
            variant_id: vid,
            error: "POST_RELEASE_BALANCE_MISMATCH",
            hold_total: holdTotal,
            release_total: releaseTotal,
            message: `RELEASE=${releaseTotal} !== HOLD=${holdTotal} para store=${sid}, variant=${vid} (pending=0)`,
          });
        }
      }

      // Se qualquer combinação falhou: rollback com single-error
      if (postReleaseViolations.length > 0) {
        await db.run("ROLLBACK");
        errorsDetails.push({
          order_id: orderId,
          phase: "post_release_validation",
          error: "POST_RELEASE_BALANCE_MISMATCH",
          violations: postReleaseViolations,
          message: `${postReleaseViolations.length} combinação(ões) com divergência saldo/movimento`,
        });
        continue;
      }

      // Calcular totais para o evento (usando aggregatedMap)
      let postReleaseHoldTotal = 0;
      let postReleaseReleaseTotal = 0;
      for (const [key, aggregated] of aggregatedMap) {
        const { hold_quantity_total } = aggregated;
        postReleaseHoldTotal += hold_quantity_total;

        // Obter release total desta combinação
        const { store_id: sid, variant_id: vid } = aggregated;
        const relRow = await db.get(
          `SELECT COALESCE(SUM(quantity_delta), 0) as total
           FROM pdv_inventory_movements_v2
           WHERE movement_type = 'RESERVATION_RELEASE'
             AND reference_id = ? AND store_id = ? AND variant_id = ? AND quantity_delta > 0`,
          [orderId, sid, vid]
        );
        postReleaseReleaseTotal += (relRow?.total || 0);
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
            hold_total: postReleaseHoldTotal,
            release_total: postReleaseReleaseTotal,
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
