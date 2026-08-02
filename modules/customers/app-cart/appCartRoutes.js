"use strict";
const express = require("express");
const { createAppSessionService } = require("../app-auth/appSessionService");
const { createRequireAppSession, sendAppSessionError } = require("../app-auth/appSessionRoutes");
const { AppCartError, createAppCartService } = require("./appCartService");

function sendError(res, error) {
  if (error instanceof AppCartError) {
    return res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
      meta: { api_version: "v1" }
    });
  }
  return sendAppSessionError(res, error);
}

function createAppCartRouter(options = {}) {
  const service = options.service || createAppCartService(options);
  const sessionService = options.sessionService || createAppSessionService(options);
  const recordAudit = options.recordAudit || (async () => null);
  const router = express.Router();
  const requireAppSession = createRequireAppSession(sessionService);
  const audit = (action, metadata = {}, entityId = "") =>
    recordAudit({ module: "app_cart", action, entity_type: "cart", entity_id: entityId, includeBody: false, metadata, source: "app" });

  // GET /cart — retorna carrinho ativo com refresh automático
  router.get("/cart", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.getOrRefreshCart(accountId);
      if (!payload) {
        return res.json({ success: true, data: { cart: null, items: [] }, meta: { api_version: "v1" } });
      }
      await audit("CART_VIEW", { item_count: payload.cart.item_count, subtotal_cents: payload.cart.subtotal_cents }, payload.cart.id);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // GET /cart/:cartId — carrinho específico
  router.get("/cart/:cartId", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.getCart(accountId, req.params.cartId);
      await audit("CART_VIEW", { item_count: payload.cart.item_count }, payload.cart.id);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // POST /cart/items — adicionar item ao carrinho
  router.post("/cart/items", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const { product_id, variant_id, quantity } = req.body || {};
      if (!product_id) throw new AppCartError("PRODUCT_ID_REQUIRED", 400, "product_id e obrigatorio.");
      const payload = await service.addItem(accountId, product_id, variant_id, quantity);
      await audit("ADD_ITEM", { product_id, variant_id, quantity: quantity || 1 }, payload.data.cart.id);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // PATCH /cart/items/:itemId — atualizar quantidade
  router.patch("/cart/items/:itemId", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const { quantity } = req.body || {};
      if (!quantity) throw new AppCartError("QUANTITY_REQUIRED", 400, "quantity e obrigatoria.");
      const payload = await service.updateItemQuantity(accountId, req.params.cartId || "", req.params.itemId, quantity);
      await audit("UPDATE_ITEM", { item_id: req.params.itemId, quantity }, payload.data.cart.id);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // DELETE /cart/items/:itemId — remover item
  router.delete("/cart/items/:itemId", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.removeItem(accountId, req.params.cartId || "", req.params.itemId);
      await audit("REMOVE_ITEM", { item_id: req.params.itemId }, payload.data.cart.id);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // DELETE /cart — limpar carrinho inteiro
  router.delete("/cart", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.clearCart(accountId, req.params.cartId || "");
      await audit("CLEAR_CART", {}, payload.data.cart.id);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  // POST /cart/close — fechar carrinho (sem conversão)
  router.post("/cart/close", requireAppSession, async (req, res) => {
    try {
      const accountId = req.appSession.account.id;
      const payload = await service.closeCart(accountId, req.params.cartId || "");
      await audit("CLOSE_CART", {}, payload.data.cart.id);
      res.json(payload);
    } catch (error) { sendError(res, error); }
  });

  return router;
}

module.exports = { createAppCartRouter };
