"use strict";

/**
 * InventoryService — Adaptador entre o Shop e o estoque real do PDV.
 *
 * Este serviço delega as operações de reserva ao pdvInventoryService,
 * consumindo diretamente as tabelas:
 *   - pdv_inventory_balances_v2 (saldo real por variante+loja)
 *   - pdv_inventory_movements_v2 (auditoria de movimentos)
 *
 * O fluxo real:
 *   1. holdReservation: decrementa available_qty, incrementa reserved_qty,
 *      grava movimento RESERVATION_HOLD com idempotency_key.
 *   2. releaseReservation: reverte hold (incrementa available_qty,
 *      decrementa reserved_qty), grava movimento RESERVATION_RELEASE.
 *
 * Nenhuma tabela paralela de reserva é criada. O PDV é a fonte da verdade.
 */

const { randomUUID } = require("crypto");

const ALLOWED_MOVEMENT_TYPES = Object.freeze([
  "RESERVATION_HOLD",
  "RESERVATION_RELEASE",
]);

function iso(d) {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}

function generateId() {
  return randomUUID();
}

function createInventoryService(options = {}) {
  const db = options.dbApi;
  if (!db || ["run", "get", "all"].some((name) => typeof db[name] !== "function")) {
    throw new Error("INVENTORY_SERVICE_DB_REQUIRED");
  }

  async function getBalance(variantId, storeId) {
    const row = await db.get(
      `SELECT id, variant_id, store_id, available_qty, reserved_qty, version, updated_at
       FROM pdv_inventory_balances_v2
       WHERE variant_id = ? AND store_id = ?`,
      [variantId, storeId]
    );
    if (!row) {
      return { id: null, variant_id: variantId, store_id: storeId, available_qty: 0, reserved_qty: 0, version: 0 };
    }
    return row;
  }

  async function ensureBalance(variantId, storeId) {
    const existing = await getBalance(variantId, storeId);
    if (existing.id) return existing;
    const now = iso(new Date());
    await db.run(
      `INSERT INTO pdv_inventory_balances_v2 (variant_id, store_id, available_qty, reserved_qty, version, updated_at)
       VALUES (?, ?, 0, 0, 1, ?)`,
      [variantId, storeId, now]
    );
    return getBalance(variantId, storeId);
  }

  /**
   * holdReservation — Reserva estoque para um pedido.
   *
   * Regras:
   * - Consulta saldo ATUAL e verifica disponibilidade.
   * - Usa transação (BEGIN/COMMIT) para garantir atomicidade.
   * - Grava movimento RESERVATION_HOLD com idempotency_key UNIQUE.
   * - Se idempotency_key já existe, retorna o movimento existente (idempotente).
   * - Retorna array de { movement_id, reservation_id, store_id, items }.
   */
  async function holdReservation(orderId, items, storeId, idempotencyKey) {
    if (!orderId) throw new Error("ORDER_ID_REQUIRED");
    if (!Array.isArray(items) || items.length === 0) throw new Error("ITEMS_REQUIRED");
    if (!storeId) throw new Error("STORE_ID_REQUIRED");
    if (!idempotencyKey) throw new Error("IDEMPOTENCY_KEY_REQUIRED");

    const now = iso(new Date());
    const reservationId = generateId();

    // Verificar idempotência (verifica pelo primeiro item + order)
    const firstItemKey = `${idempotencyKey}::${items[0].variant_id}`;
    const existingMovement = await db.get(
      `SELECT id, variant_id, store_id, quantity_delta, reference_id
       FROM pdv_inventory_movements_v2
       WHERE idempotency_key = ? AND movement_type = 'RESERVATION_HOLD'`,
      [firstItemKey]
    );
    if (existingMovement) {
      return {
        reservation_id: existingMovement.reference_id,
        order_id: orderId,
        store_id: existingMovement.store_id,
        status: "HELD",
        items: [{
          variant_id: existingMovement.variant_id,
          store_id: existingMovement.store_id,
          quantity: Math.abs(existingMovement.quantity_delta),
          movement_id: existingMovement.id,
        }],
      };
    }

    const heldItems = [];

    // Usar transação para garantir atomicidade
    await db.run("BEGIN TRANSACTION");
    try {
      for (const item of items) {
        const variantId = item.variant_id;
        const quantity = Math.max(1, Math.floor(item.quantity || 1));

        // Obter saldo atual com lock implícito (transação)
        const balance = await ensureBalance(variantId, storeId);
        if (balance.available_qty < quantity) {
          await db.run("ROLLBACK");
          throw new Error(`INSUFFICIENT_STOCK: variant=${variantId}, store=${storeId}, requested=${quantity}, available=${balance.available_qty}`);
        }

        const newAvailable = balance.available_qty - quantity;
        const newReserved = balance.reserved_qty + quantity;
        const newVersion = balance.version + 1;
        const movementId = generateId();

        // Atualizar saldo
        await db.run(
          `UPDATE pdv_inventory_balances_v2
           SET available_qty = ?, reserved_qty = ?, version = ?, updated_at = ?
           WHERE id = ? AND version = ?`,
          [newAvailable, newReserved, newVersion, now, balance.id, balance.version]
        );

        // Verificar se a atualização foi aplicada (caso de concorrência)
        const updated = await db.get(
          `SELECT id FROM pdv_inventory_balances_v2 WHERE id = ? AND version = ?`,
          [balance.id, newVersion]
        );
        if (!updated) {
          await db.run("ROLLBACK");
          throw new Error(`STOCK_CONCURRENCY_CONFLICT: variant=${variantId}, store=${storeId}`);
        }

        // Gravar movimento
        await db.run(
          `INSERT INTO pdv_inventory_movements_v2
           (id, variant_id, store_id, movement_type, quantity_delta, quantity_before,
            quantity_after, origin, reference_type, reference_id, idempotency_key,
            actor_user_id, actor_name, metadata_json, created_at)
           VALUES (?, ?, ?, 'RESERVATION_HOLD', ?, ?, ?, ?, 'RESERVATION', ?, ?, ?, ?, ?, ?)`,
          [
            movementId,
            variantId,
            storeId,
            -quantity,
            balance.available_qty,
            newAvailable,
            "app_order_shop",
            reservationId,
            `${idempotencyKey}::${variantId}`,
            0,
            "system",
            JSON.stringify({ order_id: orderId }),
            now,
          ]
        );

        heldItems.push({
          variant_id: variantId,
          store_id: storeId,
          quantity,
          movement_id: movementId,
          before_available: balance.available_qty,
          after_available: newAvailable,
        });
      }

      await db.run("COMMIT");
    } catch (err) {
      // ROLLBACK já foi feito em caso de erro específico, mas garantir
      try { await db.run("ROLLBACK"); } catch (_) {}
      throw err;
    }

    return {
      reservation_id: reservationId,
      order_id: orderId,
      store_id: storeId,
      status: "HELD",
      items: heldItems,
    };
  }

  /**
   * releaseReservation — Libera reserva (rollback).
   *
   * Reverte o hold: incrementa available_qty, decrementa reserved_qty.
   * Grava movimento RESERVATION_RELEASE.
   */
  async function releaseReservation(orderId, storeId, items) {
    if (!orderId) throw new Error("ORDER_ID_REQUIRED");
    if (!storeId) throw new Error("STORE_ID_REQUIRED");
    if (!Array.isArray(items) || items.length === 0) return { released: false, reason: "NO_ITEMS" };

    const now = iso(new Date());

    for (const item of items) {
      const variantId = item.variant_id;
      const quantity = Math.max(1, Math.floor(item.quantity || 1));

      const balance = await ensureBalance(variantId, storeId);
      const newAvailable = balance.available_qty + quantity;
      const newReserved = Math.max(0, balance.reserved_qty - quantity);
      const newVersion = balance.version + 1;
      const movementId = generateId();

      await db.run(
        `UPDATE pdv_inventory_balances_v2
         SET available_qty = ?, reserved_qty = ?, version = ?, updated_at = ?
         WHERE id = ? AND version = ?`,
        [newAvailable, newReserved, newVersion, now, balance.id, balance.version]
      );

      await db.run(
        `INSERT INTO pdv_inventory_movements_v2
         (id, variant_id, store_id, movement_type, quantity_delta, quantity_before,
          quantity_after, origin, reference_type, reference_id, idempotency_key,
          actor_user_id, actor_name, metadata_json, created_at)
         VALUES (?, ?, ?, 'RESERVATION_RELEASE', ?, ?, ?, ?, 'RESERVATION', ?, ?, ?, ?, ?, ?)`,
        [
          movementId,
          variantId,
          storeId,
          quantity,
          balance.available_qty,
          newAvailable,
          "app_order_shop",
          orderId,
          generateId(),
          0,
          "system",
          JSON.stringify({ order_id: orderId, reason: "release" }),
          now,
        ]
      );
    }

    return { released: true, order_id: orderId, store_id: storeId };
  }

  return {
    getBalance,
    holdReservation,
    releaseReservation,
  };
}

module.exports = { createInventoryService };
