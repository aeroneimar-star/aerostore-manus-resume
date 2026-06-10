"use strict";

const assert = require("assert");
const { get, run } = require("../db");
const {
  listInventoryProducts,
  getInventoryMovements
} = require("../modules/pdv/inventory/pdvInventoryService");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const TEST_EMAIL = process.env.AEROSTORE_TEST_EMAIL || "gerente@aerostore.local";
const TEST_PASSWORD = process.env.AEROSTORE_TEST_PASSWORD || "123456";

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
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD })
  });
  const body = await response.json().catch(() => ({}));
  assert.strictEqual(response.status, 200, body.error || "Login deveria funcionar.");
  return (response.headers.getSetCookie?.() || []).map((item) => item.split(";")[0]).join("; ");
}

function findTiny41286(items = []) {
  return (items || []).find((item) => {
    const values = [
      item.codigo_tiny,
      item.tiny_id,
      item.codigo,
      item.sku,
      item.codigo_interno,
      item.product_id,
      item.inventory_id
    ].map((value) => String(value || ""));
    return values.some((value) => value.includes("41286"));
  }) || null;
}

function buildAdjustmentPayload(item = {}, storeId = "vila", targetQuantity = 0) {
  return {
    mode: "stock_count",
    inventory_id: item.inventory_id || "",
    product_id: item.product_id || item.id || "",
    sku: item.sku || "",
    codigo: item.codigo || "",
    codigo_tiny: item.codigo_tiny || item.tiny_id || "",
    codigo_etiqueta: item.codigo_etiqueta || "",
    codigo_interno: item.codigo_interno || "",
    codigo_barras: item.codigo_barras || item.ean || "",
    nome: item.nome || item.name || "",
    marca: item.marca || item.brand || "",
    categoria: item.categoria || item.category || "",
    cor: item.cor || item.color || "",
    tamanho: item.tamanho || item.size || "",
    tipo: item.tipo || "",
    source: item.source || item.origin || "",
    preco_venda: item.preco_venda || item.price || 0,
    store_id: storeId,
    target_quantity: targetQuantity,
    notes: "Smoke de ajuste operacional por contagem.",
    origin: "pdv_legacy_inventory_stock_adjustment_smoke"
  };
}

function findRecord(query, storeId) {
  const response = listInventoryProducts({ q: query, storeId, limit: 80 });
  return findTiny41286(response.items || []);
}

async function adjust(cookie, item, storeId, targetQuantity) {
  const response = await request("/api/pdv/inventory/adjust", {
    method: "POST",
    cookie,
    body: buildAdjustmentPayload(item, storeId, targetQuantity)
  });
  assert.strictEqual(response.status, 200, response.body.error || `Ajuste deveria funcionar em ${storeId}.`);
  assert.strictEqual(response.body.record.store_id, storeId);
  assert.strictEqual(Number(response.body.record.available_qty || 0), targetQuantity);
  assert.strictEqual(response.body.movement.type, "STOCK_COUNT_ADJUSTMENT");
  assert.strictEqual(response.body.movement.store_id, storeId);
  return response.body;
}

function getLatestMovement(productId, storeId) {
  const response = getInventoryMovements({ productId, storeId, limit: 20 });
  return (response.items || []).find((item) => item.type === "STOCK_COUNT_ADJUSTMENT" && item.store_id === storeId) || null;
}

async function assertOperationalSearchGrouped(cookie, query) {
  const response = await request(`/api/pdv/operational/search/products?q=${encodeURIComponent(query)}&store=vila&limit=20`, { cookie });
  assert.strictEqual(response.status, 200, response.body.error || "Busca operacional deveria responder.");
  const matches = (response.body.unified || response.body.items || []).filter((item) => {
    const values = [item.codigo_tiny, item.codigo, item.sku, item.product_id, item.id].map((value) => String(value || ""));
    return values.some((value) => value.includes("41286"));
  });
  assert(matches.length >= 1, "Tiny 41286 deve continuar localizavel na venda.");
  const uniqueKeys = new Set(matches.map((item) => item.product_id || item.id || item.sku || item.codigo));
  assert.strictEqual(uniqueKeys.size, matches.length, "Busca operacional nao deve duplicar o mesmo item exato.");
  return matches.length;
}

async function runSmoke() {
  const cookie = await login();
  const initial = await request("/api/pdv/inventory/products?q=41286&limit=40", { cookie });
  assert.strictEqual(initial.status, 200, initial.body.error || "Busca inicial deveria responder.");
  const tiny = findTiny41286(initial.body.items || []);
  assert(tiny, "Produto legado/Tiny 41286 precisa existir na base local para este smoke.");
  assert(!String(tiny.source || "").toLowerCase().includes("pdv_product_v2"), "Smoke deve usar legado/importado, nao normalizado.");

  const expectedIdentity = {
    product_id: tiny.product_id || tiny.id || "",
    sku: tiny.sku || "",
    codigo_tiny: tiny.codigo_tiny || tiny.tiny_id || "",
    nome: tiny.nome || tiny.name || "",
    source: tiny.source || tiny.origin || ""
  };

  const vila = await adjust(cookie, tiny, "vila", 5);
  const botanico = await adjust(cookie, tiny, "botanico", 2);
  const sul = await adjust(cookie, tiny, "sul", 1);

  const productId = vila.record.product_id;
  for (const [storeId, expectedQty] of [["vila", 5], ["botanico", 2], ["sul", 1]]) {
    const record = findRecord("41286", storeId);
    assert(record, `Registro ajustado deve aparecer em ${storeId}.`);
    assert.strictEqual(Number(record.available_qty || 0), expectedQty, `Saldo separado incorreto em ${storeId}.`);
    assert.strictEqual(record.product_id, productId, "Ajuste entre lojas deve preservar product_id.");
    const movement = getLatestMovement(productId, storeId);
    assert(movement, `Movimento STOCK_COUNT_ADJUSTMENT deve existir em ${storeId}.`);
  }

  const current = findRecord("41286", "vila");
  assert.strictEqual(current.product_id, expectedIdentity.product_id || productId);
  assert.strictEqual(current.sku || "", expectedIdentity.sku || current.sku || "");
  assert.strictEqual(current.codigo_tiny || "", expectedIdentity.codigo_tiny || current.codigo_tiny || "");
  assert.strictEqual(current.nome || "", expectedIdentity.nome || current.nome || "");
  assert.strictEqual(current.source || current.origin || "", expectedIdentity.source || current.source || current.origin || "");

  const saleMatches = await assertOperationalSearchGrouped(cookie, "41286");

  console.log(JSON.stringify({
    ok: true,
    product_id: productId,
    tiny_41286: {
      vila: Number(vila.record.available_qty || 0),
      botanico: Number(botanico.record.available_qty || 0),
      sul: Number(sul.record.available_qty || 0)
    },
    movement_types: [vila.movement.type, botanico.movement.type, sul.movement.type],
    sale_search_matches: saleMatches
  }, null, 2));
}

async function main() {
  const user = await get(
    "SELECT id, allowed_stores_json, permissions_json FROM users WHERE lower(email) = lower(?) LIMIT 1",
    [TEST_EMAIL]
  );
  assert(user, `Usuario de QA ${TEST_EMAIL} deve existir.`);
  let permissions = {};
  try {
    permissions = JSON.parse(user.permissions_json || "{}");
  } catch (error) {
    permissions = {};
  }
  await run(
    "UPDATE users SET allowed_stores_json = ?, permissions_json = ? WHERE id = ?",
    [
      JSON.stringify(["vila", "botanico", "sul"]),
      JSON.stringify({ ...permissions, can_adjust_inventory: true }),
      user.id
    ]
  );
  try {
    await runSmoke();
  } finally {
    await run(
      "UPDATE users SET allowed_stores_json = ?, permissions_json = ? WHERE id = ?",
      [user.allowed_stores_json, user.permissions_json, user.id]
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
