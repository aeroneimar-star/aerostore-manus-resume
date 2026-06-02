"use strict";

const express = require("express");
const {
  searchExchangeOrigins,
  createExchangeDraft,
  setExchangeReturnedItem,
  setExchangeNewItem,
  setExchangeCustomer,
  updateExchangeNewItemQuantity,
  removeExchangeNewItem,
  updateExchangeReason,
  finalizeExchange,
  getExchange,
  listExchanges,
  listExchangeCredits,
  createManualExchangeCredit,
  cancelManualExchangeCredit
} = require("../exchanges/pdvExchangeService");
const { ensureOpenCashRegisterForStore } = require("../utils/pdvCashRegisterGuard");
const { normalizeStoreKey } = require("../utils/pdvStoreUtils");

const router = express.Router();

function hasPermission(user = {}, permission = "") {
  return Boolean(user?.permissions?.[permission]);
}

function hasAnyPermission(user = {}, permissions = []) {
  return permissions.some((permission) => hasPermission(user, permission));
}

function requireExchangePermission(permissions = [], message = "Seu perfil nao pode executar esta acao de troca.") {
  return (req, res, next) => {
    if (hasAnyPermission(req.user || {}, permissions)) {
      return next();
    }
    return res.status(403).json({ error: message, permissions });
  };
}

const canViewExchange = requireExchangePermission(["can_view_exchanges", "can_sell"], "Seu perfil nao pode acessar trocas.");
const canGenerateExchangeCredit = requireExchangePermission(["can_generate_exchange_credit", "can_sell"], "Seu perfil nao pode gerar Credito de Troca.");
const canCreateManualExchangeCredit = requireExchangePermission(["can_generate_exchange_credit", "can_create_manual_exchange_credit"], "Seu perfil nao pode criar Credito de Troca manual.");
const canCancelManualExchangeCredit = requireExchangePermission(["can_generate_exchange_credit", "can_cancel_manual_exchange_credit"], "Seu perfil nao pode cancelar Credito de Troca manual.");

function sendRouteError(res, error, fallbackMessage = "Falha ao processar troca do PDV.") {
  const status = error?.statusCode || error?.status || 400;
  res.status(status).json({ error: error?.message || fallbackMessage });
}

router.get("/", canViewExchange, (req, res) => {
  try {
    res.json(listExchanges(req.query || {}, req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao listar trocas do PDV.");
  }
});

router.get("/search-origin", canViewExchange, (req, res) => {
  try {
    res.json(searchExchangeOrigins(req.query.q || req.query.search || "", req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao buscar venda original para troca.");
  }
});

router.get("/credits/active", canViewExchange, (req, res) => {
  try {
    res.json(listExchangeCredits(req.query || {}, req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao consultar Creditos de Troca.");
  }
});

router.post("/credits/manual", canCreateManualExchangeCredit, (req, res) => {
  try {
    res.json(createManualExchangeCredit(req.body || {}, req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao criar Credito de Troca manual.");
  }
});

router.post("/credits/:creditId/cancel", canCancelManualExchangeCredit, (req, res) => {
  try {
    res.json(cancelManualExchangeCredit(req.params.creditId, req.body || {}, req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao cancelar Credito de Troca manual.");
  }
});

router.post("/draft", canViewExchange, (req, res) => {
  try {
    res.json(createExchangeDraft(req.body || {}, req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao criar rascunho de troca.");
  }
});

router.get("/:exchangeId", canViewExchange, (req, res) => {
  try {
    res.json(getExchange(req.params.exchangeId, req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao carregar troca.");
  }
});

router.patch("/:exchangeId/returned-item", canViewExchange, (req, res) => {
  try {
    res.json(setExchangeReturnedItem(req.params.exchangeId, req.body || {}, req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao selecionar item devolvido.");
  }
});

router.patch("/:exchangeId/new-item", canViewExchange, (req, res) => {
  try {
    res.json(setExchangeNewItem(req.params.exchangeId, req.body || {}, req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao selecionar novo produto.");
  }
});

router.patch("/:exchangeId/customer", canViewExchange, (req, res) => {
  try {
    res.json(setExchangeCustomer(req.params.exchangeId, req.body || {}, req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao vincular cliente da troca.");
  }
});

router.patch("/:exchangeId/new-items/:lineId", canViewExchange, (req, res) => {
  try {
    res.json(updateExchangeNewItemQuantity(req.params.exchangeId, req.params.lineId, req.body || {}, req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao atualizar item do carrinho de troca.");
  }
});

router.delete("/:exchangeId/new-items/:lineId", canViewExchange, (req, res) => {
  try {
    res.json(removeExchangeNewItem(req.params.exchangeId, req.params.lineId, req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao remover item do carrinho de troca.");
  }
});

router.patch("/:exchangeId/reason", canViewExchange, (req, res) => {
  try {
    res.json(updateExchangeReason(req.params.exchangeId, req.body || {}, req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao salvar motivo da troca.");
  }
});

router.post("/:exchangeId/finalize", canGenerateExchangeCredit, async (req, res) => {
  try {
    const exchange = getExchange(req.params.exchangeId, req.user || {});
    const storeId = normalizeStoreKey(
      exchange?.store_id
      || exchange?.origin_store
      || exchange?.original_sale_summary?.store_id
      || req.body?.store_id
      || req.body?.loja
      || req.user?.store_id
      || req.user?.store
      || ""
    );
    await ensureOpenCashRegisterForStore(req, storeId, {
      module: "exchange_credit",
      action: "exchange_blocked_without_open_cash",
      entityType: "exchange",
      entityId: req.params.exchangeId,
      saleId: exchange?.original_sale_id || exchange?.origin_sale_id || "",
      message: "Caixa fechado. Abra o caixa da loja antes de finalizar troca."
    });
    res.json(finalizeExchange(req.params.exchangeId, req.body || {}, req.user || {}));
  } catch (error) {
    sendRouteError(res, error, "Falha ao finalizar troca.");
  }
});

module.exports = {
  pdvExchangeRouter: router
};
