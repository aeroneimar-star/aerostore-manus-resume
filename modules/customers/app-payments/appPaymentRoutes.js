"use strict";

const express = require("express");
const { createPaymentEngine } = require("./PaymentEngine");
const { createWebhookEngine } = require("./WebhookEngine");
const { createReconciliationService } = require("./ReconciliationService");
const { envelope, PaymentError } = require("./appPaymentDto");

function createAppPaymentRouter(options = {}) {
  const router = express.Router();
  const db = options.dbApi;
  const provider = options.provider;
  const paymentEngine = createPaymentEngine({
    dbApi: db,
    provider,
    recordAudit: options.recordAudit,
    onPaymentApproved: options.onPaymentApproved,
    onPaymentFailed: options.onPaymentFailed
  });
  const webhookEngine = createWebhookEngine({
    dbApi: db,
    provider,
    paymentEngine,
    recordAudit: options.recordAudit,
    onPaymentApproved: options.onPaymentApproved
  });
  const reconciliationService = createReconciliationService({
    dbApi: db,
    provider,
    paymentEngine,
    recordAudit: options.recordAudit
  });

  router.get("/health", async (req, res) => {
    try {
      const health = await provider.health();
      res.json({ success: true, data: health, meta: { api_version: "v1" } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: "HEALTH_CHECK_FAILED", message: err.message } });
    }
  });

  router.post("/payments", async (req, res) => {
    try {
      const payment = await paymentEngine.createPayment(req.body);
      res.status(201).json(envelope(payment));
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
    }
  });

  router.post("/payments/:paymentId/attempts", async (req, res) => {
    try {
      const attempt = await paymentEngine.createPaymentAttempt(req.params.paymentId);
      res.status(201).json(envelope(attempt));
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
    }
  });

  router.get("/payments/:paymentId", async (req, res) => {
    try {
      const payment = await paymentEngine.getPayment(req.params.paymentId);
      if (!payment) {
        res.status(404).json({ success: false, error: { code: "PAYMENT_NOT_FOUND" } });
        return;
      }
      res.json(envelope(payment));
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
    }
  });

  router.get("/payments/:paymentId/attempts", async (req, res) => {
    try {
      const attempts = await paymentEngine.getPaymentAttempts(req.params.paymentId);
      res.json(envelope(attempts));
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
    }
  });

  router.get("/payments/:paymentId/events", async (req, res) => {
    try {
      const events = await paymentEngine.getPaymentEvents(req.params.paymentId);
      res.json(envelope(events));
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
    }
  });

  router.post("/payments/:paymentId/cancel", async (req, res) => {
    try {
      const payment = await paymentEngine.cancelPayment(req.params.paymentId, req.body?.reason);
      res.json(envelope(payment));
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
    }
  });

  router.post("/payments/:paymentId/expire", async (req, res) => {
    try {
      const payment = await paymentEngine.expirePayment(req.params.paymentId);
      res.json(envelope(payment));
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
    }
  });

  router.post("/payments/:paymentId/query", async (req, res) => {
    try {
      const payment = await paymentEngine.queryPayment(req.params.paymentId);
      if (!payment) {
        res.status(404).json({ success: false, error: { code: "PAYMENT_NOT_FOUND" } });
        return;
      }
      res.json(envelope(payment));
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
    }
  });

  router.get("/orders/:orderId/payments", async (req, res) => {
    try {
      const payments = await paymentEngine.getPaymentsByOrder(req.params.orderId);
      res.json(envelope(payments));
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
    }
  });

  router.post("/webhook", async (req, res) => {
    try {
      const result = await webhookEngine.handleWebhook(req.body, req.headers["x-webhook-signature"]);
      res.json({ success: true, data: result, meta: { api_version: "v1" } });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
    }
  });

  router.post("/reconciliation/:paymentId", async (req, res) => {
    try {
      const report = await reconciliationService.reconcilePayment(req.params.paymentId);
      res.json(envelope(report));
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
    }
  });

  router.post("/reconciliation/all", async (req, res) => {
    try {
      const results = await reconciliationService.reconcileAllPending();
      res.json(envelope(results));
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ success: false, error: { code: err.code, message: err.message } });
    }
  });

  return {
    router,
    paymentEngine,
    webhookEngine,
    reconciliationService
  };
}

module.exports = { createAppPaymentRouter };
