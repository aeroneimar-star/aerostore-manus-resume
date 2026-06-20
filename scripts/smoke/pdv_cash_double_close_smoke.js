"use strict";

/**
 * SMOKE TEST — pdv_cash_double_close_smoke.js
 *
 * Cenário: Tentar fechar o mesmo caixa duas vezes em sequencia.
 *
 * Comportamento esperado:
 * - 1o fechamento: sucesso (status 200)
 * - 2o fechamento: erro (status 409 ou 400) com mensagem clara
 *
 * API: POST /api/pdv/control/registers/open
 *      POST /api/pdv/control/registers/:id/close
 */

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const PASSWORD = process.env.AEROSTORE_TEST_PASSWORD || "123456";
const { blockProduction, warnLocalOnly } = require("../scriptSafety");

blockProduction("pdv_cash_double_close_smoke.js");
warnLocalOnly("pdv_cash_double_close_smoke.js");

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
async function safeClose(cookie, sessionId, extraPayload = {}) {
  const detail = await api(`/api/pdv/control/registers/${sessionId}`, {
    method: "GET",
    cookie
  });
  const expectedCash = detail.body?.expected?.dinheiro_esperado
    || detail.body?.expected?.expected_cash_amount
    || 0;
  const initialCash = detail.body?.valor_inicial || 0;
  const diff = Math.abs(expectedCash - initialCash);

  const payload = {
    dinheiro_informado: expectedCash,
    observacao: "Smoke test",
    tickets_conferidos: { pix: true, debit: true, credit: true },
    ...extraPayload
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
  console.log("[SMOKE] pdv_cash_double_close — inicio");

  const storeId = "vila_masc";

  // Setup: login admin
  const { cookie: adminCookie } = await login("admin@aerostore.local");

  // Arrange: fechar qualquer caixa existente (com valor correto)
  const statusBefore = await api("/api/pdv/control/open-status", {
    method: "GET",
    cookie: adminCookie
  });

  let existingWasOpen = false;
  if (statusBefore.body.is_open && statusBefore.body.cash_register_id) {
    existingWasOpen = true;
    console.log(`[SMOKE] Ja existe caixa aberto: ${statusBefore.body.cash_register_id}. Fechando com safeClose.`);
    const r = await safeClose(adminCookie, statusBefore.body.cash_register_id);
    console.log(`[SMOKE] Cleanup close: status=${r.status}`);
  }

  // Arrange: abrir caixa de teste
  console.log(`[SMOKE] Abrindo caixa de teste: ${storeId}`);
  const open = await api("/api/pdv/control/registers/open", {
    method: "POST",
    cookie: adminCookie,
    body: { loja: storeId, valor_inicial: 0, observacao: "Smoke test — double close" }
  });

  if (open.status !== 200) {
    throw new Error(`Abrir caixa deveria retornar 200. Status: ${open.status}, Error: ${JSON.stringify(open.body)}`);
  }

  const sessionId = open.body.cash_register_id;
  console.log(`[SMOKE] Caixa aberto: ${sessionId}`);

  // Act: primeiro fechamento
  console.log("[SMOKE] Fechamento 1/2 — primeiro fechamento");
  const close1 = await safeClose(adminCookie, sessionId);

  if (close1.status !== 200) {
    throw new Error(`Primeiro fechamento deveria retornar 200. Status: ${close1.status}, Error: ${JSON.stringify(close1.body)}`);
  }
  console.log(`[SMOKE] Fechamento 1 OK`);

  // Act: segundo fechamento (double-close)
  console.log("[SMOKE] Fechamento 2/2 — tentativa de double-close");
  const close2 = await api(`/api/pdv/control/registers/${sessionId}/close`, {
    method: "POST",
    cookie: adminCookie,
    body: { dinheiro_informado: 0, observacao: "Smoke test — double close attempt" }
  });
  console.log(`[SMOKE] Fechamento 2: status=${close2.status}, body=${JSON.stringify(close2.body)}`);

  // ============================================================
  // Assertions
  // ============================================================

  let passed = true;
  const reasons = [];

  // Assert 1: Primeiro fechamento OK
  if (close1.status !== 200) {
    passed = false;
    reasons.push(`Primeiro fechamento deveria retornar 200. Status: ${close1.status}`);
  }

  // Assert 2: Segundo fechamento deve falhar (4xx)
  const isSecondRejected = close2.status >= 400 && close2.status < 500;
  if (!isSecondRejected) {
    passed = false;
    reasons.push(`Segundo fechamento deveria retornar 4xx. Status: ${close2.status} — double-close nao foi protegido!`);
  }

  // Assert 3: Mensagem de erro semântica correta
  if (isSecondRejected) {
    const err = (close2.body.error || "").toLowerCase();
    const correct = /fechado|ja.*fechad|caixa.*ja|close|closed|status/i.test(err);
    if (!correct) {
      reasons.push(`Mensagem de erro inesperada: "${close2.body.error}"`);
    }
  }

  // Assert 4: Caixa nao deve estar aberto apos double-close
  const statusAfter = await api("/api/pdv/control/open-status", {
    method: "GET",
    cookie: adminCookie
  });

  if (statusAfter.body.is_open === true && close2.status === 200) {
    passed = false;
    reasons.push("Double-close foi ACEITO e caixa ficou aberto — gravissimo!");
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
    scenario: "cash_double_close",
    store_id: storeId,
    session_id: sessionId,
    first_close: { status: close1.status, rejected: close1.status !== 200 },
    second_close: {
      status: close2.status,
      rejected: isSecondRejected,
      error: close2.body.error || ""
    },
    register_status_after: statusAfter.body.is_open ? "OPEN" : "CLOSED",
    reasons: reasons.length > 0 ? reasons : undefined
  };

  console.log("[SMOKE] Result:", JSON.stringify(result, null, 2));

  if (!passed) {
    console.error("[SMOKE] FALHOU — razoes:", reasons.join("; "));
    process.exit(1);
  }

  console.log("[SMOKE] pdv_cash_double_close — OK");
}

main().catch((error) => {
  console.error("[SMOKE] Erro fatal:", error.message || error);
  process.exit(1);
});
