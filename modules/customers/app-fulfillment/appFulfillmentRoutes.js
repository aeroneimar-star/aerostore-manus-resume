"use strict";

const express = require("express");
const { createAppSessionService } = require("../app-auth/appSessionService");
const { createRequireAppSession, sendAppSessionError } = require("../app-auth/appSessionRoutes");
const { AppFulfillmentError, createAppFulfillmentService } = require("./appFulfillmentService");
const { ShippingQuoteError } = require("./shippingQuoteProvider");

function sendError(res, error) {
  if (error instanceof AppFulfillmentError) {
    return res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
      meta: { api_version: "v1" }
    });
  }
  if (error instanceof ShippingQuoteError) {
    return res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
      meta: { api_version: "v1" }
    });
  }
  return sendAppSessionError(res, error);
}

function createAppFulfillmentRouter(options = {}) {
  const service = options.service || createAppFulfillmentService(options);
  const sessionService = options.sessionService || createAppSessionService(options);
  const recordAudit = options.recordAudit || (async () => null);
  const router = express.Router();
  const requireAppSession = createRequireAppSession(sessionService);
  const audit = (action, metadata = {}, entityId = "") =>
    recordAudit({ module: "app_fulfillment", action, entity_type: "fulfillment", entity_id: entityId, includeBody: false, metadata, source: "app" });

  // GET /cart/fulfillment-options
  router.get("/cart/fulfillment-options", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.getFulfillmentOptions(accountId);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // PUT /cart/fulfillment
  router.put("/cart/fulfillment", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.setFulfillment(accountId, req.body || {});
      await audit("FULFILLMENT_SET", { fulfillment_type: req.body?.fulfillment_type || "" }, payload.data.id);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // POST /cart/shipping-quote
  router.post("/cart/shipping-quote", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.requestShippingQuote(accountId);
      await audit("SHIPPING_QUOTE_REQUESTED", { account_id: accountId }, "");
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // GET /cart/delivery-summary
  router.get("/cart/delivery-summary", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.getDeliverySummary(accountId);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  return router;
}

module.exports = { createAppFulfillmentRouter };
