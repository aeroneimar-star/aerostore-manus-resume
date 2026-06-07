"use strict";

const assert = require("assert");
const { run } = require("../db");
const {
  listProductManagementCatalog
} = require("../modules/pdv/products/pdvProductManagementService");

async function main() {
  const suffix = Date.now();
  const simpleSku = `QA-C4-SIMPLE-${suffix}`;
  const simpleVariantId = `VAR_QA_C4_${suffix}`;
  const timestamp = new Date().toISOString();
  const inserted = await run(
    `INSERT INTO pdv_products_v2
      (name, product_type, status, base_sku, sale_price_cents, cost_price_cents,
       source, created_by_name, created_at, updated_at)
     VALUES (?, 'simple', 'ativo', ?, 3990, 1500, 'qa_cycle_4', 'QA Ciclo 4', ?, ?)`,
    [`QA C4 Simple ${suffix}`, simpleSku, timestamp, timestamp]
  );
  await run(
    `INSERT INTO pdv_product_variants
      (id, product_id, sku, status, attributes_json, attribute_key, is_default,
       sale_price_cents, cost_price_cents, created_at, updated_at)
     VALUES (?, ?, ?, 'ativo', '{}', 'DEFAULT', 1, 3990, 1500, ?, ?)`,
    [simpleVariantId, inserted.lastID, simpleSku, timestamp, timestamp]
  );
  await run(
    `INSERT INTO pdv_inventory_balances_v2
      (variant_id, store_id, available_qty, reserved_qty, version, updated_at)
     VALUES (?, 'vila', 3, 0, 1, ?)`,
    [simpleVariantId, timestamp]
  );
  try {
  const gradeByName = await listProductManagementCatalog({
    query: "QA Grade API 1780836517493",
    storeId: "vila",
    page: 1,
    limit: 25
  });
  assert.strictEqual(gradeByName.items.length, 1, "A grade deve aparecer uma vez por produto pai.");
  const grade = gradeByName.items[0];
  assert.strictEqual(grade.product_type, "variable");
  assert.strictEqual(grade.variants.length, 4);
  assert.strictEqual(grade.physical_qty, 5);
  assert.strictEqual(grade.reserved_qty, 0);
  assert.strictEqual(grade.available_qty, 5);
  assert.deepStrictEqual(grade.colors.sort(), ["PRETO", "VERDE"]);
  assert.deepStrictEqual(grade.sizes.sort(), ["GG", "M", "P"]);

  const byVariantSku = await listProductManagementCatalog({
    query: "QA-C3-API-1780836517493-VERDE-M",
    storeId: "vila",
    page: 1,
    limit: 25
  });
  assert.strictEqual(byVariantSku.items.length, 1);
  assert.strictEqual(byVariantSku.items[0].id, grade.id);

  const byBarcode = await listProductManagementCatalog({
    query: "178083651749302",
    storeId: "vila",
    page: 1,
    limit: 25
  });
  assert.strictEqual(byBarcode.items.length, 1);
  assert.strictEqual(byBarcode.items[0].id, grade.id);

  const simple = await listProductManagementCatalog({
    query: simpleSku,
    storeId: "vila",
    page: 1,
    limit: 25
  });
  assert(simple.items.some((item) => (
    item.product_type === "simple"
    && item.variants.length === 1
    && item.variants[0].attribute_key === "DEFAULT"
  )), "Produto simples deve permanecer agrupado com variacao DEFAULT.");

  const filtered = await listProductManagementCatalog({
    query: "QA Grade API 1780836517493",
    storeId: "vila",
    status: "ativo",
    productType: "variable",
    stockMode: "with_stock",
    page: 1,
    limit: 25
  });
  assert.strictEqual(filtered.items.length, 1);

  for (const limit of [25, 50, 100]) {
    const page = await listProductManagementCatalog({ page: 1, limit });
    assert.strictEqual(page.pagination.limit, limit);
    assert(page.items.length <= limit);
  }

  await assert.rejects(
    () => listProductManagementCatalog({ page: 1, limit: 200 }),
    /25, 50 ou 100/
  );

  const tiny = await listProductManagementCatalog({
    query: "41286",
    storeId: "vila",
    page: 1,
    limit: 25
  });
  assert(tiny.items.length >= 1, "Tiny legado 41286 deve continuar localizavel.");
  assert(tiny.items.some((item) => item.legacy_adapter === true));

  console.log(JSON.stringify({
    grouped_parent: grade.id,
    physical_qty: grade.physical_qty,
    reserved_qty: grade.reserved_qty,
    available_qty: grade.available_qty,
    pagination_limits: [25, 50, 100],
    tiny_41286: tiny.items[0]?.id || ""
  }, null, 2));
  } finally {
    await run("DELETE FROM pdv_inventory_balances_v2 WHERE variant_id = ?", [simpleVariantId]);
    await run("DELETE FROM pdv_product_variants WHERE id = ?", [simpleVariantId]);
    await run("DELETE FROM pdv_products_v2 WHERE id = ?", [inserted.lastID]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
