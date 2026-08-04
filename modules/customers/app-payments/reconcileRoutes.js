"use strict";

/**
 * reconcileRoutes — Endpoints de reconciliação manual e consulta de status.
 *
 * POST /app/v1/payment-attempts/:id/reconcile
 *   - Autenticado (accountId)
 *   - Consulta payment_check
 *   - Valida 7 condições
 *   - Finaliza atomicamente
 *
 * GET /app/v1/payment-attempts/:id/status
 *   - Autenticado (accountId)
 *   - Retorna estado público seguro
 *   - NUNCA retorna payload bruto do provider
 */

const { ReconciliationError } = require("./infinitePayReconciliationService");

function sendSuccess(res, data = {}) {
  res.status(200).json({ ok: true, ...data });
}

function sendError(res, err) {
  const code = err.code || "INTERNAL_ERROR";
  const status = err.status || 500;
  res.status(status).json({
    ok: false,
    error: {
      code,
      message: err.message || "Erro interno",
    },
  });
}

function extractAccountId(req) {
  // Bearer token → accountId (mesmo padrão de paymentAttemptRoutes)
  const authHeader = req.headers?.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  // Fallback: query param (teste)
  return req.query?.account_id || null;
}

function createReconcileRouter(options = {}) {
  const reconciliationService = options.reconciliationService;
  if (!reconciliationService) {
    throw new Error("RECONCILIATION_SERVICE_REQUIRED for reconcileRouter");
  }

  const routes = [];

  function post(path, handler) {
    routes.push({ method: "POST", path, handler });
  }

  function get(path, handler) {
    routes.push({ method: "GET", path, handler });
  }

  // Register routes
  post("/app/v1/payment-attempts/:id/reconcile", handleReconcile);
  get("/app/v1/payment-attempts/:id/status", handleGetStatus);

  function handle(req, res, next) {
    const url = req.url || "";
    const method = (req.method || "GET").toUpperCase();

    for (const route of routes) {
      // Parse params from route pattern
      const params = matchRoute(route.path, url);
      if (params && route.method === method) {
        req.params = { ...req.params, ...params };
        return Promise.resolve()
          .then(() => route.handler(req, res, next))
          .catch(err => sendError(res, err));
      }
    }

    if (next) {
      next();
    } else {
      res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Rota não encontrada" } });
    }
  }

  function matchRoute(pattern, url) {
    const patternParts = pattern.split("/");
    const urlParts = (url.split("?")[0]).split("/");

    if (patternParts.length !== urlParts.length) return null;

    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(":")) {
        params[patternParts[i].slice(1)] = urlParts[i];
      } else if (patternParts[i] !== urlParts[i]) {
        return null;
      }
    }
    return params;
  }

  async function handleReconcile(req, res) {
    const accountId = extractAccountId(req);
    if (!accountId) {
      return sendError(res, {
        code: "ACCOUNT_ID_REQUIRED",
        message: "account_id obrigatório",
        status: 401,
      });
    }

    const attemptId = req.params?.id;
    if (!attemptId) {
      return sendError(res, {
        code: "ATTEMPT_ID_REQUIRED",
        message: "ID da tentativa obrigatório",
        status: 400,
      });
    }

    try {
      const result = await reconciliationService.reconcileAttempt(accountId, attemptId);
      sendSuccess(res, result);
    } catch (err) {
      if (err instanceof ReconciliationError) {
        sendError(res, err);
      } else {
        sendError(res, {
          code: "INTERNAL_ERROR",
          message: err.message || "Erro interno",
          status: 500,
        });
      }
    }
  }

  async function handleGetStatus(req, res) {
    const accountId = extractAccountId(req);
    if (!accountId) {
      return sendError(res, {
        code: "ACCOUNT_ID_REQUIRED",
        message: "account_id obrigatório",
        status: 401,
      });
    }

    const attemptId = req.params?.id;
    if (!attemptId) {
      return sendError(res, {
        code: "ATTEMPT_ID_REQUIRED",
        message: "ID da tentativa obrigatório",
        status: 400,
      });
    }

    try {
      const result = await reconciliationService.getAttemptStatus(accountId, attemptId);
      sendSuccess(res, result);
    } catch (err) {
      if (err instanceof ReconciliationError) {
        sendError(res, err);
      } else {
        sendError(res, {
          code: "INTERNAL_ERROR",
          message: err.message || "Erro interno",
          status: 500,
        });
      }
    }
  }

  return { handle, routes };
}

module.exports = { createReconcileRouter };
