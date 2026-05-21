"use strict";

const assert = require("assert");
const {
  projectInventoryProductPhotos
} = require("../modules/pdv/inventory/pdvInventoryPhotoProjectionService");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const USERS = {
  admin: { email: "admin@aerostore.local", password: "123456" },
  managerVila: { email: "gerente@aerostore.local", password: "123456" },
  sellerBotanico: { email: "vendedor@aerostore.local", password: "123456" }
};
const PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9kAAAAASUVORK5CYII=", "base64");

function assertStatus(result, expected, message) {
  assert.strictEqual(result.status, expected, `${message}: ${result.status} ${result.body?.error || ""}`);
}

async function login(credentials) {
  const response = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials)
  });
  const body = await response.json().catch(() => ({}));
  assert(response.ok, `Falha no login de ${credentials.email}: ${body.error || response.status}`);
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const cookie = cookies.map((item) => item.split(";")[0]).join("; ");
  assert(cookie, `Sessao ausente para ${credentials.email}.`);
  return cookie;
}

async function request(path, { method = "GET", cookie = "", body, form } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : form
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({}))
  };
}

function buildPhotoForm() {
  const form = new FormData();
  form.append("photo", new Blob([PNG_BYTES], { type: "image/png" }), "stage828-stock-photo.png");
  return form;
}

function validatePureProjectionRules() {
  const products = [
    { id: 82801, sku: "SKU-SAFE", codigo: "COD-SAFE", gtin_ean: "7898280100001", main_media_id: 82801 },
    { id: 82802, sku: "SKU-AMBIGUO", codigo: "COD-A", main_media_id: 82802 },
    { id: 82803, sku: "SKU-AMBIGUO", codigo: "COD-B", main_media_id: 82803 }
  ];
  const logs = [];
  const logger = { warn: (...args) => logs.push(args) };
  const rows = projectInventoryProductPhotos([
    { product_id: "AI_82801", sku: "OUTRO" },
    { sku: "SKU-SAFE" },
    { codigo_interno: "COD-SAFE" },
    { codigo_barras: "7898280100001" },
    { sku: "SKU-SAFE", photo_preview_url: "/snapshot/proprio.png" },
    { sku: "SKU-AMBIGUO" },
    { sku: "SEM-FOTO" }
  ], products, logger);

  assert.strictEqual(rows[0].photo_projection_match_by, "product_id", "product_id deveria ser o primeiro match seguro.");
  assert.strictEqual(rows[1].photo_projection_match_by, "sku", "SKU deveria projetar foto.");
  assert.strictEqual(rows[2].photo_projection_match_by, "codigo_interno", "Codigo interno deveria projetar foto.");
  assert.strictEqual(rows[3].photo_projection_match_by, "barcode", "Barcode deveria projetar foto.");
  assert.strictEqual(rows[4].photo_preview_url_resolved, "/snapshot/proprio.png", "Foto propria do snapshot nao deve ser sobrescrita.");
  assert.strictEqual(rows[4].photo_source, "inventory_snapshot", "Foto propria deve manter origem do snapshot.");
  assert.strictEqual(rows[5].photo_projection_status, "ambiguous", "Match ambiguo nao deve projetar foto.");
  assert.strictEqual(Boolean(rows[5].photo_preview_url_resolved), false, "Match ambiguo nao deve devolver foto resolvida.");
  assert.strictEqual(Boolean(rows[6].photo_preview_url_resolved), false, "Produto sem foto deve manter placeholder.");
  assert(logs.length > 0, "Match ambiguo deveria registrar warning tecnico.");
}

async function findStockCandidate(cookie) {
  const stock = await request("/api/pdv/inventory/products?store=vila_masc", { cookie });
  assertStatus(stock, 200, "Admin deveria listar estoque Vila");
  for (const item of stock.body?.items || []) {
    if (!item?.sku || item.photo_preview_url || item.photo_preview_url_resolved) continue;
    const catalog = await request(`/api/products?q=${encodeURIComponent(item.sku)}&limit=5`, { cookie });
    assertStatus(catalog, 200, "Admin deveria consultar catalogo para escolher candidato");
    const duplicate = (catalog.body?.items || []).some((product) => String(product.sku || "").toUpperCase() === String(item.sku || "").toUpperCase());
    if (!duplicate) return item;
  }
  throw new Error("Nao encontrei item de estoque sem foto e sem produto cadastral duplicado para o smoke.");
}

async function main() {
  validatePureProjectionRules();

  const adminCookie = await login(USERS.admin);
  const managerCookie = await login(USERS.managerVila);
  const sellerCookie = await login(USERS.sellerBotanico);
  const candidate = await findStockCandidate(adminCookie);
  let createdProductId = "";

  try {
    const create = await request("/api/products", {
      method: "POST",
      cookie: adminCookie,
      body: {
        sku: candidate.sku,
        codigo: candidate.codigo || candidate.codigo_interno || candidate.sku,
        name: `Stage 828 ${candidate.nome || candidate.sku}`,
        commercial_name: `Stage 828 ${candidate.sku}`,
        category: candidate.categoria || "Teste smoke",
        price: 1,
        stock: 0,
        source: "manual",
        use_in_ai: 0,
        use_in_pos: 0
      }
    });
    assertStatus(create, 201, "Admin deveria criar produto temporario para projecao");
    createdProductId = String(create.body?.product?.id || "");
    assert(createdProductId, "Produto temporario deveria ter id.");

    const upload = await request(`/api/products/${createdProductId}/photo`, {
      method: "POST",
      cookie: adminCookie,
      form: buildPhotoForm()
    });
    assertStatus(upload, 200, "Produto temporario deveria receber foto");

    const projected = await request(`/api/pdv/inventory/products?store=vila_masc&q=${encodeURIComponent(candidate.sku)}`, { cookie: adminCookie });
    assertStatus(projected, 200, "Estoque deveria responder com projecao");
    const projectedItem = (projected.body?.items || []).find((item) => String(item.sku || "") === String(candidate.sku || ""));
    assert(projectedItem, "Item do estoque candidato deveria voltar.");
    assert.strictEqual(projectedItem.photo_source, "product_profile", "Item sem foto propria deveria usar foto do cadastro.");
    assert(projectedItem.photo_preview_url_resolved, "Item projetado deveria conter URL resolvida.");
    assert.strictEqual(Boolean(projectedItem.photo_preview_url), false, "Projecao nao deveria persistir/sobrescrever photo_preview_url bruto.");

    const ownPhoto = await request("/api/pdv/inventory/products", { cookie: adminCookie });
    assertStatus(ownPhoto, 200, "Item com foto propria deveria ser consultavel");
    const ownPhotoItem = (ownPhoto.body?.items || []).find((item) => item.photo_preview_url);
    assert(ownPhotoItem, "Smoke precisa de item de estoque com foto propria.");
    assert.strictEqual(ownPhotoItem.photo_preview_url_resolved, ownPhotoItem.photo_preview_url, "Foto propria do estoque deve prevalecer.");
    assert.strictEqual(ownPhotoItem.photo_source, "inventory_snapshot", "Foto propria deve indicar snapshot.");

    const managerOwn = await request(`/api/pdv/inventory/products?store=vila_masc&q=${encodeURIComponent(candidate.sku)}`, { cookie: managerCookie });
    assertStatus(managerOwn, 200, "Manager Vila deveria manter acesso ao proprio estoque.");
    const managerOutside = await request("/api/pdv/inventory/products?store=botanico", { cookie: managerCookie });
    assertStatus(managerOutside, 403, "Manager Vila nao deve ler estoque fora do escopo.");
    const sellerOutside = await request("/api/pdv/inventory/products?store=vila_masc", { cookie: sellerCookie });
    assertStatus(sellerOutside, 403, "Seller Botanico nao deve ler estoque Vila.");

    console.log(JSON.stringify({
      ok: true,
      candidate_sku: candidate.sku,
      projected_match: projectedItem.photo_projection_match_by,
      own_photo_source: ownPhotoItem.photo_source,
      scoping: {
        manager_own: managerOwn.status,
        manager_outside: managerOutside.status,
        seller_outside: sellerOutside.status
      }
    }, null, 2));
  } finally {
    if (createdProductId) {
      await request(`/api/products/${createdProductId}/photo`, { method: "DELETE", cookie: adminCookie });
      await request(`/api/products/${createdProductId}`, { method: "DELETE", cookie: adminCookie });
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
