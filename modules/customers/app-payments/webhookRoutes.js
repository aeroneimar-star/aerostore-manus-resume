"use strict";

/**
 * webhookRoutes — Endpoint de webhook da InfinitePay.
 *
 * POST /webhooks/infinitepay
 *
 * Responsabilidade: receber notificações do provider,
 * registrar evento com idempotência, retornar 200 rapidamente.
 *
 * NUNCA marca pedido como PAID.
 * NUNCA baixa estoque.
 *
 * Autenticação: sem auth (webhook é público do provider).
 * Opcional: validação de assinatura HMAC (futura).
 */

const { createInfinitePayReconciliationService, ReconciliationError } = require("./infinitePayReconciliationService");
const { sanitizeResponse, sanitizeFailureMessage } = require("./sanitizeResponse");

const WEBHOOK_ENABLED_FLAG = "INFINITEPAY_WEBHOOK_ENABLED";

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

function isWebhookEnabled() {
  return process.env[WEBHOOK_ENABLED_FLAG] === "true";
}

function createWebhookRouter(options = {}) {
  const reconciliationService = options.reconciliationService;
  if (!reconciliationService) {
    throw new Error("RECONCILIATION_SERVICE_REQUIRED for webhookRouter");
  }

  function router() {
    // Simple express-like router interface
    const routes = [];

    function post(path, handler) {
      routes.push({ method: "POST", path, handler });
    }

    function get(path, handler) {
      routes.push({ method: "GET", path, handler });
    }

    function handle(req, res, next) {
      const url = req.url || "";
      const method = (req.method || "GET").toUpperCase();
      const matched = routes.find(r => {
        if (r.method !== method) return false;
        if (r.path.endsWith("*")) {
          return url.startsWith(r.path.slice(0, -1));
        }
        // Simple path matching
        return url === r.path || url.startsWith(r.path + "?");
      });

      if (matched) {
        Promise.resolve()
          .then(() => matched.handler(req, res, next))
          .catch(err => {
            sendError(res, err);
          });
      } else if (next) {
        next();
      } else {
        res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Rota não encontrada" } });
      }
    }

    // Register routes
    post("/webhooks/infinitepay", handleInfinitePayWebhook);
    post("/webhooks/infinitepay*", handleInfinitePayWebhook);

    return { handle, routes };
  }

  async function handleInfinitePayWebhook(req, res) {
    // Gate: flag must be enabled
    if (!isWebhookEnabled()) {
      return sendSuccess(res, {
        message: "Webhook desabilitado. Configure INFINITEPAY_WEBHOOK_ENABLED=true.",
      });
    }

    // Validate content-type
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
      return sendError(res, {
        code: "INVALID_CONTENT_TYPE",
        message: "Content-Type deve ser application/json",
        status: 400,
      });
    }

    // Parse body
    let body;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch (e) {
      return sendError(res, {
        code: "INVALID_JSON",
        message: "Payload JSON inválido",
        status: 400,
      });
    }

    // Delegate to reconciliation service
    try {
      const result = await reconciliationService.handleWebhook(body);
      res.status(result.statusCode || 200).json({
        ok: result.success,
        ...result,
      });
    } catch (err) {
      sendError(res, err);
    }
  }

  const r = router();
  return {
    handle: r.handle,
    isWebhookEnabled,
  };
}

module.exports = { createWebhookRouter };
