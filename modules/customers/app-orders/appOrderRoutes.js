"use strict";

const express = require("express");

function createAppOrderRouter(service) {
  const router = express.Router();

  router.post("/", async (req, res, next) => {
    try {
      const accountId = req.customerAccountId || req.body.account_id;
      if (!accountId) {
        return res.status(400).json({ success: false, error: { code: "ACCOUNT_REQUIRED", message: "Identificador de conta obrigatorio." } });
      }
      const result = await service.createOrder(accountId, req.body || {});
      res.status(result.data.duplicate ? 200 : 201).json(result);
    } catch (err) {
      if (err.code) {
        return res.status(err.status || 400).json({ success: false, error: { code: err.code, message: err.message } });
      }
      next(err);
    }
  });

  router.get("/", async (req, res, next) => {
    try {
      const accountId = req.customerAccountId;
      if (!accountId) {
        return res.status(400).json({ success: false, error: { code: "ACCOUNT_REQUIRED", message: "Identificador de conta obrigatorio." } });
      }
      const result = await service.listOrders(accountId);
      res.status(200).json(result);
    } catch (err) {
      if (err.code) {
        return res.status(err.status || 400).json({ success: false, error: { code: err.code, message: err.message } });
      }
      next(err);
    }
  });

  router.get("/:orderId", async (req, res, next) => {
    try {
      const accountId = req.customerAccountId;
      if (!accountId) {
        return res.status(400).json({ success: false, error: { code: "ACCOUNT_REQUIRED", message: "Identificador de conta obrigatorio." } });
      }
      const result = await service.getOrder(accountId, req.params.orderId);
      res.status(200).json(result);
    } catch (err) {
      if (err.code) {
        return res.status(err.status || 400).json({ success: false, error: { code: err.code, message: err.message } });
      }
      next(err);
    }
  });

  router.post("/:orderId/expire", async (req, res, next) => {
    try {
      const accountId = req.customerAccountId;
      if (!accountId) {
        return res.status(400).json({ success: false, error: { code: "ACCOUNT_REQUIRED", message: "Identificador de conta obrigatorio." } });
      }
      const result = await service.expireOrder(accountId, req.params.orderId);
      res.status(200).json(result);
    } catch (err) {
      if (err.code) {
        return res.status(err.status || 400).json({ success: false, error: { code: err.code, message: err.message } });
      }
      next(err);
    }
  });

  router.post("/:orderId/release", async (req, res, next) => {
    try {
      const accountId = req.customerAccountId;
      if (!accountId) {
        return res.status(400).json({ success: false, error: { code: "ACCOUNT_REQUIRED", message: "Identificador de conta obrigatorio." } });
      }
      const result = await service.releaseOrder(accountId, req.params.orderId);
      res.status(200).json(result);
    } catch (err) {
      if (err.code) {
        return res.status(err.status || 400).json({ success: false, error: { code: err.code, message: err.message } });
      }
      next(err);
    }
  });

  return router;
}

module.exports = { createAppOrderRouter };
