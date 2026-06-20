"use strict";

/**
 * SMOKE TEST — pdv_inventory_stock_count_negative_target_smoke.js
 *
 * Cenário: Tentativa de contagem de estoque com target_quantity negativo.
 *
 * Comportamento esperado:
 * - stock_count com target_quantity = -1 retorna erro (status 400)
 * - Mensagem contem "negativa" (rejeicao de contagem negativa)
 * - Estoque NAO e alterado
 *
 * API: POST /api/pdv/inventory/adjust
 * Permissão: can_adjust_inventory (Admin)
 */

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const PASSWORD = process.env.AEROSTORE_TEST_PASSWORD || "123456";
const { blockProduction, warnLocalOnly } = require("../scriptSafety");

blockProduction("pdv_inventory_stock_count_negative_target_smoke.js");
warnLocalOnly("pdv_inventory_stock_count_negative_target_smoke.js");

const TEST_STORE = "vila";
const TEST_SKU = "41286";

async function login(email) {
  const response = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Connection: "close" },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 200) {
    throw new Error(`Login falhou para ${email}: ${body.error || response.status}`);
  }
  const cookie = (response.headers.getSetCookie?.() || [])
    .map((item) => item.split(";")[0])
    .join("; ");
  return { cookie, body };
}

async function api(pathname, { method = "GET", cookie = "", body } = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      Connection: "close",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const responseBody = await response.json().catch(() => ({}));
  return { status: response.status, body: responseBody };
}

async function getCurrentStock(cookie, sku, store) {
  const result = await api(`/api/pdv/inventory/products?store=${store}&limit=200`, { method: "GET", cookie });
  if (result.status !== 200) return null;
  const items = result.body?.items || [];
  const item = items.find((p) => p.sku === sku && p.store_id === store);
  return item ? Number(item.available_qty) : null;
}

async function main() {
  console.log("[SMOKE] pdv_inventory_stock_count_negative_target — inicio");

  // Setup: login admin
  const { cookie: adminCookie } = await login("admin@aerostore.local");

  // Ler saldo antes
  const stockBefore = await getCurrentStock(adminCookie, TEST_SKU, TEST_STORE);
  if (stockBefore === null) {
    throw new Error(`Produto ${TEST_SKU} nao encontrado na loja ${TEST_STORE}.`);
  }
  console.log(`[SMOKE] Saldo antes: ${stockBefore}`);

  // Tentar stock_count com target_quantity = -1
  const badPayload = {
    store_id: TEST_STORE,
    sku: TEST_SKU,
    mode: "stock_count",
    target_quantity: -1
  };
  const result = await api("/api/pdv/inventory/adjust", {
    method: "POST",
    cookie: adminCookie,
    body: badPayload
  });
  console.log(`[SMOKE] Tentativa: status=${result.status}`);

  // Validações
  const rejected = result.status === 400
    && String(result.body?.error || "").toLowerCase().includes("negativa");

  // Estoque nao deve ter mudado
  const stockAfter = await getCurrentStock(adminCookie, TEST_SKU, TEST_STORE);
  console.log(`[SMOKE] Saldo depois: ${stockAfter}`);
  const stockUnchanged = stockAfter === stockBefore;

  const smokeOk = rejected && stockUnchanged;

  const smokeResult = {
    ok: smokeOk,
    scenario: "inventory_stock_count_negative_target",
    store: TEST_STORE,
    sku: TEST_SKU,
    stock_before: stockBefore,
    stock_after: stockAfter,
    stock_unchanged: stockUnchanged,
    reject_status: result.status,
    reject_error: result.body?.error,
    reject_contains_negativa: String(result.body?.error || "").toLowerCase().includes("negativa")
  };

  console.log(`[SMOKE] pdv_inventory_stock_count_negative_target — ${smokeOk ? "OK" : "FALHOU"}`);
  console.log(JSON.stringify(smokeResult, null, 2));
  return smokeResult;
}

main().then((r) => {
  if (!r.ok) process.exit(1);
}).catch((e) => {
  console.error("[SMOKE] Erro:", e.message);
  process.exit(1);
});
