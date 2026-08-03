"use strict";

/**
 * paymentAttemptRoutes — Rotas REST para pagamento PIX via InfinitePay.
 *
 * POST /app/v1/orders/:id/pay — Cria tentativa PIX
 * GET  /app/v1/payments/:id/status — Consulta status
 * GET  /app/v1/orders/:id/payments — Lista tentativas
 */

const { PaymentAttemptError } = require("./paymentAttemptService");

function sendSuccess(res, statusCode, data) {
  res.status(statusCode).json({ ok: true, data });
}

function sendError(res, err) {
  if (err instanceof PaymentAttemptError) {
    res.status(err.status).json({
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  } else {
    res.status(500).json({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Erro interno do servidor",
      },
    });
  }
}

function createPaymentAttemptRouter(options = {}) {
  const { Router } = options.express || require("express");
  const router = new Router();
  const service = options.paymentService;

  if (!service) {
    throw new Error("PAYMENT_SERVICE_REQUIRED");
  }

  function extractAccountId(req) {
    const auth = req.headers?.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return null;
    }
    return req.user?.id || req.user?.accountId || null;
  }

  // POST /app/v1/orders/:id/pay — Criar tentativa PIX
  router.post("/orders/:id/pay", async (req, res) => {
    try {
      const accountId = extractAccountId(req);
      if (!accountId) {
        return res.status(401).json({
          ok: false,
          error: { code: "UNAUTHORIZED", message: "Autenticação necessária" },
        });
      }
      const orderId = req.params.id;
      const result = await service.createPixAttempt(orderId, {
        clientAmountCents: req.body?.amount_cents,
        expires_at: req.body?.expires_at,
      });
      const statusCode = result.success ? 201 : 400;
      sendSuccess(res, statusCode, result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // GET /app/v1/payments/:id/status — Consultar status
  router.get("/payments/:id/status", async (req, res) => {
    try {
      const accountId = extractAccountId(req);
      if (!accountId) {
        return res.status(401).json({
          ok: false,
          error: { code: "UNAUTHORIZED", message: "Autenticação necessária" },
        });
      }
      const attemptId = req.params.id;
      const result = await service.getPixAttemptStatus(attemptId);
      sendSuccess(res, 200, result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // GET /app/v1/orders/:id/payments — Listar tentativas
  router.get("/orders/:id/payments", async (req, res) => {
    try {
      const accountId = extractAccountId(req);
      if (!accountId) {
        return res.status(401).json({
          ok: false,
          error: { code: "UNAUTHORIZED", message: "Autenticação necessária" },
        });
      }
      const orderId = req.params.id;
      const result = await service.listAttemptsByOrder(orderId);
      sendSuccess(res, 200, result);
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}

module.exports = { createPaymentAttemptRouter, PaymentAttemptError };
