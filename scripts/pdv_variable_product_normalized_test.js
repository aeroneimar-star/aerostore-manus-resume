"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aerostore-pdv-variable-product-"));
process.env.DATABASE_PATH = path.join(tempRoot, "test.sqlite");

const { db, initializeDatabase, all, run } = require("../db");
const {
  applyNormalizedInventoryMovement,
  buildVariantSku,
  createProductAggregate,
  getProductAggregateById,
  normalizeVariantColor,
  normalizeVariantSize,
  updateProductAggregate
} = require("../modules/pdv/products/pdvSimpleProductService");
const {
  syncNormalizedProductProjection
} = require("../modules/pdv/inventory/pdvInventoryService");

const actor = {
  id: 999003,
  name: "QA Ciclo 3",
  email: "qa-ciclo3@aerostore.local",
  role: "admin"
};

async function main() {
  await initializeDatabase();

  assert.strictEqual(normalizeVariantColor("Verde Água"), "VERDE-AGUA");
  assert.strictEqual(normalizeVariantColor("Off White"), "OFF-WHITE");
  assert.strictEqual(normalizeVariantColor("Azul  Marinho"), "AZUL-MARINHO");
  assert.strictEqual(normalizeVariantSize(" gg "), "GG");
  assert.strictEqual(buildVariantSku("AERO-000120", "Verde", "m"), "AERO-000120-VERDE-M");

  await assert.rejects(
    createProductAggregate({
      name: "QA Projecao Deve Reverter",
      product_type: "variable",
      base_sku: "QA-CICLO3-PROJECTION-ROLLBACK",
      price: 10,
      store_id: "vila",
      variants: [{ color: "Verde", size: "P", initial_stock: 1 }]
    }, actor, {
      projectAggregate: () => {
        throw new Error("Falha simulada na projecao JSON.");
      }
    }),
    /Falha simulada/
  );
  const rolledBackProjectionProducts = await all(
    "SELECT id FROM pdv_products_v2 WHERE base_sku = ?",
    ["QA-CICLO3-PROJECTION-ROLLBACK"]
  );
  assert.strictEqual(rolledBackProjectionProducts.length, 0);

  const created = await createProductAggregate({
    name: "QA Camiseta Brasil Copa",
    product_type: "variable",
    base_sku: "QA-CICLO3-GRADE-001",
    price: 129.9,
    cost_price: 55,
    store_id: "vila",
    status: "ativo",
    source: "manual",
    variants: [
      { color: "Verde", size: "P", initial_stock: 2, barcode: "7891000000011" },
      { color: "Verde", size: "M", initial_stock: 4, barcode: "7891000000012" },
      { color: "Preto", size: "M", initial_stock: 3, barcode: "7891000000013" },
      { color: "Preto", size: "GG", initial_stock: 1, barcode: "7891000000014" }
    ]
  }, actor);

  assert(created.product.id, "Produto pai deve ser criado.");
  assert.strictEqual(created.product.product_type, "variable");
  assert.strictEqual(created.product.base_sku, "QA-CICLO3-GRADE-001");
  assert.strictEqual(created.variants.length, 4);
  assert.strictEqual(created.variants.filter((item) => item.is_default).length, 0);
  assert.deepStrictEqual(
    created.variants.map((item) => item.sku).sort(),
    [
      "QA-CICLO3-GRADE-001-PRETO-GG",
      "QA-CICLO3-GRADE-001-PRETO-M",
      "QA-CICLO3-GRADE-001-VERDE-M",
      "QA-CICLO3-GRADE-001-VERDE-P"
    ]
  );
  assert.strictEqual(created.totals.physical_qty, 10);
  assert.strictEqual(created.totals.reserved_qty, 0);
  assert.strictEqual(created.totals.available_qty, 10);

  const verdeM = created.variants.find((item) => item.color === "VERDE" && item.size === "M");
  assert(verdeM, "Variacao Verde/M deve existir.");
  assert.strictEqual(verdeM.physical_qty, 4);
  assert.strictEqual(verdeM.reserved_qty, 0);
  assert.strictEqual(verdeM.available_qty, 4);

  await run(
    `UPDATE pdv_inventory_balances_v2
     SET reserved_qty = 1
     WHERE variant_id = ? AND store_id = ?`,
    [verdeM.variation_id, "vila"]
  );

  const reservedAggregate = await getProductAggregateById(created.product.id);
  const reservedVerdeM = reservedAggregate.variants.find((item) => item.variation_id === verdeM.variation_id);
  assert.strictEqual(reservedVerdeM.physical_qty, 4);
  assert.strictEqual(reservedVerdeM.reserved_qty, 1);
  assert.strictEqual(reservedVerdeM.available_qty, 3);
  assert.strictEqual(reservedAggregate.totals.physical_qty, 10);
  assert.strictEqual(reservedAggregate.totals.reserved_qty, 1);
  assert.strictEqual(reservedAggregate.totals.available_qty, 9);

  const movements = await all(
    `SELECT movement_type, variant_id, quantity_delta, created_at
     FROM pdv_inventory_movements_v2
     WHERE variant_id IN (
       SELECT id FROM pdv_product_variants WHERE product_id = ?
     )
     ORDER BY created_at, id`,
    [created.product.id]
  );
  assert.strictEqual(movements.length, 4);
  assert(movements.every((item) => item.movement_type === "INITIAL_STOCK"));
  assert(movements.every((item) => item.created_at));

  const adjustment = await applyNormalizedInventoryMovement({
    variant_id: verdeM.variation_id,
    store_id: "vila",
    movement_type: "MANUAL_ADJUSTMENT",
    quantity_delta: 2,
    origin: "product_edit",
    reference_type: "PRODUCT",
    reference_id: String(created.product.id),
    idempotency_key: "qa-cycle3:adjust:verde-m",
    metadata: { reason: "QA ajuste" }
  }, actor);
  assert.strictEqual(adjustment.balance.available_qty, 6);
  assert.strictEqual(adjustment.balance.reserved_qty, 1);

  const replayedAdjustment = await applyNormalizedInventoryMovement({
    variant_id: verdeM.variation_id,
    store_id: "vila",
    movement_type: "MANUAL_ADJUSTMENT",
    quantity_delta: 2,
    origin: "product_edit",
    reference_type: "PRODUCT",
    reference_id: String(created.product.id),
    idempotency_key: "qa-cycle3:adjust:verde-m",
    metadata: { reason: "QA ajuste" }
  }, actor);
  assert.strictEqual(replayedAdjustment.replayed, true);
  assert.strictEqual(replayedAdjustment.balance.available_qty, 6);

  await assert.rejects(
    applyNormalizedInventoryMovement({
      variant_id: verdeM.variation_id,
      store_id: "vila",
      movement_type: "MANUAL_ADJUSTMENT",
      quantity_delta: 3,
      origin: "product_edit",
      reference_type: "PRODUCT",
      reference_id: String(created.product.id),
      idempotency_key: "qa-cycle3:adjust:verde-m",
      metadata: { reason: "Payload conflitante" }
    }, actor),
    /idempotencia|conflito/i
  );

  await assert.rejects(
    updateProductAggregate(created.product.id, {
      variants: created.variants
        .filter((item) => item.variation_id !== verdeM.variation_id)
        .map((item) => ({
          variation_id: item.variation_id,
          color: item.color,
          size: item.size,
          desired_stock: item.physical_qty,
          status: item.status
        }))
    }, actor),
    /possui 6 unidades.*saldo para zero/i
  );

  const edited = await updateProductAggregate(created.product.id, {
    name: "QA Camiseta Brasil Copa Editada",
    price: 139.9,
    variants: [
      ...created.variants.map((item) => ({
        variation_id: item.variation_id,
        color: item.color,
        size: item.size,
        desired_stock: item.variation_id === verdeM.variation_id ? 5 : item.physical_qty,
        status: item.status
      })),
      { color: "Azul Marinho", size: "G", desired_stock: 2, barcode: "7891000000015" }
    ]
  }, actor);
  assert.strictEqual(edited.product.name, "QA Camiseta Brasil Copa Editada");
  assert.strictEqual(edited.variants.length, 5);
  assert.strictEqual(
    edited.variants.find((item) => item.attribute_key === "VERDE|M").variation_id,
    verdeM.variation_id,
    "Edicao deve preservar variation_id existente."
  );
  assert.strictEqual(edited.variants.find((item) => item.attribute_key === "VERDE|M").physical_qty, 5);
  assert.strictEqual(edited.variants.find((item) => item.attribute_key === "AZUL-MARINHO|G").physical_qty, 2);

  const projectedRecords = [];
  const projection = syncNormalizedProductProjection(edited, actor, {
    records: projectedRecords,
    persist: false
  });
  assert.strictEqual(projection.records.length, 5);
  assert.strictEqual(projectedRecords.length, 5);
  assert(projectedRecords.every((item) => item.product_id === item.normalized_variant_id));
  assert(projectedRecords.every((item) => String(item.product_id) !== String(edited.product.id)));
  const projectedVerdeM = projectedRecords.find((item) => item.normalized_variant_id === verdeM.variation_id);
  assert.strictEqual(projectedVerdeM.physical_qty, 5);
  assert.strictEqual(projectedVerdeM.reserved_qty, 1);
  assert.strictEqual(projectedVerdeM.available_qty, 4);

  console.log(JSON.stringify({
    ok: true,
    product_id: created.product.id,
    variants: edited.variants.length,
    totals: edited.totals
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
  });
