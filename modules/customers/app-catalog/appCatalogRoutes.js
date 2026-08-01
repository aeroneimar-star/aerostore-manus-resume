"use strict";

const express = require("express");
const { createAppSessionService } = require("../app-auth/appSessionService");
const { createRequireAppSession, sendAppSessionError } = require("../app-auth/appSessionRoutes");
const { AppCatalogError, createAppCatalogService } = require("./appCatalogService");

function sendError(res, error) {
  if (error instanceof AppCatalogError) return res.status(error.status).json({ success: false, error: { code: error.code, message: error.message }, meta: { api_version: "v1" } });
  return sendAppSessionError(res, error);
}

function createAppCatalogRouter(options = {}) {
  const service = options.service || createAppCatalogService(options);
  const sessionService = options.sessionService || createAppSessionService(options);
  const recordAudit = options.recordAudit || (async () => null);
  const router = express.Router(); const requireAppSession = createRequireAppSession(sessionService);
  const audit = (action, metadata = {}, entityId = "") => recordAudit({ module: "app_catalog", action, entity_type: "product", entity_id: entityId, includeBody: false, metadata, source: "app" });

  router.get("/catalog", requireAppSession, async (req, res) => {
    try {
      const payload = await service.list(req.query || {});
      const action = req.query?.busca ? "SEARCH" : req.query?.categoria ? "CATEGORY_VIEW" : "CATALOG_VIEW";
      await audit(action, { page: payload.data.pagination.page, pageSize: payload.data.pagination.limit, hasSearch: Boolean(req.query?.busca), categoryFiltered: Boolean(req.query?.categoria), brandFiltered: Boolean(req.query?.marca) });
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });
  router.get("/catalog/categories", requireAppSession, async (_req, res) => {
    try { const payload = await service.categories(); await audit("CATEGORY_VIEW", { categoryCount: payload.data.categories.length }); res.json(payload); }
    catch (error) { sendError(res, error); }
  });
  router.get("/catalog/:productId", requireAppSession, async (req, res) => {
    try { const payload = await service.detail(req.params.productId); await audit("PRODUCT_VIEW", {}, payload.data.product.id); res.json(payload); }
    catch (error) { sendError(res, error); }
  });
  return router;
}

module.exports = { createAppCatalogRouter };
