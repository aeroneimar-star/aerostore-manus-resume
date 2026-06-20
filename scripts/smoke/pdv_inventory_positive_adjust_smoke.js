"use strict";

/**
 * SMOKE TEST — pdv_inventory_positive_adjust_smoke.js
 *
 * Cenário: Ajuste positivo de estoque em produto seed.
 *
 * Comportamento esperado:
 * - Ajuste com quantity > 0 retorna success (status 200)
 * - Movimento MANUAL_ADJUSTMENT tipo IN é gerado
 * - before_qty e after_qty refletem a alteração correta
 * - Cleanup: ajuste reverso restaura saldo original
 *
 * API: POST /api/pdv/inventory/adjust
 * Permissão: can_adjust_inventory (Admin)
 */

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const PASSWORD = process.env.AEROSTORE_TEST_PASSWORD || "123456";
const { blockProduction, warnLocalOnly } = require("../scriptSafety");

blockProduction("pdv_inventory_positive_adjust_smoke.js");
warnLocalOnly("pdv_inventory_positive_adjust_smoke.js");

// Produto seed seguro: sku 41286, store Vila
// available_qty atual ~5 (ou mais se smoke já rodou antes)
const TEST_STORE = "vila";
const TEST_SKU = "41286";
const ADJUST_DELTA = 3;

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
  console.log("[SMOKE] pdv_inventory_positive_adjust — inicio");

  // Setup: login admin
  const { cookie: adminCookie } = await login("admin@aerostore.local");

  // Passo 1: ler saldo atual antes do ajuste
  const stockBefore = await getCurrentStock(adminCookie, TEST_SKU, TEST_STORE);
  if (stockBefore === null) {
    throw new Error(`Produto ${TEST_SKU} nao encontrado na loja ${TEST_STORE}.`);
  }
  console.log(`[SMOKE] Saldo atual: ${stockBefore}`);

  // Passo 2: ajuste positivo
  const adjustPayload = {
    store_id: TEST_STORE,
    sku: TEST_SKU,
    quantity: ADJUST_DELTA,
    reason: "INVENTARIO",
    notes: "Smoke test — ajuste positivo"
  };
  const adjustResult = await api("/api/pdv/inventory/adjust", {
    method: "POST",
    cookie: adminCookie,
    body: adjustPayload
  });
  console.log(`[SMOKE] Ajuste: status=${adjustResult.status}`);

  // Validações
  const ok = adjustResult.status === 200
    && adjustResult.body?.record
    && adjustResult.body?.movement
    && adjustResult.body.movement.type === "MANUAL_ADJUSTMENT"
    && adjustResult.body.movement.direction === "IN"
    && adjustResult.body.movement.quantity === ADJUST_DELTA
    && adjustResult.body.movement.before_qty === stockBefore
    && adjustResult.body.movement.after_qty === stockBefore + ADJUST_DELTA;

  // Cleanup: ajuste reverso
  console.log("[SMOKE] Cleanup: revertendo saldo original...");
  await api("/api/pdv/inventory/adjust", {
    method: "POST",
    cookie: adminCookie,
    body: {
      store_id: TEST_STORE,
      sku: TEST_SKU,
      quantity: -ADJUST_DELTA,
      reason: "INVENTARIO",
      notes: "Smoke test — rollback"
    }
  });

  // Verifica saldo restaurado
  const stockAfterCleanup = await getCurrentStock(adminCookie, TEST_SKU, TEST_STORE);
  console.log(`[SMOKE] Saldo apos cleanup: ${stockAfterCleanup} (esperado: ${stockBefore})`);

  const result = {
    ok,
    scenario: "inventory_positive_adjust",
    store: TEST_STORE,
    sku: TEST_SKU,
    adjust_delta: ADJUST_DELTA,
    stock_before: stockBefore,
    stock_after_adjust: stockBefore + ADJUST_DELTA,
    stock_after_cleanup: stockAfterCleanup,
    cleanup_verified: stockAfterCleanup === stockBefore,
    adjust_response_status: adjustResult.status,
    movement_type: adjustResult.body?.movement?.type,
    movement_direction: adjustResult.body?.movement?.direction,
    movement_quantity: adjustResult.body?.movement?.quantity,
    movement_before_qty: adjustResult.body?.movement?.before_qty,
    movement_after_qty: adjustResult.body?.movement?.after_qty
  };

  console.log(`[SMOKE] pdv_inventory_positive_adjust — ${ok ? "OK" : "FALHOU"}`);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

main().then((r) => {
  if (!r.ok) process.exit(1);
}).catch((e) => {
  console.error("[SMOKE] Erro:", e.message);
  process.exit(1);
});
