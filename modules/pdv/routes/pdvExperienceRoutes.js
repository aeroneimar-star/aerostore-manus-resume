"use strict";

const express = require("express");
const { normalizeStoreKey, storesMatch } = require("../utils/pdvStoreUtils");
const {
  getExperienceSummary,
  getMessageTemplates,
  generateCouponForSale,
  getSaleById,
  getCouponBySaleId,
  getCouponDocument,
  queueMessage,
  updateMessageStatus,
  loadMessageQueue,
  loadWelcomeBonuses
} = require("../services/pdvExperienceService");

const router = express.Router();

function normalizeStoreScope(value = "") {
  return normalizeStoreKey(value || "");
}

function canViewAllStores(user = {}) {
  return Boolean(user?.permissions?.can_view_all_stores);
}

function hasPermission(user = {}, permission = "") {
  return Boolean(user?.permissions?.[permission]);
}

function hasAnyPermission(user = {}, permissions = []) {
  return permissions.some((permission) => hasPermission(user, permission));
}

function requireExperiencePermission(permissions = [], message = "Seu perfil nao pode executar esta acao de experiencia.") {
  return (req, res, next) => {
    if (hasAnyPermission(req.user || {}, permissions)) {
      return next();
    }
    return res.status(403).json({ error: message, permissions });
  };
}

const canHandleCoupon = requireExperiencePermission(["can_sell", "can_view_orders", "can_view_cash_register"], "Seu perfil nao pode acessar cupons da venda.");
const canHandleMessages = requireExperiencePermission(["can_use_whatsapp", "can_manage_campaigns"], "Seu perfil nao pode operar mensagens do PDV.");

function getAllowedStores(user = {}) {
  return Array.isArray(user?.allowed_stores)
    ? user.allowed_stores.map((item) => normalizeStoreScope(item)).filter(Boolean)
    : [];
}

function ensureSaleStoreAccess(req, res, sale = null) {
  const saleStore = normalizeStoreScope(sale?.loja || sale?.loja_venda || sale?.store_id || "");
  if (canViewAllStores(req.user || {})) {
    return true;
  }
  const allowedStores = getAllowedStores(req.user || {});
  if (!saleStore || !allowedStores.length) {
    res.status(403).json({ error: "Acesso restrito a sua loja.", store_id: saleStore || "" });
    return false;
  }
  if (allowedStores.some((item) => storesMatch(item, saleStore))) {
    return true;
  }
  res.status(403).json({ error: "Acesso restrito a sua loja.", store_id: saleStore });
  return false;
}

router.get("/manifest", async (req, res) => {
  try {
    const summary = getExperienceSummary();
    res.json({
      templates: Object.keys(getMessageTemplates()),
      queueStatuses: summary.queueStatuses,
      giftStatuses: summary.giftStatuses
    });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o manifesto de experiencia do PDV." });
  }
});

router.get("/summary", async (req, res) => {
  try {
    res.json(getExperienceSummary());
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o resumo de experiencia do PDV." });
  }
});

router.get("/templates", async (req, res) => {
  try {
    res.json({ items: Object.keys(getMessageTemplates()) });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar os templates de mensagens do PDV." });
  }
});

router.post("/coupon/:saleId/generate", canHandleCoupon, async (req, res) => {
  try {
    const sale = getSaleById(req.params.saleId);
    if (!sale) {
      return res.status(404).json({ error: "Venda do PDV nao encontrada para gerar cupom." });
    }
    if (!ensureSaleStoreAccess(req, res, sale)) {
      return;
    }
    res.json(await generateCouponForSale(req.params.saleId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao gerar o cupom do PDV." });
  }
});

router.post("/coupon/:saleId/reprint", canHandleCoupon, async (req, res) => {
  try {
    const sale = getSaleById(req.params.saleId);
    if (!sale) {
      return res.status(404).json({ error: "Venda do PDV nao encontrada para reimpressao do cupom." });
    }
    if (!ensureSaleStoreAccess(req, res, sale)) {
      return;
    }
    res.json(await generateCouponForSale(req.params.saleId, {
      mode: req.body?.mode,
      reprint_reason: req.body?.reason || req.body?.reprint_reason || ""
    }, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao reimprimir o cupom do PDV." });
  }
});

router.get("/coupon/:saleId", canHandleCoupon, async (req, res) => {
  try {
    const sale = getSaleById(req.params.saleId);
    if (!sale) {
      return res.status(404).json({ error: "Venda do PDV nao encontrada." });
    }
    if (!ensureSaleStoreAccess(req, res, sale)) {
      return;
    }
    const coupon = getCouponBySaleId(req.params.saleId, { mode: req.query.mode || "" });
    if (!coupon) {
      return res.status(404).json({ error: "Cupom do PDV nao encontrado." });
    }
    res.json(coupon);
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o cupom do PDV." });
  }
});

router.get("/coupon/:saleId/document", canHandleCoupon, async (req, res) => {
  try {
    const sale = getSaleById(req.params.saleId);
    if (!sale) {
      return res.status(404).json({ error: "Venda do PDV nao encontrada." });
    }
    if (!ensureSaleStoreAccess(req, res, sale)) {
      return;
    }
    const document = getCouponDocument(req.params.saleId, { mode: req.query.mode || "" });
    if (!document) {
      return res.status(404).json({ error: "Documento do cupom do PDV nao encontrado." });
    }
    const format = String(req.query.format || "html").trim().toLowerCase();
    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${document.sale_id || "cupom"}.pdf"`);
      return res.send(document.pdfBuffer);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(document.html);
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o documento do cupom do PDV." });
  }
});

router.get("/messages/queue", canHandleMessages, async (req, res) => {
  try {
    res.json({ items: loadMessageQueue().slice(0, 200) });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar a fila de mensagens do PDV." });
  }
});

router.post("/messages/queue", canHandleMessages, async (req, res) => {
  try {
    res.json(queueMessage(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao adicionar mensagem na fila do PDV." });
  }
});

router.patch("/messages/:messageId/status", canHandleMessages, async (req, res) => {
  try {
    res.json(updateMessageStatus(req.params.messageId, req.body?.status || "", req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao atualizar o status da mensagem do PDV." });
  }
});

router.get("/welcome-bonuses", async (req, res) => {
  try {
    res.json({ items: loadWelcomeBonuses().slice(0, 120) });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar os bonus de boas-vindas do PDV." });
  }
});

module.exports = {
  pdvExperienceRouter: router
};
