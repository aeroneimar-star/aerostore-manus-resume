"use strict";

const assert = require("assert");
const { all, initializeDatabase } = require("../db");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";

async function request(pathname, { method = "GET", cookie = "", body } = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({}))
  };
}

async function login() {
  const response = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "gerente@aerostore.local", password: "123456" })
  });
  const body = await response.json().catch(() => ({}));
  assert.strictEqual(response.status, 200, body.error || "Login deveria funcionar.");
  return (response.headers.getSetCookie?.() || []).map((item) => item.split(";")[0]).join("; ");
}

function buildVariantPayload(variants = [], quantities = {}) {
  return variants.map((variant) => ({
    variation_id: variant.variation_id,
    color: variant.color || "AZUL",
    size: variant.size,
    desired_stock: quantities[variant.size] ?? 0,
    initial_stock: quantities[variant.size] ?? 0,
    barcode: variant.barcode || ""
  }));
}

async function getBalances(productId) {
  return all(
    `SELECT v.id AS variation_id,
            v.sku,
            json_extract(v.attributes_json, '$.size') AS size,
            b.store_id,
            b.available_qty AS physical_qty,
            b.reserved_qty
       FROM pdv_product_variants v
       INNER JOIN pdv_inventory_balances_v2 b ON b.variant_id = v.id
      WHERE v.product_id = ?
      ORDER BY v.sku, b.store_id`,
    [productId]
  );
}

async function getMovements(productId) {
  return all(
    `SELECT m.variant_id,
            json_extract(v.attributes_json, '$.size') AS size,
            m.store_id,
            m.movement_type,
            m.quantity_delta,
            m.quantity_before,
            m.quantity_after,
            m.origin
       FROM pdv_inventory_movements_v2 m
       INNER JOIN pdv_product_variants v ON v.id = m.variant_id
      WHERE v.product_id = ?
        AND m.origin IN ('product_create', 'product_edit')
      ORDER BY m.created_at, m.id`,
    [productId]
  );
}

function findQty(rows, storeId, size) {
  const row = rows.find((item) => item.store_id === storeId && item.size === size);
  return Number(row?.physical_qty || 0);
}

async function main() {
  await initializeDatabase();
  const cookie = await login();
  const suffix = String((Date.now() % 900000) + 100000).padStart(6, "0");
  const baseSku = `AERO-STORE-${suffix}`;
  const name = `QA Loja Unidade Manual Normalizado ${suffix}`;

  const created = await request("/api/products", {
    method: "POST",
    cookie,
    body: {
      name,
      commercial_name: name,
      product_type: "variable",
      base_sku: baseSku,
      sku: baseSku,
      price: 149.9,
      promotional_price: 89.9,
      cost_price: 40,
      store: "vila",
      store_id: "vila",
      color: "Azul",
      status: "ativo",
      source: "manual",
      use_in_pos: 1,
      variants: [
        { color: "Azul", size: "P", initial_stock: 2 },
        { color: "Azul", size: "M", initial_stock: 3 },
        { color: "Azul", size: "G", initial_stock: 0 }
      ]
    }
  });
  assert.strictEqual(created.status, 201, created.body.error || "Produto deveria ser criado em Vila.");
  const legacyId = created.body.product.id;
  const productId = created.body.normalized.product.id;
  const createdVariants = created.body.normalized.variants.map((variant) => ({
    variation_id: variant.variation_id || variant.id,
    color: variant.color || "AZUL",
    size: variant.size,
    barcode: variant.barcode || ""
  }));

  const botanico = await request(`/api/products/${legacyId}`, {
    method: "PUT",
    cookie,
    body: {
      name,
      commercial_name: name,
      product_type: "variable",
      base_sku: baseSku,
      sku: baseSku,
      price: 149.9,
      promotional_price: 89.9,
      cost_price: 40,
      store: "botanico",
      store_id: "botanico",
      color: "Azul",
      status: "ativo",
      source: "manual",
      use_in_pos: 1,
      variants: buildVariantPayload(createdVariants, { P: 1, M: 1, G: 0 })
    }
  });
  assert.strictEqual(botanico.status, 200, botanico.body.error || "Produto deveria aceitar saldo no Botanico.");

  const sul = await request(`/api/products/${legacyId}`, {
    method: "PUT",
    cookie,
    body: {
      name,
      commercial_name: name,
      product_type: "variable",
      base_sku: baseSku,
      sku: baseSku,
      price: 149.9,
      promotional_price: 89.9,
      cost_price: 40,
      store: "sul",
      store_id: "sul",
      color: "Azul",
      status: "ativo",
      source: "manual",
      use_in_pos: 1,
      variants: buildVariantPayload(createdVariants, { P: 0, M: 1, G: 0 })
    }
  });
  assert.strictEqual(sul.status, 200, sul.body.error || "Produto deveria aceitar Sul como loja valida.");

  const balances = await getBalances(productId);
  assert.strictEqual(balances.length, 9, "Tres variacoes devem ter balance em tres lojas.");
  assert.strictEqual(findQty(balances, "vila", "P"), 2);
  assert.strictEqual(findQty(balances, "vila", "M"), 3);
  assert.strictEqual(findQty(balances, "vila", "G"), 0);
  assert.strictEqual(findQty(balances, "botanico", "P"), 1);
  assert.strictEqual(findQty(balances, "botanico", "M"), 1);
  assert.strictEqual(findQty(balances, "botanico", "G"), 0);
  assert.strictEqual(findQty(balances, "sul", "P"), 0);
  assert.strictEqual(findQty(balances, "sul", "M"), 1);
  assert.strictEqual(findQty(balances, "sul", "G"), 0);

  const management = await request(`/api/products?search=${encodeURIComponent(baseSku)}&limit=25`, { cookie });
  assert.strictEqual(management.status, 200, management.body.error || "Listagem deveria responder.");
  const matches = (management.body.items || []).filter((item) => item.normalized_parent_product_id === productId);
  assert.strictEqual(matches.length, 1, "Listagem deve manter um unico produto pai.");
  assert.strictEqual((matches[0].variants || []).length, 3, "Listagem deve manter uma linha por variacao, sem duplicar por loja.");

  const movements = await getMovements(productId);
  const storesWithMovements = new Set(movements.map((item) => item.store_id));
  assert(storesWithMovements.has("vila"), "Movimentos devem registrar Vila.");
  assert(storesWithMovements.has("botanico"), "Movimentos devem registrar Botanico.");
  assert(storesWithMovements.has("sul"), "Movimentos devem registrar Sul.");

  console.log(JSON.stringify({
    ok: true,
    product_id: productId,
    legacy_id: legacyId,
    base_sku: baseSku,
    parent_matches: matches.length,
    variants_in_management: matches[0].variants.length,
    balances: balances.map((item) => ({
      sku: item.sku,
      size: item.size,
      store_id: item.store_id,
      physical_qty: Number(item.physical_qty || 0),
      reserved_qty: Number(item.reserved_qty || 0)
    })),
    movement_stores: Array.from(storesWithMovements).sort()
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
