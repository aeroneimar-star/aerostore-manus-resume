"use strict";

const express = require("express");
const { createAppSessionService } = require("../app-auth/appSessionService");
const { createRequireAppSession, sendAppSessionError } = require("../app-auth/appSessionRoutes");
const { AppAddressError, createAppAddressService } = require("./appAddressService");
const { createPostalCodeService, PostalCodeError } = require("./postalCodeService");

function sendError(res, error) {
  if (error instanceof AppAddressError) {
    return res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
      meta: { api_version: "v1" }
    });
  }
  if (error instanceof PostalCodeError) {
    return res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
      meta: { api_version: "v1" }
    });
  }
  return sendAppSessionError(res, error);
}

function createAppAddressRouter(options = {}) {
  const service = options.service || createAppAddressService(options);
  const postalCodeService = options.postalCodeService || createPostalCodeService(options);
  const sessionService = options.sessionService || createAppSessionService(options);
  const recordAudit = options.recordAudit || (async () => null);
  const router = express.Router();
  const requireAppSession = createRequireAppSession(sessionService);
  const audit = (action, metadata = {}, entityId = "") =>
    recordAudit({ module: "app_address", action, entity_type: "address", entity_id: entityId, includeBody: false, metadata, source: "app" });

  // GET /addresses
  router.get("/addresses", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.listAddresses(accountId);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // POST /addresses
  router.post("/addresses", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.createAddress(accountId, req.body || {});
      await audit("APP_ADDRESS_CREATED", { postal_code: req.body?.postal_code || "" }, payload.data.id);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // GET /addresses/:addressId
  router.get("/addresses/:addressId", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.getAddress(accountId, req.params.addressId);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // PATCH /addresses/:addressId
  router.patch("/addresses/:addressId", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.updateAddress(accountId, req.params.addressId, req.body || {});
      await audit("APP_ADDRESS_UPDATED", { address_id: req.params.addressId }, req.params.addressId);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // DELETE /addresses/:addressId (archive)
  router.delete("/addresses/:addressId", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.archiveAddress(accountId, req.params.addressId);
      await audit("APP_ADDRESS_ARCHIVED", { address_id: req.params.addressId }, req.params.addressId);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // POST /addresses/:addressId/default
  router.post("/addresses/:addressId/default", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.setDefaultAddress(accountId, req.params.addressId);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // GET /postal-code/:postalCode
  router.get("/postal-code/:postalCode", requireAppSession, async (req, res) => {
    try {
      const payload = await postalCodeService.lookup(req.params.postalCode);
      res.json({ success: true, data: payload, meta: { api_version: "v1" } });
    } catch (error) { sendError(res, error); }
  });

  return router;
}

module.exports = { createAppAddressRouter };
