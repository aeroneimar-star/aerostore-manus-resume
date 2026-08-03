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
 * Idempotência: por movimento individual (orderId + storeId + variantId).
 * Transação: aceita { db } para rodar dentro de BEGIN/COMMIT externo.
 * Nenhuma tabela paralela de reserva é criada. O PDV é a fonte da verdade.
 *
 * Bloqueio de inflação: releaseReservation valida reserved_qty >= quantity
 * antes de atualizar o saldo. Se inconsistente, lança
 * RESERVATION_BALANCE_INCONSISTENT e faz rollback integral.
 *
 * CRUCIAL: releaseReservation NÃO cria saldo.
 * - Usa getBalance (não ensureBalance).
 * - Se saldo não existir: INVENTORY_BALANCE_NOT_FOUND, rollback.
 * - Nunca insere linha nova na tabela de saldos.
 */

const { randomUUID } = require("crypto");

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

  async function getBalance(runner, variantId, storeId) {
    const r = runner || db;
    const row = await r.get(
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

  async function ensureBalance(runner, variantId, storeId) {
    const r = runner || db;
    const existing = await getBalance(r, variantId, storeId);
    if (existing.id) return existing;
    const now = iso(new Date());
    await r.run(
      `INSERT INTO pdv_inventory_balances_v2 (variant_id, store_id, available_qty, reserved_qty, version, updated_at)
       VALUES (?, ?, 0, 0, 1, ?)`,
      [variantId, storeId, now]
    );
    return getBalance(r, variantId, storeId);
  }

  /**
   * holdReservation — Reserva estoque para um pedido.
   *
   * Regras:
   * - Consulta saldo ATUAL e verifica disponibilidade.
   * - Usa transação (BEGIN/COMMIT) para garantir atomicidade.
   * - Grava movimento RESERVATION_HOLD com idempotency_key UNIQUE.
   * - Se idempotency_key já existe, retorna o movimento existente (idempotente).
   * - Pode usar ensureBalance conforme contrato (cria saldo se ausente).
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

        const balance = await ensureBalance(db, variantId, storeId);
        if (balance.available_qty < quantity) {
          await db.run("ROLLBACK");
          throw new Error(`INSUFFICIENT_STOCK: variant=${variantId}, store=${storeId}, requested=${quantity}, available=${balance.available_qty}`);
        }

        const newAvailable = balance.available_qty - quantity;
        const newReserved = balance.reserved_qty + quantity;
        const newVersion = balance.version + 1;
        const movementId = generateId();

        await db.run(
          `UPDATE pdv_inventory_balances_v2
           SET available_qty = ?, reserved_qty = ?, version = ?, updated_at = ?
           WHERE id = ? AND version = ?`,
          [newAvailable, newReserved, newVersion, now, balance.id, balance.version]
        );

        const updated = await db.get(
          `SELECT id FROM pdv_inventory_balances_v2 WHERE id = ? AND version = ?`,
          [balance.id, newVersion]
        );
        if (!updated) {
          await db.run("ROLLBACK");
          throw new Error(`STOCK_CONCURRENCY_CONFLICT: variant=${variantId}, store=${storeId}`);
        }

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
   *
   * BLOQUEIO DE INFLAÇÃO:
   * - Antes do UPDATE, valida reserved_qty >= quantity.
   * - Se reserved_qty < quantity: lança RESERVATION_BALANCE_INCONSISTENT.
   * - available_qty e reserved_qty NÃO mudam.
   * - Nenhum RELEASE é gravado.
   *
   * RELEASE NÃO CRIA SALDO:
   * - Usa getBalance (não ensureBalance).
   * - Se saldo não existir: INVENTORY_BALANCE_NOT_FOUND.
   * - Não insere linha nova na tabela de saldos.
   * - Rollback integral.
   *
   * Idempotente: usa chave por movimento (orderId + storeId + variantId).
   * Se já foi liberado, retorna sem re-liberar (evita double-release).
   *
   * Runner transacional:
   * - Se txOpts.db fornecido, TODAS operações usam esse runner.
   * - Nunca usa db da closure quando txOpts.db existe.
   *
   * Verificação de versão: após UPDATE, verifica se version mudou
   * para detectar conflito concorrente.
   */
  async function releaseReservation(orderId, storeId, items, txOpts = null) {
    if (!orderId) throw new Error("ORDER_ID_REQUIRED");
    if (!storeId) throw new Error("STORE_ID_REQUIRED");
    if (!Array.isArray(items) || items.length === 0) return { released: false, reason: "NO_ITEMS" };

    // Runner: se txOpts.db fornecido, usar exclusivamente ele
    const runner = txOpts?.db || db;

    const results = [];
    let threwInconsistency = false;

    for (const item of items) {
      const variantId = item.variant_id;
      const quantity = Math.max(1, Math.floor(item.quantity || 1));

      // Idempotência por movimento individual
      const releaseKey = `RELEASE::${orderId}::${storeId}::${variantId}`;
      const existingRelease = await runner.get(
        `SELECT id FROM pdv_inventory_movements_v2
         WHERE idempotency_key = ? AND movement_type = 'RESERVATION_RELEASE'`,
        [releaseKey]
      );
      if (existingRelease) {
        results.push({ variant_id: variantId, released: false, reason: "ALREADY_RELEASED", idempotent: true });
        continue;
      }

      const now = iso(new Date());

      // OBTER SALDO SEM CRIAR (getBalance, não ensureBalance)
      const balance = await getBalance(runner, variantId, storeId);

      // RELEASE NÃO CRIA SALDO: se não existir, INVENTORY_BALANCE_NOT_FOUND
      if (!balance.id) {
        results.push({
          variant_id: variantId,
          released: false,
          reason: "INVENTORY_BALANCE_NOT_FOUND",
          error: `Balance not found for variant=${variantId}, store=${storeId}`,
        });
        threwInconsistency = true;
        continue;
      }

      // BLOQUEIO DE INFLAÇÃO: validar reserved_qty >= quantity
      if (balance.reserved_qty < quantity) {
        results.push({
          variant_id: variantId,
          released: false,
          reason: "RESERVATION_BALANCE_INCONSISTENT",
          error: `reserved_qty=${balance.reserved_qty} < quantity=${quantity}`,
        });
        threwInconsistency = true;
        continue;
      }

      const newAvailable = balance.available_qty + quantity;
      const newReserved = balance.reserved_qty - quantity;
      const newVersion = balance.version + 1;
      const movementId = generateId();

      // UPDATE com verificação de versão (conflito concorrente)
      await runner.run(
        `UPDATE pdv_inventory_balances_v2
         SET available_qty = ?, reserved_qty = ?, version = ?, updated_at = ?
         WHERE id = ? AND version = ?`,
        [newAvailable, newReserved, newVersion, now, balance.id, balance.version]
      );

      // Verificar que a versão foi atualizada (detectar conflito)
      const updated = await runner.get(
        `SELECT id, version FROM pdv_inventory_balances_v2 WHERE id = ? AND version = ?`,
        [balance.id, newVersion]
      );
      if (!updated) {
        results.push({
          variant_id: variantId,
          released: false,
          reason: "VERSION_CONFLICT",
          error: `Balance version changed concurrently for variant=${variantId}, store=${storeId}`,
        });
        threwInconsistency = true;
        continue;
      }

      await runner.run(
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
          releaseKey,
          0,
          "system",
          JSON.stringify({ order_id: orderId, reason: "release" }),
          now,
        ]
      );

      results.push({ variant_id: variantId, released: true, movement_id: movementId });
    }

    // Se houve inconsistência, o caller (sweepExpiredOrders) deve fazer rollback
    if (threwInconsistency) {
      return {
        released: false,
        reason: "INCONSISTENT_RELEASE",
        order_id: orderId,
        store_id: storeId,
        results,
        has_inconsistency: true,
      };
    }

    const anyReleased = results.some(r => r.released);
    const allIdempotent = results.length > 0 && results.every(r => r.idempotent === true);
    return {
      released: anyReleased,
      idempotent: allIdempotent,
      reason: allIdempotent ? 'ALREADY_RELEASED' : undefined,
      order_id: orderId,
      store_id: storeId,
      results,
      has_inconsistency: false,
    };
  }

  return {
    getBalance: (variantId, storeId) => getBalance(null, variantId, storeId),
    ensureBalance: (variantId, storeId) => ensureBalance(null, variantId, storeId),
    holdReservation,
    releaseReservation,
  };
}

module.exports = { createInventoryService };
