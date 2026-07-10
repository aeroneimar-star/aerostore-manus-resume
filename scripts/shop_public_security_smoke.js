"use strict";

const http = require("http");
const express = require("express");
const { registerPublicSiteRoutes } = require("../modules/public-site/routes/publicSiteRoutes");
const { registerShopModule } = require("../modules/shop");
const { isPublicSiteHost } = require("../modules/public-site/utils/publicSiteHost");
const { FORBIDDEN_KEYS } = require("../modules/shop/dto/publicProductDto");

function request(port, host, path = "/", options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: options.method || "GET",
      headers: { Host: host, ...(options.headers || {}) }
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function collectForbiddenKeys(obj, found = new Set(), path = "") {
  if (!obj || typeof obj !== "object") {
    return found;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => collectForbiddenKeys(item, found, `${path}[${index}]`));
    return found;
  }
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(key)) {
      found.add(`${path}${key}`);
    }
    collectForbiddenKeys(obj[key], found, `${path}${key}.`);
  }
  return found;
}

async function main() {
  const app = express();
  registerPublicSiteRoutes(app);
  registerShopModule(app);
  app.get("/", (req, res, next) => {
    if (isPublicSiteHost(req)) {
      return next();
    }
    res.redirect(302, "/pdv");
  });

  const server = app.listen(0);
  const port = server.address().port;

  try {
    const publicApiBlocked = await request(port, "aerostore.site", "/api/products");
    if (publicApiBlocked.status !== 404) {
      throw new Error(`Public host /api/products expected 404, got ${publicApiBlocked.status}`);
    }

    const publicPdvBlocked = await request(port, "aerostore.site", "/pdv/venda");
    if (publicPdvBlocked.status !== 404) {
      throw new Error(`Public host /pdv/venda expected 404, got ${publicPdvBlocked.status}`);
    }

    const catalogPage = await request(port, "aerostore.site", "/catalogo");
    if (catalogPage.status !== 200) {
      throw new Error(`Public /catalogo expected 200, got ${catalogPage.status}`);
    }
    if (!catalogPage.body.includes("Seleção AEROSTORE")) {
      throw new Error("Catalog page missing hero title");
    }
    if (!catalogPage.body.includes("Camiseta Premium Algodão Branca")) {
      throw new Error("Catalog page missing expanded pilot product");
    }

    const catalogApi = await request(port, "aerostore.site", "/public-api/catalog");
    if (catalogApi.status !== 200) {
      throw new Error(`Public /public-api/catalog expected 200, got ${catalogApi.status}`);
    }
    const catalogJson = JSON.parse(catalogApi.body);
    if (!catalogJson.success || !Array.isArray(catalogJson.items) || catalogJson.items.length < 6) {
      throw new Error("Catalog API missing pilot products");
    }
    const forbiddenInCatalog = collectForbiddenKeys(catalogJson);
    if (forbiddenInCatalog.size) {
      throw new Error(`Catalog API leaked forbidden keys: ${Array.from(forbiddenInCatalog).join(", ")}`);
    }

    const productApi = await request(port, "aerostore.site", "/public-api/products/polo-pima-marinho");
    if (productApi.status !== 200) {
      throw new Error(`Product API expected 200, got ${productApi.status}`);
    }
    const productJson = JSON.parse(productApi.body);
    const forbiddenInProduct = collectForbiddenKeys(productJson);
    if (forbiddenInProduct.size) {
      throw new Error(`Product API leaked forbidden keys: ${Array.from(forbiddenInProduct).join(", ")}`);
    }
    if (!productJson.product?.slug || productJson.product.sku) {
      throw new Error("Product API shape invalid or leaked sku");
    }

    const missingProduct = await request(port, "aerostore.site", "/public-api/products/nao-existe");
    if (missingProduct.status !== 404) {
      throw new Error(`Missing product expected 404, got ${missingProduct.status}`);
    }

    const publicAppJs = await request(port, "aerostore.site", "/app.js");
    if (publicAppJs.status !== 404) {
      throw new Error(`Public host /app.js expected 404, got ${publicAppJs.status}`);
    }

    const productPage = await request(port, "aerostore.site", "/produto/polo-pima-marinho");
    if (productPage.status !== 200 || !productPage.body.includes("Polo Pima Marinho")) {
      throw new Error("Product page failed");
    }
    if (!productPage.body.includes("Consultar disponibilidade")) {
      throw new Error("Product page missing CTA copy");
    }

    const catalogItem = catalogJson.items[0];
    if (catalogItem.sku || catalogItem.product_id || catalogItem.tiny_id) {
      throw new Error("Catalog item leaked internal fields");
    }

    const cacheHeader = catalogApi.headers["cache-control"] || "";
    if (!cacheHeader.includes("max-age")) {
      throw new Error("Catalog API missing Cache-Control max-age");
    }

    console.log("SHOP_PUBLIC_SECURITY_SMOKE_OK");
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error("SHOP_PUBLIC_SECURITY_SMOKE_FAIL", error.message);
  process.exit(1);
});
