"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aerostore-pdv-simple-product-"));
process.env.DATABASE_PATH = path.join(tempRoot, "test.sqlite");

const { db, initializeDatabase, all, get } = require("../db");
const {
  createSimpleProduct,
  updateSimpleProduct,
  applyNormalizedInventoryMovement,
  getSimpleProductByLegacyId
} = require("../modules/pdv/products/pdvSimpleProductService");
const {
  syncNormalizedSimpleProductProjection
} = require("../modules/pdv/inventory/pdvInventoryService");

const actor = {
  id: 999001,
  name: "QA Ciclo 2",
  email: "qa-ciclo2@aerostore.local",
  role: "admin"
};

async function main() {
  await initializeDatabase();

  const created = await createSimpleProduct({
    name: "QA Produto simples normalizado",
    price: 129.9,
    cost_price: 55.25,
    stock: 4,
    store_id: "vila",
    status: "ativo",
    source: "manual",
    sku: "QA-CICLO2-SIMPLE-001"
  }, actor);

  assert(created.product.id, "Produto pai normalizado deve ser criado.");
  assert(created.product.legacy_ai_product_id, "Produto deve manter vinculo com ai_products.");
  assert.strictEqual(created.product.product_type, "simple");
  assert.strictEqual(created.product.status, "ativo");
  assert.strictEqual(created.product.sale_price_cents, 12990);
  assert.strictEqual(created.product.cost_price_cents, 5525);

  assert(created.variant.id, "Variacao padrao deve ser criada.");
  assert.strictEqual(created.variant.product_id, created.product.id);
  assert.strictEqual(created.variant.sku, "QA-CICLO2-SIMPLE-001");
  assert.strictEqual(created.variant.is_default, 1);

  assert.strictEqual(created.balance.variant_id, created.variant.id);
  assert.strictEqual(created.balance.store_id, "vila");
  assert.strictEqual(created.balance.available_qty, 4);

  const initialMovements = await all(
    `SELECT *
     FROM pdv_inventory_movements_v2
     WHERE variant_id = ?
     ORDER BY created_at, id`,
    [created.variant.id]
  );
  assert.strictEqual(initialMovements.length, 1);
  assert.strictEqual(initialMovements[0].movement_type, "INITIAL_STOCK");
  assert.strictEqual(initialMovements[0].quantity_delta, 4);
  assert.strictEqual(initialMovements[0].quantity_before, 0);
  assert.strictEqual(initialMovements[0].quantity_after, 4);
  assert.strictEqual(initialMovements[0].origin, "product_create");
  assert.strictEqual(initialMovements[0].actor_user_id, actor.id);

  const audits = await all(
    `SELECT action_type
     FROM pdv_product_audit_logs
     WHERE product_id = ?
     ORDER BY id`,
    [created.product.id]
  );
  assert.deepStrictEqual(
    audits.map((item) => item.action_type),
    ["PRODUCT_CREATED", "DEFAULT_VARIANT_CREATED", "INITIAL_STOCK_RECORDED"]
  );

  const legacy = await get(
    "SELECT id, name, sku, codigo, stock, estoque_total FROM ai_products WHERE id = ?",
    [created.product.legacy_ai_product_id]
  );
  assert(legacy, "Camada de compatibilidade ai_products deve ser criada.");
  assert.strictEqual(legacy.sku, created.variant.sku);
  assert.strictEqual(legacy.stock, 4);
  assert.strictEqual(legacy.estoque_total, 4);

  const reloaded = await getSimpleProductByLegacyId(created.product.legacy_ai_product_id);
  assert.strictEqual(reloaded.product.id, created.product.id);
  assert.strictEqual(reloaded.variant.id, created.variant.id);

  const projectedRecords = [];
  const firstProjection = syncNormalizedSimpleProductProjection(created, actor, {
    records: projectedRecords,
    persist: false
  });
  assert.strictEqual(projectedRecords.length, 1);
  assert.strictEqual(firstProjection.record.product_id, created.variant.id);
  assert.strictEqual(firstProjection.record.sku, created.variant.sku);
  assert.strictEqual(firstProjection.record.available_qty, 4);
  assert.strictEqual(firstProjection.record.source, "PDV_PRODUCT_V2");
  assert.strictEqual(firstProjection.record.normalized_product_id, created.product.id);
  assert.strictEqual(firstProjection.record.normalized_variant_id, created.variant.id);

  const secondProjection = syncNormalizedSimpleProductProjection(created, actor, {
    records: projectedRecords,
    persist: false
  });
  assert.strictEqual(projectedRecords.length, 1, "Reprojetar nao pode duplicar o inventario.");
  assert.strictEqual(secondProjection.record.inventory_id, firstProjection.record.inventory_id);

  await assert.rejects(
    createSimpleProduct({
      name: "QA SKU duplicado",
      price: 10,
      stock: 1,
      store_id: "vila",
      sku: "qa-ciclo2-simple-001"
    }, actor),
    /codigo interno|sku.*existe/i
  );

  const updated = await updateSimpleProduct(created.product.legacy_ai_product_id, {
    name: "QA Produto simples editado",
    price: 139.9,
    cost_price: 60,
    status: "bloqueado_para_venda"
  }, actor);

  assert.strictEqual(updated.variant.id, created.variant.id, "Edicao nao pode recriar a variacao.");
  assert.strictEqual(updated.variant.sku, created.variant.sku, "Edicao nao pode trocar o SKU implicitamente.");
  assert.strictEqual(updated.product.name, "QA Produto simples editado");
  assert.strictEqual(updated.product.status, "bloqueado_para_venda");
  assert.strictEqual(updated.balance.available_qty, 4, "Edicao cadastral nao pode alterar estoque.");

  const saleMovement = await applyNormalizedInventoryMovement({
    variant_id: created.variant.id,
    store_id: "vila",
    movement_type: "SALE_OUT",
    quantity_delta: -1,
    origin: "sale",
    reference_type: "SALE",
    reference_id: "QA-SALE-001",
    idempotency_key: "sale:QA-SALE-001:variant:1"
  }, actor);
  assert.strictEqual(saleMovement.balance.available_qty, 3);
  assert.strictEqual(saleMovement.movement.quantity_before, 4);
  assert.strictEqual(saleMovement.movement.quantity_after, 3);

  const replayed = await applyNormalizedInventoryMovement({
    variant_id: created.variant.id,
    store_id: "vila",
    movement_type: "SALE_OUT",
    quantity_delta: -1,
    origin: "sale",
    reference_type: "SALE",
    reference_id: "QA-SALE-001",
    idempotency_key: "sale:QA-SALE-001:variant:1"
  }, actor);
  assert.strictEqual(replayed.balance.available_qty, 3, "Reprocessamento nao pode baixar duas vezes.");
  assert.strictEqual(replayed.replayed, true);

  await assert.rejects(
    applyNormalizedInventoryMovement({
      variant_id: created.variant.id,
      store_id: "vila",
      movement_type: "SALE_OUT",
      quantity_delta: -4,
      origin: "sale",
      reference_type: "SALE",
      reference_id: "QA-SALE-002",
      idempotency_key: "sale:QA-SALE-002:variant:1"
    }, actor),
    /estoque insuficiente/i
  );

  console.log(JSON.stringify({
    ok: true,
    product_id: created.product.id,
    legacy_ai_product_id: created.product.legacy_ai_product_id,
    variant_id: created.variant.id,
    sku: created.variant.sku,
    initial_stock: 4,
    stock_after_sale: saleMovement.balance.available_qty
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
