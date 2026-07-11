"use strict";

/**
 * Deploy A1 — catálogo público OFF, CRM admin shop read-only ON.
 * Simula produção: NODE_ENV=production + SHOP_PUBLIC_CATALOG_ENABLED=false
 */
process.env.NODE_ENV = "production";
process.env.SHOP_PUBLIC_CATALOG_ENABLED = "false";

const http = require("http");
const express = require("express");
const path = require("path");
const fs = require("fs");
const { registerPublicSiteRoutes } = require("../modules/public-site/routes/publicSiteRoutes");
const { registerShopModule } = require("../modules/shop");
const { registerShopAdminRoutes } = require("../modules/shop");
const { isPublicSiteHost } = require("../modules/public-site/utils/publicSiteHost");

function request(port, host, pathName = "/", options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathName,
      method: options.method || "GET",
      headers: { Host: host, ...(options.headers || {}) }
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          location: res.headers.location || ""
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function requireAnyPermission() {
  return (req, res, next) => {
    const auth = String(req.headers.authorization || "").trim();
    const cookie = String(req.headers.cookie || "").trim();
    if (!auth && !cookie) {
      return res.status(401).json({ error: "Acesso restrito à publicação shop do CRM." });
    }
    return next();
  };
}

function servePublicIndex(res) {
  const indexPath = path.join(__dirname, "..", "public", "index.html");
  res.type("html").send(fs.readFileSync(indexPath, "utf8"));
}

async function main() {
  const app = express();
  registerShopModule(app);
  registerPublicSiteRoutes(app);
  registerShopAdminRoutes(app, { requireAnyPermission });

  app.get("/", (req, res, next) => {
    if (isPublicSiteHost(req)) {
      return next();
    }
    res.redirect(302, "/pdv");
  });

  app.get("/shop/publicacao", (req, res) => {
    servePublicIndex(res);
  });

  app.get("/pdv", (req, res) => {
    servePublicIndex(res);
  });

  const server = app.listen(0);
  const port = server.address().port;

  try {
    const publicChecks = [
      ["/catalogo", "catalogo"],
      ["/produto/polo-pima-marinho", "produto"],
      ["/public-api/catalog", "public-api-catalog"],
      ["/pdv", "pdv"],
      ["/app.js", "app-js"]
    ];

    for (const [pathName, label] of publicChecks) {
      const res = await request(port, "aerostore.site", pathName);
      if (res.status !== 404) {
        throw new Error(`aerostore.site ${pathName} expected 404, got ${res.status} (${label})`);
      }
    }

    const publicHome = await request(port, "aerostore.site", "/");
    if (publicHome.status !== 200 || !publicHome.body.includes("AEROSTORE")) {
      throw new Error("aerostore.site / should still serve landing");
    }

    const crmShop = await request(port, "crm.aerostore.site", "/shop/publicacao");
    if (crmShop.status !== 200 || !crmShop.body.includes("shop-publication")) {
      throw new Error("crm.aerostore.site /shop/publicacao should serve CRM SPA shell");
    }

    const crmPdv = await request(port, "crm.aerostore.site", "/pdv");
    if (crmPdv.status !== 200) {
      throw new Error(`crm.aerostore.site /pdv expected 200, got ${crmPdv.status}`);
    }

    const apiBlocked = await request(port, "crm.aerostore.site", "/api/shop/publication/candidates?limit=1");
    if (apiBlocked.status !== 401) {
      throw new Error(`Unauthenticated candidates API expected 401, got ${apiBlocked.status}`);
    }

    const disabledApi = await request(port, "aerostore.site", "/public-api/catalog");
    let disabledCode = "";
    try {
      disabledCode = JSON.parse(disabledApi.body)?.code || "";
    } catch (error) {
      disabledCode = "";
    }
    if (disabledApi.status !== 404 || disabledCode !== "SHOP_PUBLIC_CATALOG_DISABLED") {
      throw new Error("Disabled public catalog API should return SHOP_PUBLIC_CATALOG_DISABLED");
    }

    console.log("SHOP_DEPLOY_A1_SMOKE_OK", {
      shop_public_catalog_enabled: false,
      aerostore_site_catalog: 404,
      crm_shop_publicacao: 200,
      candidates_api_unauth: 401
    });
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error("SHOP_DEPLOY_A1_SMOKE_FAIL", error.message);
  process.exit(1);
});
