"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aerostore-pdv-reservation-"));
process.env.DATABASE_PATH = path.join(tempRoot, "test.sqlite");

const { db, initializeDatabase, all } = require("../db");
const {
  convertNormalizedReservationToSale,
  createProductAggregate,
  holdNormalizedReservation,
  holdNormalizedReservations,
  releaseNormalizedReservation
} = require("../modules/pdv/products/pdvSimpleProductService");

const actor = { id: 999004, name: "QA Reserva Ciclo 3", role: "admin" };

async function main() {
  await initializeDatabase();
  const product = await createProductAggregate({
    name: "QA Reserva Grade",
    product_type: "variable",
    base_sku: "QA-C3-RESERVA",
    price: 80,
    store_id: "vila",
    variants: [
      { color: "Verde", size: "M", initial_stock: 4 },
      { color: "Verde", size: "G", initial_stock: 1 }
    ]
  }, actor);
  const variationId = product.variants.find((item) => item.size === "M").variation_id;
  const secondVariationId = product.variants.find((item) => item.size === "G").variation_id;

  const held = await holdNormalizedReservation({
    reservation_id: "RSV_QA_C3_1",
    variation_id: variationId,
    store_id: "vila",
    quantity: 1,
    idempotency_key: "reservation:RSV_QA_C3_1:hold"
  }, actor);
  assert.strictEqual(held.balance.physical_qty, 4);
  assert.strictEqual(held.balance.reserved_qty, 1);
  assert.strictEqual(held.balance.available_qty, 3);
  assert.strictEqual(held.movement.movement_type, "RESERVATION_HOLD");

  const replayed = await holdNormalizedReservation({
    reservation_id: "RSV_QA_C3_1",
    variation_id: variationId,
    store_id: "vila",
    quantity: 1,
    idempotency_key: "reservation:RSV_QA_C3_1:hold"
  }, actor);
  assert.strictEqual(replayed.replayed, true);
  assert.strictEqual(replayed.balance.reserved_qty, 1);

  const released = await releaseNormalizedReservation({
    reservation_id: "RSV_QA_C3_1",
    variation_id: variationId,
    store_id: "vila",
    quantity: 1,
    idempotency_key: "reservation:RSV_QA_C3_1:release"
  }, actor);
  assert.strictEqual(released.balance.physical_qty, 4);
  assert.strictEqual(released.balance.reserved_qty, 0);
  assert.strictEqual(released.balance.available_qty, 4);

  await holdNormalizedReservation({
    reservation_id: "RSV_QA_C3_2",
    variation_id: variationId,
    store_id: "vila",
    quantity: 2,
    idempotency_key: "reservation:RSV_QA_C3_2:hold"
  }, actor);
  const converted = await convertNormalizedReservationToSale({
    reservation_id: "RSV_QA_C3_2",
    sale_id: "SALE_QA_C3_2",
    variation_id: variationId,
    store_id: "vila",
    quantity: 2,
    idempotency_key: "reservation:RSV_QA_C3_2:convert"
  }, actor);
  assert.strictEqual(converted.balance.physical_qty, 2);
  assert.strictEqual(converted.balance.reserved_qty, 0);
  assert.strictEqual(converted.balance.available_qty, 2);
  assert.strictEqual(converted.movement.movement_type, "SALE_OUT");

  const saleMovements = await all(
    `SELECT * FROM pdv_inventory_movements_v2
     WHERE variant_id = ? AND movement_type = 'SALE_OUT'`,
    [variationId]
  );
  assert.strictEqual(saleMovements.length, 1, "Conversao deve gerar um unico SALE_OUT.");
  assert.strictEqual(saleMovements[0].quantity_delta, -2);

  const convertedReplay = await convertNormalizedReservationToSale({
    reservation_id: "RSV_QA_C3_2",
    sale_id: "SALE_QA_C3_2",
    variation_id: variationId,
    store_id: "vila",
    quantity: 2,
    idempotency_key: "reservation:RSV_QA_C3_2:convert"
  }, actor);
  assert.strictEqual(convertedReplay.replayed, true);
  assert.strictEqual(convertedReplay.balance.physical_qty, 2);

  await assert.rejects(
    () => holdNormalizedReservations([
      {
        reservation_id: "RSV_QA_C3_BATCH",
        variation_id: variationId,
        store_id: "vila",
        quantity: 1,
        idempotency_key: "reservation:RSV_QA_C3_BATCH:m:hold"
      },
      {
        reservation_id: "RSV_QA_C3_BATCH",
        variation_id: secondVariationId,
        store_id: "vila",
        quantity: 2,
        idempotency_key: "reservation:RSV_QA_C3_BATCH:g:hold"
      }
    ], actor),
    /Disponibilidade insuficiente/
  );
  const balancesAfterBatchFailure = await all(
    `SELECT variant_id, reserved_qty
     FROM pdv_inventory_balances_v2
     WHERE variant_id IN (?, ?)
     ORDER BY variant_id`,
    [variationId, secondVariationId]
  );
  assert.deepStrictEqual(
    balancesAfterBatchFailure.map((item) => Number(item.reserved_qty)),
    [0, 0],
    "Falha em um item deve reverter todos os HOLDs do lote."
  );

  console.log(JSON.stringify({
    ok: true,
    variation_id: variationId,
    physical_qty: converted.balance.physical_qty,
    reserved_qty: converted.balance.reserved_qty,
    sale_out_movements: saleMovements.length,
    batch_rollback: true
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  });
