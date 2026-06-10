"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { all } = require("../db");

const inventoryServiceSource = fs.readFileSync(
  path.join(__dirname, "..", "modules", "pdv", "inventory", "pdvInventoryService.js"),
  "utf8"
);
const inventoryRoutesSource = fs.readFileSync(
  path.join(__dirname, "..", "modules", "pdv", "inventory", "pdvInventoryRoutes.js"),
  "utf8"
);
const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const dbSource = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const {
  adjustLegacyProductPrice,
  listInventoryProducts,
  searchInventoryProducts
} = require("../modules/pdv/inventory/pdvInventoryService");
const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const PASSWORD = process.env.AEROSTORE_TEST_PASSWORD || "123456";

async function request(pathname, { method = "GET", cookie = "", body } = {}) {
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

async function login(email) {
  const response = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Connection: "close" },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  const body = await response.json().catch(() => ({}));
  assert.strictEqual(response.status, 200, body.error || `Login deveria funcionar para ${email}.`);
  return (response.headers.getSetCookie?.() || []).map((item) => item.split(";")[0]).join("; ");
}

assert(
  /async function adjustLegacyProductPrice\(/.test(inventoryServiceSource),
  "Servico deve oferecer operacao dedicada de ajuste de preco legado."
);
assert(
  /router\.post\("\/price-adjust", canAdjustProductPrice/.test(inventoryRoutesSource),
  "Endpoint de ajuste de preco deve exigir permissao especifica."
);
assert(
  /can_adjust_product_price/.test(dbSource) && /can_adjust_product_price/.test(serverSource),
  "Permissao can_adjust_product_price deve existir nos defaults e catalogo."
);
assert(
  /function canAdjustPdvProductPriceFrontend\(\)/.test(appSource)
    && /data-pdv-stock-price-adjustment-form="true"/.test(appSource),
  "Tela de estoque deve expor formulario de preco somente para autorizado."
);
assert(
  /legacy_product_price_adjusted/.test(inventoryServiceSource)
    && /product_price_adjusted/.test(serverSource),
  "Ajuste deve gerar auditoria operacional e central identificavel."
);
assert(
  /UPDATE ai_products[\s\S]*?price = \?/.test(inventoryServiceSource),
  "Ajuste deve sincronizar o preco no catalogo ai_products para refletir no PDV Venda."
);

function findTiny41286() {
  return (listInventoryProducts({ q: "41286", limit: 20 }).items || []).find((item) =>
    [item.codigo_tiny, item.codigo, item.sku].some((value) => String(value || "") === "41286")
  ) || null;
}

async function main() {
  const before = findTiny41286();
  assert(before, "Tiny 41286 deve existir na massa local para validar o ajuste.");
  const previousPrice = Number(before.preco_venda || 0);
  const nextPrice = Number((previousPrice + 1.13).toFixed(2));
  const identityBefore = {
    product_id: before.product_id,
    sku: before.sku,
    codigo: before.codigo,
    codigo_tiny: before.codigo_tiny,
    nome: before.nome,
    source: before.source,
    foto: before.foto,
    photo_preview_url: before.photo_preview_url
  };
  const actor = {
    id: 999001,
    name: "QA Ajuste Preco Tiny",
    email: "qa.preco@aerostore.local",
    role: "manager"
  };

  try {
    const managerCookie = await login("gerente@aerostore.local");
    const sellerCookie = await login("vendedor@aerostore.local");
    const payload = {
      inventory_id: before.inventory_id,
      product_id: before.product_id,
      new_price: nextPrice,
      reason: "Smoke de ajuste operacional de preco Tiny"
    };
    const blocked = await request("/api/pdv/inventory/price-adjust", {
      method: "POST",
      cookie: sellerCookie,
      body: payload
    });
    assert.strictEqual(blocked.status, 403, "Vendedor comum nao deve ajustar preco importado.");

    const allowed = await request("/api/pdv/inventory/price-adjust", {
      method: "POST",
      cookie: managerCookie,
      body: payload
    });
    assert.strictEqual(allowed.status, 200, allowed.body.error || "Gestor deveria ajustar preco importado.");
    const result = allowed.body;
    assert.strictEqual(result.previous_price, previousPrice);
    assert.strictEqual(result.new_price, nextPrice);

    const after = findTiny41286();
    assert(after, "Tiny 41286 deve continuar existindo depois do ajuste.");
    assert.strictEqual(Number(after.preco_venda), nextPrice, "Listagem de estoque deve refletir o novo preco.");
    Object.entries(identityBefore).forEach(([key, value]) => {
      assert.strictEqual(after[key] || "", value || "", `Ajuste nao pode alterar ${key}.`);
    });

    const saleItem = searchInventoryProducts("41286", { limit: 20 }).find((item) =>
      [item.codigo_tiny, item.codigo, item.sku].some((value) => String(value || "") === "41286")
    );
    assert(saleItem, "Busca operacional de venda deve continuar encontrando Tiny 41286.");
    assert.strictEqual(Number(saleItem.preco_venda), nextPrice, "Busca da venda deve receber o preco ajustado.");

    const auditRows = await all(
      `SELECT user_email, user_role, product_id, reason, after_json
         FROM audit_logs
        WHERE module = 'inventory'
          AND action = 'product_price_adjusted'
          AND product_id = ?
        ORDER BY id DESC
        LIMIT 5`,
      [before.product_id]
    );
    const audit = auditRows.find((row) => String(row.user_email || "").toLowerCase() === "gerente@aerostore.local");
    assert(audit, "Auditoria central deve registrar o gestor que ajustou o preco.");
    const afterAudit = JSON.parse(audit.after_json || "{}");
    assert.strictEqual(Number(afterAudit.new_price), nextPrice, "Auditoria deve registrar o novo preco.");
    assert.strictEqual(Number(afterAudit.previous_price), previousPrice, "Auditoria deve registrar o preco anterior.");
  } finally {
    const current = findTiny41286();
    if (current && Number(current.preco_venda || 0) !== previousPrice) {
      await adjustLegacyProductPrice({
        inventory_id: current.inventory_id,
        product_id: current.product_id,
        new_price: previousPrice,
        reason: "Restauracao automatica do smoke de preco Tiny"
      }, actor);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    permission: "can_adjust_product_price",
    endpoint: "/api/pdv/inventory/price-adjust",
    product: "41286",
    price_restored: previousPrice,
    source_preserved: true,
    sale_price_sync: true,
    audit: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
