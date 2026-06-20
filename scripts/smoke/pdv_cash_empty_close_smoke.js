"use strict";

/**
 * SMOKE TEST — pdv_cash_empty_close_smoke.js
 *
 * Cenário: Fechar caixa operacional sem nenhuma venda vinculada.
 *
 * Comportamento esperado:
 * - Caixa abre com valor_inicial=0
 * - Nenhuma venda vinculada
 * - Fechamento funciona com dinheiro_informado=0 (diferenca=0)
 *
 * API: POST /api/pdv/control/registers/open
 *      POST /api/pdv/control/registers/:id/close
 */

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const PASSWORD = process.env.AEROSTORE_TEST_PASSWORD || "123456";
const { blockProduction, warnLocalOnly } = require("../scriptSafety");

blockProduction("pdv_cash_empty_close_smoke.js");
warnLocalOnly("pdv_cash_empty_close_smoke.js");

// ============================================================
// Helpers
// ============================================================

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
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({}))
  };
}

// Fechar caixa buscando o valor esperado correto
async function safeClose(cookie, sessionId) {
  // Busca o valor esperado
  const detail = await api(`/api/pdv/control/registers/${sessionId}`, {
    method: "GET",
    cookie
  });
  const expectedCash = detail.body?.expected?.dinheiro_esperado
    || detail.body?.expected?.expected_cash_amount
    || 0;
  const initialCash = detail.body?.valor_inicial || 0;

  // Se houver diferença >= 20, precisa de categoria
  const diff = Math.abs(expectedCash - initialCash);
  const payload = {
    dinheiro_informado: expectedCash,
    observacao: "Smoke test cleanup",
    tickets_conferidos: { pix: true, debit: true, credit: true }
  };
  if (diff >= 20) {
    payload.diferenca_categoria = "INVENTARIO";
    payload.diferenca_justificativa = "Smoke test — diferenca contabilizada";
  }

  return api(`/api/pdv/control/registers/${sessionId}/close`, {
    method: "POST",
    cookie,
    body: payload
  });
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("[SMOKE] pdv_cash_empty_close — inicio");

  const storeId = "vila_masc";

  // Setup: login admin
  const { cookie: adminCookie } = await login("admin@aerostore.local");

  // Arrange: fechar qualquer caixa existente na loja (busca valor correto)
  const statusBefore = await api("/api/pdv/control/open-status", {
    method: "GET",
    cookie: adminCookie
  });

  let existingWasOpen = false;
  if (statusBefore.body.is_open && statusBefore.body.cash_register_id) {
    existingWasOpen = true;
    console.log(`[SMOKE] Ja existe caixa aberto: ${statusBefore.body.cash_register_id}. Fechando com valor correto.`);
    const closeResult = await safeClose(adminCookie, statusBefore.body.cash_register_id);
    console.log(`[SMOKE] Cleanup close: status=${closeResult.status}`);
  }

  // Act: abrir caixa com valor_inicial=0 (caixa vazio de verdade)
  console.log(`[SMOKE] Abrindo caixa vazio em ${storeId} com valor_inicial=0`);
  const open = await api("/api/pdv/control/registers/open", {
    method: "POST",
    cookie: adminCookie,
    body: {
      loja: storeId,
      valor_inicial: 0,
      observacao: "Smoke test — caixa vazio"
    }
  });

  if (open.status !== 200) {
    throw new Error(`Abrir caixa deveria retornar 200. Status: ${open.status}, Error: ${JSON.stringify(open.body)}`);
  }

  const sessionId = open.body.cash_register_id;
  console.log(`[SMOKE] Caixa aberto: ${sessionId}`);

  // Verificar que nao ha vendas vinculadas
  const detail = await api(`/api/pdv/control/registers/${sessionId}`, {
    method: "GET",
    cookie: adminCookie
  });

  const linkedSales = detail.body?.linked_sales || 0;
  const expectedCash = detail.body?.expected?.dinheiro_esperado || 0;
  console.log(`[SMOKE] Vendas vinculadas: ${linkedSales}, esperado: R$${expectedCash}`);

  // Act: fechar caixa vazio
  console.log("[SMOKE] Fechando caixa vazio com dinheiro_informado=0");
  const close = await api(`/api/pdv/control/registers/${sessionId}/close`, {
    method: "POST",
    cookie: adminCookie,
    body: { dinheiro_informado: 0, observacao: "Smoke test — fechamento vazio" }
  });

  // ============================================================
  // Assertions
  // ============================================================

  let passed = true;
  const reasons = [];

  // Assert 1: Fechamento deve retornar 200
  if (close.status !== 200) {
    passed = false;
    reasons.push(`Fechamento deveria retornar 200. Status: ${close.status}, Error: ${JSON.stringify(close.body)}`);
  }

  // Assert 2: linked_sales deve ser zero
  if (linkedSales !== 0) {
    passed = false;
    reasons.push(`Esperado 0 vendas vinculadas, encontrado ${linkedSales}`);
  }

  // Assert 3: expected_cash deve ser zero (caixa vazio com valor_inicial=0)
  if (Math.abs(expectedCash) > 0.01) {
    passed = false;
    reasons.push(`Esperado expected_cash=0, encontrado R$${expectedCash.toFixed(2)}`);
  }

  // Assert 4: caixa deve estar fechado
  const finalStatus = await api("/api/pdv/control/open-status", {
    method: "GET",
    cookie: adminCookie
  });

  if (finalStatus.body.is_open === true) {
    passed = false;
    reasons.push("Caixa ainda esta aberto apos fechamento");
  }

  // ============================================================
  // Cleanup
  // ============================================================

  if (existingWasOpen) {
    console.log("[SMOKE] Cleanup: reabrindo caixa original");
    await api("/api/pdv/control/registers/open", {
      method: "POST",
      cookie: adminCookie,
      body: { loja: storeId, valor_inicial: 0, observacao: "Restaurado apos smoke test" }
    });
  }

  // ============================================================
  // Result
  // ============================================================

  const result = {
    ok: passed,
    scenario: "cash_empty_close",
    store_id: storeId,
    session_id: sessionId,
    linked_sales: linkedSales,
    expected_cash: expectedCash,
    close_status: close.status,
    status_after_close: finalStatus.body.is_open ? "STILL_OPEN" : "CLOSED",
    reasons: reasons.length > 0 ? reasons : undefined
  };

  console.log("[SMOKE] Result:", JSON.stringify(result, null, 2));

  if (!passed) {
    console.error("[SMOKE] FALHOU — razoes:", reasons.join("; "));
    process.exit(1);
  }

  console.log("[SMOKE] pdv_cash_empty_close — OK");
}

main().catch((error) => {
  console.error("[SMOKE] Erro fatal:", error.message || error);
  process.exit(1);
});
