"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aerostore-label-print-plan-"));
process.env.DATABASE_PATH = path.join(tempRoot, "test.sqlite");
process.env.ARGOX_SAFE_TEST_MODE = "false";

const { initializeDatabase } = require("../db");
const { createProductAggregate } = require("../modules/pdv/products/pdvSimpleProductService");
const {
  resolveLabelPrintPlan,
  PRINT_QUANTITY_MODES
} = require("../modules/pdv/services/labelPrintPlanResolver");
const {
  buildLabelPreview,
  printLabel
} = require("../modules/pdv/services/pdvLabelPrintService");
const { resolveLabelHeaderText } = require("../modules/pdv/services/argoxLabelStorePolicy");

const actor = {
  id: 9931,
  name: "QA Label Print Plan",
  email: "qa-label-print-plan@aerostore.local",
  role: "admin",
  permissions: { can_view_all_stores: true }
};

function basePayload(product, variationId, storeId, extra = {}) {
  return {
    product_id: product.product.id,
    variation_id: variationId,
    store_id: storeId,
    loja: storeId,
    template_id: "aerostore_tag_40x60_2c",
    quantity: 1,
    print_quantity_mode: PRINT_QUANTITY_MODES.MANUAL,
    show_price: true,
    show_barcode: true,
    show_sku: true,
    show_name: true,
    show_brand: true,
    show_size_color: true,
    price_with_cents: true,
    price_mode: "normal",
    ...extra
  };
}

function countRoles(elements = [], role = "") {
  return (Array.isArray(elements) ? elements : []).filter((item) => item.role === role).length;
}

async function main() {
  await initializeDatabase();

  const variable = await createProductAggregate({
    name: "QA Label Print Plan Grade",
    product_type: "variable",
    base_sku: "QA-LABEL-PLAN",
    price: 199,
    store_id: "vila",
    variants: [
      { color: "Preto", size: "P", barcode: "7891000003011", initial_stock: 2 },
      { color: "Preto", size: "M", barcode: "7891000003012", initial_stock: 4 },
      { color: "Preto", size: "G", barcode: "7891000003013", initial_stock: 1 }
    ]
  }, actor);

  const sizeP = variable.variants.find((item) => item.size === "P");
  const sizeM = variable.variants.find((item) => item.size === "M");
  const sizeG = variable.variants.find((item) => item.size === "G");
  assert(sizeP && sizeM && sizeG, "Variações P/M/G devem existir.");

  const legacyAiProductId = String(variable.product.legacy_ai_product_id || "");
  assert(legacyAiProductId, "Produto de teste deve ter legacy_ai_product_id.");

  const manualOne = await resolveLabelPrintPlan(basePayload(variable, sizeM.variation_id, "vila", {
    print_quantity_mode: PRINT_QUANTITY_MODES.MANUAL,
    quantity: 1
  }), actor);
  assert.strictEqual(manualOne.total_labels, 1);
  assert.strictEqual(manualOne.entries[0].variation_id, sizeM.variation_id);

  const manualLegacyId = await resolveLabelPrintPlan({
    ...basePayload(variable, sizeM.variation_id, "vila", {
      print_quantity_mode: PRINT_QUANTITY_MODES.MANUAL,
      quantity: 1
    }),
    product_id: legacyAiProductId
  }, actor);
  assert.strictEqual(manualLegacyId.total_labels, 1);
  assert.strictEqual(manualLegacyId.print_plan_debug.resolved_normalized_product_id, String(variable.product.id));
  assert.strictEqual(manualLegacyId.print_plan_debug.resolved_legacy_ai_product_id, legacyAiProductId);

  const allVariantsLegacyId = await resolveLabelPrintPlan({
    ...basePayload(variable, sizeM.variation_id, "vila", {
      print_quantity_mode: PRINT_QUANTITY_MODES.ALL_VARIANTS_STOCK
    }),
    product_id: legacyAiProductId
  }, actor);
  assert.strictEqual(allVariantsLegacyId.total_labels, 7);
  assert.strictEqual(allVariantsLegacyId.print_plan_debug.variants_found, 3);

  const normalizedPrefixPlan = await resolveLabelPrintPlan({
    ...basePayload(variable, sizeM.variation_id, "vila", {
      print_quantity_mode: PRINT_QUANTITY_MODES.ONE_PER_VARIANT
    }),
    product_id: `NORMALIZED_PARENT:${variable.product.id}`
  }, actor);
  assert.strictEqual(normalizedPrefixPlan.total_labels, 3);

  const manualThree = await resolveLabelPrintPlan(basePayload(variable, sizeM.variation_id, "vila", {
    print_quantity_mode: PRINT_QUANTITY_MODES.MANUAL,
    quantity: 3
  }), actor);
  assert.strictEqual(manualThree.total_labels, 3);
  assert.strictEqual(manualThree.manual_over_stock_warning, false);

  const manualOverStock = await resolveLabelPrintPlan(basePayload(variable, sizeM.variation_id, "vila", {
    print_quantity_mode: PRINT_QUANTITY_MODES.MANUAL,
    quantity: 99
  }), actor);
  assert.strictEqual(manualOverStock.manual_over_stock_warning, true);
  assert.match(manualOverStock.manual_over_stock_message || "", /estoque disponível/i);

  const variantStock = await resolveLabelPrintPlan(basePayload(variable, sizeM.variation_id, "vila", {
    print_quantity_mode: PRINT_QUANTITY_MODES.VARIANT_STOCK
  }), actor);
  assert.strictEqual(variantStock.total_labels, 4);

  const allVariants = await resolveLabelPrintPlan(basePayload(variable, sizeM.variation_id, "vila", {
    print_quantity_mode: PRINT_QUANTITY_MODES.ALL_VARIANTS_STOCK
  }), actor);
  assert.strictEqual(allVariants.total_labels, 7);
  assert.strictEqual(allVariants.entries.length, 3);

  const onePerVariant = await resolveLabelPrintPlan(basePayload(variable, "", "vila", {
    print_quantity_mode: PRINT_QUANTITY_MODES.ONE_PER_VARIANT
  }), actor);
  assert.strictEqual(onePerVariant.total_labels, 3);
  assert.strictEqual(onePerVariant.entries.every((entry) => entry.quantity === 1), true);

  let zeroStockBlocked = false;
  try {
    const zeroVariant = await createProductAggregate({
      name: "QA Label Zero Stock",
      product_type: "variable",
      base_sku: "QA-LABEL-ZERO",
      price: 99,
      store_id: "vila",
      variants: [{ color: "Azul", size: "U", barcode: "", initial_stock: 0 }]
    }, actor);
    await resolveLabelPrintPlan(basePayload(zeroVariant, zeroVariant.variants[0].variation_id, "vila", {
      print_quantity_mode: PRINT_QUANTITY_MODES.VARIANT_STOCK
    }), actor);
  } catch (error) {
    zeroStockBlocked = /estoque disponível/i.test(error.message || "");
  }
  assert(zeroStockBlocked, "Estoque 0 deve bloquear impressão.");

  let noVariantsBlocked = false;
  try {
    await resolveLabelPrintPlan({
      product_id: legacyAiProductId,
      variation_id: "",
      store_id: "vila",
      print_quantity_mode: PRINT_QUANTITY_MODES.ALL_VARIANTS_STOCK
    }, actor);
  } catch (error) {
    noVariantsBlocked = /localizar variações/i.test(error.message || "");
  }
  assert(!noVariantsBlocked, "Produto com grade não deve bloquear all_variants via legacy id.");

  let fakeProductBlocked = false;
  try {
    await resolveLabelPrintPlan({
      product_id: "999999999",
      store_id: "vila",
      print_quantity_mode: PRINT_QUANTITY_MODES.ALL_VARIANTS_STOCK
    }, actor);
  } catch (error) {
    fakeProductBlocked = /localizar variações/i.test(error.message || "");
  }
  assert(fakeProductBlocked, "Produto inexistente deve bloquear impressão em lote.");

  const sulActor = { ...actor, id: 1, email: "admin@aerostore.local" };
  const sulPreview = await buildLabelPreview(basePayload(variable, sizeM.variation_id, "sul", {
    store_id: "sul",
    loja: "sul"
  }), sulActor);
  assert.strictEqual(resolveLabelHeaderText("sul"), "Casa Camborê");
  assert.strictEqual(sulPreview.label_debug.label_header, "Casa Camborê");

  const vilaPreview = await buildLabelPreview(basePayload(variable, sizeM.variation_id, "vila"), actor);
  assert.strictEqual(vilaPreview.label_debug.label_header, "AEROSTORE");

  const hideNamePreview = await buildLabelPreview(basePayload(variable, sizeM.variation_id, "vila", {
    show_name: false
  }), actor);
  assert.strictEqual(countRoles(hideNamePreview.preview_elements, "name"), 0);

  const hideBarcodePreview = await buildLabelPreview(basePayload(variable, sizeM.variation_id, "vila", {
    show_barcode: false
  }), actor);
  assert.strictEqual(countRoles(hideBarcodePreview.preview_elements, "barcode"), 0);

  const allVariantsPrint = await printLabel(basePayload(variable, sizeM.variation_id, "vila", {
    print_quantity_mode: PRINT_QUANTITY_MODES.ALL_VARIANTS_STOCK
  }), actor);
  assert.strictEqual(allVariantsPrint.print_plan.total_labels, 7);
  assert.strictEqual(allVariantsPrint.agent_items_count, 7);

  process.env.ARGOX_SAFE_TEST_MODE = "true";
  const safePlan = await resolveLabelPrintPlan(basePayload(variable, sizeM.variation_id, "vila", {
    print_quantity_mode: PRINT_QUANTITY_MODES.MANUAL,
    quantity: 3
  }), actor);
  assert.strictEqual(safePlan.total_labels, 3);
  assert.strictEqual(safePlan.total_labels_after_safe_mode, 1);
  assert.strictEqual(safePlan.safe_test_mode, true);

  console.log(JSON.stringify({
    ok: true,
    manual_one: manualOne.total_labels,
    manual_legacy_id: manualLegacyId.total_labels,
    all_variants_legacy_id: allVariantsLegacyId.total_labels,
    normalized_prefix_total: normalizedPrefixPlan.total_labels,
    manual_three: manualThree.total_labels,
    variant_stock_m: variantStock.total_labels,
    all_variants_total: allVariants.total_labels,
    one_per_variant_total: onePerVariant.total_labels,
    agent_items_all_variants: allVariantsPrint.agent_items_count,
    safe_mode_final: safePlan.total_labels_after_safe_mode
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
