"use strict";

/**
 * paymentAttemptRoutes — Rotas REST para pagamento PIX via InfinitePay.
 *
 * POST /app/v1/orders/:id/pay — Cria tentativa PIX
 * GET  /app/v1/payment-attempts/:id/status — Consulta status
 * GET  /app/v1/orders/:id/payments — Lista tentativas
 *
 * Todas as rotas exigem req.user (middleware existente).
 * Sem fallback por query string.
 *
 * Contrato HTTP:
 *   SUCESSO: { ok: true, data: ... }
 *   ERRO:    { ok: false, error: { code, message, details } }
 */

const express = require("express");
const { PaymentAttemptError } = require("./paymentAttemptService");
const { ReservationIntegrityError } = require("../app-orders/reservationIntegrityService");

function sendSuccess(res, statusCode, data) {
  res.status(statusCode).json({ ok: true, data });
}

function sendError(res, err) {
  if (err instanceof PaymentAttemptError || err instanceof ReservationIntegrityError) {
    res.status(err.status).json({
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
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
  const { Router } = options.express || express;
  const router = new Router();
  const service = options.paymentService;

  if (!service) {
    throw new Error("PAYMENT_SERVICE_REQUIRED");
  }

  /**
   * extractAccountId — Usa exclusivamente req.user.id ou req.user.accountId.
   * NUNCA usa fallback por query string.
   */
  function extractAccountId(req) {
    if (req.user && req.user.id) return req.user.id;
    if (req.user && req.user.accountId) return req.user.accountId;
    return null;
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
      const result = await service.createPixAttempt(accountId, orderId, {});
      if (result.success) {
        res.status(201).json({ ok: true, data: result });
      } else {
        res.status(400).json({
          ok: false,
          error: {
            code: result.error,
            message: result.message,
          },
        });
      }
    } catch (err) {
      sendError(res, err);
    }
  });

  // GET /app/v1/payment-attempts/:id/status — Consultar status
  router.get("/app/v1/payment-attempts/:id/status", async (req, res) => {
    try {
      const accountId = extractAccountId(req);
      if (!accountId) {
        return res.status(401).json({
          ok: false,
          error: { code: "UNAUTHORIZED", message: "Autenticação necessária" },
        });
      }
      const attemptId = req.params.id;
      const result = await service.getPixAttemptStatus(accountId, attemptId);
      if (result.success) {
        res.status(200).json({ ok: true, data: result });
      } else {
        res.status(result.statusCode || 400).json({
          ok: false,
          error: {
            code: result.error || "STATUS_CHECK_FAILED",
            message: result.message || "Falha ao consultar status",
          },
        });
      }
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
      const result = await service.listAttemptsByOrder(accountId, orderId);
      if (result.success) {
        res.status(200).json({ ok: true, data: result });
      } else {
        res.status(400).json({
          ok: false,
          error: {
            code: result.error,
            message: result.message,
          },
        });
      }
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}

module.exports = { createPaymentAttemptRouter, PaymentAttemptError };
