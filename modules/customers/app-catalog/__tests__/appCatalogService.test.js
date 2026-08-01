"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const sqlite3 = require("sqlite3");
const { AppSessionError } = require("../../app-auth/appSessionService");
const { createAppCatalogRouter } = require("../appCatalogRoutes");
const { createAppCatalogService } = require("../appCatalogService");
const { assertAllowList } = require("../appCatalogDto");

function fixture() {
  const connection = new sqlite3.Database(":memory:");
  const db = {
    run: (sql, params = []) => new Promise((resolve, reject) => connection.run(sql, params, function done(error) { error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID }); })),
    all: (sql, params = []) => new Promise((resolve, reject) => connection.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows))),
    close: () => new Promise((resolve, reject) => connection.close((error) => error ? reject(error) : resolve()))
  };
  return db;
}

async function seed(db) {
  await db.run("CREATE TABLE pdv_products_v2(id INTEGER PRIMARY KEY,legacy_ai_product_id INTEGER,name TEXT,base_sku TEXT,sale_price_cents INTEGER,updated_at TEXT,status TEXT)");
  await db.run("CREATE TABLE pdv_product_variants(id TEXT PRIMARY KEY,product_id INTEGER,sku TEXT,attributes_json TEXT,sale_price_cents INTEGER,status TEXT,created_at TEXT)");
  await db.run("CREATE TABLE pdv_inventory_balances_v2(variant_id TEXT,available_qty REAL,reserved_qty REAL)");
  await db.run("CREATE TABLE ai_products(id INTEGER PRIMARY KEY,commercial_name TEXT,category TEXT,marca TEXT,short_description TEXT,ai_short_description TEXT,sales_argument TEXT,promotional_price REAL,main_media_id INTEGER)");
  await db.run("CREATE TABLE campaign_media(id INTEGER PRIMARY KEY,file_path TEXT,status TEXT)");
  await db.run("CREATE TABLE ai_product_media(id INTEGER PRIMARY KEY,product_id INTEGER,media_id INTEGER,sort_order INTEGER)");
  await db.run("INSERT INTO campaign_media VALUES (10,'C:\\repo\\public\\uploads\\products\\bermuda.jpg','active')");
  await db.run("INSERT INTO ai_products VALUES (20,'Bermuda Yougue','Bermudas','Osklen','Sarja premium','','',197,10)");
  await db.run("INSERT INTO pdv_products_v2 VALUES (1,20,'Bermuda Yougue','AERO-1',39700,'2026-08-01T00:00:00.000Z','ativo')");
  await db.run("INSERT INTO pdv_product_variants VALUES ('v1',1,'AERO-1-M','{\"color\":\"Bege\",\"size\":\"M\"}',39700,'ativo','2026-08-01T00:00:00.000Z')");
  await db.run("INSERT INTO pdv_inventory_balances_v2 VALUES ('v1',4,1)");
  await db.run("INSERT INTO ai_product_media VALUES (1,20,10,0)");
  await db.run("INSERT INTO pdv_products_v2 VALUES (2,NULL,'QA Grade API 999','QA-2',1000,'2026-08-02T00:00:00.000Z','ativo')");
  await db.run("INSERT INTO pdv_product_variants VALUES ('v2',2,'QA-2-M','{\"size\":\"M\"}',1000,'ativo','2026-08-02T00:00:00.000Z')");
  await db.run("INSERT INTO pdv_inventory_balances_v2 VALUES ('v2',9,0)");
}

test("catalogo real agrupa variantes, estoque e imagem sem expor campos internos", async () => {
  const db = fixture(); await seed(db); const service = createAppCatalogService({ dbApi: db });
  const response = await service.list({ page: "1", pageSize: "24", marca: "osklen", busca: "bermuda", ordenacao: "preco_asc" });
  assert.equal(response.data.items.length, 1); const item = response.data.items[0];
  assert.equal(item.id, "1"); assert.equal(item.sku, "AERO-1"); assert.equal(item.brand, "Osklen");
  assert.equal(item.availability, "in_stock"); assert.equal(item.price_cents, 19700); assert.equal(item.compare_at_price_cents, 39700);
  assert.equal(item.primary_image.url, "/uploads/products/bermuda.jpg");
  assert.equal(JSON.stringify(response).includes("available_qty"), false); assert.doesNotThrow(() => assertAllowList(response));
  await db.close();
});

test("categorias, detalhe, paginacao e filtros sao deterministicos", async () => {
  const db = fixture(); await seed(db); const service = createAppCatalogService({ dbApi: db });
  assert.deepEqual((await service.categories()).data.categories, [{ slug: "bermudas", label: "Bermudas", count: 1 }]);
  const detail = (await service.detail("1")).data.product; assert.equal(detail.variants[0].size, "M"); assert.equal(detail.colors[0], "Bege");
  assert.equal((await service.list({ categoria: "bermudas", pageSize: "1" })).data.pagination.total, 1);
  await assert.rejects(service.list({ pageSize: "101" }), (error) => error.code === "INVALID_PAGE_SIZE");
  await assert.rejects(service.detail("2"), (error) => error.code === "PRODUCT_NOT_FOUND");
  await db.close();
});

test("rotas exigem sessao APPROVED, auditam sem termo de busca e preservam status HTTP", async () => {
  const db = fixture(); await seed(db); const service = createAppCatalogService({ dbApi: db }); const events = [];
  const sessionService = { authenticateAccess: async (token) => {
    if (token === "approved") return { account: { id: "account-1", access_status: "APPROVED" } };
    if (!token || token === "invalid") throw new AppSessionError("ACCESS_TOKEN_INVALID", 401);
    throw new AppSessionError("APP_ACCESS_NOT_APPROVED", 403, token.replace("status-", "").toUpperCase());
  } };
  const app = express(); app.use("/app/v1", createAppCatalogRouter({ service, sessionService, recordAudit: async (event) => events.push(event) }));
  const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/app/v1/catalog`)).status, 401);
    assert.equal((await fetch(`${base}/app/v1/catalog`, { headers: { Authorization: "Bearer invalid" } })).status, 401);
    for (const status of ["pending", "rejected", "blocked", "suspended", "closed"]) assert.equal((await fetch(`${base}/app/v1/catalog`, { headers: { Authorization: `Bearer status-${status}` } })).status, 403);
    const headers = { Authorization: "Bearer approved" };
    assert.equal((await fetch(`${base}/app/v1/catalog?busca=cliente`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/app/v1/catalog/categories`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/app/v1/catalog/1`, { headers })).status, 200);
    assert.deepEqual(events.map((event) => event.action), ["SEARCH", "CATEGORY_VIEW", "PRODUCT_VIEW"]);
    assert.equal(JSON.stringify(events).includes("cliente"), false);
  } finally { await new Promise((resolve) => server.close(resolve)); await db.close(); }
});
