"use strict";

/**
 * PDV Bloco C — Smoke 3: Discount 15% → seller finalize blocked
 *
 * User: vendedor@aerostore.local (perfil SELLER)
 *   - can_sell: true           → passa middleware PATCH discount
 *   - can_finalize_sale: true  → pode chamar finalize
 *   - can_apply_discount: false (sem bypass de limite)
 *
 * Lojas do seller: botanico (apenas)
 * Produto smoke: SMOKE-C3-DISCOUNT-001 (criado via createProductAggregate, deletado no cleanup)
 *
 * Fluxo: admin abre caixa botanico → criar produto smoke com estoque
 *        → login seller → open session botanico → search product (get variant_id)
 *        → add item with normalized_product=true + fulfillment data
 *        → verificar sessao limpa (cashback=0, credito=0, payments=0, subtotal>0)
 *        → apply 15% discount → finalize SEM authorization_id
 *        → esperar 400/403 por autorizacao gerencial
 *        → confirmar venda nao criada, estoque inalterado
 *        → cleanup: deletar produto smoke
 */
const BASE_URL = "http://localhost:3000";
const STORE = "botanico";
const SELLER_NAME = "Vendedor AEROSTORE";
const SELLER_EMAIL = "vendedor@aerostore.local";
const SMOKE_SKU = "SMOKE-C3-DISCOUNT-001";
const SMOKE_PRODUCT_NAME = "Smoke Desconto 15% Botânico";
const SMOKE_PRICE = 100.00;
const SMOKE_INITIAL_STOCK = 10;
const PASSWORD = "123456";
const { blockProduction, warnLocalOnly } = require("../scriptSafety");

blockProduction("pdv_sale_discount_unauthorized_smoke.js");
warnLocalOnly("pdv_sale_discount_unauthorized_smoke.js");

const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const { createProductAggregate } = require("../../modules/pdv/products/pdvSimpleProductService");

let cookie = "";
let sessionId = "";
let stockBefore = null;
let smokeProductId = null;
let smokeVariantId = null;
let smokeLegacyId = null;
let db = null;

function log(msg) { console.log(`  [C3] ${msg}`); }

// ============================================================
// Helpers de massa de teste
// ============================================================

async function getDb() {
  if (db) return db;
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "..", "..", "data", "aerostore-crm.sqlite");
  db = new sqlite3.Database(dbPath);
  return db;
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().then(database => {
      database.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().then(database => {
      database.run(sql, params, function(err) { err ? reject(err) : resolve({ changes: this.changes }); });
    });
  });
}

async function ensureSmokeProduct(actor) {
  const fs = require("fs");
  const invJsonPath = path.join(__dirname, "..", "..", "data", "pdv", "inventory", "inventory.json");

  // Verificar se ja existe no DB
  const existing = await dbAll(
    `SELECT p.id AS product_id, v.id AS variant_id, p.legacy_ai_product_id,
            b.available_qty, b.store_id
     FROM pdv_products_v2 p
     INNER JOIN pdv_product_variants v ON v.product_id = p.id
     INNER JOIN pdv_inventory_balances_v2 b ON b.variant_id = v.id
     WHERE p.base_sku = ? AND b.store_id = ? COLLATE NOCASE`,
    [SMOKE_SKU, STORE]
  );

  if (existing.length > 0) {
    smokeProductId = existing[0].product_id;
    smokeVariantId = existing[0].variant_id;
    smokeLegacyId = existing[0].legacy_ai_product_id;
    log(`Produto smoke ja existe: ${SMOKE_SKU} (id=${smokeProductId})`);

    // Garantir estoque no DB
    await dbRun(
      `UPDATE pdv_inventory_balances_v2 SET available_qty = ? WHERE variant_id = ? AND store_id = ? COLLATE NOCASE`,
      [SMOKE_INITIAL_STOCK, smokeVariantId, STORE]
    );

    // Garantir estoque no inventory.json (cache de leitura do sistema operacional)
    let inventoryData = JSON.parse(fs.readFileSync(invJsonPath, "utf8"));
    const invIdx = inventoryData.findIndex(r => r.codigo_interno === SMOKE_SKU && r.store_id === STORE);
    if (invIdx >= 0) {
      inventoryData[invIdx].available_qty = SMOKE_INITIAL_STOCK;
      inventoryData[invIdx].preco_venda = SMOKE_PRICE;
      inventoryData[invIdx].nome = SMOKE_PRODUCT_NAME;
    } else {
      inventoryData.push({
        inventory_id: `INV_SMOKE_${smokeVariantId}`.substring(0, 20),
        product_id: `PRD_SMOKE_${smokeProductId}`.substring(0, 20),
        sku: SMOKE_SKU, codigo: SMOKE_SKU, codigo_tiny: SMOKE_SKU, codigo_etiqueta: SMOKE_SKU,
        ean: "", codigo_barras: "", codigo_interno: SMOKE_SKU,
        nome: SMOKE_PRODUCT_NAME, descricao: SMOKE_PRODUCT_NAME.toUpperCase(),
        marca: "", categoria: "", linha_genero: "", tipo: "", cor: "", tamanho: "", grade: "",
        preco_venda: SMOKE_PRICE, preco_custo: 0,
        store_id: STORE, available_qty: SMOKE_INITIAL_STOCK, reserved_qty: 0,
        unavailable_qty: 0, exchange_qty: 0, consumption_qty: 0,
        last_movement_at: new Date().toISOString(), status: "ACTIVE",
        observacao: "Smoke test C3", media_id: null,
        photo_preview_url: "", media_url: "", foto: "", source: "PDV_IMPORT"
      });
    }
    fs.writeFileSync(invJsonPath, JSON.stringify(inventoryData, null, 2), "utf8");

    // Limpar cache do modulo pdvInventoryService
    const invPath = require.resolve("../../modules/pdv/inventory/pdvInventoryService");
    delete require.cache[invPath];
    require(invPath);
    return;
  }

  // Criar produto smoke
  log(`Criando produto smoke: ${SMOKE_SKU}...`);
  const created = await createProductAggregate({
    name: SMOKE_PRODUCT_NAME,
    commercial_name: SMOKE_PRODUCT_NAME,
    product_type: "simple",
    base_sku: SMOKE_SKU,
    price: SMOKE_PRICE,
    store_id: STORE,
    initial_stock: SMOKE_INITIAL_STOCK,
    notes: "Smoke test C3"
  }, actor);

  smokeProductId = created.product.id;
  smokeVariantId = created.variants[0].variation_id;
  smokeLegacyId = created.product.legacy_ai_product_id;
  log(`Produto smoke criado: id=${smokeProductId}, variant=${smokeVariantId}`);

  // Adicionar ao inventory.json (fonte de leitura do sistema operacional)
  let inventoryData = JSON.parse(fs.readFileSync(invJsonPath, "utf8"));
  inventoryData.push({
    inventory_id: `INV_SMOKE_${smokeVariantId}`.substring(0, 20),
    product_id: `PRD_SMOKE_${smokeProductId}`.substring(0, 20),
    sku: SMOKE_SKU, codigo: SMOKE_SKU, codigo_tiny: SMOKE_SKU, codigo_etiqueta: SMOKE_SKU,
    ean: "", codigo_barras: "", codigo_interno: SMOKE_SKU,
    nome: SMOKE_PRODUCT_NAME, descricao: SMOKE_PRODUCT_NAME.toUpperCase(),
    marca: "", categoria: "", linha_genero: "", tipo: "", cor: "", tamanho: "", grade: "",
    preco_venda: SMOKE_PRICE, preco_custo: 0,
    store_id: STORE, available_qty: SMOKE_INITIAL_STOCK, reserved_qty: 0,
    unavailable_qty: 0, exchange_qty: 0, consumption_qty: 0,
    last_movement_at: new Date().toISOString(), status: "ACTIVE",
    observacao: "Smoke test C3", media_id: null,
    photo_preview_url: "", media_url: "", foto: "", source: "PDV_IMPORT"
  });
  fs.writeFileSync(invJsonPath, JSON.stringify(inventoryData, null, 2), "utf8");
  log(`Registro adicionado ao inventory.json.`);

  // Limpar cache do modulo pdvInventoryService
  const invPath = require.resolve("../../modules/pdv/inventory/pdvInventoryService");
  delete require.cache[invPath];
  require(invPath);
}

async function cleanupSmokeProduct() {
  if (!smokeProductId) return;
  log("Limpando produto smoke...");
  try {
    await dbRun(`DELETE FROM pdv_inventory_movements_v2 WHERE reference_id = ?`, [smokeProductId]);
    await dbRun(`DELETE FROM pdv_inventory_balances_v2 WHERE variant_id = ? AND store_id = ? COLLATE NOCASE`, [smokeVariantId, STORE]);
    await dbRun(`DELETE FROM pdv_product_variants WHERE id = ?`, [smokeVariantId]);
    await dbRun(`DELETE FROM pdv_products_v2 WHERE id = ?`, [smokeProductId]);
    if (smokeLegacyId) {
      await dbRun(`DELETE FROM ai_products WHERE id = ?`, [smokeLegacyId]);
    }
    log("Produto smoke deletado.");
  } catch (e) {
    log(`Warn: cleanup falhou (pode ja ter sido deletado): ${e.message}`);
  }
}

async function closeDb() {
  if (db) {
    await new Promise(resolve => db.close(() => resolve()));
    db = null;
  }
}

// ============================================================
// Helpers de API
// ============================================================

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
  log("Seller nao pode abrir caixa. Abrindo com admin@aerostore.local...");
  const adminCookie = await login("admin@aerostore.local");
  const opened = await api("/api/pdv/control/registers/open", {
    method: "POST",
    headers: { Cookie: adminCookie, "Content-Type": "application/json", Connection: "close" },
    body: { loja: STORE, store_id: STORE, operador: "Admin AEROSTORE", valor_inicial: 100 }
  });
  if (opened.status !== 200) throw new Error(`Nao abriu caixa: ${JSON.stringify(opened.body)}`);
  log(`Caixa aberto: ${opened.body.cash_register_id}`);
  await login(SELLER_EMAIL);
}

async function getStock() {
  const r = await api(`/api/pdv/operational/search/products?q=${SMOKE_SKU}&store=${STORE}&limit=1`);
  const items = r.body?.items || r.body?.data || [];
  if (!items.length) return null;
  // Para produtos normalizados, buscar estoque da variant
  const found = items.find((i) => i.normalized_product && i.variants?.length > 0);
  if (found) return found.variants[0]?.available_qty ?? found.available_qty ?? null;
  return Number(items[0].available_qty || items[0].stock_quantity || 0) || null;
}

async function getSessionFields() {
  const s = await api(`/api/pdv/operational/session/${sessionId}`);
  const sd = s.body?.session || s.body;
  const cartItems = Array.isArray(sd?.cart_items) ? sd.cart_items : [];
  const grossSubtotal = cartItems.reduce((acc, i) => acc + (Number(i.quantidade || 1) * Number(i.preco_venda || i.unit_price || 0)), 0);
  const itemDiscount = cartItems.reduce((acc, i) => acc + Number(i.desconto_item || i.discount_amount || 0), 0);
  const netSubtotal = grossSubtotal - itemDiscount;
  const methods = sd?.payment_plan?.methods || [];
  const totalPaid = methods.reduce((acc, m) => acc + Number(m.amount || 0), 0);
  return {
    cartItemsCount: cartItems.length,
    grossSubtotal,
    itemDiscount,
    netSubtotal,
    cashbackApplied: sd?.cashback_application?.amount ?? 0,
    exchangeCreditApplied: sd?.exchange_credit_application?.amount ?? 0,
    paymentMethodsCount: methods.filter((m) => Number(m.amount || 0) > 0).length,
    totalPaid,
    discountPercent: sd?.discount_percent ?? 0,
    discountAmount: sd?.desconto_extra ?? sd?.discount_amount ?? 0,
    authorizationRequired: sd?.authorization_required ?? false,
    discountAuthRequired: sd?.discount_authorization_required ?? false
  };
}

// ============================================================
// Main
// ============================================================

async function run() {
  console.log("\n=== Smoke C3: Discount 15% + seller sem autorizacao ===\n");

  const adminActor = { id: 999001, name: "Admin Smoke C3", role: "admin" };

  try {
    // 0. Garantir produto smoke
    await ensureSmokeProduct(adminActor);

    // 1. Login como vendedor
    log(`Logando como ${SELLER_EMAIL}...`);
    await login(SELLER_EMAIL);
    log("Logado (perfil SELLER).");

    // 2. Garantir caixa aberto
    log("Verificando caixa...");
    await ensureCashRegister();

    // 3. Estoque antes
    stockBefore = await getStock();
    log(`Estoque antes: ${stockBefore}`);
    if (stockBefore === null || stockBefore <= 0) {
      console.error(`FAIL: Produto smoke sem estoque. Estoque=${stockBefore}`);
      process.exit(1);
    }

    // 4. Abrir sessao operacional
    log("Abrindo sessao...");
    const s = await api("/api/pdv/operational/session/open", {
      method: "POST",
      body: { seller: SELLER_NAME, loja: STORE, force_new: true }
    });
    if (s.status !== 200 || !s.body.session_id) {
      console.error("FAIL: Nao abriu sessao", s.body);
      await cleanupSmokeProduct();
      process.exit(1);
    }
    sessionId = s.body.session_id;
    log(`Sessao: ${sessionId}`);

    // 5. Buscar produto smoke para obter variant_id (necessario para produtos normalizados)
    log(`Buscando produto smoke ${SMOKE_SKU}...`);
    const search = await api(`/api/pdv/operational/search/products?q=${SMOKE_SKU}&store=${STORE}&limit=1`);
    const items = search.body?.items || search.body?.data || [];
    const found = items.find((i) => i.normalized_product && i.variants?.length > 0);
    if (!found) {
      console.error("FAIL: Produto smoke nao encontrado na busca operacional.");
      await cleanupSmokeProduct();
      process.exit(1);
    }
    const variant = found.variants[0];
    log(`Variante encontrada: ${variant.variation_id}, estoque: ${variant.available_qty}`);

    // 6. Adicionar item smoke com informacoes de produto normalizado
    log(`Adicionando produto smoke ${SMOKE_SKU}...`);
    const a = await api(`/api/pdv/operational/cart/${sessionId}/items`, {
      method: "POST",
      body: {
        store_id: STORE,
        codigo: SMOKE_SKU,
        quantidade: 1,
        // Campos normalizados para evitar verificacao de inventario via cache
        normalized_product: true,
        normalized_parent_product_id: found.parent_product_id,
        variation_id: variant.variation_id,
        sku: variant.sku,
        nome: variant.nome || found.nome,
        preco_venda: variant.preco_venda,
        available_qty: variant.available_qty,
        fulfillment_type: "LOCAL_STOCK",
        fulfillment_mode: "venda_normal",
        fulfillment_status: "confirmado",
        stock_source_store_id: STORE,
        sale_store_id: STORE,
        operational_stock_status: variant.operational_stock_status || "AVAILABLE_LOCAL"
      }
    });
    if (a.status !== 200) {
      console.error("FAIL: Nao adicionou item smoke", a.body);
      await cleanupSmokeProduct();
      process.exit(1);
    }
    log("Item adicionado.");

    // 6. Verificar sessao LIMPA antes do desconto
    const before = await getSessionFields();
    log(`\n  [Sessao antes do desconto]`);
    log(`  - cart_items: ${before.cartItemsCount}`);
    log(`  - subtotal liquido: R$ ${before.netSubtotal.toFixed(2)}`);
    log(`  - cashback aplicado: R$ ${before.cashbackApplied.toFixed(2)}`);
    log(`  - credito troca: R$ ${before.exchangeCreditApplied.toFixed(2)}`);
    log(`  - pagamentos: ${before.paymentMethodsCount}`);
    log(`  - desconto atual: ${before.discountPercent}%`);

    if (before.cartItemsCount === 0) {
      console.error("FAIL: Carrinho vazio.");
      await cleanupSmokeProduct();
      process.exit(1);
    }
    if (before.netSubtotal <= 0) {
      console.error("FAIL: Subtotal zero.");
      await cleanupSmokeProduct();
      process.exit(1);
    }
    if (before.cashbackApplied > 0) {
      console.error("FAIL: Cashback aplicado na sessao.");
      await cleanupSmokeProduct();
      process.exit(1);
    }
    if (before.exchangeCreditApplied > 0) {
      console.error("FAIL: Credito de troca aplicado.");
      await cleanupSmokeProduct();
      process.exit(1);
    }
    if (before.paymentMethodsCount > 0) {
      console.error("FAIL: Pagamento ja aplicado.");
      await cleanupSmokeProduct();
      process.exit(1);
    }
    log("\n  Sessao LIMPA confirmada. Prosseguindo...\n");

    // 7. Aplicar pagamento PIX (necessario para base elegivel do desconto)
    // O desconto e aplicado sobre o valor PIX, nao sobre cashback/credito
    const subtotal = before.netSubtotal;
    log(`Aplicando PIX de R$ ${subtotal.toFixed(2)} (base elegivel)...`);
    const pix = await api(`/api/pdv/operational/cart/${sessionId}/payment-plan`, {
      method: "POST",
      body: { methods: [{ method: "pix", amount: subtotal }] }
    });
    if (pix.status !== 200) {
      console.error("FAIL: Falhou ao aplicar PIX", pix.body);
      await cleanupSmokeProduct();
      process.exit(1);
    }
    log("PIX aplicado.");

    // 8. Aplicar desconto de 15% (limite automatico = 10%)
    // Com PIX como base, o desconto de 15% > 10%limite → authorization_required=true
    log("Aplicando desconto de 15%...");
    const d = await api(`/api/pdv/operational/cart/${sessionId}/discount`, {
      method: "PATCH",
      body: { mode: "percent", value: 15, reason: "Smoke: 15% exceeds 10% limit without authorization" }
    });

    if (d.status !== 200) {
      const errMsg = JSON.stringify(d.body).toLowerCase();
      const isBaseError = errMsg.includes("base elegivel") || errMsg.includes("sem subtotal");
      if (isBaseError) {
        console.error(`FAIL: PATCH erro de base elegivel: ${d.body.error}`);
        await cleanupSmokeProduct();
        process.exit(1);
      }
      const isAuthError =
        errMsg.includes("autoriz") ||
        errMsg.includes("gerencial") ||
        errMsg.includes("desconto") ||
        errMsg.includes("discount") ||
        errMsg.includes("limit") ||
        errMsg.includes("exceeded");
      if (isAuthError) {
        log(`PATCH bloqueou por autorizacao (HTTP ${d.status}): ${d.body.error}`);
        console.log("\n=== Smoke C3 PASSED (desconto bloqueado no PATCH por autorizacao gerencial) ===");
        await cleanupSmokeProduct();
        process.exit(0);
      }
      console.error(`FAIL: Erro inesperado no PATCH (HTTP ${d.status}):`, d.body);
      await cleanupSmokeProduct();
      process.exit(1);
    }

    log("PATCH retornou 200 — desconto aplicado.");

    const after = await getSessionFields();
    log(`\n  [Sessao apos desconto]`);
    log(`  - discount_percent: ${after.discountPercent}%`);
    log(`  - discount_amount: R$ ${after.discountAmount.toFixed(2)}`);
    log(`  - authorization_required: ${after.authorizationRequired}`);
    log(`  - discount_authorization_required: ${after.discountAuthRequired}`);

    if (!after.authorizationRequired && !after.discountAuthRequired) {
      console.error("FAIL: Desconto 15% aplicado mas authorization_required=false.");
      await cleanupSmokeProduct();
      process.exit(1);
    }

    // 9. Tentar finalizar SEM authorization_id
    log("Tentando finalizar venda (esperando HTTP 400/403 por autorizacao gerencial)...");
    const f = await api(`/api/pdv/sales/finalize/${sessionId}`, {
      method: "POST",
      body: { loja: STORE }
    });

    if (f.status === 200) {
      const saleId = f.body?.sale_id;
      log(`ERRO: finalize retornou 200 com sale_id=${saleId} — seller nao deveria finalizar.`);
      if (saleId) {
        log("Limpando: cancelando venda...");
        await api(`/api/pdv/sales/cancel/${saleId}`, {
          method: "POST",
          body: { loja: STORE, reason: "Smoke test cleanup - unexpected finalize" }
        });
      }
      console.error("FAIL: Seller conseguiu finalizar venda com desconto 15% sem autorizacao.");
      await cleanupSmokeProduct();
      process.exit(1);
    }

    const errMsg = JSON.stringify(f.body).toLowerCase();
    const isDiscountAuthError =
      errMsg.includes("autoriz") ||
      errMsg.includes("gerencial") ||
      errMsg.includes("desconto") ||
      errMsg.includes("discount") ||
      errMsg.includes("authorization");

    if (isDiscountAuthError) {
      log(`Bloqueado no finalize (HTTP ${f.status}): ${JSON.stringify(f.body).substring(0, 200)}`);
      log("Venda nao criada.");

      const stockAfter = await getStock();
      log(`Estoque depois: ${stockAfter}`);
      if (stockAfter !== stockBefore) {
        console.error(`FAIL: Estoque mudou de ${stockBefore} para ${stockAfter}.`);
        await cleanupSmokeProduct();
        process.exit(1);
      }
      log("Estoque inalterado. PASS.");

      console.log("\n=== Smoke C3 PASSED (desconto 15% bloqueado no finalize por falta de autorizacao gerencial) ===");
      await cleanupSmokeProduct();
      process.exit(0);
    }

    console.error(`FAIL: Erro inesperado no finalize (HTTP ${f.status}):`, f.body);
    await cleanupSmokeProduct();
    process.exit(1);

  } finally {
    await cleanupSmokeProduct();
    await closeDb();
  }
}

run().catch((e) => {
  console.error("Unhandled error:", e);
  cleanupSmokeProduct().then(() => closeDb()).then(() => process.exit(1));
});