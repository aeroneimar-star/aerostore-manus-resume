"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.AEROSTORE_BASE_URL || "http://localhost:3000";

async function request(pathname, { method = "GET", cookie = "", body, form } = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: form || (body ? JSON.stringify(body) : undefined)
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
    body: JSON.stringify({ email: "gerente@aerostore.local", password: "123456" })
  });
  const body = await response.json().catch(() => ({}));
  assert.strictEqual(response.status, 200, body.error || "Login deveria funcionar.");
  return (response.headers.getSetCookie?.() || []).map((item) => item.split(";")[0]).join("; ");
}

async function openSaleSession(cookie) {
  const opened = await request("/api/pdv/operational/session/open", {
    method: "POST",
    cookie,
    body: { seller: "QA Ciclo 4.7", loja: "vila", force_new: true }
  });
  assert.strictEqual(opened.status, 200, opened.body.error || "Sessao deveria abrir.");
  return opened.body.session_id;
}

async function ensureCashRegister(cookie) {
  const status = await request("/api/pdv/control/open-status?store=vila", { cookie });
  if (status.body.is_open) return;
  const opened = await request("/api/pdv/control/registers/open", {
    method: "POST",
    cookie,
    body: { loja: "vila", store_id: "vila", operador: "QA Ciclo 4.7", valor_inicial: 100 }
  });
  assert.strictEqual(opened.status, 200, opened.body.error || "Caixa deveria abrir.");
}

async function attachCustomer(cookie, sessionId, suffix) {
  const attached = await request(`/api/pdv/operational/session/${sessionId}/customer`, {
    method: "POST",
    cookie,
    body: {
      master_customer_id: `QA-C47-CUSTOMER-${suffix}`,
      name: `QA Cliente Produto Manual ${suffix}`,
      phone: `119${String(suffix).slice(-8).padStart(8, "0")}`,
      origin: "qa"
    }
  });
  assert.strictEqual(attached.status, 200, attached.body.error || "Cliente deveria ser vinculado.");
  return attached.body;
}

async function addVariationToCart(cookie, sessionId, parent, variant, quantity = 1) {
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
  return added.body;
}

async function addPaymentPlan(cookie, sessionId, amount) {
  const payment = await request(`/api/pdv/operational/cart/${sessionId}/payment-plan`, {
    method: "POST",
    cookie,
    body: { methods: [{ method: "dinheiro", amount, installments: 1 }] }
  });
  assert.strictEqual(payment.status, 200, payment.body.error || "Pagamento deveria ser aceito.");
  return payment.body;
}

async function resolveVariant(cookie, identifier) {
  const resolved = await request(
    `/api/pdv/products/resolve?identifier=${encodeURIComponent(identifier)}&store=vila`,
    { cookie }
  );
  assert.strictEqual(resolved.status, 200, resolved.body.error || `Variacao ${identifier} deveria resolver.`);
  return resolved.body.variant;
}

function findParent(items = [], productId) {
  return items.find((item) => Number(item.normalized_parent_product_id) === Number(productId));
}

async function searchProduct(cookie, query) {
  const response = await request(
    `/api/pdv/operational/search/products?q=${encodeURIComponent(query)}&store=vila&limit=20`,
    { cookie }
  );
  assert.strictEqual(response.status, 200, response.body.error || `Busca ${query} deveria responder.`);
  return response.body.items || [];
}

async function main() {
  const cookie = await login();
  const shortCode = String((Date.now() % 900000) + 100000).padStart(6, "0");
  const baseSku = `AERO-${shortCode}`;
  const barcode = `${Date.now()}47`;
  const productName = `QA Manual Normalizado ${shortCode}`;
  const normalPrice = 129.9;
  const promoPrice = 79.9;

  const created = await request("/api/products", {
    method: "POST",
    cookie,
    body: {
      name: productName,
      commercial_name: productName,
      product_type: "variable",
      base_sku: baseSku,
      sku: baseSku,
      price: normalPrice,
      promotional_price: promoPrice,
      cost_price: 30,
      store: "vila",
      status: "ativo",
      source: "manual",
      use_in_pos: 1,
      variants: [
        { color: "Azul", size: "P", initial_stock: 2, barcode },
        { color: "Azul", size: "M", initial_stock: 2, barcode: `${barcode}1` }
      ]
    }
  });
  assert.strictEqual(created.status, 201, created.body.error || "Produto manual normalizado deveria ser criado.");
  const legacyId = created.body.product.id;
  const normalizedProductId = created.body.normalized.product.id;

  const imageBytes = fs.readFileSync(
    path.join(__dirname, "..", "public", "assets", "labels", "argox-tag-40x60-2c-mockup.png")
  );
  const photoForm = new FormData();
  photoForm.append("photo", new Blob([imageBytes], { type: "image/png" }), "qa-product-photo.png");
  const upload = await request(`/api/products/${legacyId}/photo`, { method: "POST", cookie, form: photoForm });
  assert.strictEqual(upload.status, 200, upload.body.error || "Foto deveria ser enviada.");
  assert(upload.body.product?.preview_url, "Upload deve retornar preview_url.");

  const byFullSku = findParent(await searchProduct(cookie, baseSku), normalizedProductId);
  assert(byFullSku, "Busca por codigo completo deve retornar o pai normalizado.");

  const byShortSku = findParent(await searchProduct(cookie, shortCode), normalizedProductId);
  assert(byShortSku, "Busca por codigo curto deve retornar o pai normalizado.");

  const byName = findParent(await searchProduct(cookie, productName), normalizedProductId);
  assert(byName, "Busca por nome deve retornar o pai normalizado.");

  const byBarcode = findParent(await searchProduct(cookie, barcode), normalizedProductId);
  assert(byBarcode, "Busca por barcode da variacao deve retornar o pai normalizado.");

  const imageUrl = byFullSku.photo_preview_url || byFullSku.preview_url || byFullSku.image || byFullSku.foto || "";
  assert(imageUrl, "Card da busca no PDV Venda deve expor a foto principal.");
  assert.strictEqual(Number(byFullSku.original_price || byFullSku.compare_at_price), normalPrice);
  assert.strictEqual(Number(byFullSku.promotional_price || byFullSku.promotionalPrice), promoPrice);
  assert.strictEqual(Number(byFullSku.preco_venda || byFullSku.price), promoPrice, "Card deve usar preco promocional ativo.");
  assert.strictEqual(Boolean(byFullSku.used_promotional_price), true);

  const variantP = byFullSku.variants.find((item) => item.size === "P" || item.tamanho === "P");
  const variantM = byFullSku.variants.find((item) => item.size === "M" || item.tamanho === "M");
  assert(variantP?.variation_id, "Produto com uma cor deve carregar variacao P selecionavel.");
  assert(variantM?.variation_id, "Produto com uma cor deve carregar variacao M selecionavel.");
  assert.strictEqual(Number(variantP.preco_venda || variantP.price), promoPrice, "Variacao deve carregar preco promocional.");

  await ensureCashRegister(cookie);
  const sessionId = await openSaleSession(cookie);
  const cart = await addVariationToCart(cookie, sessionId, byFullSku, variantP, 1);
  const cartItem = (cart.cart_items || cart.session?.cart_items || cart.session?.items || cart.items || [])
    .find((item) => item.variation_id === variantP.variation_id);
  assert(cartItem, "Carrinho deve conter a variation_id selecionada.");
  assert.strictEqual(Number(cartItem.preco_referencia || cartItem.preco_venda || cartItem.price || cartItem.unit_price), promoPrice, "Carrinho deve usar preco promocional.");
  await addPaymentPlan(cookie, sessionId, promoPrice);
  const finalized = await request(`/api/pdv/sales/finalize/${sessionId}`, {
    method: "POST",
    cookie,
    body: { loja: "vila", vendedor: "QA Ciclo 4.7" }
  });
  assert.strictEqual(finalized.status, 200, finalized.body.error || "Venda da variacao deveria finalizar.");
  assert.strictEqual(finalized.body.normalized_inventory_movements?.length, 1, "Venda deve gerar um SALE_OUT normalizado.");
  const afterSale = await resolveVariant(cookie, barcode);
  assert.strictEqual(afterSale.variation_id, variantP.variation_id);
  assert.strictEqual(Number(afterSale.physical_qty), 1, "Venda deve baixar somente a variacao P.");

  const reservationSessionId = await openSaleSession(cookie);
  await attachCustomer(cookie, reservationSessionId, shortCode);
  await addVariationToCart(cookie, reservationSessionId, byFullSku, variantM, 1);
  const reserved = await request(`/api/pdv/operational/reservations/from-session/${reservationSessionId}`, {
    method: "POST",
    cookie,
    body: { loja: "vila", vendedor: "QA Ciclo 4.7", validade: "2099-12-31" }
  });
  assert.strictEqual(reserved.status, 200, reserved.body.error || "Reserva normalizada deveria ser criada.");
  assert.strictEqual(reserved.body.normalized_holds?.length, 1, "Reserva deve gerar RESERVATION_HOLD normalizado.");
  const afterHold = await resolveVariant(cookie, `${barcode}1`);
  assert.strictEqual(afterHold.variation_id, variantM.variation_id);
  assert.strictEqual(Number(afterHold.physical_qty), 2, "Reserva nao pode baixar saldo fisico.");
  assert.strictEqual(Number(afterHold.reserved_qty), 1, "Reserva deve aumentar reserved_qty.");
  assert.strictEqual(Number(afterHold.available_qty), 1, "Reserva deve reduzir available_qty calculado.");

  console.log(JSON.stringify({
    ok: true,
    base_sku: baseSku,
    short_code: shortCode,
    product_id: normalizedProductId,
    image_url: imageUrl,
    price: Number(byFullSku.preco_venda || byFullSku.price),
    original_price: Number(byFullSku.original_price || byFullSku.compare_at_price),
    promotional_price: Number(byFullSku.promotional_price || byFullSku.promotionalPrice),
    cart_price: Number(cartItem.preco_referencia || cartItem.preco_venda || cartItem.price || cartItem.unit_price),
    after_sale_physical_qty: Number(afterSale.physical_qty),
    after_hold_physical_qty: Number(afterHold.physical_qty),
    after_hold_reserved_qty: Number(afterHold.reserved_qty),
    after_hold_available_qty: Number(afterHold.available_qty)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
