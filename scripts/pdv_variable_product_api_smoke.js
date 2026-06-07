"use strict";

const assert = require("assert");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";

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

async function login() {
  const response = await request("/api/login", {
    method: "POST",
    body: { email: "gerente@aerostore.local", password: "123456" }
  });
  assert.strictEqual(response.status, 200, response.body.error || "Login deveria funcionar.");
  const raw = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "gerente@aerostore.local", password: "123456" })
  });
  return (raw.headers.getSetCookie?.() || []).map((item) => item.split(";")[0]).join("; ");
}

async function ensureCashRegister(cookie) {
  const status = await request("/api/pdv/control/open-status?store=vila", { cookie });
  if (status.body.is_open) return;
  const opened = await request("/api/pdv/control/registers/open", {
    method: "POST",
    cookie,
    body: { loja: "vila", store_id: "vila", operador: "QA Ciclo 3", valor_inicial: 100 }
  });
  assert.strictEqual(opened.status, 200, opened.body.error || "Caixa deveria abrir.");
}

async function openSaleSession(cookie) {
  const opened = await request("/api/pdv/operational/session/open", {
    method: "POST",
    cookie,
    body: { seller: "QA Ciclo 3", loja: "vila", force_new: true }
  });
  assert.strictEqual(opened.status, 200, opened.body.error || "Sessao deveria abrir.");
  return opened.body;
}

async function addVariationAndPayment(cookie, sessionId, parent, variant, quantity = 1) {
  const added = await request(`/api/pdv/operational/cart/${sessionId}/items`, {
    method: "POST",
    cookie,
    body: {
      ...parent,
      ...variant,
      variation_id: variant.variation_id,
      product_id: variant.variation_id,
      selected_product_id: variant.variation_id,
      normalized_parent_product_id: parent.normalized_parent_product_id,
      normalized_product: true,
      loja: "vila",
      store_id: "vila",
      quantidade: quantity
    }
  });
  assert.strictEqual(added.status, 200, added.body.error || "Variacao deveria entrar no carrinho.");
  const payment = await request(`/api/pdv/operational/cart/${sessionId}/payment-plan`, {
    method: "POST",
    cookie,
    body: {
      methods: [{ method: "dinheiro", amount: Number((variant.preco_venda * quantity).toFixed(2)), installments: 1 }]
    }
  });
  assert.strictEqual(payment.status, 200, payment.body.error || "Pagamento deveria ser aceito.");
}

async function main() {
  const cookie = await login();
  const suffix = Date.now();
  const baseSku = `QA-C3-API-${suffix}`;

  const created = await request("/api/products", {
    method: "POST",
    cookie,
    body: {
      name: `QA Grade API ${suffix}`,
      commercial_name: `QA Grade API ${suffix}`,
      product_type: "variable",
      base_sku: baseSku,
      sku: baseSku,
      price: 99.9,
      cost_price: 40,
      store: "vila",
      status: "ativo",
      source: "manual",
      use_in_pos: 1,
      variants: [
        { color: "Verde", size: "P", initial_stock: 2, barcode: `${suffix}01` },
        { color: "Verde", size: "M", initial_stock: 4, barcode: `${suffix}02` },
        { color: "Preto", size: "M", initial_stock: 0, barcode: `${suffix}03` },
        { color: "Preto", size: "GG", initial_stock: 1, barcode: `${suffix}04` }
      ]
    }
  });
  assert.strictEqual(created.status, 201, created.body.error || "Grade deveria ser criada.");
  assert.strictEqual(created.body.normalized?.product?.product_type, "variable");
  assert.strictEqual(created.body.normalized?.variants?.length, 4);
  assert.strictEqual(created.body.operational_projection?.records?.length, 4);
  const legacyId = created.body.product.id;
  const verdeM = created.body.normalized.variants.find((item) => item.attribute_key === "VERDE|M");

  const detail = await request(`/api/products/${legacyId}`, { cookie });
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(detail.body.normalized.variants.length, 4);
  assert.strictEqual(detail.body.normalized.totals.physical_qty, 7);

  const search = await request(
    `/api/pdv/operational/search/products?q=${encodeURIComponent(baseSku)}&store=vila&limit=20`,
    { cookie }
  );
  assert.strictEqual(search.status, 200, search.body.error || "Busca deveria responder.");
  const parent = (search.body.items || []).find((item) => item.normalized_parent_product_id === created.body.normalized.product.id);
  assert(parent, "Busca deve retornar o pai normalizado agrupado.");
  assert.strictEqual(parent.variants.length, 4);
  assert.strictEqual(parent.available_qty, 7);
  const sellVerdeM = parent.variants.find((item) => item.variation_id === verdeM.variation_id);

  const barcodeSearch = await request(
    `/api/pdv/operational/search/products?q=${encodeURIComponent(`${suffix}02`)}&store=vila&limit=20`,
    { cookie }
  );
  assert.strictEqual(barcodeSearch.status, 200, barcodeSearch.body.error || "Busca por barcode deveria responder.");
  const barcodeParent = (barcodeSearch.body.items || []).find(
    (item) => item.normalized_parent_product_id === created.body.normalized.product.id
  );
  assert(barcodeParent, "Busca por barcode deve preservar o pai normalizado.");
  assert(barcodeParent.variants.some((item) => item.variation_id === verdeM.variation_id));

  const resolved = await request(
    `/api/pdv/products/resolve?identifier=${encodeURIComponent(`${suffix}02`)}&store=vila`,
    { cookie }
  );
  assert.strictEqual(resolved.status, 200);
  assert.strictEqual(resolved.body.variant.variation_id, verdeM.variation_id);
  assert.strictEqual(resolved.body.variant.available_qty, 4);

  await ensureCashRegister(cookie);
  const saleSession = await openSaleSession(cookie);
  await addVariationAndPayment(cookie, saleSession.session_id, parent, sellVerdeM, 1);
  const finalized = await request(`/api/pdv/sales/finalize/${saleSession.session_id}`, {
    method: "POST",
    cookie,
    body: { loja: "vila", vendedor: "QA Ciclo 3" }
  });
  assert.strictEqual(finalized.status, 200, finalized.body.error || "Venda da variacao deveria finalizar.");
  assert.strictEqual(finalized.body.normalized_inventory_movements.length, 1);
  const afterSale = await request(
    `/api/pdv/products/resolve?identifier=${encodeURIComponent(`${suffix}02`)}&store=vila`,
    { cookie }
  );
  assert.strictEqual(afterSale.body.variant.physical_qty, 3);

  const reservationSession = await openSaleSession(cookie);
  await addVariationAndPayment(cookie, reservationSession.session_id, parent, {
    ...sellVerdeM,
    physical_qty: 3,
    available_qty: 3
  }, 1);
  const reserved = await request(`/api/pdv/operational/reservations/from-session/${reservationSession.session_id}`, {
    method: "POST",
    cookie,
    body: { loja: "vila", vendedor: "QA Ciclo 3", validade: "2099-12-31" }
  });
  assert.strictEqual(reserved.status, 200, reserved.body.error || "Reserva normalizada deveria ser criada.");
  assert.strictEqual(reserved.body.normalized_holds.length, 1);
  const afterHold = await request(
    `/api/pdv/products/resolve?identifier=${encodeURIComponent(`${suffix}02`)}&store=vila`,
    { cookie }
  );
  assert.strictEqual(afterHold.body.variant.physical_qty, 3);
  assert.strictEqual(afterHold.body.variant.reserved_qty, 1);
  assert.strictEqual(afterHold.body.variant.available_qty, 2);
  const converted = await request(`/api/pdv/sales/finalize/${reservationSession.session_id}`, {
    method: "POST",
    cookie,
    body: { loja: "vila", vendedor: "QA Ciclo 3" }
  });
  assert.strictEqual(converted.status, 200, converted.body.error || "Reserva deveria converter em venda.");
  assert.strictEqual(converted.body.normalized_inventory_movements.length, 1);
  const afterConversion = await request(
    `/api/pdv/products/resolve?identifier=${encodeURIComponent(`${suffix}02`)}&store=vila`,
    { cookie }
  );
  assert.strictEqual(afterConversion.body.variant.physical_qty, 2);
  assert.strictEqual(afterConversion.body.variant.reserved_qty, 0);

  const blockedVariant = created.body.normalized.variants.find((item) => item.attribute_key === "PRETO|M");
  const blocked = await request(
    `/api/pdv/products/${created.body.normalized.product.id}/variants/${blockedVariant.variation_id}/status`,
    { method: "POST", cookie, body: { status: "bloqueado_para_venda" } }
  );
  assert.strictEqual(blocked.status, 200, blocked.body.error || "Variacao deveria ser bloqueada.");
  const positiveVariant = created.body.normalized.variants.find((item) => item.attribute_key === "PRETO|GG");
  const inactiveWithStock = await request(
    `/api/pdv/products/${created.body.normalized.product.id}/variants/${positiveVariant.variation_id}/status`,
    { method: "POST", cookie, body: { status: "inativo" } }
  );
  assert.strictEqual(inactiveWithStock.status, 409);
  assert(/possui 1 unidades.*saldo para zero/i.test(inactiveWithStock.body.error || ""));

  const parentResolve = await request(
    `/api/pdv/products/resolve?identifier=${encodeURIComponent(baseSku)}&store=vila`,
    { cookie }
  );
  assert.strictEqual(parentResolve.status, 404, "SKU do pai nao pode resolver item vendavel.");

  const duplicate = await request("/api/products", {
    method: "POST",
    cookie,
    body: {
      name: `QA Grade duplicada ${suffix}`,
      product_type: "variable",
      base_sku: baseSku,
      price: 10,
      store: "vila",
      source: "manual",
      variants: [{ color: "Verde", size: "M", initial_stock: 1 }]
    }
  });
  assert.strictEqual(duplicate.status, 409);
  assert.strictEqual(duplicate.body.code, "VARIANT_SKU_CONFLICT");
  assert(new RegExp(`Ja existe uma variacao com o SKU ${baseSku}-VERDE-M`, "i").test(duplicate.body.error));

  console.log(JSON.stringify({
    ok: true,
    legacy_product_id: legacyId,
    normalized_product_id: created.body.normalized.product.id,
    variation_id: verdeM.variation_id,
    grouped_variations: parent.variants.length,
    available_qty: parent.available_qty,
    sold_variation: verdeM.variation_id,
    reserved_and_converted: true,
    positive_stock_inactivation_blocked: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
