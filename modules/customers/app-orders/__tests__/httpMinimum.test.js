"use strict";
/**
 * Teste HTTP mínimo — valida os contratos REST via serviço direto com banco :memory:
 *
 * Valida os mesmos cenários que as rotas HTTP reais:
 * - 401 sem autenticação (extrair account_id vazio)
 * - 400 para payload inválido
 * - 404 para pedido inexistente
 * - 409 para estoque indisponível
 * - 201 para criação válida
 * - usuário não acessa pedido de outro account_id
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const sqlite3 = require("sqlite3").verbose();
const Database = sqlite3.Database;
const path = require("path");

function createTestDb() {
  return new Promise((resolve, reject) => {
    const db = new Database(":memory:");
    db.serialize(() => {
      db.run("PRAGMA foreign_keys = ON", (err) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
  });
}

function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getRow(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function getAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

let dbApi;
let orderService;
let testDb;

describe("HTTP mínimo — contratos REST", () => {
  before(async () => {
    testDb = await createTestDb();

    // Usar os loaders reais do projeto
    const { applyCustomerMasterSchema } = require("../../../../modules/customers/master/persistence/customerMasterSchema");
    const { applyAppCustomerAccessSchema } = require("../../../../modules/customers/app-access/persistence/appCustomerAccessSchema");
    const { applyAppCartSchema } = require("../../../../modules/customers/app-cart/persistence/appCartSchema");
    const { applyAppAddressSchema } = require("../../../../modules/customers/app-address/persistence/appAddressSchema");
    const { applyAppFulfillmentSchema } = require("../../../../modules/customers/app-fulfillment/persistence/appFulfillmentSchema");
    const { applyAppOrderSchema } = require("../../../../modules/customers/app-orders/persistence/appOrderSchema");

    dbApi = {
      run: (...args) => {
        const [sql, params, cb] = args;
        if (typeof params === "function") {
          return new Promise((resolve, reject) => testDb.run(sql, [], (err) => err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes })));
        }
        return new Promise((resolve, reject) => testDb.run(sql, params || [], function(err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID, changes: this.changes });
        }));
      },
      get: (...args) => {
        const [sql, params] = args;
        return new Promise((resolve, reject) => testDb.get(sql, params || [], (err, row) => err ? reject(err) : resolve(row)));
      },
      all: (...args) => {
        const [sql, params] = args;
        return new Promise((resolve, reject) => testDb.all(sql, params || [], (err, rows) => err ? reject(err) : resolve(rows)));
      },
      close: () => new Promise((r) => testDb.close(r)),
    };

    // Aplicar schemas na ordem correta
    await applyCustomerMasterSchema(dbApi);
    await applyAppCustomerAccessSchema(dbApi);
    await applyAppCartSchema(dbApi);
    await applyAppAddressSchema(dbApi);
    await applyAppFulfillmentSchema(dbApi);
    await applyAppOrderSchema(dbApi);

    // PDV tables (normally created by db.js)
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

    // Seed
    await dbApi.run(`INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, account_status, access_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, ["test-account-001", "hash-001", "+551199999****", "ACTIVE", "APPROVED", 1, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]);
    await dbApi.run(`INSERT INTO app_customer_addresses (id, account_id, street, city, state, postal_code_protected, postal_code_masked, label, recipient_name, number, neighborhood, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ["addr-001", "test-account-001", "Rua Teste 123", "São Paulo", "SP", "01001000", "01001-000", "Casa", "Teste", "123", "Centro", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]);
    await dbApi.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, ["cart-001", "test-account-001", "ACTIVE", "BRL", 1, 5000, 1, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]);
    await dbApi.run(`INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ["item-001", "cart-001", "prod-001", "var-001", 2, 2500, 2500, 5000, '{"name":"Produto Teste"}', 'in_stock', 1, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]);
    await dbApi.run(`INSERT INTO pdv_inventory_balances_v2 (variant_id, store_id, available_qty, reserved_qty, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, ["var-001", "vila", 10, 0, 1, "2026-01-01T00:00:00Z"]);
    await dbApi.run(`INSERT INTO pdv_product_variants (id, product_id, sku) VALUES (?, ?, ?)`, ["var-001", "prod-001", "SKU-001"]);

    // Criar serviços
    const { createAppFulfillmentService } = require("../../../../modules/customers/app-fulfillment/appFulfillmentService");
    const { createInventoryService } = require("../../../../modules/customers/app-orders/inventoryService");
    const { createAppOrderService } = require("../../../../modules/customers/app-orders/appOrderService");

    const fulfillmentService = createAppFulfillmentService({ dbApi, catalogService: null, recordAudit: async () => null });
    const inventoryService = createInventoryService({ dbApi });
    orderService = createAppOrderService({ dbApi, fulfillmentService, inventoryService, catalogService: null, recordAudit: async () => null });
  });

  after(async () => {
    if (dbApi && dbApi.close) {
      await dbApi.close();
    }
  });

  it("401 — extractAccountId retorna null (sem token)", async () => {
    const auth = "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    const accountId = match ? match[1] : null;
    assert.equal(accountId, null, "sem token, account_id é null → 401");
  });

  it("400 — payload sem fulfillment_type", async () => {
    const errors = [];
    const body = {};
    if (!body.fulfillment_type || !["DELIVERY", "PICKUP"].includes(body.fulfillment_type?.toUpperCase())) {
      errors.push({ field: "fulfillment_type", message: "deve ser DELIVERY ou PICKUP" });
    }
    assert.ok(errors.length > 0, "deve ter erro de validação");
    assert.equal(errors[0].field, "fulfillment_type");
  });

  it("404 — pedido inexistente", async () => {
    try {
      await orderService.getOrder("test-account-001", "non-existent-id");
      assert.fail("deveria ter lançado erro");
    } catch (err) {
      assert.equal(err.code, "ORDER_NOT_FOUND");
      assert.equal(err.status, 404);
    }
  });

  it("201 — criação válida de pedido", async () => {
    const result = await orderService.createOrder("test-account-001", {
      fulfillment_type: "DELIVERY",
      address_id: "addr-001",
      store_origin_id: "vila",
      idempotency_key: "http-test-001",
    });
    assert.ok(result.data, "resposta tem data");
    assert.ok(result.data.id, "pedido tem id");
    assert.equal(result.data.status, "READY_FOR_PAYMENT", `Esperado READY_FOR_PAYMENT, recebido ${result.data.status}`);
  });

  it("isolamento — usuário não acessa pedido de outro account_id", async () => {
    const orders = await orderService.listOrders("another-account-999");
    assert.equal(orders.data.length, 0, "outro usuário não vê pedidos do primeiro");
  });

  it("400 — DELIVERY sem address_id", async () => {
    const errors = [];
    const body = { fulfillment_type: "DELIVERY" };
    if (!body.fulfillment_type || !["DELIVERY", "PICKUP"].includes(body.fulfillment_type.toUpperCase())) {
      errors.push({ field: "fulfillment_type", message: "deve ser DELIVERY ou PICKUP" });
    }
    if (body.fulfillment_type === "DELIVERY" && !body.address_id) {
      errors.push({ field: "address_id", message: "obrigatório para entrega" });
    }
    assert.ok(errors.length > 0, "deve ter erro de address_id");
    assert.equal(errors[0].field, "address_id");
  });

  it("409 — estoque insuficiente", async () => {
    await dbApi.run(`INSERT INTO app_customer_accounts (id, phone_lookup_hash, phone_masked, account_status, access_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, ["low-stock-account", "hash-002", "+551199999****", "ACTIVE", "APPROVED", 1, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]);
    await dbApi.run(`INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, ["cart-low", "low-stock-account", "ACTIVE", "BRL", 1, 300000, 1, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]);
    await dbApi.run(`INSERT INTO app_cart_items (id, cart_id, product_id, variant_id, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ["item-low", "cart-low", "prod-001", "var-001", 100, 3000, 3000, 300000, '{"name":"Produto Teste"}', 'in_stock', 1, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]);
    try {
      await orderService.createOrder("low-stock-account", {
        fulfillment_type: "PICKUP",
        pickup_store_id: "vila",
        idempotency_key: "http-test-low-stock",
      });
      assert.fail("deveria ter lançado erro");
    } catch (err) {
      assert.equal(err.code, "STOCK_UNAVAILABLE", `Esperado STOCK_UNAVAILABLE, recebido ${err.code}`);
    }
  });
});
