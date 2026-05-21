"use strict";

const express = require("express");
const { normalizeStoreKey, storesMatch } = require("../utils/pdvStoreUtils");
const { searchCustomersDetailed } = require("../services/pdvOperationalService");
const {
  buildPdvWhatsappContext,
  buildPdvWhatsappMessage,
  buildPdvWhatsappCustomerSearchRows,
  validatePdvWhatsappSend,
  registerPdvWhatsappSent,
  maskSensitiveWhatsappContext
} = require("../services/pdvWhatsappService");

const PDV_WHATSAPP_SEND_TIMEOUT_MS = Math.max(5000, Number(process.env.PDV_WHATSAPP_SEND_TIMEOUT_MS || 25000));

function withPdvWhatsappTimeout(promise, timeoutMs = PDV_WHATSAPP_SEND_TIMEOUT_MS) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("O WhatsApp CRM demorou para confirmar o envio. Tente reenviar em instantes.");
      error.code = "WHATSAPP_SEND_TIMEOUT";
      error.statusCode = 504;
      error.userMessage = "O WhatsApp CRM demorou para confirmar o envio. O link nao foi marcado como enviado. Tente reenviar em instantes.";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function createPdvWhatsappRouter({
  sendWhatsAppTextMessage,
  createAiMessageLog,
  getWhatsAppRuntimeState
} = {}) {
  if (typeof sendWhatsAppTextMessage !== "function") {
    throw new Error("createPdvWhatsappRouter requer sendWhatsAppTextMessage real do CRM.");
  }

  const router = express.Router();

  function normalizeStoreScope(value = "") {
    return normalizeStoreKey(value || "");
  }

  function canViewAllStores(user = {}) {
    return Boolean(user?.permissions?.can_view_all_stores);
  }

  function getAllowedStores(user = {}) {
    return Array.isArray(user?.allowed_stores)
      ? user.allowed_stores.map((item) => normalizeStoreScope(item)).filter(Boolean)
      : [];
  }

  function ensureWhatsappStoreAccess(req, res, context = null) {
    const contextStore = normalizeStoreScope(context?.store?.id || context?.sale?.storeId || "");
    if (canViewAllStores(req.user || {})) {
      return true;
    }
    const allowedStores = getAllowedStores(req.user || {});
    if (!contextStore || !allowedStores.length) {
      res.status(403).json({ error: "Acesso restrito a sua loja.", store_id: contextStore || "" });
      return false;
    }
    if (allowedStores.some((item) => storesMatch(item, contextStore))) {
      return true;
    }
    res.status(403).json({ error: "Acesso restrito a sua loja.", store_id: contextStore });
    return false;
  }

  router.get("/status", async (req, res) => {
    try {
      const runtime = typeof getWhatsAppRuntimeState === "function" ? getWhatsAppRuntimeState() : {};
      res.json({
        status: runtime?.status || "desconectado",
        connectedNumber: runtime?.connectedNumber || null,
        lastConnectedAt: runtime?.lastConnectedAt || null,
        lastError: runtime?.lastError || null
      });
    } catch (error) {
      res.status(500).json({ error: "Não foi possível consultar o status do WhatsApp CRM." });
    }
  });

  router.get("/customers/search", async (req, res) => {
    try {
      const query = String(req.query.q || "").trim();
      if (query.length < 2) {
        return res.json({ items: [] });
      }
      const result = await searchCustomersDetailed(query, { limit: req.query.limit || 8 });
      res.json({ items: buildPdvWhatsappCustomerSearchRows(result) });
    } catch (error) {
      res.status(400).json({ error: error.message || "Falha ao buscar clientes para o WhatsApp do PDV." });
    }
  });

  router.post("/preview", async (req, res) => {
    try {
      const payload = req.body || {};
      const context = await buildPdvWhatsappContext(payload, req.user || {}, { req });
      if (!ensureWhatsappStoreAccess(req, res, context)) {
        return;
      }
      const type = String(payload.type || "").trim().toLowerCase();
      const message = buildPdvWhatsappMessage(type, context);
      const runtime = typeof getWhatsAppRuntimeState === "function" ? getWhatsAppRuntimeState() : {};
      const validation = await validatePdvWhatsappSend({
        type,
        context,
        message,
        runtimeState: { status: "conectado" },
        overrideDuplicate: Boolean(payload.overrideDuplicate),
        confirmPendingReview: Boolean(payload.confirmPendingReview)
      });
      res.json({
        type,
        message,
        context: maskSensitiveWhatsappContext(context),
        canSend: validation.ok && (runtime?.status || "") === "conectado",
        runtime: {
          status: runtime?.status || "desconectado",
          connectedNumber: runtime?.connectedNumber || null,
          lastError: runtime?.lastError || null
        },
        validation: validation.ok ? [] : [{
          code: validation.code || "",
          message: validation.message || ""
        }],
        duplicate: validation.duplicate || null
      });
    } catch (error) {
      res.status(400).json({ error: error.message || "Falha ao preparar a prévia da mensagem do PDV." });
    }
  });

  router.post("/send", async (req, res) => {
    const payload = req.body || {};
    const type = String(payload.type || "").trim().toLowerCase();
    let context = null;
    let message = "";
    try {
      context = await buildPdvWhatsappContext(payload, req.user || {}, { req });
      if (!ensureWhatsappStoreAccess(req, res, context)) {
        return;
      }
      message = buildPdvWhatsappMessage(type, context);
      const runtime = typeof getWhatsAppRuntimeState === "function" ? getWhatsAppRuntimeState() : {};
      const validation = await validatePdvWhatsappSend({
        type,
        context,
        message,
        runtimeState: runtime,
        overrideDuplicate: Boolean(payload.overrideDuplicate),
        confirmPendingReview: Boolean(payload.confirmPendingReview)
      });
      if (!validation.ok) {
        return res.status(validation.statusCode || 400).json({
          error: validation.message || "Não foi possível enviar pelo CRM agora.",
          code: validation.code || "",
          duplicate: validation.duplicate || null,
          context: maskSensitiveWhatsappContext(context),
          messagePreview: message
        });
      }
      const sendResult = await withPdvWhatsappTimeout(sendWhatsAppTextMessage(context.customer.whatsapp, message, {
        debugLabel: `PDV_WHATSAPP:${type.toUpperCase()}`
      }));
      await registerPdvWhatsappSent({
        logger: createAiMessageLog,
        context,
        type,
        message,
        sendResult,
        overrideDuplicate: Boolean(payload.overrideDuplicate)
      });
      res.json({
        success: true,
        channel: "whatsapp_motor",
        status: "sent",
        type,
        message,
        context: maskSensitiveWhatsappContext(context),
        sendResult
      });
    } catch (error) {
      if (context && message) {
        await registerPdvWhatsappSent({
          logger: createAiMessageLog,
          context,
          type,
          message,
          error,
          overrideDuplicate: Boolean(payload.overrideDuplicate)
        }).catch(() => {});
      }
      res.status(error.statusCode || 500).json({
        error: String(error.userMessage || error.message || "Não foi possível enviar pelo CRM agora."),
        code: error.code || "",
        context: context ? maskSensitiveWhatsappContext(context) : null,
        messagePreview: message || ""
      });
    }
  });

  return router;
}

module.exports = {
  createPdvWhatsappRouter
};
