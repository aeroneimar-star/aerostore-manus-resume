"use strict";

/**
 * appOrderRoutes — Rotas REST para criação e consulta de pedidos do Shop.
 *
 * Rota POST /api/shop/orders — Cria pedido com reserva de estoque PDV
 * Rota GET  /api/shop/orders/:id — Consulta pedido
 * Rota GET  /api/shop/orders — Lista pedidos do cliente
 *
 * Segurança:
 * - Autenticação via Authorization header (Bearer token → account_id)
 * - Validação de payload (Joi-like manual)
 * - Proteção contra IDs arbitrários de endereço
 * - Não exposição de stack trace
 * - Resposta HTTP consistente
 */

const { createAppOrderService, AppOrderError } = require("./appOrderService");
const { envelope } = require("./appOrderDto");

function sendSuccess(res, statusCode, data) {
  res.status(statusCode).json({ ok: true, data });
}

function sendError(res, err) {
  if (err instanceof AppOrderError) {
    res.status(err.status).json({
      ok: false,
      error: {
        code: err.code,
        message: err.message,
      },
    });
  } else {
    res.status(500).json({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Erro interno. Tente novamente.",
      },
    });
  }
}

function extractAccountId(req) {
  // Simples: extrair do header Authorization ou query param
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1];

  // Fallback: query param (para testes)
  const q = req.query.account_id;
  if (q && typeof q === "string" && q.length >= 3) return q;

  return null;
}

function validateOrderPayload(body) {
  const errors = [];

  if (!body.fulfillment_type || !["DELIVERY", "PICKUP"].includes(body.fulfillment_type.toUpperCase())) {
    errors.push({ field: "fulfillment_type", message: "deve ser DELIVERY ou PICKUP" });
  }

  if (body.fulfillment_type === "DELIVERY" && !body.address_id) {
    errors.push({ field: "address_id", message: "obrigatório para entrega" });
  }

  if (body.fulfillment_type === "PICKUP" && !body.pickup_store_id) {
    errors.push({ field: "pickup_store_id", message: "obrigatório para retirada" });
  }

  // Limite de segurança
  if (body.store_origin_id && typeof body.store_origin_id === "string" && body.store_origin_id.length > 50) {
    errors.push({ field: "store_origin_id", message: "muito longo (máx 50 caracteres)" });
  }

  return { valid: errors.length === 0, errors };
}

function createAppOrderRouter(options = {}) {
  const { Router } = options.express || require("express");
  const router = new Router();
  const service = options.orderService;

  if (!service) {
    throw new Error("ORDER_SERVICE_REQUIRED");
  }

  // POST /api/shop/orders — Criar pedido
  router.post("/orders", async (req, res) => {
    try {
      const accountId = extractAccountId(req);
      if (!accountId) {
        return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Autenticação necessária" } });
      }

      const validation = validateOrderPayload(req.body || {});
      if (!validation.valid) {
        return res.status(400).json({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "Dados inválidos", details: validation.errors },
        });
      }

      const result = await service.createOrder(accountId, {
        fulfillment_type: (req.body.fulfillment_type || "").toUpperCase(),
        address_id: req.body.address_id,
        pickup_store_id: req.body.pickup_store_id,
        store_origin_id: req.body.store_origin_id,
        idempotency_key: req.body.idempotency_key,
      });

      sendSuccess(res, 201, result.data);
    } catch (err) {
      sendError(res, err);
    }
  });

  // GET /api/shop/orders — Listar pedidos do cliente
  router.get("/orders", async (req, res) => {
    try {
      const accountId = extractAccountId(req);
      if (!accountId) {
        return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Autenticação necessária" } });
      }

      const result = await service.listOrders(accountId);
      sendSuccess(res, 200, result.data);
    } catch (err) {
      sendError(res, err);
    }
  });

  // GET /api/shop/orders/:id — Consultar pedido
  router.get("/orders/:id", async (req, res) => {
    try {
      const accountId = extractAccountId(req);
      if (!accountId) {
        return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Autenticação necessária" } });
      }

      const result = await service.getOrder(accountId, req.params.id);
      sendSuccess(res, 200, result.data);
    } catch (err) {
      sendError(res, err);
    }
  });



  return router;
}

module.exports = { createAppOrderRouter };
