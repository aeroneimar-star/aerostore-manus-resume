"use strict";

const assert = require("assert");

const {
  applyLegacyManualProductMigration,
  dryRunLegacyManualProductMigration,
  rollbackLegacyManualProductMigration
} = require("../modules/pdv/products/pdvLegacyManualMigrationService");
const { initializeDatabase, all, get } = require("../db");
const { searchProductsDetailed } = require("../modules/pdv/services/pdvOperationalService");

const AI_PRODUCT_ID = 10;
const VARIANT_IDS = ["P", "M", "G", "GG", "XG"].map((size) => `VAR_LEGACY_AI_10_${size}`);

async function countRows() {
  const product = await get("SELECT id FROM pdv_products_v2 WHERE legacy_ai_product_id = ?", [AI_PRODUCT_ID]);
  const variants = await all("SELECT id FROM pdv_product_variants WHERE id IN (?, ?, ?, ?, ?)", VARIANT_IDS);
  const balances = await all("SELECT id FROM pdv_inventory_balances_v2 WHERE variant_id IN (?, ?, ?, ?, ?)", VARIANT_IDS);
  const movements = await all(
    "SELECT id FROM pdv_inventory_movements_v2 WHERE origin = 'legacy_manual_migration' AND reference_type = 'ai_products' AND reference_id = ?",
    [String(AI_PRODUCT_ID)]
  );
  return {
    productCount: product ? 1 : 0,
    productId: product?.id || null,
    variantCount: variants.length,
    balanceCount: balances.length,
    movementCount: movements.length
  };
}

async function searchPilot() {
  const result = await searchProductsDetailed("Camiseta Azul Surf Testex", { storeId: "vila", page: 1, limit: 24 });
  const items = (result.unified || []).filter((item) => /CAMISETA AZUL SURF TESTEX/i.test(item.nome || item.name || ""));
  const legacyItems = items.filter((item) => /^AI_10__SIZE__/i.test(item.product_id || item.id || ""));
  const normalizedItems = items.filter((item) => item.normalized_product);
  return { total: items.length, legacy: legacyItems.length, normalized: normalizedItems.length };
}

async function main() {
  await initializeDatabase();

  await rollbackLegacyManualProductMigration({ aiProductId: AI_PRODUCT_ID });
  const beforeCounts = await countRows();
  assert.deepStrictEqual(
    beforeCounts,
    { productCount: 0, productId: null, variantCount: 0, balanceCount: 0, movementCount: 0 },
    "Rollback deve deixar o banco sem o piloto normalizado."
  );

  const beforeSearch = await searchPilot();
  assert.strictEqual(beforeSearch.normalized, 0, "Antes do apply, o piloto nao deve aparecer normalizado.");
  assert(beforeSearch.legacy >= 1, "Antes do apply, o caminho legado deve continuar aparecendo.");

  const dryRun = await dryRunLegacyManualProductMigration({ aiProductId: AI_PRODUCT_ID });
  assert.strictEqual(dryRun.eligible, true, "Dry-run deve continuar elegivel.");
  assert.strictEqual(dryRun.variants.length, 5);
  assert.strictEqual(dryRun.balances.length, 10);
  assert.strictEqual(dryRun.movements.length, 10);

  const applied = await applyLegacyManualProductMigration({ aiProductId: AI_PRODUCT_ID });
  assert.strictEqual(applied.status, "migrated");
  const afterApplyCounts = await countRows();
  assert.strictEqual(afterApplyCounts.productCount, 1, "Apply deve criar um pai.");
  assert.strictEqual(afterApplyCounts.variantCount, 5, "Apply deve criar 5 variacoes.");
  assert.strictEqual(afterApplyCounts.balanceCount, 10, "Apply deve criar 10 balances.");
  assert.strictEqual(afterApplyCounts.movementCount, 10, "Apply deve criar 10 movimentos LEGACY_IMPORT.");

  const reapplied = await applyLegacyManualProductMigration({ aiProductId: AI_PRODUCT_ID });
  assert.strictEqual(reapplied.status, "already_migrated");
  const afterSecondApplyCounts = await countRows();
  assert.deepStrictEqual(afterSecondApplyCounts, afterApplyCounts, "Segundo apply nao pode duplicar nada.");

  const afterSearch = await searchPilot();
  assert.strictEqual(afterSearch.normalized, 1, "Depois do apply, deve haver um pai normalizado.");
  assert.strictEqual(afterSearch.legacy, 0, "Depois do apply, AI_10__SIZE__* nao deve aparecer.");
  assert.strictEqual(afterSearch.total, 1, "Depois do apply, busca deve retornar um card unico.");

  console.log(JSON.stringify({
    ok: true,
    beforeCounts,
    beforeSearch,
    dryRun: {
      variants: dryRun.variants.length,
      balances: dryRun.balances.length,
      movements: dryRun.movements.length
    },
    afterApplyCounts,
    afterSecondApplyCounts,
    afterSearch
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
