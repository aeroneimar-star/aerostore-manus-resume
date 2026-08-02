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
 * - Todas reservation_ids processadas (não apenas a primeira)
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
 * 4. Processa TODAS reservation_ids
 * 5. Libera estoque para cada reserva
 * 6. Atualiza status para EXPIRED com expired_at
 * 7. Registra evento ORDER_EXPIRED
 * 8. COMMIT — se qualquer passo falhar, ROLLBACK
 * 9. Retorna contagem de sucesso/falha
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

      // Extrair store_id do snapshot_json (app_orders não tem coluna store_id)
      const snapshot = reRead.snapshot_json ? JSON.parse(reRead.snapshot_json) : {};
      const storeId = snapshot.store_origin_id;

      let stockReleased = false;

      if (reservationIds.length > 0) {
        // Para cada reservation_id, buscar os movimentos HOLD
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

        if (allHoldMovements.length > 0) {
          // Agrupar itens por store_id para liberação correta
          const itemsByStore = {};
          for (const m of allHoldMovements) {
            const key = m.store_id;
            if (!itemsByStore[key]) itemsByStore[key] = [];
            itemsByStore[key].push({
              variant_id: m.variant_id,
              quantity: Math.abs(m.quantity_delta),
            });
          }

          // 5. Liberar estoque por store usando releaseReservation
          try {
            let anyReleased = false;
            for (const [storeId, items] of Object.entries(itemsByStore)) {
              await inventoryService.releaseReservation(
                orderId,
                storeId,
                items,
                { db } // passar db para usar dentro da tx
              );
              anyReleased = true;
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
        }
      }

      // 6. Atualizar status para EXPIRED com expired_at
      await db.run(
        `UPDATE app_orders
         SET status = 'EXPIRED', expired_at = ?, updated_at = ?
         WHERE id = ? AND status = 'READY_FOR_PAYMENT'`,
        [nowIso, nowIso, orderId]
      );

      // 7. Verificar se a atualização foi aplicada
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

      // 8. Registrar evento de expiração
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

      // 9. COMMIT
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
