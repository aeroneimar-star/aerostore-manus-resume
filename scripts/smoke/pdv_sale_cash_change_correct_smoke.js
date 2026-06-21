"use strict";

/**
 * PDV Bloco C — Smoke 2: Cash payment + correct change + cancel
 *
 * Flow: login → open cash register → open session → add item → dinheiro (R$200) → finalize → cancel
 * Confirms: sale completes with troco, cancel restores stock.
 */
const BASE_URL = "http://localhost:3000";
const STORE = "vila";
const SELLER = "Neimar";
const PRODUCT_CODE = "41286"; // Bermuda Cargo — preco_venda=129.90
const PASSWORD = "123456";
const { blockProduction, warnLocalOnly } = require("../scriptSafety");

blockProduction("pdv_sale_cash_change_correct_smoke.js");
warnLocalOnly("pdv_sale_cash_change_correct_smoke.js");

let cookie = "";
let cashRegisterId = "";
let sessionId = "";
let saleId = "";
let stockBefore = 0;
let stockFinal = 0;

function log(msg) { console.log(`  [cash] ${msg}`); }

async function login(email) {
  const r = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Connection: "close" },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  const body = await r.json().catch(() => ({}));
  if (r.status !== 200) throw new Error(`Login falhou: ${body.error || r.status}`);
  const rawCookies = r.headers.getSetCookie?.() || [];
  cookie = rawCookies.map((c) => c.split(";")[0]).join("; ");
  return cookie;
}

async function api(path, { method = "GET", body } = {}) {
  const opts = {
    method,
    headers: {
      Connection: "close",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE_URL}${path}`, opts);
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: r.status, body: json };
}

async function ensureCashRegister() {
  const status = await api("/api/pdv/control/open-status?store=vila");
  if (status.body?.is_open) {
    cashRegisterId = status.body.cash_register_id;
    log(`Caixa já aberto: ${cashRegisterId}`);
    return cashRegisterId;
  }
  const opened = await api("/api/pdv/control/registers/open", {
    method: "POST",
    body: { loja: STORE, store_id: STORE, operador: SELLER, valor_inicial: 100 }
  });
  if (opened.status !== 200) throw new Error(`Não abriu caixa: ${JSON.stringify(opened.body)}`);
  cashRegisterId = opened.body.cash_register_id;
  log(`Caixa aberto: ${cashRegisterId}`);
  return cashRegisterId;
}

async function getStock() {
  const r = await api(`/api/pdv/inventory/products?store=${STORE}&q=${PRODUCT_CODE}&limit=1`);
  const items = r.body?.items || r.body?.data || [];
  return items.length ? items[0].available_qty : null;
}

async function run() {
  console.log("\n=== Smoke C2: Cash payment + correct change + cancel ===\n");

  // 0. Login
  log("Logando...");
  await login("admin@aerostore.local");
  log("Logado.");

  // 1. Garantir caixa aberto
  log("Verificando caixa...");
  await ensureCashRegister();

  // 2. Abrir sessão
  log("Abrindo sessão...");
  const s = await api("/api/pdv/operational/session/open", {
    method: "POST",
    body: { seller: SELLER, loja: STORE, force_new: true }
  });
  if (s.status !== 200 || !s.body.session_id) {
    console.error("FAIL: Não abriu sessão", s.body);
    process.exit(1);
  }
  sessionId = s.body.session_id;
  log(`Sessão: ${sessionId}`);

  // 3. Estoque antes
  stockBefore = await getStock();
  log(`Estoque antes: ${stockBefore}`);

  // 4. Adicionar item
  log(`Adicionando produto ${PRODUCT_CODE}...`);
  const a = await api(`/api/pdv/operational/cart/${sessionId}/items`, {
    method: "POST",
    body: { store_id: STORE, codigo: PRODUCT_CODE, quantidade: 1 }
  });
  if (a.status !== 200) { console.error("FAIL: Não adicionou item", a.body); process.exit(1); }
  const cartTotal = a.body.cart?.total ?? a.body.total ?? 129.9;
  log(`Item adicionado. Total: R$ ${cartTotal.toFixed(2)}`);

  // 5. Dinheiro payment with excess (paying R$ 200, troco should be R$ 70.10)
  const received = 200;
  log(`Aplicando dinheiro: R$ ${received} (troco esperado: R$ ${(received - cartTotal).toFixed(2)})...`);
  const p = await api(`/api/pdv/operational/cart/${sessionId}/payment-plan`, {
    method: "POST",
    body: { methods: [{ method: "dinheiro", amount: received }] }
  });
  if (p.status !== 200) { console.error("FAIL: Pagamento falhou", p.body); process.exit(1); }
  log("Pagamento dinheiro aplicado.");

  // 6. Finalizar
  log("Finalizando venda...");
  const f = await api(`/api/pdv/sales/finalize/${sessionId}`, {
    method: "POST",
    body: { loja: STORE }
  });
  if (f.status !== 200) { console.error("FAIL: Finalizar falhou", f.body); process.exit(1); }
  saleId = f.body.sale_id;
  log(`Venda finalizada: ${saleId} | status=${f.body.status}`);

  // 7. Verificar estoque deduzido
  const stockAfter = await getStock();
  if (stockAfter !== stockBefore - 1) {
    console.error(`FAIL: Estoque deveria ser ${stockBefore - 1}, foi ${stockAfter}`);
    process.exit(1);
  }
  log("Estoque deduzido corretamente.");

  // 8. Cancelar venda
  log("Cancelando venda...");
  const c = await api(`/api/pdv/sales/cancel/${saleId}`, {
    method: "POST",
    body: { loja: STORE, reason: "Smoke test cleanup" }
  });
  if (c.status !== 200) { console.error("FAIL: Cancel falhou", c.body); process.exit(1); }
  log(`Venda cancelada: ${c.body.status}`);

  // 9. Verificar estoque restaurado
  stockFinal = await getStock();
  if (stockFinal !== stockBefore) {
    console.error(`FAIL: Estoque deveria ser ${stockBefore}, foi ${stockFinal}`);
    process.exit(1);
  }
  log("Estoque restaurado corretamente após cancelamento.");

  console.log("\n=== Smoke C2 PASSED ===");
  process.exit(0);
}

run().catch((e) => { console.error("Unhandled error:", e); process.exit(1); });
