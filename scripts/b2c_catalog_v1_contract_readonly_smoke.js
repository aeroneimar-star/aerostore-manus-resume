"use strict";

process.env.SHOP_PUBLIC_CATALOG_ENABLED = "true";

const assert = require("assert");
const http = require("http");
const express = require("express");
const { registerShopModule } = require("../modules/shop");
const { registerB2cModule } = require("../modules/b2c");
const {
  listCatalog: listLegacyCatalog,
  listCatalogFilters: listLegacyFilters,
  getProductBySlug: getLegacyProductBySlug
} = require("../modules/shop/services/shopCatalogService");
const {
  loadPilotPublications
} = require("../modules/shop/services/shopSettingsService");
const {
  B2C_FORBIDDEN_KEYS,
  assertNoB2cForbiddenKeys
} = require("../modules/b2c/catalog/b2cCatalogDto");
const {
  B2cCatalogError,
  createB2cCatalogService
} = require("../modules/b2c/catalog/b2cCatalogService");

const passThroughRateLimit = (req, res, next) => next();

function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: options.method || "GET",
      headers: {
        Host: "aerostore.site",
        Origin: "https://aerostore.site",
        Connection: "close",
        ...(options.headers || {})
      }
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch (error) {
          // Rotas ausentes do Express retornam HTML; o status continua sendo a evidência.
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          json
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function withServer(app, callback) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    return await callback(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function createPublicApp(catalogOptions = {}) {
  const app = express();
  registerShopModule(app);
  registerB2cModule(app, {
    catalog: {
      rateLimit: passThroughRateLimit,
      ...catalogOptions
    }
  });
  return app;
}

function assertError(response, status, code) {
  assert.strictEqual(response.status, status);
  assert.strictEqual(response.json?.success, false);
  assert.strictEqual(response.json?.error?.code, code);
  assert.strictEqual(response.json?.meta?.api_version, "v1");
  assert.strictEqual(typeof response.json?.error?.message, "string");
  assert.ok(!response.body.includes("node:internal"));
  assert.ok(!response.body.includes("C:\\"));
  assert.ok(!response.body.toLowerCase().includes("sqlite"));
}

function assertUniqueBySlug(items, label) {
  const slugs = items.map((item) => item.slug);
  assert.strictEqual(new Set(slugs).size, slugs.length, `${label} contém slugs duplicados`);
}

function assertStableLabelOrder(items, label) {
  const labels = items.map((item) => item.label);
  const sorted = [...labels].sort((a, b) => a.localeCompare(b, "pt-BR"));
  assert.deepStrictEqual(labels, sorted, `${label} não possui ordem estável`);
}

async function testProductionRoutesAndLegacyParity() {
  const legacyCatalog = listLegacyCatalog({});
  const legacyFilters = listLegacyFilters();
  assert.ok(legacyCatalog.items.length > 0, "fixture piloto deveria conter publicados");
  const validSlug = legacyCatalog.items[0].slug;
  const legacyProduct = getLegacyProductBySlug(validSlug);
  const rawPilot = loadPilotPublications();
  const publishedRawSlugs = rawPilot.publications
    .filter((item) => String(item.status || "").trim() === "published")
    .map((item) => item.public_slug)
    .sort();

  await withServer(createPublicApp(), async (port) => {
    const legacyCatalogHttp = await request(port, "/public-api/catalog");
    assert.strictEqual(legacyCatalogHttp.status, 200);
    assert.deepStrictEqual(legacyCatalogHttp.json, legacyCatalog);

    const legacyFiltersHttp = await request(port, "/public-api/catalog/filters");
    assert.strictEqual(legacyFiltersHttp.status, 200);
    assert.deepStrictEqual(legacyFiltersHttp.json, legacyFilters);

    const legacyProductHttp = await request(port, `/public-api/products/${validSlug}`);
    assert.strictEqual(legacyProductHttp.status, 200);
    assert.deepStrictEqual(legacyProductHttp.json, legacyProduct);

    const legacyMissingHttp = await request(port, "/public-api/products/produto-inexistente");
    assert.strictEqual(legacyMissingHttp.status, 404);
    assert.strictEqual(legacyMissingHttp.json?.code, "PRODUCT_NOT_FOUND");

    const catalog = await request(port, "/b2c/v1/catalog");
    assert.strictEqual(catalog.status, 200);
    assert.strictEqual(catalog.json?.success, true);
    assert.strictEqual(catalog.json?.meta?.api_version, "v1");
    assert.strictEqual(catalog.json?.meta?.source_mode, undefined);
    assert.ok(Array.isArray(catalog.json?.data?.items));
    assert.deepStrictEqual(catalog.json.data.pagination, {
      page: 1,
      limit: 24,
      total: legacyCatalog.total,
      total_pages: legacyCatalog.total_pages
    });
    assert.deepStrictEqual(
      catalog.json.data.items.map((item) => item.slug).sort(),
      publishedRawSlugs
    );
    assertNoB2cForbiddenKeys(catalog.json);

    const emptyPage = await request(port, "/b2c/v1/catalog?page=999");
    assert.strictEqual(emptyPage.status, 200);
    assert.deepStrictEqual(emptyPage.json.data.items, []);
    assert.strictEqual(emptyPage.json.data.pagination.total, legacyCatalog.total);

    assertError(await request(port, "/b2c/v1/catalog?page=0"), 400, "INVALID_PAGE");
    assertError(await request(port, "/b2c/v1/catalog?page=abc"), 400, "INVALID_PAGE");
    assertError(await request(port, "/b2c/v1/catalog?limit=0"), 400, "INVALID_LIMIT");
    assertError(await request(port, "/b2c/v1/catalog?limit=49"), 400, "INVALID_LIMIT");
    assertError(await request(port, "/b2c/v1/catalog?limit=abc"), 400, "INVALID_LIMIT");
    assertError(await request(port, "/b2c/v1/catalog?color=azul"), 400, "INVALID_FILTER");
    assertError(await request(port, "/b2c/v1/catalog?featured=talvez"), 400, "INVALID_FILTER");

    const category = legacyFilters.categories[0]?.slug;
    assert.ok(category, "categoria piloto esperada");
    const categoryResult = await request(port, `/b2c/v1/catalog?category=${category}`);
    assert.strictEqual(categoryResult.status, 200);
    assert.ok(categoryResult.json.data.items.every((item) => item.category_slug === category));

    const missingCategory = await request(port, "/b2c/v1/catalog?category=categoria-inexistente");
    assert.strictEqual(missingCategory.status, 200);
    assert.deepStrictEqual(missingCategory.json.data.items, []);

    const featured = await request(port, "/b2c/v1/catalog?featured=true");
    assert.strictEqual(featured.status, 200);
    assert.ok(featured.json.data.items.every((item) => item.featured === true));

    const filters = await request(port, "/b2c/v1/catalog/filters");
    assert.strictEqual(filters.status, 200);
    for (const dimension of ["categories", "colors", "sizes"]) {
      assert.ok(Array.isArray(filters.json.data[dimension]));
      assertUniqueBySlug(filters.json.data[dimension], dimension);
      assertStableLabelOrder(filters.json.data[dimension], dimension);
    }
    assertNoB2cForbiddenKeys(filters.json);

    const product = await request(port, `/b2c/v1/products/${validSlug}`);
    assert.strictEqual(product.status, 200);
    assert.strictEqual(product.json.data.product.slug, validSlug);
    assert.strictEqual(product.json.data.product.price_cents, legacyProduct.product.price_cents);
    assert.deepStrictEqual(product.json.data.product.images, legacyProduct.product.images);
    assert.deepStrictEqual(product.json.data.product.variants, legacyProduct.product.variants);
    assertNoB2cForbiddenKeys(product.json);

    assertError(
      await request(port, "/b2c/v1/products/produto-inexistente"),
      404,
      "PRODUCT_NOT_FOUND"
    );
    assertError(
      await request(port, "/b2c/v1/products/slug%20invalido"),
      400,
      "INVALID_FILTER"
    );

    const search = await request(port, "/b2c/v1/search?q=polo");
    assert.strictEqual(search.status, 404, "busca não deve existir neste pacote");
    const writeAttempt = await request(port, "/b2c/v1/catalog", { method: "POST" });
    assert.strictEqual(writeAttempt.status, 404, "fachada deve expor somente GET/OPTIONS");

    assert.strictEqual(catalog.headers["access-control-allow-origin"], "https://aerostore.site");
    assert.ok(String(catalog.headers["cache-control"] || "").includes("max-age"));

    const deniedOrigin = await request(port, "/b2c/v1/catalog", {
      headers: { Origin: "https://example.invalid" }
    });
    assert.strictEqual(deniedOrigin.status, 200);
    assert.strictEqual(deniedOrigin.headers["access-control-allow-origin"], undefined);

    const preflight = await request(port, "/b2c/v1/catalog", { method: "OPTIONS" });
    assert.strictEqual(preflight.status, 204);
    assert.strictEqual(preflight.headers["access-control-allow-origin"], "https://aerostore.site");
    assert.strictEqual(preflight.headers["access-control-allow-methods"], "GET, OPTIONS");
  });
}

async function testControlledFailures() {
  const baseSource = {
    listCatalog: () => ({
      page: 1,
      limit: 24,
      total: 0,
      total_pages: 1,
      items: [],
      filters: { categories: [] }
    }),
    getFilters: () => ({ categories: [], colors: [], sizes: [] }),
    getProductBySlug: () => null
  };

  const disabledService = createB2cCatalogService({
    source: baseSource,
    isCatalogEnabled: () => false
  });
  await withServer(createPublicApp({ service: disabledService }), async (port) => {
    assertError(await request(port, "/b2c/v1/catalog"), 404, "CATALOG_DISABLED");
    assertError(await request(port, "/b2c/v1/catalog/filters"), 404, "CATALOG_DISABLED");
    assertError(await request(port, "/b2c/v1/products/qualquer"), 404, "CATALOG_DISABLED");
  });

  process.env.SHOP_PUBLIC_CATALOG_ENABLED = "false";
  try {
    await withServer(createPublicApp(), async (port) => {
      assertError(await request(port, "/b2c/v1/catalog"), 404, "CATALOG_DISABLED");
    });
  } finally {
    process.env.SHOP_PUBLIC_CATALOG_ENABLED = "true";
  }

  const unavailableService = createB2cCatalogService({
    source: {},
    isCatalogEnabled: () => true
  });
  await withServer(createPublicApp({ service: unavailableService }), async (port) => {
    assertError(
      await request(port, "/b2c/v1/catalog"),
      503,
      "CATALOG_SOURCE_UNAVAILABLE"
    );
  });

  const explicitUnavailableService = createB2cCatalogService({
    source: {
      ...baseSource,
      listCatalog() {
        const error = new Error("caminho interno que não pode vazar");
        error.code = "CATALOG_SOURCE_UNAVAILABLE";
        throw error;
      }
    },
    isCatalogEnabled: () => true
  });
  await withServer(createPublicApp({ service: explicitUnavailableService }), async (port) => {
    const response = await request(port, "/b2c/v1/catalog");
    assertError(response, 503, "CATALOG_SOURCE_UNAVAILABLE");
    assert.ok(!response.body.includes("caminho interno"));
  });

  const internalErrorService = createB2cCatalogService({
    source: {
      ...baseSource,
      listCatalog() {
        throw new Error("stack e SQL privados");
      }
    },
    isCatalogEnabled: () => true
  });
  await withServer(createPublicApp({ service: internalErrorService }), async (port) => {
    const response = await request(port, "/b2c/v1/catalog");
    assertError(response, 500, "INTERNAL_ERROR");
    assert.ok(!response.body.includes("stack e SQL privados"));
  });

  assert.throws(
    () => createB2cCatalogService({
      source: baseSource,
      isCatalogEnabled: () => true
    }).getProductBySlug(""),
    (error) => error instanceof B2cCatalogError && error.code === "INVALID_FILTER"
  );
}

function testRecursiveSecurityGuard() {
  for (const key of B2C_FORBIDDEN_KEYS) {
    assert.throws(
      () => assertNoB2cForbiddenKeys({ safe: [{ nested: { [key]: "secret" } }] }),
      /Campo interno proibido/
    );
  }
  assert.doesNotThrow(() => assertNoB2cForbiddenKeys({
    success: true,
    data: {
      product: {
        slug: "produto-publico",
        images: [{ url: "https://aerostore.site/image.jpg" }]
      }
    }
  }));
}

async function main() {
  testRecursiveSecurityGuard();
  await testProductionRoutesAndLegacyParity();
  await testControlledFailures();
  console.log("B2C_CATALOG_V1_CONTRACT_READONLY_OK");
}

main().catch((error) => {
  console.error("B2C_CATALOG_V1_CONTRACT_READONLY_FAIL", error.message);
  process.exit(1);
});
