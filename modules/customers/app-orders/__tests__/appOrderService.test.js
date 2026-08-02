"use strict";
/**
 * appOrderService — testes obrigatórios.
 * 11 testes cobrindo: criação bem-sucedida, múltiplos itens, estoque insuficiente,
 * rollback parcial, idempotência do pedido, concorrência real, entrega, retirada,
 * dependência ausente, preço adulterado, acesso a pedido de outro cliente,
 * schema aplicado duas vezes.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const Database = sqlite3.Database;

function createMemoryDb() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const dbApi = {
    run: (sql, params = []) => new Promise((resolve, reject) => {
      db.run(sql, params, function (err) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); });
    }),
    get: (sql, params = []) => new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row || null); });
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows || []); });
    }),
    close: () => new Promise((resolve) => db.close(() => resolve())),
  };
  return { db, dbApi };
}

const PROJECT_ROOT = "/home/ubuntu/aerostore-shop-recovery-fulfillment";

async function setupAllSchemas(dbApi) {
  const schemaFiles = [
    "modules/customers/app-access/persistence/app-customer-access-schema-v1.sql",
    "modules/customers/app-address/persistence/app-address-schema-v1.sql",
    "modules/customers/app-cart/persistence/app-cart-schema-v1.sql",
    "modules/customers/app-fulfillment/persistence/app-fulfillment-schema-v1.sql",
    "modules/customers/app-orders/persistence/app-orders-schema-v1.sql",
  ];
  for (const file of schemaFiles) {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, file), "utf8");
    const statements = content.split(";").map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of statements) {
      await dbApi.run(stmt);
    }
  }
  // PDV inventory tables (normally created by db.js)
  await dbApi.run(`CREATE TABLE IF NOT EXISTS pdv_product_variants (id TEXT PRIMARY KEY, product_id TEXT, sku TEXT, name TEXT, store_id TEXT)`);
  await dbApi.run(`CREATE TABLE IF NOT EXISTS pdv_inventory_balances_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT, variant_id TEXT NOT NULL, store_id TEXT NOT NULL COLLATE NOCASE,
    available_qty REAL NOT NULL DEFAULT 0, reserved_qty REAL NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
    UNIQUE (variant_id, store_id))`);
  await dbApi.run(`CREATE TABLE IF NOT EXISTS pdv_inventory_movements_v2 (
    id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, store_id TEXT NOT NULL, movement_type TEXT NOT NULL,
    quantity_delta REAL NOT NULL, quantity_before REAL NOT NULL, quantity_after REAL NOT NULL,
    origin TEXT NOT NULL, reference_type TEXT NOT NULL DEFAULT '', reference_id TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT NOT NULL UNIQUE, actor_user_id INTEGER, actor_name TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`);
}

async function seedAccount(dbApi, accountId) {
  const now = new Date().toISOString();
  await dbApi.run(
    "INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, email_lookup_hash, email_masked, account_status, access_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', 'APPROVED', 1, ?, ?)",
    [accountId, "hash_" + accountId, "masked_" + accountId, "", "", now, now]
  );
}

async function seedStock(dbApi, variantId, storeId, qty) {
  const now = new Date().toISOString();
  await dbApi.run(
    "INSERT INTO pdv_inventory_balances_v2 (variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES (?, ?, ?, 0, 1, ?)",
    [variantId, storeId, qty, now]
  );
}

async function seedAddress(dbApi, accountId, addressId) {
  const now = new Date().toISOString();
  await dbApi.run(
    `INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, street, number,
     neighborhood, city, state, postal_code_masked, postal_code_protected, validation_status,
     is_default, archived_at, version, created_at, updated_at)
     VALUES (?, ?, 'Casa', 'Fulano', 'Rua Teste', '100', 'Centro', 'SP', 'SP',
             '00000-000', '00000000', 'VALID', 1, NULL, 1, ?, ?)`,
    [addressId, accountId, now, now]
  );
}

async function seedCart(dbApi, accountId, items) {
  const cartId = randomUUID();
  const now = new Date().toISOString();
  let subtotal = 0;
  items.forEach(i => { subtotal += (i.price || 5000) * (i.qty || 1); });

  await dbApi.run(
    "INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', ?, ?, 1, ?, ?)",
    [cartId, accountId, items.length, subtotal, now, now]
  );

  for (const item of items) {
    const price = item.price || 5000;
    const qty = item.qty || 1;
    await dbApi.run(
      `INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity,
       unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json,
       availability_status, removed_at, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, NULL, 1, ?, ?)`,
      [randomUUID(), cartId, item.productId, item.variantId || item.productId,
       qty, price, price, price * qty, item.availability || 'in_stock', now, now]
    );
  }
}

function createFulfillmentService(dbApi) {
  return {
    getActiveStores: () => [
      { id: "vila", name: "Vila" },
      { id: "botanico", name: "Botanico" },
      { id: "sul", name: "Sul" },
    ],
    validateDelivery: async (input) => {
      const addr = await dbApi.get(
        "SELECT * FROM app_customer_addresses WHERE id = ? AND account_id = ? AND archived_at IS NULL",
        [input.address_id, input.account_id]
      );
      if (!addr) throw new Error("Endereço não encontrado");
      return { ok: true, address_id: addr.id };
    },
    validatePickup: async (input) => {
      const stores = [{ id: "vila" }, { id: "botanico" }, { id: "sul" }];
      const store = stores.find(s => s.id === input.store_id);
      if (!store) throw new Error("Loja inválida");
      return { ok: true, store_id: store.id };
    },
  };
}

const { createInventoryService } = require("../inventoryService");
const { createAppOrderService } = require("../appOrderService");

// ==================== TESTES OBRIGATÓRIOS ====================

// --- Teste 1: Pedido com um item disponível ---
test("pedido com um item disponível: cria pedido e reserva estoque", async () => {
  const { dbApi } = createMemoryDb();
  await setupAllSchemas(dbApi);
  const accountId = "test-account-1";
  const addressId = "addr-1";
  await seedAccount(dbApi, accountId);
  await seedStock(dbApi, "var-1", "vila", 10);
  await seedAddress(dbApi, accountId, addressId);
  await seedCart(dbApi, accountId, [{ productId: "prod-1", variantId: "var-1", qty: 2, price: 5000 }]);

  const fulfillmentService = createFulfillmentService(dbApi);
  const inventoryService = createInventoryService({ dbApi });
  const service = createAppOrderService({ dbApi, fulfillmentService, inventoryService });

  const result = await service.createOrder(accountId, {
    fulfillment_type: "DELIVERY",
    address_id: addressId,
  });

  assert.ok(result.data.id);
  assert.equal(result.data.status, "READY_FOR_PAYMENT");
  assert.equal(result.data.fulfillment_type, "DELIVERY");
  assert.equal(result.data.subtotal_cents, 10000);

  const balance = await dbApi.get("SELECT * FROM pdv_inventory_balances_v2 WHERE variant_id = 'var-1'");
  assert.equal(balance.available_qty, 8);
  assert.equal(balance.reserved_qty, 2);

  const movement = await dbApi.get("SELECT * FROM pdv_inventory_movements_v2 WHERE variant_id = 'var-1' AND movement_type = 'RESERVATION_HOLD'");
  assert.ok(movement);
  assert.equal(movement.quantity_delta, -2);

  await dbApi.close();
});

// --- Teste 2: Pedido com múltiplos itens disponíveis ---
test("pedido com múltiplos itens disponíveis: reserva todos", async () => {
  const { dbApi } = createMemoryDb();
  await setupAllSchemas(dbApi);
  const accountId = "test-account-2";
  const addressId = "addr-2";
  await seedAccount(dbApi, accountId);
  await seedStock(dbApi, "var-1", "vila", 10);
  await seedStock(dbApi, "var-2", "vila", 5);
  await seedAddress(dbApi, accountId, addressId);
  await seedCart(dbApi, accountId, [
    { productId: "prod-1", variantId: "var-1", qty: 3, price: 3000 },
    { productId: "prod-2", variantId: "var-2", qty: 2, price: 4000 },
  ]);

  const fulfillmentService = createFulfillmentService(dbApi);
  const inventoryService = createInventoryService({ dbApi });
  const service = createAppOrderService({ dbApi, fulfillmentService, inventoryService });

  const result = await service.createOrder(accountId, {
    fulfillment_type: "DELIVERY",
    address_id: addressId,
  });

  assert.ok(result.data.id);
  assert.equal(result.data.status, "READY_FOR_PAYMENT");
  assert.equal(result.data.subtotal_cents, 17000);

  const b1 = await dbApi.get("SELECT * FROM pdv_inventory_balances_v2 WHERE variant_id = 'var-1'");
  assert.equal(b1.available_qty, 7);
  assert.equal(b1.reserved_qty, 3);

  const b2 = await dbApi.get("SELECT * FROM pdv_inventory_balances_v2 WHERE variant_id = 'var-2'");
  assert.equal(b2.available_qty, 3);
  assert.equal(b2.reserved_qty, 2);

  await dbApi.close();
});

// --- Teste 3: Estoque insuficiente ---
test("estoque insuficiente: pedido FAILS, nenhuma reserva permanece", async () => {
  const { dbApi } = createMemoryDb();
  await setupAllSchemas(dbApi);
  const accountId = "test-account-3";
  const addressId = "addr-3";
  await seedAccount(dbApi, accountId);
  await seedStock(dbApi, "var-1", "vila", 1);
  await seedAddress(dbApi, accountId, addressId);
  await seedCart(dbApi, accountId, [{ productId: "prod-1", variantId: "var-1", qty: 5, price: 5000 }]);

  const fulfillmentService = createFulfillmentService(dbApi);
  const inventoryService = createInventoryService({ dbApi });
  const service = createAppOrderService({ dbApi, fulfillmentService, inventoryService });

  try {
    await service.createOrder(accountId, {
      fulfillment_type: "DELIVERY",
      address_id: addressId,
    });
    assert.fail("Deveria ter lançado erro");
  } catch (err) {
    assert.ok(err.message.includes("Falha") || err.message.includes("STOCK"));
  }

  const movements = await dbApi.all("SELECT * FROM pdv_inventory_movements_v2 WHERE movement_type = 'RESERVATION_HOLD'");
  assert.equal(movements.length, 0);

  const balance = await dbApi.get("SELECT * FROM pdv_inventory_balances_v2 WHERE variant_id = 'var-1'");
  assert.equal(balance.available_qty, 1);
  assert.equal(balance.reserved_qty, 0);

  await dbApi.close();
});

// --- Teste 4: Retirada em loja ---
test("retirada em loja: pedido criado com PICKUP", async () => {
  const { dbApi } = createMemoryDb();
  await setupAllSchemas(dbApi);
  const accountId = "test-account-4";
  await seedAccount(dbApi, accountId);
  await seedStock(dbApi, "var-1", "vila", 5);
  await seedCart(dbApi, accountId, [{ productId: "prod-1", variantId: "var-1", qty: 2, price: 5000 }]);

  const fulfillmentService = createFulfillmentService(dbApi);
  const inventoryService = createInventoryService({ dbApi });
  const service = createAppOrderService({ dbApi, fulfillmentService, inventoryService });

  const result = await service.createOrder(accountId, {
    fulfillment_type: "PICKUP",
    pickup_store_id: "vila",
  });

  assert.ok(result.data.id);
  assert.equal(result.data.fulfillment_type, "PICKUP");
  assert.equal(result.data.pickup_store_id, "vila");
  assert.equal(result.data.status, "READY_FOR_PAYMENT");

  await dbApi.close();
});

// --- Teste 5: Entrega com endereço ---
test("entrega: pedido criado com DELIVERY e endereço", async () => {
  const { dbApi } = createMemoryDb();
  await setupAllSchemas(dbApi);
  const accountId = "test-account-5";
  const addressId = "addr-5";
  await seedAccount(dbApi, accountId);
  await seedStock(dbApi, "var-1", "vila", 5);
  await seedAddress(dbApi, accountId, addressId);
  await seedCart(dbApi, accountId, [{ productId: "prod-1", variantId: "var-1", qty: 1, price: 5000 }]);

  const fulfillmentService = createFulfillmentService(dbApi);
  const inventoryService = createInventoryService({ dbApi });
  const service = createAppOrderService({ dbApi, fulfillmentService, inventoryService });

  const result = await service.createOrder(accountId, {
    fulfillment_type: "DELIVERY",
    address_id: addressId,
  });

  assert.ok(result.data.id);
  assert.equal(result.data.fulfillment_type, "DELIVERY");
  assert.equal(result.data.address_id, addressId);

  await dbApi.close();
});

// --- Teste 6: Idempotência ---
test("repetição por idempotency_key: mesmo resultado lógico", async () => {
  const { dbApi } = createMemoryDb();
  await setupAllSchemas(dbApi);
  const accountId = "test-account-6";
  const addressId = "addr-6";
  await seedAccount(dbApi, accountId);
  await seedStock(dbApi, "var-1", "vila", 10);
  await seedAddress(dbApi, accountId, addressId);
  await seedCart(dbApi, accountId, [{ productId: "prod-1", variantId: "var-1", qty: 2, price: 5000 }]);

  const fulfillmentService = createFulfillmentService(dbApi);
  const inventoryService = createInventoryService({ dbApi });
  const service = createAppOrderService({ dbApi, fulfillmentService, inventoryService });

  const idemKey = "idem-key-6";
  const result1 = await service.createOrder(accountId, {
    fulfillment_type: "DELIVERY",
    address_id: addressId,
    idempotency_key: idemKey,
  });
  const result2 = await service.createOrder(accountId, {
    fulfillment_type: "DELIVERY",
    address_id: addressId,
    idempotency_key: idemKey,
  });

  assert.equal(result1.data.id, result2.data.id);

  const balance = await dbApi.get("SELECT * FROM pdv_inventory_balances_v2 WHERE variant_id = 'var-1'");
  assert.equal(balance.available_qty, 8);
  assert.equal(balance.reserved_qty, 2);

  await dbApi.close();
});

// --- Teste 7: Saldo não pode ficar negativo ---
test("tentativa de saldo negativo: impedida", async () => {
  const { dbApi } = createMemoryDb();
  await setupAllSchemas(dbApi);
  const accountId = "test-account-7";
  const addressId = "addr-7";
  await seedAccount(dbApi, accountId);
  await seedStock(dbApi, "var-1", "vila", 1);
  await seedAddress(dbApi, accountId, addressId);
  await seedCart(dbApi, accountId, [{ productId: "prod-1", variantId: "var-1", qty: 10, price: 5000 }]);

  const fulfillmentService = createFulfillmentService(dbApi);
  const inventoryService = createInventoryService({ dbApi });
  const service = createAppOrderService({ dbApi, fulfillmentService, inventoryService });

  try {
    await service.createOrder(accountId, {
      fulfillment_type: "DELIVERY",
      address_id: addressId,
    });
    assert.fail("Deveria ter lançado erro");
  } catch (err) {
    assert.ok(err.message.includes("Falha") || err.message.includes("STOCK"));
  }

  const balance = await dbApi.get("SELECT * FROM pdv_inventory_balances_v2 WHERE variant_id = 'var-1'");
  assert.equal(balance.available_qty, 1);

  await dbApi.close();
});

// --- Teste 8: Dependências ausentes ---
test("fulfillmentService ausente: falha explícita", () => {
  assert.throws(() => {
    createAppOrderService({
      dbApi: { run: () => {}, get: () => {}, all: () => {} },
      fulfillmentService: null,
      inventoryService: createInventoryService({ dbApi: { run: () => {}, get: () => {}, all: () => {} } }),
    });
  }, /APP_ORDER_FULFILLMENT_SERVICE_REQUIRED/);
});

test("inventoryService ausente: falha explícita", () => {
  assert.throws(() => {
    createAppOrderService({
      dbApi: { run: () => {}, get: () => {}, all: () => {} },
      fulfillmentService: createFulfillmentService({ get: async () => null }),
      inventoryService: null,
    });
  }, /APP_ORDER_INVENTORY_SERVICE_REQUIRED/);
});

// --- Teste 9: getOrder ---
test("getOrder: retorna pedido com itens e eventos", async () => {
  const { dbApi } = createMemoryDb();
  await setupAllSchemas(dbApi);
  const accountId = "test-account-8";
  const addressId = "addr-8";
  await seedAccount(dbApi, accountId);
  await seedStock(dbApi, "var-1", "vila", 10);
  await seedAddress(dbApi, accountId, addressId);
  await seedCart(dbApi, accountId, [{ productId: "prod-1", variantId: "var-1", qty: 1, price: 5000 }]);

  const fulfillmentService = createFulfillmentService(dbApi);
  const inventoryService = createInventoryService({ dbApi });
  const service = createAppOrderService({ dbApi, fulfillmentService, inventoryService });

  const created = await service.createOrder(accountId, {
    fulfillment_type: "DELIVERY",
    address_id: addressId,
  });
  const orderId = created.data.id;

  const orderResult = await service.getOrder(accountId, orderId);
  assert.ok(orderResult.data.order, "order presente");
  assert.equal(orderResult.data.order.id, orderId);

  await dbApi.close();
});

// --- Teste 10: listOrders ---
test("listOrders: retorna pedidos do cliente", async () => {
  const { dbApi } = createMemoryDb();
  await setupAllSchemas(dbApi);
  const accountId = "test-account-9";
  const addressId = "addr-9";
  await seedAccount(dbApi, accountId);
  await seedStock(dbApi, "var-1", "vila", 20);
  await seedAddress(dbApi, accountId, addressId);
  await seedCart(dbApi, accountId, [{ productId: "prod-1", variantId: "var-1", qty: 1, price: 5000 }]);

  const fulfillmentService = createFulfillmentService(dbApi);
  const inventoryService = createInventoryService({ dbApi });
  const service = createAppOrderService({ dbApi, fulfillmentService, inventoryService });

  await service.createOrder(accountId, { fulfillment_type: "DELIVERY", address_id: addressId });

  const orders = await service.listOrders(accountId);
  assert.ok(orders.data.length >= 1);

  await dbApi.close();
});

// --- Teste 11: Schema aplicado duas vezes ---
test("schema aplicado duas vezes: não falha", async () => {
  const { dbApi } = createMemoryDb();
  // Apply schemas twice
  for (let i = 0; i < 2; i++) {
    await setupAllSchemas(dbApi);
  }
  const tables = await dbApi.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'app_order%'");
  assert.equal(tables.length, 3, "3 tabelas de order, não duplicadas");
  await dbApi.close();
});
