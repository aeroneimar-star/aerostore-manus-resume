"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

function assertFrontendRejectsStaleStockResponses() {
  const appPath = path.join(__dirname, "..", "public", "app.js");
  const source = fs.readFileSync(appPath, "utf8");
  const stockStateStart = source.indexOf("pdvStock: {");
  const stockStateEnd = source.indexOf("aerointel: {", stockStateStart);
  const stockState = stockStateStart >= 0 && stockStateEnd > stockStateStart
    ? source.slice(stockStateStart, stockStateEnd)
    : "";
  const filterStart = source.indexOf("function applyPdvStockFiltersFromForm(formElement)");
  const filterEnd = source.indexOf("async function submitPdvStockAdjustment", filterStart);
  const loaderStart = source.indexOf("async function loadPdvStockFront(options = {})");
  const loaderEnd = source.indexOf("function getDefaultAerointelStoreFilter", loaderStart);
  const filterApply = filterStart >= 0 && filterEnd > filterStart ? source.slice(filterStart, filterEnd) : "";
  const loader = loaderStart >= 0 && loaderEnd > loaderStart ? source.slice(loaderStart, loaderEnd) : "";

  assert(
    /loadingRequestId:\s*0/.test(stockState),
    "Estado de estoque deve possuir loadingRequestId para ordenar respostas concorrentes."
  );
  assert(
    /const requestId = Number\(state\.pdvStock\.loadingRequestId \|\| 0\) \+ 1;/.test(loader),
    "Carga de estoque deve gerar um requestId monotônico."
  );
  assert(
    /if \(state\.pdvStock\.loadingRequestId !== requestId\) return;/.test(loader),
    "Carga de estoque deve ignorar respostas antigas antes de atualizar a UI."
  );
  assert(
    /state\.pdvStock\.items = \[\];/.test(filterApply)
      && /total:\s*0/.test(filterApply),
    "Nova busca deve limpar itens e total antigos antes de renderizar o estado de carregamento."
  );
}

function findByCode(items = [], code = "") {
  return (items || []).filter((item) => [
    item.sku,
    item.codigo,
    item.codigo_tiny,
    item.codigo_etiqueta,
    item.codigo_interno,
    item.codigo_barras,
    item.ean
  ].some((value) => String(value || "").includes(code)));
}

async function main() {
  assertFrontendRejectsStaleStockResponses();
  const cookie = await login();

  const general = await request("/api/pdv/inventory/products?store=vila&page=1&limit=25", { cookie });
  assert.strictEqual(general.status, 200, general.body.error || "Listagem geral deveria responder.");
  assert(Number(general.body.pagination?.total || 0) > 25, "Massa geral deveria ter mais de uma página.");

  const tiny = await request("/api/pdv/inventory/products?q=41286&store=vila&page=1&limit=25", { cookie });
  assert.strictEqual(tiny.status, 200, tiny.body.error || "Busca Tiny deveria responder.");
  assert(findByCode(tiny.body.items, "41286").length >= 1, "Tiny 41286 deveria aparecer na busca filtrada.");
  assert(
    Number(tiny.body.pagination?.total || 0) < Number(general.body.pagination?.total || 0),
    "Total filtrado não pode permanecer igual ao total global."
  );

  const missing = await request(
    `/api/pdv/inventory/products?q=${encodeURIComponent("ZZZ-PRODUTO-INEXISTENTE-999")}&store=vila&page=1&limit=25`,
    { cookie }
  );
  assert.strictEqual(missing.status, 200, missing.body.error || "Busca inexistente deveria responder.");
  assert.strictEqual(Number(missing.body.pagination?.total || 0), 0, "Busca inexistente deveria retornar total zero.");
  assert.strictEqual((missing.body.items || []).length, 0, "Busca inexistente não deveria retornar itens.");

  console.log(JSON.stringify({
    ok: true,
    general_total: Number(general.body.pagination?.total || 0),
    tiny_total: Number(tiny.body.pagination?.total || 0),
    tiny_matches: findByCode(tiny.body.items, "41286").length,
    missing_total: Number(missing.body.pagination?.total || 0),
    stale_response_guard: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
