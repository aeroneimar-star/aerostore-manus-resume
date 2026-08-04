"use strict";
/**
 * reservationIntegrityService — Validação compartilhada de reservas de estoque.
 *
 * Usado por:
 *   - orderExpiryService (expiração de pedidos)
 *   - paymentAttemptService (criação de tentativa PIX)
 *
 * Tabelas reais consultadas:
 *   - pdv_inventory_movements_v2 (movimentos)
 *   - pdv_inventory_balances_v2 (saldos)
 *
 * Para um pedido READY_FOR_PAYMENT, valida:
 *   1. reservation_ids_json válido e não vazio
 *   2. Nenhum reservation_id duplicado
 *   3. Para cada reservation_id, consultar TODOS os HOLDs em pdv_inventory_movements_v2
 *   4. Cada HOLD deve ter:
 *      - movement_type = RESERVATION_HOLD
 *      - quantity_delta < 0
 *      - store_id preenchido
 *      - variant_id preenchido
 *   5. Agregar HOLD por store_id + variant_id
 *   6. Consultar TODOS os RELEASEs do order_id
 *   7. Validar cada RELEASE:
 *      - quantity_delta > 0
 *      - quantity_before >= 0
 *      - quantity_after >= 0
 *      - quantity_after - quantity_before = quantity_delta
 *   8. release_total > hold_total → ORDER_RESERVATION_INVALID
 *   9. release_total = hold_total enquanto READY_FOR_PAYMENT → PREEXISTING_FULL_RELEASE_REQUIRES_RECONCILIATION
 *  10. Calcular pending = hold_total - release_total
 *  11. Exigir saldo em pdv_inventory_balances_v2
 *  12. Exigir reserved_qty >= pending
 *
 * API:
 *   validateReservationIntegrity(db, order) → {
 *     reservationIds: string[],
 *     totalHoldByStoreVariant: Map<"store::variant", { holdTotal, releaseTotal, pending }>,
 *     reservationFingerprint: string  // hash canônico para idempotência
 *   }
 */

function createReservationIntegrityService() {
  /**
   * validateReservationIntegrity — Valida reservas de um pedido.
   *
   * @param {object} runner - db ou db.transaction()
   * @param {object} order - { id, status, reservation_ids_json, snapshot_json }
   * @returns {object} { reservationIds, totalHoldByStoreVariant, reservationFingerprint }
   * @throws {PaymentAttemptError} com código adequado
   */
  async function validateReservationIntegrity(runner, order) {
    const ReservationIntegrityError = class extends Error {
      constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "ReservationIntegrityError";
      }
    };

    if (!order.reservation_ids_json || order.reservation_ids_json.trim() === "" || order.reservation_ids_json === "[]") {
      throw new ReservationIntegrityError("ORDER_RESERVATION_INVALID", "Reservas inválidas ou ausentes.");
    }

    let reservationIds;
    try {
      reservationIds = JSON.parse(order.reservation_ids_json);
    } catch (e) {
      throw new ReservationIntegrityError("ORDER_RESERVATION_INVALID", "reservation_ids_json inválido.");
    }

    if (!Array.isArray(reservationIds) || reservationIds.length === 0) {
      throw new ReservationIntegrityError("ORDER_RESERVATION_INVALID", "Nenhuma reserva encontrada.");
    }

    // 2. Nenhum reservation_id duplicado
    const uniqueIds = new Set(reservationIds);
    if (uniqueIds.size !== reservationIds.length) {
      throw new ReservationIntegrityError("DUPLICATE_RESERVATION_ID", "Reservation IDs duplicados detectados.");
    }

    // 3-5. Para cada reservation_id, consultar TODOS os HOLDs
    const storeVariantHoldMap = new Map();
    const allHolds = [];

    for (const resId of reservationIds) {
      const holds = await runner.all(
        `SELECT id, variant_id, store_id, movement_type, quantity_delta, quantity_before, quantity_after,
                reference_type, reference_id, idempotency_key
         FROM pdv_inventory_movements_v2
         WHERE reference_id = ? AND movement_type = 'RESERVATION_HOLD'`,
        [resId]
      );

      if (!holds || holds.length === 0) {
        throw new ReservationIntegrityError(
          "ORDER_RESERVATION_INVALID",
          `Reserva ${resId} sem movimentos HOLD válidos.`
        );
      }

      for (const hold of holds) {
        // 4. Validação de cada HOLD
        if (hold.movement_type !== "RESERVATION_HOLD") {
          throw new ReservationIntegrityError("ORDER_RESERVATION_INVALID", "Movimento não é RESERVATION_HOLD.");
        }
        if (hold.quantity_delta >= 0) {
          throw new ReservationIntegrityError("ORDER_RESERVATION_INVALID", "HOLD deve ter quantity_delta < 0.");
        }
        if (!hold.store_id || hold.store_id.trim() === "") {
          throw new ReservationIntegrityError("ORDER_RESERVATION_INVALID", "HOLD sem store_id.");
        }
        if (!hold.variant_id || hold.variant_id.trim() === "") {
          throw new ReservationIntegrityError("ORDER_RESERVATION_INVALID", "HOLD sem variant_id.");
        }

        allHolds.push(hold);

        // 5. Agregar por store_id + variant_id
        const key = `${hold.store_id}::${hold.variant_id}`;
        const existing = storeVariantHoldMap.get(key) || { holdTotal: 0, holdDetails: [] };
        existing.holdTotal += Math.abs(hold.quantity_delta);
        existing.holdDetails.push(hold);
        storeVariantHoldMap.set(key, existing);
      }
    }

    // 6. Consultar TODOS os RELEASEs do order_id
    const releases = await runner.all(
      `SELECT id, variant_id, store_id, movement_type, quantity_delta, quantity_before, quantity_after,
              reference_type, reference_id, idempotency_key
       FROM pdv_inventory_movements_v2
       WHERE reference_id = ? AND movement_type = 'RESERVATION_RELEASE'`,
      [order.id]
    );

    // 7. Validar cada RELEASE
    for (const rel of (releases || [])) {
      if (rel.quantity_delta <= 0) {
        throw new ReservationIntegrityError("ORDER_RESERVATION_INVALID", "RELEASE deve ter quantity_delta > 0.");
      }
      if (rel.quantity_before < 0) {
        throw new ReservationIntegrityError("ORDER_RESERVATION_INVALID", "RELEASE quantity_before < 0.");
      }
      if (rel.quantity_after < 0) {
        throw new ReservationIntegrityError("ORDER_RESERVATION_INVALID", "RELEASE quantity_after < 0.");
      }
      if ((rel.quantity_after - rel.quantity_before) !== rel.quantity_delta) {
        throw new ReservationIntegrityError(
          "ORDER_RESERVATION_INVALID",
          "RELEASE inconsistente: after - before != delta."
        );
      }
    }

    // Agregar releases por store_id + variant_id
    for (const rel of (releases || [])) {
      const key = `${rel.store_id}::${rel.variant_id}`;
      const entry = storeVariantHoldMap.get(key);
      if (entry) {
        entry.releaseTotal = (entry.releaseTotal || 0) + rel.quantity_delta;
      }
    }

    // 8-12. Validar hold vs release e saldo
    const result = {};
    for (const [key, entry] of storeVariantHoldMap) {
      const holdTotal = entry.holdTotal;
      const releaseTotal = entry.releaseTotal || 0;
      const pending = holdTotal - releaseTotal;

      if (releaseTotal > holdTotal) {
        throw new ReservationIntegrityError(
          "ORDER_RESERVATION_INVALID",
          `Release total (${releaseTotal}) > hold total (${holdTotal}) para ${key}.`
        );
      }

      if (releaseTotal === holdTotal && order.status === "READY_FOR_PAYMENT") {
        throw new ReservationIntegrityError(
          "PREEXISTING_FULL_RELEASE_REQUIRES_RECONCILIATION",
          `Full release pré-existente para ${key} enquanto pedido READY_FOR_PAYMENT.`
        );
      }

      // 11. Exigir saldo
      const [storeId, variantId] = key.split("::");
      const balance = await runner.get(
        `SELECT id, variant_id, store_id, available_qty, reserved_qty, version
         FROM pdv_inventory_balances_v2
         WHERE variant_id = ? AND store_id = ?`,
        [variantId, storeId]
      );

      if (!balance || !balance.id) {
        throw new ReservationIntegrityError(
          "INVENTORY_BALANCE_NOT_FOUND",
          `Saldo não encontrado para ${key}.`
        );
      }

      // 12. Exigir reserved_qty >= pending
      if (balance.reserved_qty < pending) {
        throw new ReservationIntegrityError(
          "INVENTORY_BALANCE_INSUFFICIENT",
          `reserved_qty (${balance.reserved_qty}) < pending (${pending}) para ${key}.`
        );
      }

      result[key] = { holdTotal, releaseTotal, pending };
    }

    // Gerar fingerprint canônico da reserva
    const fingerprintParts = [];
    for (const hold of allHolds.sort((a, b) => a.id.localeCompare(b.id))) {
      fingerprintParts.push(`${hold.id}:${hold.variant_id}:${hold.store_id}:${hold.quantity_delta}`);
    }
    for (const rel of (releases || []).sort((a, b) => a.id.localeCompare(b.id))) {
      fingerprintParts.push(`REL:${rel.id}:${rel.variant_id}:${rel.store_id}:${rel.quantity_delta}`);
    }

    return {
      reservationIds,
      totalHoldByStoreVariant: result,
      reservationFingerprint: fingerprintParts.join(";"),
    };
  }

  return { validateReservationIntegrity };
}

module.exports = { createReservationIntegrityService };
