"use strict";

const {
  listCatalog,
  listCatalogFilters,
  getProductBySlug
} = require("../services/shopCatalogService");
const { loadShopSettings } = require("../services/shopSettingsService");
const {
  createCatalogRateLimiter,
  applyPublicApiHeaders,
  applyCors
} = require("../middleware/shopPublicApiMiddleware");
const { assertNoForbiddenKeys } = require("../dto/publicProductDto");

const catalogRateLimit = createCatalogRateLimiter();

function sendJson(res, status, payload, cacheSeconds) {
  applyPublicApiHeaders(res, cacheSeconds);
  res.status(status).json(payload);
}

function registerShopPublicApiRoutes(app) {
  app.options("/public-api/*", (req, res) => {
    applyCors(req, res);
    applyPublicApiHeaders(res, 0);
    res.status(204).end();
  });

  app.get("/public-api/catalog", catalogRateLimit, (req, res) => {
    applyCors(req, res);
    try {
      const payload = listCatalog(req.query || {});
      assertNoForbiddenKeys(payload);
      const cacheSeconds = Number(loadShopSettings()?.catalog?.cache_max_age_seconds || 120);
      sendJson(res, 200, payload, cacheSeconds);
    } catch (error) {
      sendJson(res, 500, { error: "Falha ao carregar catálogo.", code: "CATALOG_ERROR" }, 0);
    }
  });

  app.get("/public-api/catalog/filters", catalogRateLimit, (req, res) => {
    applyCors(req, res);
    try {
      const payload = listCatalogFilters();
      assertNoForbiddenKeys(payload);
      const cacheSeconds = Number(loadShopSettings()?.catalog?.cache_max_age_seconds || 120);
      sendJson(res, 200, payload, cacheSeconds);
    } catch (error) {
      sendJson(res, 500, { error: "Falha ao carregar filtros.", code: "FILTERS_ERROR" }, 0);
    }
  });

  app.get("/public-api/products/:slug", catalogRateLimit, (req, res) => {
    applyCors(req, res);
    try {
      const payload = getProductBySlug(req.params.slug);
      if (!payload) {
        return sendJson(res, 404, {
          error: "Produto não encontrado.",
          code: "PRODUCT_NOT_FOUND"
        }, 0);
      }
      assertNoForbiddenKeys(payload);
      const cacheSeconds = Number(loadShopSettings()?.catalog?.cache_max_age_seconds || 120);
      sendJson(res, 200, payload, cacheSeconds);
    } catch (error) {
      sendJson(res, 500, { error: "Falha ao carregar produto.", code: "PRODUCT_ERROR" }, 0);
    }
  });
}

module.exports = {
  registerShopPublicApiRoutes
};
