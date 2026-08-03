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
 * - releaseReservation NÃO cria saldo (INVENTORY_BALANCE_NOT_FOUND se ausente)
 * - Idempotência cumulativa: RELEASE::orderId::storeId::variantId::TARGET::holdTotal
 * - Sinal dos movimentos: HOLD < 0, RELEASE > 0
 * - Reservation IDs duplicados: rejeitar com DUPLICATE_RESERVATION_ID
 * - Snapshot pré-release por store+variant (item 1)
 * - Validação pós-release com 4 igualdades por store+variant (item 2)
 * - Full release pré-existente bloqueado (item 3)
 * - Se qualquer passo falhar: ROLLBACK completo
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
 * 7. LOOP 1: Verifica release_quantity_total já existente por (orderId + storeId + variantId)
 *    - Consultar TODOS movimentos RESERVATION_RELEASE sem filtro de sinal
 *    - Validar cada movimento: delta > 0, quantity_before >= 0, quantity_after >= 0
 *    - release_quantity_total === hold_quantity_total: FULL RELEASE PRÉ-EXISTENTE
 *      → PREEXISTING_FULL_RELEASE_REQUIRES_RECONCILIATION, rollback
 *    - release_quantity_total > hold_quantity_total: RESERVATION_RELEASE_OVERFLOW, rollback
 *    - release_quantity_total < hold_quantity_total: liberar a diferença
 * 8. ITEM 1 — SNAPSHOT PRÉ-RELEASE por store+variant:
 *    - hold_total, release_total_before, pending_quantity
 *    - available_qty_before, reserved_qty_before, version_before
 *    - Se saldo não existe: INVENTORY_BALANCE_NOT_FOUND, rollback
 *    - Se reserved_qty_before < pending_quantity: RESERVATION_BALANCE_INCONSISTENT, rollback
 * 9. Libera estoque via releaseReservation (runner transacional, chave TARGET cumulativa)
 * 10. ITEM 2 — VALIDAÇÃO PÓS-RELEASE REAL:
 *     - Reler: release_total_after, available_qty_after, reserved_qty_after, version_after
 *     - Exigir TODAS as 4 igualdades (quando pending_quantity > 0):
 *       a) release_total_after === hold_total
 *       b) release_total_after === release_total_before + pending_quantity
 *       c) available_qty_after === available_qty_before + pending_quantity
 *       d) reserved_qty_after === reserved_qty_before - pending_quantity
 *       e) version_after === version_before + 1
 *     - POST_RELEASE_BALANCE_MISMATCH com valores before/after, rollback
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
      const orderViolations = [];

      for (const reservationId of reservationIds) {
        const holdMovements = await db.all(
          `SELECT variant_id, store_id, quantity_delta
           FROM pdv_inventory_movements_v2
           WHERE reference_id = ?
             AND movement_type = 'RESERVATION_HOLD'`,
          [reservationId]
        );

        if (!holdMovements || holdMovements.length === 0) {
          orderViolations.push({
            reservation_id: reservationId,
            error: "RESERVATION_MOVEMENTS_NOT_FOUND",
            message: `Reservation ${reservationId} não possui nenhum movimento RESERVATION_HOLD`,
          });
          stockReleased = null;
          break;
        }

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

          // Validar sinal do HOLD: quantity_delta DEVE ser < 0
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
      // Consultar TODOS movimentos RESERVATION_RELEASE sem filtro de sinal
      const releaseValidationMap = new Map();
      const invalidReleaseViolations = [];

      for (const [key, aggregated] of aggregatedMap) {
        const { store_id: sid, variant_id: vid } = aggregated;

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

      // ITEM 3 — FULL RELEASE PRÉ-EXISTENTE
      // Se release_total_before === hold_total enquanto status = READY_FOR_PAYMENT
      let fullReleasePreExisting = false;
      const fullReleaseViolations = [];

      for (const [key, validation] of releaseValidationMap) {
        const { store_id: sid, variant_id: vid, hold_quantity_total, release_quantity_total } = validation;

        if (release_quantity_total === hold_quantity_total && hold_quantity_total > 0) {
          fullReleasePreExisting = true;
          fullReleaseViolations.push({
            store_id: sid,
            variant_id: vid,
            hold_total: hold_quantity_total,
            release_total: release_quantity_total,
            message: `RELEASE=${release_quantity_total} === HOLD=${hold_quantity_total} para store=${sid}, variant=${vid} mas pedido ainda READY_FOR_PAYMENT`,
          });
        }
      }

      if (fullReleasePreExisting) {
        await db.run("ROLLBACK");
        errorsDetails.push({
          order_id: orderId,
          phase: "preexisting_full_release",
          error: "PREEXISTING_FULL_RELEASE_REQUIRES_RECONCILIATION",
          violations: fullReleaseViolations,
          message: `Pedido ${orderId} com release completo mas status READY_FOR_PAYMENT — requer reconciliação`,
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
            hold_total: hold_quantity_total,
          });
          hasPendingRelease = true;
        }
      }

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

      // ITEM 1 — SNAPSHOT PRÉ-RELEASE por store+variant
      // Capturar saldo ANTES de chamar releaseReservation
      const preReleaseSnapshots = new Map(); // key -> { hold_total, release_total_before, pending, available_before, reserved_before, version_before }

      for (const [key, validation] of releaseValidationMap) {
        const { store_id: sid, variant_id: vid, hold_quantity_total, release_quantity_total } = validation;
        const pendingQuantity = hold_quantity_total - release_quantity_total;

        // Se não há liberação pendente para esta combinação, pular snapshot
        if (pendingQuantity <= 0) {
          preReleaseSnapshots.set(key, {
            store_id: sid,
            variant_id: vid,
            hold_total: hold_quantity_total,
            release_total_before: release_quantity_total,
            pending_quantity: 0,
            available_qty_before: null,
            reserved_qty_before: null,
            version_before: null,
            no_release_needed: true,
          });
          continue;
        }

        // Buscar saldo atual ANTES do release
        const balanceRow = await db.get(
          `SELECT available_qty, reserved_qty, version
           FROM pdv_inventory_balances_v2
           WHERE variant_id = ? AND store_id = ?`,
          [vid, sid]
        );

        // Se saldo não existe: INVENTORY_BALANCE_NOT_FOUND
        if (!balanceRow) {
          await db.run("ROLLBACK");
          errorsDetails.push({
            order_id: orderId,
            phase: "pre_release_snapshot",
            error: "INVENTORY_BALANCE_NOT_FOUND",
            store_id: sid,
            variant_id: vid,
            message: `Saldo não encontrado para variant=${vid}, store=${sid}`,
          });
          break; // sai do loop, o continue externo vai tratar
        }

        // Se reserved_qty < pending_quantity: RESERVATION_BALANCE_INCONSISTENT
        if (balanceRow.reserved_qty < pendingQuantity) {
          await db.run("ROLLBACK");
          errorsDetails.push({
            order_id: orderId,
            phase: "pre_release_snapshot",
            error: "RESERVATION_BALANCE_INCONSISTENT",
            store_id: sid,
            variant_id: vid,
            reserved_qty: balanceRow.reserved_qty,
            pending_quantity: pendingQuantity,
            message: `reserved_qty=${balanceRow.reserved_qty} < pending=${pendingQuantity} para store=${sid}, variant=${vid}`,
          });
          break;
        }

        preReleaseSnapshots.set(key, {
          store_id: sid,
          variant_id: vid,
          hold_total: hold_quantity_total,
          release_total_before: release_quantity_total,
          pending_quantity: pendingQuantity,
          available_qty_before: balanceRow.available_qty,
          reserved_qty_before: balanceRow.reserved_qty,
          version_before: balanceRow.version,
          no_release_needed: false,
        });
      }

      // Verificar se algum snapshot falhou (break no loop acima)
      const snapshotFailure = errorsDetails.length > 0 &&
        errorsDetails[errorsDetails.length - 1].order_id === orderId;
      if (snapshotFailure) {
        continue; // já fez rollback
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
              { db }
            );
            if (releaseResult && releaseResult.released) {
              anyReleased = true;
            }
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
        stockReleased = true;
      }

      // ITEM 2 — VALIDAÇÃO PÓS-RELEASE REAL por (store_id, variant_id) com 4 igualdades
      const postReleaseViolations = [];

      for (const [key, snapshot] of preReleaseSnapshots) {
        if (snapshot.no_release_needed) continue;

        const { store_id: sid, variant_id: vid } = snapshot;
        const { hold_total, release_total_before, pending_quantity, available_qty_before, reserved_qty_before, version_before } = snapshot;

        // Reler HOLD total após release
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
        const holdTotalAfter = holdSum?.total || 0;

        // Reler RELEASE total após release
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
        const releaseTotalAfter = releaseSum?.total || 0;

        // Reler saldo após release
        const balanceAfter = await db.get(
          `SELECT available_qty, reserved_qty, version
           FROM pdv_inventory_balances_v2
           WHERE variant_id = ? AND store_id = ?`,
          [vid, sid]
        );

        const availableAfter = balanceAfter?.available_qty;
        const reservedAfter = balanceAfter?.reserved_qty;
        const versionAfter = balanceAfter?.version;

        // Exigir TODAS as 4 igualdades quando pending_quantity > 0
        const violations = [];

        if (releaseTotalAfter !== hold_total) {
          violations.push({
            field: "release_total_after === hold_total",
            expected: hold_total,
            actual: releaseTotalAfter,
          });
        }

        if (releaseTotalAfter !== release_total_before + pending_quantity) {
          violations.push({
            field: "release_total_after === release_total_before + pending_quantity",
            expected: release_total_before + pending_quantity,
            actual: releaseTotalAfter,
          });
        }

        if (availableAfter !== available_qty_before + pending_quantity) {
          violations.push({
            field: "available_qty_after === available_qty_before + pending_quantity",
            expected: available_qty_before + pending_quantity,
            actual: availableAfter,
          });
        }

        if (reservedAfter !== reserved_qty_before - pending_quantity) {
          violations.push({
            field: "reserved_qty_after === reserved_qty_before - pending_quantity",
            expected: reserved_qty_before - pending_quantity,
            actual: reservedAfter,
          });
        }

        if (versionAfter !== version_before + 1) {
          violations.push({
            field: "version_after === version_before + 1",
            expected: version_before + 1,
            actual: versionAfter,
          });
        }

        if (violations.length > 0) {
          postReleaseViolations.push({
            store_id: sid,
            variant_id: vid,
            error: "POST_RELEASE_BALANCE_MISMATCH",
            violations,
            before: {
              available_qty: available_qty_before,
              reserved_qty: reserved_qty_before,
              version: version_before,
              release_total: release_total_before,
            },
            after: {
              available_qty: availableAfter,
              reserved_qty: reservedAfter,
              version: versionAfter,
              release_total: releaseTotalAfter,
            },
            hold_total,
            pending_quantity,
            message: `${violations.length} igualdade(s) falhou(aram) para store=${sid}, variant=${vid}`,
          });
        }
      }

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

      // Calcular totais para o evento
      let postReleaseHoldTotal = 0;
      let postReleaseReleaseTotal = 0;
      for (const [key, snapshot] of preReleaseSnapshots) {
        postReleaseHoldTotal += snapshot.hold_total;
        if (!snapshot.no_release_needed) {
          const { store_id: sid, variant_id: vid } = snapshot;
          const relRow = await db.get(
            `SELECT COALESCE(SUM(quantity_delta), 0) as total
             FROM pdv_inventory_movements_v2
             WHERE movement_type = 'RESERVATION_RELEASE'
               AND reference_id = ? AND store_id = ? AND variant_id = ? AND quantity_delta > 0`,
            [orderId, sid, vid]
          );
          postReleaseReleaseTotal += (relRow?.total || 0);
        } else {
          postReleaseReleaseTotal += snapshot.release_total_before;
        }
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
