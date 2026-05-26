"use strict";

const assert = require("assert");
const { blockProduction, requireExplicitConfirmation, warnLocalOnly } = require("./scriptSafety");

blockProduction("stage827_product_photo_upload_smoke.js");
warnLocalOnly("stage827_product_photo_upload_smoke.js");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const ADMIN = { email: "admin@aerostore.local", password: "123456" };
const SELLER = { email: "vendedor@aerostore.local", password: "123456" };
const PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9kAAAAASUVORK5CYII=", "base64");

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
  assert(cookie, `Login de ${credentials.email} nao retornou sessao.`);
  return cookie;
}

async function request(path, { method = "GET", cookie = "", form } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
    body: form
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({}))
  };
}

function buildPhotoForm({ bytes = PNG_BYTES, type = "image/png", filename = "stage827-product-photo.png" } = {}) {
  const form = new FormData();
  form.append("photo", new Blob([bytes], { type }), filename);
  return form;
}

async function main() {
  requireExplicitConfirmation("--confirm");
  const adminCookie = await login(ADMIN);
  const sellerCookie = await login(SELLER);
  const candidates = await request("/api/products?withoutPhoto=1&limit=1", { cookie: adminCookie });
  assert.strictEqual(candidates.status, 200, "Admin deveria listar produto sem foto para o smoke.");
  const product = candidates.body?.items?.[0];
  assert(product?.id, "Smoke precisa de ao menos um produto sem foto.");

  const results = {
    product_id: product.id,
    admin_png: await request(`/api/products/${product.id}/photo`, {
      method: "POST",
      cookie: adminCookie,
      form: buildPhotoForm()
    })
  };
  assert.strictEqual(results.admin_png.status, 200, "Admin deveria subir PNG.");
  assert(results.admin_png.body?.product?.preview_url, "Upload deveria retornar preview_url.");

  results.admin_jpg = await request(`/api/products/${product.id}/photo`, {
    method: "POST",
    cookie: adminCookie,
    form: buildPhotoForm({ type: "image/jpeg", filename: "stage827-product-photo.jpg" })
  });
  assert.strictEqual(results.admin_jpg.status, 200, "Admin deveria subir JPG.");

  results.admin_webp = await request(`/api/products/${product.id}/photo`, {
    method: "POST",
    cookie: adminCookie,
    form: buildPhotoForm({ type: "image/webp", filename: "stage827-product-photo.webp" })
  });
  assert.strictEqual(results.admin_webp.status, 200, "Admin deveria subir WEBP.");

  results.invalid_file = await request(`/api/products/${product.id}/photo`, {
    method: "POST",
    cookie: adminCookie,
    form: buildPhotoForm({ bytes: Buffer.from("not-a-photo"), type: "text/plain", filename: "stage827.txt" })
  });
  assert.strictEqual(results.invalid_file.status, 400, "Arquivo invalido deveria bloquear.");

  results.oversize = await request(`/api/products/${product.id}/photo`, {
    method: "POST",
    cookie: adminCookie,
    form: buildPhotoForm({ bytes: Buffer.alloc((5 * 1024 * 1024) + 1), type: "image/jpeg", filename: "stage827-large.jpg" })
  });
  assert.strictEqual(results.oversize.status, 400, "Foto maior que 5MB deveria bloquear.");

  results.seller = await request(`/api/products/${product.id}/photo`, {
    method: "POST",
    cookie: sellerCookie,
    form: buildPhotoForm()
  });
  assert.strictEqual(results.seller.status, 403, "Seller nao deveria subir foto.");

  results.missing = await request("/api/products/999999999/photo", {
    method: "POST",
    cookie: adminCookie,
    form: buildPhotoForm()
  });
  assert.strictEqual(results.missing.status, 404, "Produto inexistente deveria retornar 404.");

  results.remove = await request(`/api/products/${product.id}/photo`, { method: "DELETE", cookie: adminCookie });
  assert.strictEqual(results.remove.status, 200, "Remocao do vinculo da foto deveria concluir.");
  assert.strictEqual(results.remove.body?.product?.preview_url || null, null, "Produto removido deveria voltar sem preview_url.");

  console.log(JSON.stringify({
    ok: true,
    product_id: product.id,
    status: {
      admin_png: results.admin_png.status,
      admin_jpg: results.admin_jpg.status,
      admin_webp: results.admin_webp.status,
      invalid_file: results.invalid_file.status,
      oversize: results.oversize.status,
      seller: results.seller.status,
      missing: results.missing.status,
      remove: results.remove.status
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
