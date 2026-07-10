"use strict";

const express = require("express");
const path = require("path");
const { requirePublicSiteHost } = require("../utils/shopHost");
const { renderCatalogPage, renderProductPage } = require("../services/shopPageRenderer");

const SHOP_ROOT = path.join(__dirname, "..", "..", "..", "public", "shop");
const SHOP_ASSETS_ROOT = path.join(SHOP_ROOT, "assets");

function applyShopSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
}

function registerShopPublicRoutes(app) {
  const shopAssetsStatic = express.static(SHOP_ASSETS_ROOT, {
    fallthrough: true,
    setHeaders(res, filePath) {
      applyShopSecurityHeaders(res);
      if (filePath.endsWith(".css")) {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
      } else if (filePath.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      } else if (filePath.endsWith(".svg")) {
        res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      }
    }
  });

  app.use("/shop/assets", requirePublicSiteHost, shopAssetsStatic);

  app.get("/catalogo", requirePublicSiteHost, (req, res) => {
    applyShopSecurityHeaders(res);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderCatalogPage(req.query || {}));
  });

  app.get("/produto/:slug", requirePublicSiteHost, (req, res) => {
    applyShopSecurityHeaders(res);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const html = renderProductPage(req.params.slug);
    if (!html) {
      res.status(404);
      res.send(renderCatalogPage());
      return;
    }
    res.send(html);
  });
}

module.exports = {
  registerShopPublicRoutes,
  SHOP_ROOT
};
