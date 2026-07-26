"use strict";

const { loadShopSettings } = require("../../shop/services/shopSettingsService");
const {
  createCatalogRateLimiter,
  applyPublicApiHeaders,
  applyCors
} = require("../../shop/middleware/shopPublicApiMiddleware");
const {
  createB2cCatalogService,
  toB2cErrorResponse
} = require("./b2cCatalogService");

function registerB2cCatalogRoutes(app, options = {}) {
  const service = options.service || createB2cCatalogService(options);
  const rateLimit = options.rateLimit || createCatalogRateLimiter();

  function sendSuccess(req, res, payload) {
    applyCors(req, res);
    const cacheSeconds = Number(loadShopSettings()?.catalog?.cache_max_age_seconds || 120);
    applyPublicApiHeaders(res, cacheSeconds);
    res.status(200).json(payload);
  }

  function sendError(req, res, error) {
    applyCors(req, res);
    applyPublicApiHeaders(res, 0);
    const response = toB2cErrorResponse(error);
    res.status(response.status).json(response.payload);
  }

  app.options("/b2c/v1/*", (req, res) => {
    applyCors(req, res);
    applyPublicApiHeaders(res, 0);
    res.status(204).end();
  });

  app.get("/b2c/v1/catalog", rateLimit, (req, res) => {
    try {
      sendSuccess(req, res, service.listCatalog(req.query || {}));
    } catch (error) {
      sendError(req, res, error);
    }
  });

  app.get("/b2c/v1/catalog/filters", rateLimit, (req, res) => {
    try {
      sendSuccess(req, res, service.getFilters());
    } catch (error) {
      sendError(req, res, error);
    }
  });

  app.get("/b2c/v1/products/:slug", rateLimit, (req, res) => {
    try {
      sendSuccess(req, res, service.getProductBySlug(req.params.slug));
    } catch (error) {
      sendError(req, res, error);
    }
  });
}

module.exports = {
  registerB2cCatalogRoutes
};
