"use strict";

const express = require("express");
const { defaultRegistry } = require("../whatsapp/WhatsAppProviderRegistry");
const { resolveWhatsAppConfig } = require("../whatsapp/whatsappConfigService");
const {
  maskPhone,
  maskIdentifier,
  buildTextMetadata,
  sanitizeForWhatsAppLog
} = require("../whatsapp/whatsappLogSanitizer");
const { normalizeMetaWebhookPayload } = require("../whatsapp/metaWebhookUtils");

function buildContext(req) {
  return {
    user: req.user || {},
    storeId: req.user?.active_store_id || req.user?.store_id || req.user?.store || ""
  };
}

function sanitizeProviderResult(result = {}) {
  const copy = {
    ...result,
    toMasked: result.toMasked || result.payloadSummary?.to || "",
    payloadSummary: result.payloadSummary || null
  };
  delete copy.token;
  delete copy.headers;
  delete copy.authorization;
  return copy;
}

function registerProtectedWhatsappProviderRoutes(app, { requireAnyPermission }) {
  const router = express.Router();
  const requireProviderAccess = requireAnyPermission([
    "can_manage_global_settings",
    "can_manage_store_settings",
    "can_use_whatsapp",
    "can_view_whatsapp_status"
  ], "Acesso restrito ao diagnostico do provider WhatsApp.");

  router.use(requireProviderAccess);

  router.get("/status", (req, res) => {
    const context = buildContext(req);
    const config = resolveWhatsAppConfig(context);
    const status = defaultRegistry.getStatus(config);
    res.json({
      provider: config.provider,
      storeId: config.storeId,
      enabled: Boolean(config.enabled),
      dryRun: Boolean(config.dryRun),
      hasToken: Boolean(process.env.WHATSAPP_CLOUD_TOKEN),
      hasPhoneNumberId: Boolean(config.phoneNumberId),
      hasAppSecret: Boolean(process.env.WHATSAPP_CLOUD_APP_SECRET),
      phoneNumberIdMasked: maskIdentifier(config.phoneNumberId),
      businessAccountIdMasked: maskIdentifier(config.businessAccountId),
      status: status.status || "",
      timestamp: new Date().toISOString()
    });
  });

  router.post("/test-text", async (req, res) => {
    const context = buildContext(req);
    const config = resolveWhatsAppConfig(context);
    const body = req.body || {};
    console.info("[WHATSAPP PROVIDER TEST TEXT]", sanitizeForWhatsAppLog({
      provider: config.provider,
      storeId: config.storeId,
      to: body.to,
      message: buildTextMetadata(body.message || body.text || "")
    }));
    const result = await defaultRegistry.sendText(config, {
      to: body.to,
      message: body.message || body.text || ""
    });
    res.status(result.success || result.status === "legacy_routes" ? 200 : 400).json({
      provider: config.provider,
      storeId: config.storeId,
      dryRun: config.dryRun,
      toMasked: maskPhone(body.to || ""),
      result: sanitizeProviderResult(result),
      timestamp: new Date().toISOString()
    });
  });

  router.post("/test-template", async (req, res) => {
    const context = buildContext(req);
    const config = resolveWhatsAppConfig(context);
    const body = req.body || {};
    console.info("[WHATSAPP PROVIDER TEST TEMPLATE]", sanitizeForWhatsAppLog({
      provider: config.provider,
      storeId: config.storeId,
      to: body.to,
      templateName: body.templateName,
      componentCount: Array.isArray(body.components) ? body.components.length : 0
    }));
    const result = await defaultRegistry.sendTemplate(config, {
      to: body.to,
      templateName: body.templateName,
      languageCode: body.languageCode,
      components: Array.isArray(body.components) ? body.components : []
    });
    res.status(result.success || result.status === "legacy_routes" ? 200 : 400).json({
      provider: config.provider,
      storeId: config.storeId,
      dryRun: config.dryRun,
      toMasked: maskPhone(body.to || ""),
      result: sanitizeProviderResult(result),
      timestamp: new Date().toISOString()
    });
  });

  router.post("/normalize-webhook", (req, res) => {
    const normalized = normalizeMetaWebhookPayload(req.body || {});
    console.info("[WHATSAPP PROVIDER NORMALIZE WEBHOOK]", sanitizeForWhatsAppLog(normalized.safeSummary));
    res.json({
      messages: normalized.messages.map((message) => ({
        messageId: message.messageId,
        fromMasked: message.fromMasked,
        waIdMasked: message.waIdMasked,
        phoneNumberIdMasked: message.phoneNumberIdMasked,
        type: message.type,
        hasText: message.hasText,
        textLength: message.textLength,
        timestamp: message.timestamp
      })),
      statuses: normalized.statuses.map((status) => ({
        id: status.id,
        status: status.status,
        recipientMasked: status.recipientMasked,
        phoneNumberIdMasked: status.phoneNumberIdMasked,
        timestamp: status.timestamp,
        errors: status.errors
      })),
      safeSummary: normalized.safeSummary,
      timestamp: new Date().toISOString()
    });
  });

  app.use("/api/whatsapp-provider", router);
}

module.exports = {
  registerProtectedWhatsappProviderRoutes
};
