"use strict";

/**
 * reconcileRoutes — Endpoints de reconciliação manual e consulta de status.
 *
 * POST /app/v1/payment-attempts/:id/reconcile
 *   - Autenticado via req.user (middleware existente)
 *   - Consulta payment_check
 *   - Valida 7 condições
 *   - Finaliza atomicamente
 *
 * GET /app/v1/payment-attempts/:id/status
 *   - Autenticado via req.user (middleware existente)
 *   - Retorna estado público seguro
 *   - NUNCA retorna payload bruto do provider
 *
 * Contrato HTTP:
 *   SUCESSO: { ok: true, data: ... }
 *   ERRO:    { ok: false, error: { code, message, details } }
 *
 * Autenticação: usar exclusivamente req.user.id ou req.user.accountId
 * (middleware existente). Sem fallback por query string.
 */

const express = require("express");
const { ReconciliationError } = require("./infinitePayReconciliationService");

function sendSuccess(res, data = {}) {
  res.status(200).json({ ok: true, data });
}

function sendError(res, code, message, status = 500, details = null) {
  res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

function createReconcileRouter(options = {}) {
  const { Router } = options.express || express;
  const reconciliationService = options.reconciliationService;
  if (!reconciliationService) {
    throw new Error("RECONCILIATION_SERVICE_REQUIRED for reconcileRouter");
  }

  const router = new Router();

  /**
   * extractAccountId — Usa exclusivamente req.user.id ou req.user.accountId.
   * NUNCA usa fallback por query string.
   */
  function extractAccountId(req) {
    if (req.user && req.user.id) return req.user.id;
    if (req.user && req.user.accountId) return req.user.accountId;
    return null;
  }

  // POST /app/v1/payment-attempts/:id/reconcile
  router.post("/app/v1/payment-attempts/:id/reconcile", async (req, res) => {
    const accountId = extractAccountId(req);
    if (!accountId) {
      return sendError(res, "UNAUTHORIZED", "Autenticação necessária", 401);
    }

    const attemptId = req.params.id;
    if (!attemptId) {
      return sendError(res, "ATTEMPT_ID_REQUIRED", "ID da tentativa obrigatório", 400);
    }

    try {
      const result = await reconciliationService.reconcileAttempt(accountId, attemptId);
      sendSuccess(res, result);
    } catch (err) {
      if (err instanceof ReconciliationError) {
        sendError(res, err.code, err.message, err.status || 400, err.details);
      } else {
        sendError(res, "INTERNAL_ERROR", err.message || "Erro interno", 500);
      }
    }
  });

  // GET /app/v1/payment-attempts/:id/status
  router.get("/app/v1/payment-attempts/:id/status", async (req, res) => {
    const accountId = extractAccountId(req);
    if (!accountId) {
      return sendError(res, "UNAUTHORIZED", "Autenticação necessária", 401);
    }

    const attemptId = req.params.id;
    if (!attemptId) {
      return sendError(res, "ATTEMPT_ID_REQUIRED", "ID da tentativa obrigatório", 400);
    }

    try {
      const result = await reconciliationService.getAttemptStatus(accountId, attemptId);
      sendSuccess(res, result);
    } catch (err) {
      if (err instanceof ReconciliationError) {
        sendError(res, err.code, err.message, err.status || 400, err.details);
      } else {
        sendError(res, "INTERNAL_ERROR", err.message || "Erro interno", 500);
      }
    }
  });

  return router;
}

module.exports = { createReconcileRouter };
