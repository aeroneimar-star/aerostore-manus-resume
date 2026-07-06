"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aerostore-label-sale-barcode-"));
process.env.DATABASE_PATH = path.join(tempRoot, "test.sqlite");

const { initializeDatabase } = require("../db");
const { createProductAggregate } = require("../modules/pdv/products/pdvSimpleProductService");
const { buildLabelPreview } = require("../modules/pdv/services/pdvLabelPrintService");
const { resolveLabelBarcode, deriveShortVariationScanCode } = require("../modules/pdv/services/argoxLabelBarcode");
const { searchProductsDetailed } = require("../modules/pdv/services/pdvOperationalService");

const actor = {
  id: 9920,
  name: "QA Label Sale Barcode",
  email: "qa-label-sale-barcode@aerostore.local",
  role: "admin",
  permissions: { can_view_all_stores: true }
};

async function main() {
  await initializeDatabase();

  const parentEan = "4006381333931";
  const variable = await createProductAggregate({
    name: "QA Barcode Grade",
    commercial_name: "QA Barcode Grade",
    product_type: "variable",
    base_sku: "QA-BARCODE-PARENT",
    price: 319.9,
    store_id: "vila",
    gtin_ean: parentEan,
    variants: [
      { color: "Preto", size: "M", barcode: "7891000001011", initial_stock: 2 },
      { color: "Preto", size: "G", barcode: "7891000001012", initial_stock: 2 }
    ]
  }, actor);

  const sizeM = variable.variants.find((item) => item.size === "M");
  const sizeG = variable.variants.find((item) => item.size === "G");
  assert(sizeM && sizeG, "Variacoes M e G devem existir.");

  const previewM = await buildLabelPreview({
    product_id: variable.product.id,
    variation_id: sizeM.variation_id,
    template_id: "aerostore_tag_40x60_2c",
    quantity: 1
  }, actor);

  assert.strictEqual(previewM.product.variation_id, sizeM.variation_id);
  assert.strictEqual(previewM.product.barcode, "7891000001011");
  assert.notStrictEqual(previewM.product.barcode, parentEan);
  assert.strictEqual(previewM.agent_payload.codigo_barras, "7891000001011");
  assert.strictEqual(previewM.agent_payload.sku_variacao, sizeM.sku);

  const previewG = await buildLabelPreview({
    product_id: variable.product.id,
    variation_id: sizeG.variation_id,
    template_id: "aerostore_tag_40x60_2c",
    quantity: 1
  }, actor);
  assert.strictEqual(previewG.product.barcode, "7891000001012");
  assert.strictEqual(previewG.agent_payload.codigo_barras, "7891000001012");

  const parentFallbackBlocked = resolveLabelBarcode({
    variation_id: sizeM.variation_id,
    variant_barcode: "",
    variant_sku: sizeM.sku,
    barcode: parentEan,
    gtin_ean: parentEan,
    ean: parentEan,
    codigo_barras: parentEan,
    sku: "QA-BARCODE-PARENT"
  }, { requireBarcode: true });
  assert.strictEqual(parentFallbackBlocked.value, deriveShortVariationScanCode(sizeM.variation_id));
  assert.strictEqual(parentFallbackBlocked.human_text, sizeM.sku);
  assert.notStrictEqual(parentFallbackBlocked.value, parentEan);

  const searchByBarcode = await searchProductsDetailed("7891000001011", { storeId: "vila", page: 1, limit: 10 });
  const barcodeHit = (searchByBarcode.unified || [])[0];
  assert(barcodeHit, "Busca por barcode da variacao deve retornar item.");
  assert.strictEqual(barcodeHit.variation_id, sizeM.variation_id);
  assert.strictEqual(barcodeHit.skip_variation_modal, true);
  assert.strictEqual(barcodeHit.direct_variation_match, true);
  assert.strictEqual(barcodeHit.direct_match_kind, "barcode");

  const searchBySku = await searchProductsDetailed(sizeG.sku, { storeId: "vila", page: 1, limit: 10 });
  const skuHit = (searchBySku.unified || [])[0];
  assert(skuHit, "Busca por SKU da variacao deve retornar item.");
  assert.strictEqual(skuHit.variation_id, sizeG.variation_id);
  assert.strictEqual(skuHit.skip_variation_modal, true);

  const searchByParent = await searchProductsDetailed("QA-BARCODE-PARENT", { storeId: "vila", page: 1, limit: 10 });
  const parentHit = (searchByParent.unified || [])[0];
  assert(parentHit, "Busca por SKU pai deve retornar produto.");
  assert.strictEqual(parentHit.normalized_product, true);
  assert(!parentHit.skip_variation_modal, "SKU pai com grade nao deve pular modal de variacao.");

  const simple = await createProductAggregate({
    name: "QA Barcode Simples",
    product_type: "simple",
    base_sku: "QA-BARCODE-SIMPLE",
    price: 149.9,
    store_id: "vila",
    gtin_ean: "7891000002020",
    initial_stock: 3
  }, actor);
  const simpleVariant = simple.variants[0];
  const simplePreview = await buildLabelPreview({
    product_id: simple.product.id,
    variation_id: simpleVariant.variation_id,
    template_id: "aerostore_tag_40x60_2c",
    quantity: 1
  }, actor);
  assert.strictEqual(simplePreview.product.barcode, "7891000002020");
  assert.strictEqual(simplePreview.agent_payload.codigo_barras, "7891000002020");

  const simpleSearch = await searchProductsDetailed("7891000002020", { storeId: "vila", page: 1, limit: 10 });
  const simpleHit = (simpleSearch.unified || [])[0];
  assert(simpleHit, "Busca produto simples por barcode deve retornar item vendavel.");
  assert.strictEqual(simpleHit.variation_id, simpleVariant.variation_id);
  assert.strictEqual(simpleHit.skip_variation_modal, true);

  const longSkuVariable = await createProductAggregate({
    name: "QA Barcode SKU Longo",
    product_type: "variable",
    base_sku: "QA-LONG-SKU-PARENT",
    price: 397,
    store_id: "vila",
    variants: [
      { color: "Bege", size: "GG", barcode: "", initial_stock: 2 }
    ]
  }, actor);
  const longSkuVariant = longSkuVariable.variants[0];
  const longSkuPreview = await buildLabelPreview({
    product_id: longSkuVariable.product.id,
    variation_id: longSkuVariant.variation_id,
    template_id: "aerostore_tag_40x60_2c",
    quantity: 1
  }, actor);
  const longHumanSku = longSkuVariant.sku;
  const longScanCode = resolveLabelBarcode({
    variation_id: longSkuVariant.variation_id,
    variant_barcode: "",
    variant_sku: longHumanSku,
    sku: longHumanSku
  }, { requireBarcode: true }).value;
  assert(longHumanSku.length > 14, "SKU de teste deve ser longo.");
  assert.notStrictEqual(longScanCode, longHumanSku, "Etiqueta nao deve codificar SKU longo nas barras.");
  assert.strictEqual(longSkuPreview.product.barcode, longScanCode);
  assert.strictEqual(longSkuPreview.product.label_barcode_human_text, longHumanSku);
  assert.strictEqual(longSkuPreview.agent_payload.codigo_barras, longScanCode);

  const searchByScanCode = await searchProductsDetailed(longScanCode, { storeId: "vila", page: 1, limit: 10 });
  const scanCodeHit = (searchByScanCode.unified || [])[0];
  assert(scanCodeHit, "Busca por scan code curto deve retornar item.");
  assert.strictEqual(scanCodeHit.variation_id, longSkuVariant.variation_id);
  assert.strictEqual(scanCodeHit.skip_variation_modal, true);
  assert.strictEqual(scanCodeHit.direct_match_kind, "barcode");

  console.log(JSON.stringify({
    ok: true,
    label_m_barcode: previewM.product.barcode,
    label_g_barcode: previewG.product.barcode,
    agent_payload_m: previewM.agent_payload.codigo_barras,
    search_barcode_variation_id: barcodeHit.variation_id,
    search_sku_variation_id: skuHit.variation_id,
    parent_keeps_modal: !parentHit.skip_variation_modal,
    simple_barcode: simplePreview.product.barcode,
    long_sku_human: longHumanSku,
    long_sku_scan_code: longScanCode,
    long_sku_search_variation_id: scanCodeHit.variation_id
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
