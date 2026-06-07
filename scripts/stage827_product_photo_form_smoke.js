"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

assert.match(
  appSource,
  /data-pdv-product-photo-file="true"\s+type="file"\s+accept="[^"]*image\/jpeg[^"]*image\/png[^"]*image\/webp[^"]*"/,
  "O cadastro deve manter um input de foto com os formatos de imagem aceitos."
);

const photoInputMarkup = appSource.match(
  /<input data-pdv-product-photo-file="true"[^>]+>/
)?.[0] || "";

assert(photoInputMarkup, "O input de foto do produto deve existir.");
assert(
  !photoInputMarkup.includes('canUploadPhoto ? "" : " disabled"'),
  "O seletor de foto nao pode ficar desabilitado durante a criacao do produto."
);
assert.match(
  appSource,
  /drawerPhotoFile\s*=\s*file/,
  "A foto selecionada deve ser preservada no estado do formulario."
);
assert.match(
  appSource,
  /const pendingPhotoFile\s*=\s*state\.pdvProducts\.drawerPhotoFile/,
  "O salvamento deve capturar a foto pendente antes de renderizar o formulario."
);
assert.match(
  appSource,
  /await uploadPdvProductPhoto\([^;]*pendingPhotoFile/,
  "Depois de criar o produto, o fluxo deve enviar a foto pendente usando o ID retornado."
);

console.log("Product photo form smoke: OK");

async function runIntegration() {
  const baseUrl = process.env.AEROSTORE_BASE_URL || "http://127.0.0.1:3000";
  const credentials = {
    email: process.env.AEROSTORE_TEST_EMAIL || "gerente@aerostore.local",
    password: process.env.AEROSTORE_TEST_PASSWORD || "123456"
  };
  const loginResponse = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials)
  });
  const loginBody = await loginResponse.json().catch(() => ({}));
  assert(loginResponse.ok, `Falha no login local: ${loginBody.error || loginResponse.status}`);
  const cookie = (loginResponse.headers.getSetCookie?.() || [])
    .map((item) => item.split(";")[0])
    .join("; ");
  assert(cookie, "Login local nao retornou cookie de sessao.");

  const request = async (urlPath, options = {}) => {
    const response = await fetch(`${baseUrl}${urlPath}`, {
      ...options,
      headers: {
        Cookie: cookie,
        ...(options.headers || {})
      }
    });
    return {
      status: response.status,
      body: await response.json().catch(() => ({}))
    };
  };

  const suffix = Date.now();
  const createdIds = [];
  try {
    const createWithPhoto = await request("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `QA Foto Produto ${suffix}`,
        commercial_name: `QA Foto ${suffix}`,
        category: "QA",
        price: 10,
        stock: 1,
        store: "vila_masc",
        source: "manual",
        auto_generate_code: 1,
        use_in_ai: 0,
        use_in_pos: 0
      })
    });
    assert.strictEqual(createWithPhoto.status, 201, createWithPhoto.body.error || "Produto com foto deveria ser criado.");
    createdIds.push(createWithPhoto.body.product.id);

    const imageBytes = fs.readFileSync(
      path.join(__dirname, "..", "public", "assets", "labels", "argox-tag-40x60-2c-mockup.png")
    );
    const photoForm = new FormData();
    photoForm.append("photo", new Blob([imageBytes], { type: "image/png" }), "qa-product-photo.png");
    const uploadPhoto = await request(`/api/products/${createWithPhoto.body.product.id}/photo`, {
      method: "POST",
      body: photoForm
    });
    assert.strictEqual(uploadPhoto.status, 200, uploadPhoto.body.error || "Foto deveria ser enviada depois da criacao.");
    assert(uploadPhoto.body.product?.preview_url, "Produto deveria retornar preview_url depois do upload.");

    const updateProduct = await request(`/api/products/${createWithPhoto.body.product.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `QA Foto Produto Editado ${suffix}`,
        commercial_name: `QA Foto ${suffix}`,
        category: "QA",
        price: 10,
        stock: 1,
        store: "vila_masc",
        source: "manual",
        sku: createWithPhoto.body.product.sku,
        codigo: createWithPhoto.body.product.codigo_interno,
        auto_generate_code: 0,
        use_in_ai: 0,
        use_in_pos: 0
      })
    });
    assert.strictEqual(updateProduct.status, 200, updateProduct.body.error || "Produto com foto deveria permitir edicao.");

    const reopened = await request(`/api/products/${createWithPhoto.body.product.id}`);
    assert.strictEqual(reopened.status, 200, reopened.body.error || "Produto deveria reabrir.");
    assert(reopened.body.product?.preview_url, "Foto deveria continuar vinculada depois da edicao.");

    const createWithoutPhoto = await request("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `QA Produto Sem Foto ${suffix}`,
        commercial_name: `QA Sem Foto ${suffix}`,
        category: "QA",
        price: 10,
        stock: 0,
        store: "vila_masc",
        source: "manual",
        auto_generate_code: 1,
        use_in_ai: 0,
        use_in_pos: 0
      })
    });
    assert.strictEqual(createWithoutPhoto.status, 201, createWithoutPhoto.body.error || "Produto sem foto deveria salvar.");
    createdIds.push(createWithoutPhoto.body.product.id);
    assert(!createWithoutPhoto.body.product.preview_url, "Produto sem foto nao deveria inventar preview.");

    console.log("Product photo integration smoke: OK");
  } finally {
    for (const id of createdIds.reverse()) {
      await request(`/api/products/${id}`, { method: "DELETE" });
    }
  }
}

if (process.argv.includes("--integration")) {
  runIntegration().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
