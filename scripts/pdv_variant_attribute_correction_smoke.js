"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aerostore-pdv-variant-correction-"));
process.env.DATABASE_PATH = path.join(tempRoot, "test.sqlite");

const { initializeDatabase, get, all, run } = require("../db");
const {
  createProductAggregate,
  updateProductAggregate
} = require("../modules/pdv/products/pdvSimpleProductService");

const actor = {
  id: 999016,
  name: "QA Cor da Variacao",
  email: "qa-variant-color@aerostore.local",
  role: "admin"
};

async function main() {
  await initializeDatabase();

  assert(
    appSource.includes("getPdvProductVariantStockForStore"),
    "Frontend deve resolver desired_stock pelo saldo da loja selecionada."
  );
  assert(
    appSource.includes('querySelector("[data-pdv-product-store]")?.addEventListener("change"'),
    "Trocar a loja no formulario deve atualizar visualmente os saldos das variacoes."
  );
  assert(
    !appSource.includes("desired_stock: item.physical_qty,\n          physical_qty: item.physical_qty,"),
    "Edicao nao pode preencher desired_stock com o total agregado da variacao."
  );

  const created = await createProductAggregate({
    name: "QA Cor de Variacao",
    product_type: "variable",
    base_sku: "QA-COR-000016",
    price: 119.9,
    color: "Marinho",
    store_id: "botanico",
    variants: [
      { color: "Marinho", size: "M", initial_stock: 1 },
      { color: "Marinho", size: "G", initial_stock: 1 }
    ]
  }, actor);

  const originalIds = created.variants.map((variant) => variant.variation_id).sort();
  for (const variant of created.variants) {
    await run(
      `INSERT INTO pdv_inventory_balances_v2
       (variant_id, store_id, available_qty, reserved_qty, version, updated_at)
       VALUES (?, 'vila', 5, 0, 1, datetime('now'))`,
      [variant.variation_id]
    );
    await run(
      `INSERT INTO pdv_inventory_balances_v2
       (variant_id, store_id, available_qty, reserved_qty, version, updated_at)
       VALUES (?, 'sul', 2, 0, 1, datetime('now'))`,
      [variant.variation_id]
    );
  }
  const originalMovementCount = await get(
    "SELECT COUNT(*) AS total FROM pdv_inventory_movements_v2 WHERE variant_id IN (?, ?)",
    originalIds
  );

  const updated = await updateProductAggregate(created.product.id, {
    color: "Preto",
    store_id: "botanico",
    variants: created.variants.map((variant) => ({
      variation_id: variant.variation_id,
      store_id: "botanico",
      color: "Preto",
      size: variant.size,
      desired_stock: 1,
      status: variant.status
    }))
  }, actor);

  assert.deepStrictEqual(
    updated.variants.map((variant) => variant.variation_id).sort(),
    originalIds,
    "Cor corrigida deve preservar as variation_id existentes."
  );
  assert(updated.variants.every((variant) => variant.color === "PRETO"));
  assert(updated.variants.every((variant) => variant.physical_qty === 8));
  assert(updated.variants.every((variant) => variant.status === "ativo"));
  const balances = await all(
    `SELECT variant_id, store_id, available_qty, reserved_qty
     FROM pdv_inventory_balances_v2
     WHERE variant_id IN (?, ?)
     ORDER BY variant_id, store_id`,
    originalIds
  );
  for (const variantId of originalIds) {
    const byStore = Object.fromEntries(
      balances
        .filter((balance) => balance.variant_id === variantId)
        .map((balance) => [balance.store_id, balance.available_qty])
    );
    assert.deepStrictEqual(byStore, {
      botanico: 1,
      sul: 2,
      vila: 5
    });
  }

  const legacy = await get(
    "SELECT color FROM ai_products WHERE id = ?",
    [created.product.legacy_ai_product_id]
  );
  assert.strictEqual(legacy.color, "Preto", "Cor geral deve persistir no cadastro legado.");

  const movementCount = await get(
    "SELECT COUNT(*) AS total FROM pdv_inventory_movements_v2 WHERE variant_id IN (?, ?)",
    originalIds
  );
  assert.strictEqual(
    movementCount.total,
    originalMovementCount.total,
    "Corrigir atributo sem mudar saldo nao deve criar movimento de estoque."
  );

  const auditRows = await all(
    `SELECT action_type, variant_id
     FROM pdv_product_audit_logs
     WHERE product_id = ? AND action_type = 'VARIANT_ATTRIBUTES_CHANGED'
     ORDER BY id`,
    [created.product.id]
  );
  assert.strictEqual(auditRows.length, 2);

  console.log(JSON.stringify({
    ok: true,
    product_id: created.product.id,
    variation_ids: originalIds,
    colors: updated.variants.map((variant) => variant.color),
    balances,
    physical_qty: updated.totals.physical_qty
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
