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
 *
 * Contrato HTTP:
 *   SUCESSO: { ok: true, ...data }
 *   ERRO:    { ok: false, error: { code, message, details } }
 */

const express = require("express");
const { createHash } = require("crypto");

const WEBHOOK_ENABLED_FLAG = "INFINITEPAY_WEBHOOK_ENABLED";

function sendSuccess(res, data = {}) {
  res.status(200).json({ ok: true, ...data });
}

function sendError(res, code, message, status = 400, details = null) {
  res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

function isWebhookEnabled() {
  return process.env[WEBHOOK_ENABLED_FLAG] === "true";
}

/**
 * computeWebhookRequestHash — Hash canônico para idempotência do webhook.
 * Inclui: provider, event_type, order_nsu, transaction_nsu, invoice_slug,
 *         capture_method, amount, paid_amount, paid
 * NUNCA retorna null.
 */
function computeWebhookRequestHash(body) {
  const input = [
    "INFINITEPAY",
    body.event_type || "PAYMENT_UPDATED",
    body.order_nsu || "",
    body.transaction_nsu || "",
    body.invoice_slug || "",
    (body.capture_method || "").toLowerCase(),
    String(body.amount || 0),
    String(body.paid_amount || 0),
    String(Boolean(body.paid)),
  ].join("|");
  return createHash("sha256").update(input).digest("hex");
}

function createWebhookRouter(options = {}) {
  const { Router } = options.express || express;
  const reconciliationService = options.reconciliationService;
  if (!reconciliationService) {
    throw new Error("RECONCILIATION_SERVICE_REQUIRED for webhookRouter");
  }

  const router = new Router();

  router.post("/webhooks/infinitepay", async (req, res) => {
    // Gate: flag deve estar habilitada
    if (!isWebhookEnabled()) {
      return sendSuccess(res, {
        message: "Webhook desabilitado. Configure INFINITEPAY_WEBHOOK_ENABLED=true.",
      });
    }

    // Validar content-type
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
      return sendError(res, "INVALID_CONTENT_TYPE", "Content-Type deve ser application/json", 400);
    }

    // Body já parseado pelo express.json()
    const body = req.body;
    if (!body || typeof body !== "object") {
      return sendError(res, "INVALID_PAYLOAD", "Payload inválido", 400);
    }

    // order_nsu obrigatório para localizar pedido
    const orderNsu = body.order_nsu || "";
    if (!orderNsu) {
      return sendError(res, "MISSING_ORDER_NSU", "order_nsu obrigatório no webhook", 400);
    }

    // Calcular request_hash para idempotência
    const requestHash = computeWebhookRequestHash(body);

    // Delegar ao serviço de reconciliação (o service calcula o hash internamente)
    try {
      const result = await reconciliationService.handleWebhook(body);

      if (result.success) {
        return sendSuccess(res, result);
      } else {
        return sendError(res, result.error || "WEBHOOK_FAILED", result.message || "Falha no webhook", result.statusCode || 400);
      }
    } catch (err) {
      const code = err.code || "INTERNAL_ERROR";
      const status = err.status || 500;
      return sendError(res, code, err.message || "Erro interno", status);
    }
  });

  return router;
}

module.exports = {
  createWebhookRouter,
  computeWebhookRequestHash,
  isWebhookEnabled,
};
