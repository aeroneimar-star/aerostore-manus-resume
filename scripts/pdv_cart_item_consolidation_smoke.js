"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const operationalService = require("../modules/pdv/services/pdvOperationalService");

const operationalDir = path.join(process.cwd(), "data", "pdv", "operational");
const protectedFiles = [
  "customer-sessions.json",
  "events.json"
].map((name) => path.join(operationalDir, name));

function snapshotFiles() {
  return protectedFiles.map((filePath) => ({
    filePath,
    exists: fs.existsSync(filePath),
    contents: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
  }));
}

function restoreFiles(snapshots = []) {
  for (const snapshot of snapshots) {
    if (snapshot.exists) {
      fs.writeFileSync(snapshot.filePath, snapshot.contents);
    } else if (fs.existsSync(snapshot.filePath)) {
      fs.unlinkSync(snapshot.filePath);
    }
  }
}

function buildLegacyPayload(product = {}) {
  return {
    ...product,
    inventory_id: product.resolved_inventory_id || product.inventory_id || "",
    product_id: product.resolved_product_id || product.product_id || "",
    stock_source_store_id: product.stock_source_store_id || "vila",
    loja: "vila",
    store_id: "vila",
    quantidade: 1
  };
}

function buildVariationPayload(product = {}, variant = {}) {
  return {
    ...product,
    ...variant,
    normalized_product: true,
    normalized_parent_product_id: product.normalized_parent_product_id || product.product_id,
    variation_id: variant.variation_id,
    product_id: variant.variation_id,
    inventory_id: variant.variation_id,
    loja: "vila",
    store_id: "vila",
    quantidade: 1
  };
}

async function main() {
  const snapshots = snapshotFiles();
  try {
    const user = { id: "QA_CART_CONSOLIDATION", name: "QA Cart Consolidation" };
    const legacyResults = await operationalService.searchProducts("41286", { storeId: "vila", limit: 20 });
    const tiny41286 = legacyResults.find((item) => (
      [item.codigo_tiny, item.sku, item.codigo].some((value) => String(value || "") === "41286")
    ));
    assert(tiny41286, "Tiny/importado 41286 deve existir para o smoke.");

    const legacySession = operationalService.openCustomerSession({
      seller: user.name,
      loja: "vila",
      force_new: true
    }, user);
    const legacyPayload = buildLegacyPayload(tiny41286);

    operationalService.addProductToCart(legacySession.session_id, legacyPayload, user);
    operationalService.addProductToCart(legacySession.session_id, legacyPayload, user);
    let current = operationalService.getSessionById(legacySession.session_id);
    assert.strictEqual(current.cart_items.length, 1, "Adicionar 41286 duas vezes deve manter uma linha.");
    assert.strictEqual(current.cart_items[0].quantidade, 2, "Adicionar 41286 duas vezes deve resultar em quantidade 2.");

    operationalService.addProductToCart(legacySession.session_id, legacyPayload, user);
    current = operationalService.getSessionById(legacySession.session_id);
    assert.strictEqual(current.cart_items.length, 1, "Adicionar 41286 tres vezes deve manter uma linha.");
    assert.strictEqual(current.cart_items[0].quantidade, 3, "Adicionar 41286 tres vezes deve resultar em quantidade 3.");

    const variableResults = await operationalService.searchProducts("QA Grade API", { storeId: "vila", limit: 40 });
    const variableProduct = variableResults.find((item) => (
      item.normalized_product
      && Array.isArray(item.variants)
      && item.variants.filter((variant) => variant.status === "ativo" && Number(variant.available_qty || 0) > 0).length >= 2
    ));
    assert(variableProduct, "Produto normalizado com ao menos duas variacoes ativas deve existir.");
    const activeVariants = variableProduct.variants.filter((variant) => (
      variant.status === "ativo" && Number(variant.available_qty || 0) > 0
    ));
    const firstVariant = activeVariants[0];
    const secondVariant = activeVariants.find((variant) => variant.variation_id !== firstVariant.variation_id);
    assert(secondVariant, "Smoke precisa de uma segunda variacao distinta.");

    const variableSession = operationalService.openCustomerSession({
      seller: user.name,
      loja: "vila",
      force_new: true
    }, user);
    const firstPayload = buildVariationPayload(variableProduct, firstVariant);
    const secondPayload = buildVariationPayload(variableProduct, secondVariant);

    operationalService.addProductToCart(variableSession.session_id, firstPayload, user);
    operationalService.addProductToCart(variableSession.session_id, firstPayload, user);
    operationalService.addProductToCart(variableSession.session_id, secondPayload, user);
    const variableCart = operationalService.getSessionById(variableSession.session_id).cart_items;
    assert.strictEqual(variableCart.length, 2, "Variacoes diferentes devem permanecer em linhas separadas.");
    const consolidatedVariant = variableCart.find((item) => item.variation_id === firstVariant.variation_id);
    const distinctVariant = variableCart.find((item) => item.variation_id === secondVariant.variation_id);
    assert.strictEqual(consolidatedVariant?.quantidade, 2, "Mesma variacao deve consolidar quantidade.");
    assert.strictEqual(distinctVariant?.quantidade, 1, "Variacao diferente deve manter quantidade independente.");

    console.log(JSON.stringify({
      ok: true,
      tiny_41286: {
        lines: current.cart_items.length,
        quantity: current.cart_items[0].quantidade
      },
      variable_product: {
        lines: variableCart.length,
        consolidated_variation_quantity: consolidatedVariant.quantidade,
        distinct_variation_quantity: distinctVariant.quantidade
      }
    }, null, 2));
  } finally {
    restoreFiles(snapshots);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
