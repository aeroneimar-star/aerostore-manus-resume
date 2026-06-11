"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = require("fs").mkdtempSync(path.join(os.tmpdir(), "aerostore-label-variation-"));
process.env.DATABASE_PATH = path.join(tempRoot, "test.sqlite");

const { initializeDatabase } = require("../db");
const { createProductAggregate } = require("../modules/pdv/products/pdvSimpleProductService");
const { buildLabelPreview } = require("../modules/pdv/services/pdvLabelPrintService");
const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");

const actor = {
  id: 9916,
  name: "QA Etiqueta Variacao",
  email: "qa-label-variation@aerostore.local",
  role: "admin",
  permissions: { can_view_all_stores: true }
};

async function main() {
  await initializeDatabase();

  assert(
    appSource.includes('name="variationId"') && appSource.includes("variation_id: labelState.variationId"),
    "Frontend deve selecionar e enviar variation_id para preview/impressao."
  );
  assert(
    stylesSource.includes("min-height: 52px") && stylesSource.includes("background: #fff"),
    "Preview tecnico deve reservar area branca maior para o barcode."
  );

  const variable = await createProductAggregate({
    name: "QA Etiqueta Grade",
    commercial_name: "QA Etiqueta Grade",
    product_type: "variable",
    base_sku: "QA-LABEL-001",
    price: 249.9,
    color: "Marinho",
    store_id: "vila",
    variants: [
      { color: "Marinho", size: "M", barcode: "7891000000911", initial_stock: 1 },
      { color: "Marinho", size: "G", barcode: "7891000000912", initial_stock: 1 },
      { color: "Marinho", size: "GG", barcode: "7891000000913", initial_stock: 1 }
    ]
  }, actor);

  const sizeM = variable.variants.find((item) => item.size === "M");
  const sizeG = variable.variants.find((item) => item.size === "G");
  assert(sizeM && sizeG, "Produto QA deve criar variacoes M e G.");

  await assert.rejects(
    buildLabelPreview({
      product_id: variable.product.legacy_ai_product_id,
      template_id: "aerostore_tag_40x60_2c",
      quantity: 1
    }, actor),
    /Selecione uma variacao especifica/
  );

  const previewM = await buildLabelPreview({
    product_id: variable.product.legacy_ai_product_id,
    variation_id: sizeM.variation_id,
    template_id: "aerostore_tag_40x60_2c",
    quantity: 1
  }, actor);
  const previewG = await buildLabelPreview({
    product_id: variable.product.legacy_ai_product_id,
    variation_id: sizeG.variation_id,
    template_id: "aerostore_tag_40x60_2c",
    quantity: 1
  }, actor);

  assert.strictEqual(previewM.product.variation_id, sizeM.variation_id);
  assert.strictEqual(previewM.product.size, "M");
  assert.strictEqual(previewM.product.color, "MARINHO");
  assert.strictEqual(previewM.product.sku, sizeM.sku);
  assert.strictEqual(previewM.product.barcode, "7891000000911");
  assert(previewM.preview_lines.includes("MARINHO / M"));
  assert(!previewM.preview_lines.some((line) => /M,\s*G|G,\s*GG/.test(line)));
  assert(previewM.command_preview.includes("7891000000911"));

  assert.strictEqual(previewG.product.variation_id, sizeG.variation_id);
  assert.strictEqual(previewG.product.size, "G");
  assert.strictEqual(previewG.product.sku, sizeG.sku);
  assert.strictEqual(previewG.product.barcode, "7891000000912");
  assert.notStrictEqual(previewM.product.sku, previewG.product.sku);

  const simple = await createProductAggregate({
    name: "QA Etiqueta Simples",
    product_type: "simple",
    base_sku: "QA-LABEL-SIMPLE",
    price: 99.9,
    store_id: "vila",
    initial_stock: 1
  }, actor);
  const simplePreview = await buildLabelPreview({
    product_id: simple.product.legacy_ai_product_id,
    variation_id: simple.variants[0].variation_id,
    template_id: "aerostore_tag_40x60_2c",
    quantity: 1
  }, actor);
  assert.strictEqual(simplePreview.product.variation_id, simple.variants[0].variation_id);
  assert.strictEqual(simplePreview.product.sku, simple.variants[0].sku);

  console.log(JSON.stringify({
    ok: true,
    variable_product_id: variable.product.id,
    preview_m: {
      variation_id: previewM.product.variation_id,
      sku: previewM.product.sku,
      barcode: previewM.product.barcode,
      size_color: `${previewM.product.color} / ${previewM.product.size}`
    },
    preview_g: {
      variation_id: previewG.product.variation_id,
      sku: previewG.product.sku,
      barcode: previewG.product.barcode,
      size_color: `${previewG.product.color} / ${previewG.product.size}`
    },
    simple_variation_id: simplePreview.product.variation_id
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
