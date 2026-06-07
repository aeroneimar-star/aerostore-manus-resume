"use strict";

const assert = require("assert");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";
const MANAGER = {
  email: process.env.AEROSTORE_TEST_EMAIL || "gerente@aerostore.local",
  password: process.env.AEROSTORE_TEST_PASSWORD || "123456"
};

async function login() {
  const response = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(MANAGER)
  });
  const body = await response.json().catch(() => ({}));
  assert(response.ok, `Falha no login: ${body.error || response.status}`);
  const cookie = (response.headers.getSetCookie?.() || [])
    .map((item) => item.split(";")[0])
    .join("; ");
  assert(cookie, "Cookie de sessao ausente.");
  return cookie;
}

async function request(path, { method = "GET", cookie = "", body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
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

async function queryOne(sql, params = []) {
  const databasePath = process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "aerostore-crm.sqlite");
  const connection = new sqlite3.Database(databasePath);
  try {
    return await new Promise((resolve, reject) => {
      connection.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
    });
  } finally {
    await new Promise((resolve) => connection.close(() => resolve()));
  }
}

async function cleanupQaArtifacts() {
  const databasePath = process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "aerostore-crm.sqlite");
  const connection = new sqlite3.Database(databasePath);
  const allRows = (sql, params = []) => new Promise((resolve, reject) => {
    connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
  });
  const runSql = (sql, params = []) => new Promise((resolve, reject) => {
    connection.run(sql, params, function onRun(error) {
      return error ? reject(error) : resolve({ changes: this.changes });
    });
  });
  try {
    const products = await allRows(
      `SELECT p.id, p.legacy_ai_product_id, v.id AS variant_id
       FROM pdv_products_v2 p
       INNER JOIN pdv_product_variants v ON v.product_id = p.id
       WHERE p.base_sku LIKE 'QA-C2-API-%'`
    );
    const productIds = products.map((item) => item.id);
    const variantIds = products.map((item) => item.variant_id);
    const legacyIds = products.map((item) => item.legacy_ai_product_id).filter(Boolean);
    await runSql("PRAGMA foreign_keys = ON");
    await runSql("BEGIN IMMEDIATE");
    for (const productId of productIds) {
      await runSql("DELETE FROM pdv_product_audit_logs WHERE product_id = ?", [productId]);
    }
    for (const variantId of variantIds) {
      await runSql("DELETE FROM pdv_inventory_movements_v2 WHERE variant_id = ?", [variantId]);
      await runSql("DELETE FROM pdv_inventory_balances_v2 WHERE variant_id = ?", [variantId]);
      await runSql("DELETE FROM pdv_product_variants WHERE id = ?", [variantId]);
    }
    for (const productId of productIds) {
      await runSql("DELETE FROM pdv_products_v2 WHERE id = ?", [productId]);
    }
    for (const legacyId of legacyIds) {
      await runSql("DELETE FROM ai_product_brand_meta WHERE product_id = ?", [legacyId]);
      await runSql("DELETE FROM ai_product_media WHERE product_id = ?", [legacyId]);
      await runSql("DELETE FROM ai_products WHERE id = ?", [legacyId]);
    }
    await runSql("COMMIT");
  } catch (error) {
    await runSql("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    await new Promise((resolve) => connection.close(() => resolve()));
  }

  const pdvDataRoot = path.join(__dirname, "..", "data", "pdv");
  const jsonFiles = [];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(".json")) jsonFiles.push(target);
    }
  };
  visit(pdvDataRoot);

  const saleIds = new Set();
  for (const filePath of jsonFiles) {
    let value;
    try {
      value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(value)) continue;
    value.forEach((item) => {
      const serialized = JSON.stringify(item);
      if (serialized.includes("QA-C2-API-") && item?.sale_id) {
        saleIds.add(String(item.sale_id));
      }
    });
  }

  const markers = ["QA-C2-API-", ...saleIds];
  for (const filePath of jsonFiles) {
    let value;
    try {
      value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(value)) continue;
    const filtered = value.filter((item) => {
      const serialized = JSON.stringify(item);
      return !markers.some((marker) => marker && serialized.includes(marker));
    });
    if (filtered.length !== value.length) {
      fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2), "utf8");
    }
  }
}

async function ensureCashRegister(cookie) {
  const status = await request("/api/pdv/control/open-status?store=vila", { cookie });
  assert.strictEqual(status.status, 200, status.body.error || "Consulta do caixa deveria responder.");
  if (status.body.is_open) return status.body.cash_register_id;
  const opened = await request("/api/pdv/control/registers/open", {
    method: "POST",
    cookie,
    body: {
      loja: "vila",
      store_id: "vila",
      operador: "QA Ciclo 2",
      valor_inicial: 100
    }
  });
  assert.strictEqual(opened.status, 200, opened.body.error || "Caixa deveria abrir.");
  return opened.body.cash_register_id;
}

async function openSaleSession(cookie) {
  const opened = await request("/api/pdv/operational/session/open", {
    method: "POST",
    cookie,
    body: {
      seller: "QA Ciclo 2",
      loja: "vila",
      force_new: true
    }
  });
  assert.strictEqual(opened.status, 200, opened.body.error || "Sessao de venda deveria abrir.");
  return opened.body;
}

async function addItemAndPay(cookie, sessionId, product, quantity) {
  const added = await request(`/api/pdv/operational/cart/${sessionId}/items`, {
    method: "POST",
    cookie,
    body: {
      ...product,
      loja: "vila",
      store_id: "vila",
      selected_product_id: product.product_id,
      selected_inventory_id: product.inventory_id,
      quantidade: quantity
    }
  });
  assert.strictEqual(added.status, 200, added.body.error || "Produto deveria entrar no carrinho.");
  const amount = Number((Number(product.preco_venda) * quantity).toFixed(2));
  const payment = await request(`/api/pdv/operational/cart/${sessionId}/payment-plan`, {
    method: "POST",
    cookie,
    body: {
      methods: [{ method: "dinheiro", amount, installments: 1 }]
    }
  });
  assert.strictEqual(payment.status, 200, payment.body.error || "Pagamento deveria ser aceito.");
  return amount;
}

async function main() {
  const cookie = await login();
  const suffix = Date.now();
  const sku = `QA-C2-API-${suffix}`;
  let productId = "";

  try {
    const legacySearch = await request(
      "/api/pdv/operational/search/products?q=41286&store=vila&limit=20",
      { cookie }
    );
    assert.strictEqual(legacySearch.status, 200, legacySearch.body.error || "Busca de produto legado deveria responder.");
    assert(
      (legacySearch.body.items || []).some((item) => item.sku === "41286"),
      "Produto legado Tiny deve continuar aparecendo no PDV."
    );

    const missingName = await request("/api/products", {
      method: "POST",
      cookie,
      body: {
        name: "",
        commercial_name: "",
        price: 10,
        stock: 0,
        store: "vila",
        source: "manual"
      }
    });
    assert.strictEqual(missingName.status, 400, "Nome obrigatorio deve retornar erro de validacao.");

    const missingPrice = await request("/api/products", {
      method: "POST",
      cookie,
      body: {
        name: `QA Sem preco ${suffix}`,
        price: "",
        stock: 0,
        store: "vila",
        source: "manual"
      }
    });
    assert.strictEqual(missingPrice.status, 400, "Preco obrigatorio deve retornar erro de validacao.");

    const created = await request("/api/products", {
      method: "POST",
      cookie,
      body: {
        name: `QA Ciclo 2 API ${suffix}`,
        commercial_name: `QA Ciclo 2 API ${suffix}`,
        price: 49.9,
        cost_price: 20,
        stock: 3,
        store: "vila",
        status: "ativo",
        source: "manual",
        sku,
        codigo: sku,
        use_in_pos: 1
      }
    });
    assert.strictEqual(created.status, 201, created.body.error || "Cadastro deveria retornar 201.");
    productId = created.body.product?.id;
    assert(productId, "ID legado deve ser retornado.");
    assert(created.body.normalized?.product?.id, "Produto pai normalizado deve ser retornado.");
    assert(created.body.normalized?.variant?.id, "Variacao padrao deve ser retornada.");
    assert.strictEqual(created.body.normalized.variant.sku, sku);
    assert.strictEqual(created.body.normalized.balance.available_qty, 3);

    const searched = await request(
      `/api/pdv/operational/search/products?q=${encodeURIComponent(sku)}&store=vila&limit=20`,
      { cookie }
    );
    assert.strictEqual(searched.status, 200, searched.body.error || "Busca operacional deveria responder.");
    const matching = (searched.body.items || []).filter((item) => item.sku === sku);
    assert.strictEqual(matching.length, 1, "Busca deve mostrar um unico item para o produto simples.");
    assert.strictEqual(matching[0].product_id, created.body.normalized.variant.id);
    assert.strictEqual(matching[0].normalized_variant_id, created.body.normalized.variant.id);
    assert.strictEqual(matching[0].available_in_sale_store_qty, 3);
    assert.strictEqual(matching[0].operational_stock_status, "AVAILABLE_LOCAL");

    const updated = await request(`/api/products/${productId}`, {
      method: "PUT",
      cookie,
      body: {
        name: `QA Ciclo 2 API editado ${suffix}`,
        commercial_name: `QA Ciclo 2 API editado ${suffix}`,
        price: 59.9,
        cost_price: 25,
        stock: 999,
        store: "vila",
        status: "ativo",
        source: "manual",
        sku,
        codigo: sku,
        use_in_pos: 1
      }
    });
    assert.strictEqual(updated.status, 200, updated.body.error || "Edicao deveria responder 200.");
    assert.strictEqual(
      updated.body.normalized?.variant?.id,
      created.body.normalized.variant.id,
      "Edicao deve preservar a variacao."
    );
    assert.strictEqual(updated.body.normalized?.balance?.available_qty, 3, "Edicao nao pode aceitar estoque solto.");

    await ensureCashRegister(cookie);
    const saleSession = await openSaleSession(cookie);
    await addItemAndPay(cookie, saleSession.session_id, matching[0], 1);
    const finalized = await request(`/api/pdv/sales/finalize/${saleSession.session_id}`, {
      method: "POST",
      cookie,
      body: {
        loja: "vila",
        vendedor: "QA Ciclo 2"
      }
    });
    assert.strictEqual(finalized.status, 200, finalized.body.error || "Venda deveria finalizar.");
    assert(finalized.body.sale_id, "Venda finalizada deve retornar sale_id.");
    assert(
      (finalized.body.normalized_inventory_movements || []).length === 1,
      "Venda deve registrar movimento normalizado."
    );

    const afterSaleSearch = await request(
      `/api/pdv/operational/search/products?q=${encodeURIComponent(sku)}&store=vila&limit=20`,
      { cookie }
    );
    assert.strictEqual(afterSaleSearch.status, 200);
    const afterSaleProduct = (afterSaleSearch.body.items || []).find((item) => item.sku === sku);
    assert.strictEqual(afterSaleProduct.available_in_sale_store_qty, 2);

    const normalizedAfterSale = await queryOne(
      `SELECT b.available_qty,
              (SELECT COUNT(*)
               FROM pdv_inventory_movements_v2 m
               WHERE m.variant_id = b.variant_id AND m.movement_type = 'SALE_OUT') AS sale_movements
       FROM pdv_inventory_balances_v2 b
       WHERE b.variant_id = ? AND b.store_id = 'vila'`,
      [created.body.normalized.variant.id]
    );
    assert.strictEqual(normalizedAfterSale.available_qty, 2);
    assert.strictEqual(normalizedAfterSale.sale_movements, 1);

    const excessiveSession = await openSaleSession(cookie);
    await addItemAndPay(cookie, excessiveSession.session_id, afterSaleProduct, 3);
    const excessiveSale = await request(`/api/pdv/sales/finalize/${excessiveSession.session_id}`, {
      method: "POST",
      cookie,
      body: {
        loja: "vila",
        vendedor: "QA Ciclo 2"
      }
    });
    assert.strictEqual(excessiveSale.status, 400, "Venda acima do estoque deve ser bloqueada.");
    assert(/estoque|saldo|dispon.vel/i.test(excessiveSale.body.error || ""));

    const reservationSession = await openSaleSession(cookie);
    await addItemAndPay(cookie, reservationSession.session_id, afterSaleProduct, 1);
    const reserved = await request(`/api/pdv/operational/reservations/from-session/${reservationSession.session_id}`, {
      method: "POST",
      cookie,
      body: {
        loja: "vila",
        vendedor: "QA Ciclo 2",
        validade: "2099-12-31",
        observacoes: `Reserva ${sku}`
      }
    });
    assert.strictEqual(reserved.status, 200, reserved.body.error || "Reserva deveria ser criada.");
    assert.strictEqual(reserved.body.inventory_status, "HELD");

    const finalizedReservation = await request(`/api/pdv/sales/finalize/${reservationSession.session_id}`, {
      method: "POST",
      cookie,
      body: {
        loja: "vila",
        vendedor: "QA Ciclo 2"
      }
    });
    assert.strictEqual(finalizedReservation.status, 200, finalizedReservation.body.error || "Venda reservada deveria finalizar.");
    assert.strictEqual(
      (finalizedReservation.body.normalized_inventory_movements || []).length,
      1,
      "Venda reservada deve registrar a baixa normalizada."
    );

    const normalizedAfterReservation = await queryOne(
      `SELECT b.available_qty,
              (SELECT COUNT(*)
               FROM pdv_inventory_movements_v2 m
               WHERE m.variant_id = b.variant_id AND m.movement_type = 'SALE_OUT') AS sale_movements
       FROM pdv_inventory_balances_v2 b
       WHERE b.variant_id = ? AND b.store_id = 'vila'`,
      [created.body.normalized.variant.id]
    );
    assert.strictEqual(normalizedAfterReservation.available_qty, 1);
    assert.strictEqual(normalizedAfterReservation.sale_movements, 2);

    const hidden = await request(`/api/products/${productId}/hide`, {
      method: "POST",
      cookie
    });
    assert.strictEqual(hidden.status, 200, hidden.body.error || "Produto deveria ser bloqueado para venda.");
    const hiddenSearch = await request(
      `/api/pdv/operational/search/products?q=${encodeURIComponent(sku)}&store=vila&limit=20`,
      { cookie }
    );
    assert.strictEqual(
      (hiddenSearch.body.items || []).filter((item) => item.sku === sku).length,
      0,
      "Produto bloqueado nao pode aparecer na busca de venda."
    );

    const reactivated = await request(`/api/products/${productId}/reactivate`, {
      method: "POST",
      cookie
    });
    assert.strictEqual(reactivated.status, 200, reactivated.body.error || "Produto deveria ser reativado.");
    const reactivatedSearch = await request(
      `/api/pdv/operational/search/products?q=${encodeURIComponent(sku)}&store=vila&limit=20`,
      { cookie }
    );
    assert.strictEqual(
      (reactivatedSearch.body.items || []).filter((item) => item.sku === sku).length,
      1,
      "Produto ativo deve voltar a busca de venda."
    );

    console.log(JSON.stringify({
      ok: true,
      legacy_product_id: productId,
      normalized_product_id: created.body.normalized.product.id,
      variant_id: created.body.normalized.variant.id,
      sku,
      operational_inventory_id: matching[0].inventory_id,
      initial_stock: matching[0].available_in_sale_store_qty,
      sale_id: finalized.body.sale_id,
      stock_after_sale: afterSaleProduct.available_in_sale_store_qty,
      normalized_sale_movements: normalizedAfterSale.sale_movements,
      excessive_sale_blocked: true,
      reservation_sale_id: finalizedReservation.body.sale_id,
      stock_after_reserved_sale: normalizedAfterReservation.available_qty,
      normalized_reserved_sale_movements: normalizedAfterReservation.sale_movements,
      blocked_status_hidden_from_pdv: true,
      reactivated_status_visible_in_pdv: true,
      legacy_tiny_product_visible: true
    }, null, 2));
  } finally {
    if (productId) {
      await request(`/api/products/${productId}`, { method: "DELETE", cookie });
    }
    await cleanupQaArtifacts();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
