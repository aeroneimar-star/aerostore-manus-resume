"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createAppCartService, AppCartError } = require("../appCartService");

const ACCOUNT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

// Use real SQLite in-memory for reliable testing
function createRealDb() {
  const sqlite3 = require("sqlite3");
  const sqlite = sqlite3.verbose();
  const connection = new sqlite.Database(":memory:");

  function wrap(callback) {
    return new Promise((resolve, reject) => callback((error, result) => error ? reject(error) : resolve(result)));
  }

  return {
    run: (statement, parameters = []) => wrap((cb) => connection.run(statement, parameters, cb)),
    get: (statement, parameters = []) => wrap((cb) => connection.get(statement, parameters, cb)),
    all: (statement, parameters = []) => wrap((cb) => connection.all(statement, parameters, cb)),
    close: () => wrap((cb) => connection.close(cb))
  };
}

async function initSchema(db) {
  await db.run(`CREATE TABLE app_carts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    currency TEXT NOT NULL DEFAULT 'BRL',
    item_count INTEGER NOT NULL DEFAULT 0,
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT
  )`);
  await db.run(`CREATE TABLE app_cart_items (
    id TEXT PRIMARY KEY,
    cart_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    variant_slug TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    promotional_price_cents INTEGER,
    effective_unit_price_cents INTEGER NOT NULL,
    line_total_cents INTEGER NOT NULL,
    product_snapshot_json TEXT NOT NULL,
    availability_status TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    removed_at TEXT,
    FOREIGN KEY (cart_id) REFERENCES app_carts(id)
  )`);
}

function createMockCatalogService() {
  return {
    loadProductsForRefresh: async () => [
      {
        id: "prod-1", slug: "polo-pima-marinho", title: "Polo Pima Marinho", brand: "Osklen",
        category_label: "Polos", price_cents: 45990, compare_at_price_cents: null, availability: "in_stock", sku: "POLO-001",
        variants: [
          { slug: "polo-pima-marinho-m", color: "Marinho", size: "M", price_cents: 45990, compare_at_price_cents: null, availability: "in_stock" }
        ],
        primary_image: { url: "https://cdn.example.com/polo.jpg", alt: "Polo Pima", sort_order: 0, role: "primary" }
      },
      {
        id: "prod-2", slug: "camisa-social-branca", title: "Camisa Social Branca", brand: "AEROSTORE",
        category_label: "Camisas", price_cents: 38990, compare_at_price_cents: 42990, availability: "in_stock", sku: "CAMISA-001",
        variants: [
          { slug: "camisa-social-branca-g", color: "Branco", size: "G", price_cents: 38990, compare_at_price_cents: 42990, availability: "in_stock" }
        ],
        primary_image: { url: "https://cdn.example.com/camisa.jpg", alt: "Camisa", sort_order: 0, role: "primary" }
      }
    ]
  };
}

// Helper: create service with fresh DB
async function createServiceWithDb() {
  const db = createRealDb();
  await initSchema(db);
  const service = createAppCartService({ dbApi: db, catalogService: createMockCatalogService() });
  return { service, db };
}

// ===== Construction tests =====
test("createAppCartService — sem db lança erro", () => {
  assert.throws(() => createAppCartService({}), /APP_CART_DB_REQUIRED/);
});

test("createAppCartService — sem catalogService lança erro", () => {
  const db = createRealDb();
  assert.throws(() => createAppCartService({ dbApi: db }), /APP_CART_CATALOG_SERVICE_REQUIRED/);
});

// ===== Error class =====
test("AppCartError — propriedades corretas", () => {
  const error = new AppCartError("TEST_CODE", 422, "Test message");
  assert.equal(error.name, "AppCartError");
  assert.equal(error.code, "TEST_CODE");
  assert.equal(error.status, 422);
  assert.equal(error.message, "Test message");
});

test("limits — maxQuantityPerItem = 99, maxItemsPerCart = 50", async () => {
  const { service, db } = await createServiceWithDb();
  assert.equal(service.limits.maxQuantityPerItem, 99);
  assert.equal(service.limits.maxItemsPerCart, 50);
  await db.close();
});

// ===== getActiveCart =====
test("getActiveCart — sem carrinho retorna null", async () => {
  const { service, db } = await createServiceWithDb();
  const result = await service.getActiveCart(ACCOUNT_ID);
  assert.equal(result, null);
  await db.close();
});

test("getActiveCart — id invalido lança erro", async () => {
  const { service, db } = await createServiceWithDb();
  try { await service.getActiveCart("invalid"); assert.fail("Should have thrown"); }
  catch (err) { assert.equal(err.code, "INVALID_ACCOUNT_ID"); }
  await db.close();
});

// ===== addItem =====
test("addItem — cria carrinho com primeiro item", async () => {
  const { service, db } = await createServiceWithDb();
  const result = await service.addItem(ACCOUNT_ID, "prod-1", "polo-pima-marinho-m", 1);
  assert.equal(result.success, true);
  assert.equal(result.data.cart.status, "ACTIVE");
  assert.equal(result.data.cart.item_count, 1);
  assert.equal(result.data.cart.subtotal_cents, 45990);
  assert.equal(result.data.cart.items.length, 1);
  assert.equal(result.data.cart.items[0].product.title, "Polo Pima Marinho");
  await db.close();
});

test("addItem — adiciona segundo produto com promoção", async () => {
  const { service, db } = await createServiceWithDb();
  await service.addItem(ACCOUNT_ID, "prod-1", "polo-pima-marinho-m", 1);
  const result = await service.addItem(ACCOUNT_ID, "prod-2", "camisa-social-branca-g", 1);
  assert.equal(result.data.cart.item_count, 2);
  assert.equal(result.data.cart.subtotal_cents, 45990 + 38990);
  const item2 = result.data.cart.items.find((i) => i.product_id === "prod-2");
  assert.equal(item2.unit_price_cents, 42990);
  assert.equal(item2.promotional_price_cents, 38990);
  assert.equal(item2.effective_unit_price_cents, 38990);
  await db.close();
});

test("addItem — incrementa quantidade do mesmo produto", async () => {
  const { service, db } = await createServiceWithDb();
  await service.addItem(ACCOUNT_ID, "prod-1", "polo-pima-marinho-m", 1);
  const result = await service.addItem(ACCOUNT_ID, "prod-1", "polo-pima-marinho-m", 2);
  assert.equal(result.data.cart.item_count, 1);
  assert.equal(result.data.cart.items[0].quantity, 3);
  assert.equal(result.data.cart.subtotal_cents, 45990 * 3);
  await db.close();
});

test("addItem — produto não encontrado lança erro", async () => {
  const { service, db } = await createServiceWithDb();
  try { await service.addItem(ACCOUNT_ID, "nonexistent", "var-1"); assert.fail(); }
  catch (err) { assert.equal(err.code, "PRODUCT_NOT_FOUND"); }
  await db.close();
});

test("addItem — quantidade zero é convertida para 1 (comportamento real)", async () => {
  const { service, db } = await createServiceWithDb();
  const result = await service.addItem(ACCOUNT_ID, "prod-1", "polo-pima-marinho-m", 0);
  assert.equal(result.data.cart.items[0].quantity, 1);
  await db.close();
});

test("addItem — quantidade 100 limita a 99", async () => {
  const { service, db } = await createServiceWithDb();
  await service.addItem(ACCOUNT_ID, "prod-1", "polo-pima-marinho-m", 50);
  const result = await service.addItem(ACCOUNT_ID, "prod-1", "polo-pima-marinho-m", 50);
  assert.equal(result.data.cart.items[0].quantity, 99);
  await db.close();
});

test("addItem — variante não encontrada lança erro", async () => {
  const { service, db } = await createServiceWithDb();
  try { await service.addItem(ACCOUNT_ID, "prod-1", "nonexistent-variant"); assert.fail(); }
  catch (err) { assert.equal(err.code, "VARIANT_NOT_FOUND"); }
  await db.close();
});

test("addItem — variante out_of_stock lança erro", async () => {
  const oosCatalog = {
    loadProductsForRefresh: async () => [{
      id: "prod-1", slug: "polo-pima-marinho", title: "Polo Pima Marinho", brand: "Osklen",
      category_label: "Polos", price_cents: 45990, compare_at_price_cents: null, availability: "in_stock", sku: "POLO-001",
      variants: [{ slug: "polo-pima-marinho-m", color: "Marinho", size: "M", price_cents: 45990, availability: "out_of_stock" }],
      primary_image: { url: "https://cdn.example.com/polo.jpg", alt: "Polo Pima", sort_order: 0, role: "primary" }
    }]
  };
  const db = createRealDb();
  await initSchema(db);
  const service = createAppCartService({ dbApi: db, catalogService: oosCatalog });
  try { await service.addItem(ACCOUNT_ID, "prod-1", "polo-pima-marinho-m", 1); assert.fail(); }
  catch (err) { assert.equal(err.code, "VARIANT_UNAVAILABLE"); }
  await db.close();
});

test("addItem — sem variante usa primeira disponível", async () => {
  const { service, db } = await createServiceWithDb();
  const result = await service.addItem(ACCOUNT_ID, "prod-1", null, 1);
  assert.equal(result.data.cart.items[0].variant_id, "prod-1-default");
  assert.equal(result.data.cart.items[0].quantity, 1);
  await db.close();
});

test("addItem — quantidade negativa lança erro", async () => {
  const { service, db } = await createServiceWithDb();
  try { await service.addItem(ACCOUNT_ID, "prod-1", "polo-pima-marinho-m", -1); assert.fail(); }
  catch (err) { assert.equal(err.code, "INVALID_QUANTITY"); }
  await db.close();
});

// ===== updateItemQuantity =====
test("updateItemQuantity — altera quantidade", async () => {
  const { service, db } = await createServiceWithDb();
  const addResult = await service.addItem(ACCOUNT_ID, "prod-1", "polo-pima-marinho-m", 1);
  const itemId = addResult.data.cart.items[0].id;
  const cartId = addResult.data.cart.id;
  const result = await service.updateItemQuantity(ACCOUNT_ID, cartId, itemId, 3);
  assert.equal(result.data.cart.items[0].quantity, 3);
  assert.equal(result.data.cart.subtotal_cents, 45990 * 3);
  await db.close();
});

test("updateItemQuantity — item não encontrado lança erro", async () => {
  const { service, db } = await createServiceWithDb();
  try { await service.updateItemQuantity(ACCOUNT_ID, "fake-cart", "fake-item", 1); assert.fail(); }
  catch (err) { assert.equal(err.code, "CART_ITEM_NOT_FOUND"); }
  await db.close();
});

// ===== removeItem =====
test("removeItem — remove item do carrinho", async () => {
  const { service, db } = await createServiceWithDb();
  const addResult = await service.addItem(ACCOUNT_ID, "prod-1", "polo-pima-marinho-m", 1);
  const itemId = addResult.data.cart.items[0].id;
  const cartId = addResult.data.cart.id;
  const result = await service.removeItem(ACCOUNT_ID, cartId, itemId);
  assert.equal(result.data.cart.item_count, 0);
  assert.equal(result.data.cart.subtotal_cents, 0);
  await db.close();
});

// ===== clearCart =====
test("clearCart — limpa carrinho inteiro", async () => {
  const { service, db } = await createServiceWithDb();
  await service.addItem(ACCOUNT_ID, "prod-1", "polo-pima-marinho-m", 1);
  const addResult = await service.addItem(ACCOUNT_ID, "prod-2", "camisa-social-branca-g", 2);
  const cartId = addResult.data.cart.id;
  const result = await service.clearCart(ACCOUNT_ID, cartId);
  assert.equal(result.data.cart.item_count, 0);
  assert.equal(result.data.cart.subtotal_cents, 0);
  assert.equal(result.data.cart.items.length, 0);
  await db.close();
});

// ===== closeCart =====
test("closeCart — fecha carrinho", async () => {
  const { service, db } = await createServiceWithDb();
  const addResult = await service.addItem(ACCOUNT_ID, "prod-1", "polo-pima-marinho-m", 1);
  const cartId = addResult.data.cart.id;
  const result = await service.closeCart(ACCOUNT_ID, cartId);
  assert.equal(result.data.cart.status, "CLOSED");
  await db.close();
});

// ===== getOrRefreshCart =====
test("getOrRefreshCart — sem carrinho retorna cart null", async () => {
  const { service, db } = await createServiceWithDb();
  const result = await service.getOrRefreshCart(ACCOUNT_ID);
  assert.equal(result.data.cart, null);
  await db.close();
});
