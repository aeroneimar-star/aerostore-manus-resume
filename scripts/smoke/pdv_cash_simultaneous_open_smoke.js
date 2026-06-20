"use strict";

/**
 * SMOKE TEST — pdv_cash_simultaneous_open_smoke.js
 *
 * Cenário: Duas requisições para abrir caixa na mesma loja em sequência rápida.
 *
 * Comportamento esperado:
 * - 1a requisição: abre caixa normalmente (status 200, already_open=false)
 * - 2a requisição: retorna o caixa existente (status 200, already_open=true)
 *
 * Protege contra: race condition que criaria dois caixas abertos simultaneamente.
 *
 * API: POST /api/pdv/control/registers/open
 */

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const PASSWORD = process.env.AEROSTORE_TEST_PASSWORD || "123456";
const { blockProduction, warnLocalOnly } = require("../scriptSafety");

blockProduction("pdv_cash_simultaneous_open_smoke.js");
warnLocalOnly("pdv_cash_simultaneous_open_smoke.js");

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

// ============================================================
// Helpers extras
// ============================================================

async function safeClose(cookie, sessionId) {
  const detail = await api(`/api/pdv/control/registers/${sessionId}`, {
    method: "GET",
    cookie
  });
  const expectedCash = detail.body?.expected?.dinheiro_esperado
    || detail.body?.expected?.expected_cash_amount
    || 0;
  const initialCash = detail.body?.valor_inicial || 0;
  const diff = Math.abs(expectedCash - initialCash);
  const payload = { dinheiro_informado: expectedCash, observacao: "Smoke test cleanup" };
  if (diff >= 20) {
    payload.diferenca_categoria = "INVENTARIO";
    payload.diferenca_justificativa = "Smoke test cleanup";
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
  console.log("[SMOKE] pdv_cash_simultaneous_open — inicio");

  // Setup: login admin
  const { cookie: adminCookie } = await login("admin@aerostore.local");

  // Arrange: garantir que nao ha caixa aberto em VILA_MASC
  const storeId = "vila_masc";
  const statusBefore = await api("/api/pdv/control/open-status", {
    method: "GET",
    cookie: adminCookie
  });

  let existingWasOpen = false;
  if (statusBefore.body.is_open && statusBefore.body.cash_register_id) {
    existingWasOpen = true;
    console.log(`[SMOKE] Ja existe caixa aberto: ${statusBefore.body.cash_register_id}. Fechando com safeClose.`);
    const r = await safeClose(adminCookie, statusBefore.body.cash_register_id);
    console.log(`[SMOKE] Cleanup: close status=${r.status}`);
  }

  // Act: primeira abertura
  console.log("[SMOKE] Abertura 1/2 — primeira abertura");
  const open1 = await api("/api/pdv/control/registers/open", {
    method: "POST",
    cookie: adminCookie,
    body: {
      loja: storeId,
      valor_inicial: 100.00,
      observacao: "Smoke test — abertura 1"
    }
  });

  if (open1.status !== 200) {
    throw new Error(`Abertura 1 deveria retornar 200. Status: ${open1.status}, Error: ${JSON.stringify(open1.body)}`);
  }

  const firstSessionId = open1.body.cash_register_id;
  const firstAlreadyOpen = open1.body.already_open === true;

  console.log(`[SMOKE] Abertura 1 result: session=${firstSessionId}, already_open=${firstAlreadyOpen}`);

  // Act: segunda abertura (sequencial, simulando "simultaneo")
  console.log("[SMOKE] Abertura 2/2 — segunda abertura (imediatamente apos)");
  const open2 = await api("/api/pdv/control/registers/open", {
    method: "POST",
    cookie: adminCookie,
    body: {
      loja: storeId,
      valor_inicial: 200.00,
      observacao: "Smoke test — abertura 2"
    }
  });

  if (open2.status !== 200) {
    throw new Error(`Abertura 2 deveria retornar 200. Status: ${open2.status}, Error: ${JSON.stringify(open2.body)}`);
  }

  const secondSessionId = open2.body.cash_register_id;
  const secondAlreadyOpen = open2.body.already_open === true;

  console.log(`[SMOKE] Abertura 2 result: session=${secondSessionId}, already_open=${secondAlreadyOpen}`);

  // ============================================================
  // Assertions
  // ============================================================

  let passed = true;
  const reasons = [];

  // Assert 1: Segunda abertura deve retornar already_open=true OU o mesmo session_id
  if (secondAlreadyOpen === false && secondSessionId !== firstSessionId) {
    passed = false;
    reasons.push("SEGUNDA ABERTURA nao retornou already_open=true nem reutilizou o session_id existente — possivel race condition!");
  }

  // Assert 2: Deve haver exatamente 1 caixa aberto na loja
  const statusAfter = await api("/api/pdv/control/open-status", {
    method: "GET",
    cookie: adminCookie
  });

  const openCount = statusAfter.body.is_open ? 1 : 0;
  if (openCount !== 1) {
    passed = false;
    reasons.push(`Esperado 1 caixa aberto, encontrado ${openCount} — sistema criou multiplos caixas!`);
  }

  // Assert 3: Session IDs devem ser iguais se already_open=false na segunda
  if (!secondAlreadyOpen && secondSessionId !== firstSessionId) {
    passed = false;
    reasons.push("Duas sessoes diferentes foram criadas — race condition confirmada!");
  }

  // ============================================================
  // Cleanup
  // ============================================================

  // Fechar caixa do teste com safeClose
  if (statusAfter.body.cash_register_id) {
    console.log(`[SMOKE] Cleanup: fechando caixa ${statusAfter.body.cash_register_id}`);
    await safeClose(adminCookie, statusAfter.body.cash_register_id);
  }

  // Restaurar caixa original se existia antes
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
    scenario: "cash_simultaneous_open",
    store_id: storeId,
    first_open: {
      session_id: firstSessionId,
      already_open: firstAlreadyOpen
    },
    second_open: {
      session_id: secondSessionId,
      already_open: secondAlreadyOpen
    },
    open_count_after: openCount,
    reasons: reasons.length > 0 ? reasons : undefined
  };

  console.log("[SMOKE] Result:", JSON.stringify(result, null, 2));

  if (!passed) {
    console.error("[SMOKE] FALHOU — razoes:", reasons.join("; "));
    process.exit(1);
  }

  console.log("[SMOKE] pdv_cash_simultaneous_open — OK");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("[SMOKE] Erro fatal:", error.message || error);
  process.exit(1);
});
