"use strict";

const { randomUUID } = require("crypto");
const { createReservationIntegrityService, ReservationIntegrityError } = require("./reservationIntegrityService");

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
 * - RELEASE sem HOLD correspondente: rejeitar com RELEASE_WITHOUT_HOLD
 * - Se qualquer passo falhar: ROLLBACK completo
 *
 * VALIDAÇÃO DE RESERVA: delegada ao reservationIntegrityService (compartilhado
 * com paymentAttemptService). Mantém single source of truth para:
 *   - reservation_ids_json parsing + validação
 *   - Duplicate reservation ID detection
 *   - HOLD signal validation (quantity_delta < 0)
 *   - HOLD completeness (store_id, variant_id)
 *   - RELEASE signal validation (quantity_delta > 0, before >= 0, after >= 0, arithmetic)
 *   - RELEASE-without-HOLD detection
 *   - Hold vs release overflow detection
 *   - Full release pre-existing detection
 *   - Balance existence + reserved_qty >= pending
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
 * 4. Delega validação de reserva ao reservationIntegrityService (shared validator)
 *    → ReservationIntegrityError mapeada para rollback + errors_details
 * 5. Converte resultado do validator em releaseValidationMap para fluxo de release
 * 6. ITEM 1 — SNAPSHOT PRÉ-RELEASE por store+variant:
 *    - hold_total, release_total_before, pending_quantity
 *    - available_qty_before, reserved_qty_before, version_before
 *    - Se saldo não existe: INVENTORY_BALANCE_NOT_FOUND, rollback
 *    - Se reserved_qty_before < pending_quantity: RESERVATION_BALANCE_INCONSISTENT, rollback
 * 7. Libera estoque via releaseReservation (runner transacional, chave TARGET cumulativa)
 * 8. ITEM 2 — VALIDAÇÃO PÓS-RELEASE REAL:
 *    - Reler: release_total_after, available_qty_after, reserved_qty_after, version_after
 *    - Exigir TODAS as 4 igualdades (quando pending_quantity > 0):
 *      a) release_total_after === hold_total
 *      b) release_total_after === release_total_before + pending_quantity
 *      c) available_qty_after === available_qty_before + pending_quantity
 *      d) reserved_qty_after === reserved_qty_before - pending_quantity
 *      e) version_after === version_before + 1
 *    - POST_RELEASE_BALANCE_MISMATCH com valores before/after, rollback
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

  // Shared validator — delegação ao reservationIntegrityService
  const reservationIntegrityService = options.reservationIntegrityService || createReservationIntegrityService();

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

      // 4. DELEGAÇÃO: validar reserva usando reservationIntegrityService (shared validator)
      //    Substitui o bloco duplicado de validação que existia nas linhas 149-417.
      let validation;
      let overflowAllViolations = null;
      try {
        validation = await reservationIntegrityService.validateReservationIntegrity(db, reRead);
      } catch (integrityErr) {
        // Para overflow: precisamos coletar TODAS as violações (não apenas a primeira)
        // O validator lança na primeira overflow; precisamos re-consultar o DB
        if (integrityErr instanceof ReservationIntegrityError &&
            integrityErr.code === "ORDER_RESERVATION_INVALID" &&
            integrityErr.message.toLowerCase().includes("release total")) {
          // Re-consultar DB para coletar todas as overflow violations
          try {
            const rawReservationIds = reRead.reservation_ids_json ? JSON.parse(reRead.reservation_ids_json) : [];
            const allHolds = await db.all(
              `SELECT variant_id, store_id, quantity_delta
               FROM pdv_inventory_movements_v2
               WHERE reference_id IN (${rawReservationIds.map(() => '?').join(',')})
                 AND movement_type = 'RESERVATION_HOLD'
                 AND quantity_delta < 0`,
              rawReservationIds
            );
            const holdAgg = {};
            for (const h of allHolds) {
              const key = `${h.store_id}::${h.variant_id}`;
              if (!holdAgg[key]) holdAgg[key] = { hold_quantity_total: 0, store_id: h.store_id, variant_id: h.variant_id };
              holdAgg[key].hold_quantity_total += Math.abs(h.quantity_delta);
            }
            const allReleases = await db.all(
              `SELECT variant_id, store_id, quantity_delta
               FROM pdv_inventory_movements_v2
               WHERE reference_id = ? AND movement_type = 'RESERVATION_RELEASE'
                 AND quantity_delta > 0`,
              [orderId]
            );
            const releaseAgg = {};
            for (const r of allReleases) {
              const key = `${r.store_id}::${r.variant_id}`;
              if (!releaseAgg[key]) releaseAgg[key] = { release_quantity_total: 0, store_id: r.store_id, variant_id: r.variant_id };
              releaseAgg[key].release_quantity_total += r.quantity_delta;
            }
            const allViolations = [];
            for (const [key, hold] of Object.entries(holdAgg)) {
              const rel = releaseAgg[key] || { release_quantity_total: 0 };
              if (rel.release_quantity_total > hold.hold_quantity_total) {
                allViolations.push({
                  store_id: hold.store_id,
                  variant_id: hold.variant_id,
                  hold_quantity_total: hold.hold_quantity_total,
                  release_quantity_total: rel.release_quantity_total,
                });
              }
            }
            if (allViolations.length > 0) {
              overflowAllViolations = allViolations;
            }
          } catch (overflowErr) {
            // Fallback: usar violation empty
          }
        }

        await db.run("ROLLBACK");
        if (integrityErr instanceof ReservationIntegrityError) {
          // Mapear códigos do validator para os códigos esperados pelo sweep
          const mappedError = mapIntegrityError(integrityErr, orderId);
          errorsDetails.push({
            order_id: orderId,
            phase: "reservation_validation",
            error: mappedError.error,
            ...mappedError.extra,
            violations: overflowAllViolations || mappedError.extra.violations || [],
            message: integrityErr.message,
          });
          continue;
        }
        // Erro não mapeável (ex: db connection error)
        errorsDetails.push({
          order_id: orderId,
          phase: "sweep",
          error: integrityErr.message,
        });
        continue;
      }

      const { reservationIds, totalHoldByStoreVariant } = validation;

      // 5. Verificar se há reservations vazias após validação (edge case)
      let stockReleased = false;

      if (!reservationIds || reservationIds.length === 0) {
        await db.run("ROLLBACK");
        errorsDetails.push({
          order_id: orderId,
          phase: "reservation_check",
          error: "NO_RESERVATIONS_FOUND",
          message: `Pedido ${orderId} sem reservation_ids válidas`,
        });
        continue;
      }

      // 6. Construir releaseValidationMap a partir do resultado do validator
      //    O validator retorna totalHoldByStoreVariant = { "store::variant": { holdTotal, releaseTotal, pending } }
      const releaseValidationMap = new Map();
      for (const [key, entry] of Object.entries(totalHoldByStoreVariant)) {
        const [storeId, variantId] = key.split("::");
        releaseValidationMap.set(key, {
          store_id: storeId,
          variant_id: variantId,
          hold_quantity_total: entry.holdTotal,
          release_quantity_total: entry.releaseTotal,
          pending: entry.pending,
        });
      }

      // 7. Validar release: apenas liberar o que NÃO foi já liberado
      let overflowDetected = false;
      const overflowViolations = [];
      const itemsByStore = {};
      let hasPendingRelease = false;

      for (const [key, entry] of releaseValidationMap) {
        const { store_id: sid, variant_id: vid, hold_quantity_total, release_quantity_total } = entry;

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
      const preReleaseSnapshots = new Map();

      for (const [key, entry] of releaseValidationMap) {
        const { store_id: sid, variant_id: vid, hold_quantity_total, release_quantity_total } = entry;
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

/**
 * mapIntegrityError — Mapeia ReservationIntegrityError codes para os codes
 * esperados pelo sweepExpiredOrders error contract.
 *
 * O reservationIntegrityService usa seus próprios códigos; o sweep precisa
 * dos códigos originais (INVALID_HOLD_SIGN, INVALID_RELEASE_MOVEMENT, etc.)
 * para que os testes de regressão continuem passando.
 */
function mapIntegrityError(integrityErr, orderId) {
  const code = integrityErr.code;
  const details = integrityErr.details || {};

  switch (code) {
    case "DUPLICATE_RESERVATION_ID":
      return {
        error: "DUPLICATE_RESERVATION_ID",
        extra: {
          phase: "duplicate_reservation_check",
          violations: details.violations || [],
        },
      };

    case "ORDER_RESERVATION_INVALID": {
      // Check if this is a RELEASE_WITHOUT_HOLD error (new contract)
      // The reservationIntegrityService uses ORDER_RESERVATION_INVALID with details.reason=RELEASE_WITHOUT_HOLD
      if (details.reason === "RELEASE_WITHOUT_HOLD") {
        return {
          error: "RELEASE_WITHOUT_HOLD",
          extra: {
            phase: "release_without_hold_check",
            violations: details.violations || [],
          },
        };
      }
      // O validator retorna mensagens genéricas; precisamos mapear para os códigos
      // específicos esperados pelo sweep.
      const msg = integrityErr.message || "";
      const violations = details.violations || [];

      // RELEASE validation: mensagens que contêm "RELEASE" e referência a delta/before/after
      if (msg.includes("RELEASE") && (msg.includes("quantity_delta") || msg.includes("quantity_before") || msg.includes("quantity_after") || msg.includes("inconsistente"))) {
        return {
          error: "INVALID_RELEASE_MOVEMENT",
          extra: {
            phase: "release_movement_validation",
            violations,
          },
        };
      }
      // Release overflow: release > hold
      // The validator message uses "Release total" (capital R) or "release total"
      if (msg.toLowerCase().includes("release total") && msg.toLowerCase().includes("hold total")) {
        return {
          error: "RESERVATION_RELEASE_OVERFLOW",
          extra: {
            phase: "release_validation",
            violations: [], // Will be populated by sweep's own overflow check below
          },
        };
      }
      // HOLD validation: mensagens que contêm "HOLD" mas não "RELEASE"
      if (msg.includes("HOLD") && msg.includes("quantity_delta")) {
        return {
          error: "INVALID_HOLD_SIGN",
          extra: {
            phase: "per_reservation_hold_check",
            violations,
          },
        };
      }
      // Missing HOLD movements: "Reserva <resId> sem movimentos HOLD válidos."
      if (msg.includes("sem movimentos HOLD válidos")) {
        const resIdMatch = msg.match(/Reserva\s+(\S+)\s+sem/);
        const resId = resIdMatch ? resIdMatch[1] : undefined;
        return {
          error: "RESERVATION_MOVEMENTS_NOT_FOUND",
          extra: {
            phase: "per_reservation_hold_check",
            reservation_id: resId,
            violations,
          },
        };
      }
      if (msg.includes("Reservation ID") || msg.includes("reservation_ids_json")) {
        return {
          error: "ORDER_RESERVATION_INVALID",
          extra: {
            phase: "reservation_validation",
            violations,
          },
        };
      }
      // Fallback: usar ORDER_RESERVATION_INVALID genérico
      return {
        error: "ORDER_RESERVATION_INVALID",
        extra: {
          phase: "reservation_validation",
          violations,
        },
      };
    }

    case "PREEXISTING_FULL_RELEASE_REQUIRES_RECONCILIATION":
      return {
        error: "PREEXISTING_FULL_RELEASE_REQUIRES_RECONCILIATION",
        extra: {
          phase: "preexisting_full_release",
          violations: details.violations || [],
        },
      };

    case "INVENTORY_BALANCE_NOT_FOUND":
      return {
        error: "INVENTORY_BALANCE_NOT_FOUND",
        extra: {
          phase: "pre_release_snapshot",
        },
      };

    case "INVENTORY_BALANCE_INSUFFICIENT":
      return {
        error: "RESERVATION_BALANCE_INCONSISTENT",
        extra: {
          phase: "pre_release_snapshot",
        },
      };

    default:
      return {
        error: code,
        extra: {
          phase: "reservation_validation",
          violations: details.violations || [],
        },
      };
  }
}

module.exports = { sweepExpiredOrders };
