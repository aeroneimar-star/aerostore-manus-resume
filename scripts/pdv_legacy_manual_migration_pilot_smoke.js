"use strict";

const assert = require("assert");

const {
  applyLegacyManualProductMigration,
  dryRunLegacyManualProductMigration,
  rollbackLegacyManualProductMigration
} = require("../modules/pdv/products/pdvLegacyManualMigrationService");
const { initializeDatabase, all, get } = require("../db");
const { resolveSaleFulfillmentPlan } = require("../modules/pdv/inventory/pdvInventoryService");
const { searchProductsDetailed } = require("../modules/pdv/services/pdvOperationalService");

const PILOT_AI_PRODUCT_ID = 10;
const PILOT_SKU = "AERO-000040";
const PILOT_VARIANT_IDS = ["P", "M", "G", "GG", "XG"].map((size) => `VAR_LEGACY_AI_10_${size}`);

async function assertNoPilotMigration() {
  const product = await get(
    "SELECT id FROM pdv_products_v2 WHERE legacy_ai_product_id = ?",
    [PILOT_AI_PRODUCT_ID]
  );
  assert.strictEqual(product, undefined, "Rollback deve remover o pai normalizado do piloto.");
}

async function main() {
  await initializeDatabase();

  await rollbackLegacyManualProductMigration({ aiProductId: PILOT_AI_PRODUCT_ID });
  await assertNoPilotMigration();

  const dryRun = await dryRunLegacyManualProductMigration({ aiProductId: PILOT_AI_PRODUCT_ID });
  assert.strictEqual(dryRun.eligible, true, "Piloto AERO-000040 deveria ser elegivel.");
  assert.strictEqual(dryRun.product.base_sku, PILOT_SKU);
  assert.deepStrictEqual(dryRun.variants.map((item) => item.sku), [
    "AERO-000040-P",
    "AERO-000040-M",
    "AERO-000040-G",
    "AERO-000040-GG",
    "AERO-000040-XG"
  ]);
  assert.strictEqual(dryRun.balances.length, 10, "Dry-run deve mapear 5 tamanhos x 2 lojas.");
  assert.strictEqual(dryRun.movements.length, 10, "Dry-run deve gerar 10 movimentos LEGACY_IMPORT.");

  const applied = await applyLegacyManualProductMigration({ aiProductId: PILOT_AI_PRODUCT_ID });
  assert.strictEqual(applied.status, "migrated", "Primeiro apply deve migrar o piloto.");

  const replayed = await applyLegacyManualProductMigration({ aiProductId: PILOT_AI_PRODUCT_ID });
  assert.strictEqual(replayed.status, "already_migrated", "Segundo apply deve ser idempotente.");
  assert.strictEqual(replayed.product.id, applied.product.id, "Apply idempotente deve retornar o mesmo pai.");

  const product = await get(
    "SELECT id, legacy_ai_product_id, base_sku, product_type, status FROM pdv_products_v2 WHERE legacy_ai_product_id = ?",
    [PILOT_AI_PRODUCT_ID]
  );
  assert(product, "Produto pai normalizado deve existir.");
  assert.strictEqual(product.base_sku, PILOT_SKU);
  assert.strictEqual(product.product_type, "variable");

  const variants = await all(
    "SELECT id, sku, attribute_key, attributes_json FROM pdv_product_variants WHERE product_id = ? ORDER BY sku",
    [product.id]
  );
  assert.strictEqual(variants.length, 5, "Deve criar 5 variacoes reais.");
  assert.deepStrictEqual(variants.map((item) => item.id).sort(), PILOT_VARIANT_IDS.sort());
  assert(variants.every((item) => item.attribute_key.startsWith("AZUL::")), "Todas as variacoes devem ter cor estruturada AZUL.");

  const balances = await all(
    "SELECT variant_id, store_id, available_qty, reserved_qty FROM pdv_inventory_balances_v2 WHERE variant_id IN (?, ?, ?, ?, ?) ORDER BY variant_id, store_id",
    PILOT_VARIANT_IDS
  );
  assert.strictEqual(balances.length, 10, "Deve criar saldo por variacao e loja.");
  assert(balances.every((item) => item.available_qty === 2 && item.reserved_qty === 0), "Saldo fisico deve ser 2 e reservado 0.");

  const movements = await all(
    "SELECT variant_id, store_id, movement_type, quantity_delta, quantity_before, quantity_after FROM pdv_inventory_movements_v2 WHERE reference_type = 'ai_products' AND reference_id = ? AND origin = 'legacy_manual_migration'",
    [String(PILOT_AI_PRODUCT_ID)]
  );
  assert.strictEqual(movements.length, 10, "Deve criar 10 movimentos LEGACY_IMPORT.");
  assert(movements.every((item) => item.movement_type === "LEGACY_IMPORT" && item.quantity_delta === 2 && item.quantity_before === 0 && item.quantity_after === 2));

  const search = await searchProductsDetailed("Camiseta Azul Surf Testex", { storeId: "vila", page: 1, limit: 24 });
  const pilotItems = (search.unified || []).filter((item) => /CAMISETA AZUL SURF TESTEX/i.test(item.nome || item.name || ""));
  assert.strictEqual(pilotItems.length, 1, "Busca operacional deve retornar um card pai unico.");
  assert.strictEqual(pilotItems[0].normalized_product, true, "Card unico deve vir do modelo normalizado.");
  assert.strictEqual((pilotItems[0].variants || []).length, 5, "Card pai deve carregar as 5 variacoes para o modal.");
  assert(!pilotItems.some((item) => /^AI_10__SIZE__/i.test(item.product_id || item.id || "")), "Cards legados AI_10__SIZE__* nao devem aparecer.");
  const mVariant = pilotItems[0].variants.find((item) => item.tamanho === "M");
  const fulfillment = resolveSaleFulfillmentPlan([{
    ...pilotItems[0],
    ...mVariant,
    variation_id: mVariant.variation_id,
    product_id: mVariant.variation_id,
    normalized_product: true,
    normalized_parent_product_id: pilotItems[0].normalized_parent_product_id,
    store_id: "vila",
    loja: "vila",
    quantidade: 1
  }], "vila");
  assert.strictEqual(fulfillment.can_finalize, true, "Venda de variacao normalizada nao deve depender do inventory legado.");

  const tiny = await searchProductsDetailed("41286", { storeId: "vila", page: 1, limit: 24 });
  assert((tiny.unified || []).length >= 1, "Tiny legado 41286 deve continuar localizavel.");

  console.log(JSON.stringify({
    ok: true,
    product_id: product.id,
    variants: variants.map((item) => item.sku),
    balances: balances.length,
    movements: movements.length,
    operational_search_items: pilotItems.length,
    tiny_41286_preserved: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
