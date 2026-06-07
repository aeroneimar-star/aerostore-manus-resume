"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const MANAGER = {
  email: process.env.AEROSTORE_TEST_EMAIL || "gerente@aerostore.local",
  password: process.env.AEROSTORE_TEST_PASSWORD || "123456"
};

async function request(urlPath, { method = "GET", cookie = "", body } = {}) {
  const response = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})),
    headers: response.headers
  };
}

async function login() {
  const response = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(MANAGER)
  });
  const body = await response.json().catch(() => ({}));
  assert(response.ok, body.error || "Login deveria funcionar.");
  const cookie = (response.headers.getSetCookie?.() || [])
    .map((item) => item.split(";")[0])
    .join("; ");
  assert(cookie, "Cookie de sessao ausente.");
  return cookie;
}

function assertFrontendSearchContract() {
  const source = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  assert(
    source.includes("pdvProducts.searchDebounce"),
    "Busca principal de /pdv/produtos deve ter debounce ao digitar."
  );
  assert(
    source.includes("schedulePdvProductsSearch"),
    "Digitar no campo de /pdv/produtos deve agendar busca automaticamente."
  );
  assert(
    source.includes("data-pdv-products-query-input"),
    "Campo principal de busca de produtos deve ter seletor estavel para input/Enter."
  );
  assert(
    source.includes("Nenhum produto encontrado para esta busca."),
    "Estado vazio de busca deve exibir mensagem especifica."
  );
}

async function main() {
  assertFrontendSearchContract();

  const cookie = await login();
  const existing = await request("/api/products?q=Camiseta%20Azul%20Surf%20Testex&page=1&limit=25", { cookie });
  assert.strictEqual(existing.status, 200, existing.body.error || "Busca por nome deveria responder.");
  assert.strictEqual(existing.body.pagination?.page, 1, "Busca deve voltar para a pagina 1.");
  assert(existing.body.pagination?.total >= 1, "Busca por produto existente deveria retornar resultado.");
  assert(
    (existing.body.items || []).some((item) => /Camiseta Azul Surf Testex/i.test(item.name || item.display_name || "")),
    "Busca por nome deveria localizar Camiseta Azul Surf Testex."
  );

  const missing = await request("/api/products?q=Produto%20Inexistente%20QA%20Busca%20999999&page=1&limit=25", { cookie });
  assert.strictEqual(missing.status, 200, missing.body.error || "Busca inexistente deveria responder.");
  assert.strictEqual(missing.body.pagination?.total, 0, "Busca inexistente deveria retornar total zero.");
  assert.strictEqual((missing.body.items || []).length, 0, "Busca inexistente nao deve retornar cards.");

  const tiny = await request("/api/products?q=41286&page=1&limit=25", { cookie });
  assert.strictEqual(tiny.status, 200, tiny.body.error || "Busca Tiny 41286 deveria responder.");
  assert((tiny.body.items || []).some((item) => item.legacy_adapter), "Tiny legado 41286 deve continuar localizavel.");

  const sku = await request("/api/products?q=AERO-000040&page=1&limit=25", { cookie });
  assert.strictEqual(sku.status, 200, sku.body.error || "Busca por SKU pai deveria responder.");
  assert(sku.body.pagination?.total >= 1, "Busca por SKU pai deveria retornar resultado.");

  const barcode = await request("/api/products?q=178083651749302&page=1&limit=25", { cookie });
  assert.strictEqual(barcode.status, 200, barcode.body.error || "Busca por barcode de variacao deveria responder.");
  assert(barcode.body.pagination?.total >= 1, "Busca por barcode de variacao deveria retornar resultado.");
  assert(
    (barcode.body.items || []).some((item) => (item.variants || []).some((variant) => String(variant.barcode || "").includes("178083651749302"))),
    "Busca por barcode deveria preservar produto pai agrupado com a variacao encontrada."
  );

  const brand = await request("/api/products?q=AEROSTORE&page=1&limit=25", { cookie });
  assert.strictEqual(brand.status, 200, brand.body.error || "Busca por marca deveria responder.");
  assert(brand.body.pagination?.total >= 1, "Busca por marca deveria retornar resultado.");

  console.log(JSON.stringify({
    ok: true,
    existing_total: existing.body.pagination.total,
    missing_total: missing.body.pagination.total,
    tiny_41286: true,
    sku_parent: true,
    variation_barcode: true,
    brand: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
