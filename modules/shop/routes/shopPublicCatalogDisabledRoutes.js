"use strict";

const { applyPublicApiHeaders } = require("../middleware/shopPublicApiMiddleware");

function sendDisabledJson(res) {
  applyPublicApiHeaders(res, 0);
  res.status(404).json({
    success: false,
    error: "Catálogo público desabilitado.",
    code: "SHOP_PUBLIC_CATALOG_DISABLED"
  });
}

function registerShopPublicCatalogDisabledRoutes(app) {
  app.options("/public-api/*", (req, res) => {
    res.status(404).end();
  });

  app.get("/public-api/catalog", (req, res) => sendDisabledJson(res));
  app.get("/public-api/catalog/filters", (req, res) => sendDisabledJson(res));
  app.get("/public-api/products/:slug", (req, res) => sendDisabledJson(res));
}

module.exports = {
  registerShopPublicCatalogDisabledRoutes,
  sendDisabledJson
};
