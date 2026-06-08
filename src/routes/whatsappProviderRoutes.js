"use strict";

const express = require("express");
const { defaultRegistry } = require("../whatsapp/WhatsAppProviderRegistry");
const {
  maskPhone,
  maskIdentifier,
  buildTextMetadata,
  sanitizeForWhatsAppLog
} = require("../whatsapp/whatsappLogSanitizer");
const {
  buildMetaCredentialsStatus,
  normalizeMetaWebhookPayload
} = require("../whatsapp/metaWebhookUtils");
const {
  listWhatsAppStoreConfigs,
  getWhatsAppStoreConfig,
  updateWhatsAppStoreConfig,
  resolveOperationalWhatsAppConfig
} = require("../whatsapp/whatsappStoreConfigService");

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

function sanitizeStoreConfigAuditPayload(config = {}) {
  return sanitizeForWhatsAppLog({
    storeId: config.store_id || config.storeId || "",
    provider: config.provider || "",
    enabled: Boolean(config.enabled),
    dryRun: Boolean(config.dryRun ?? config.dry_run),
    phoneNumberIdMasked: config.phoneNumberIdMasked || "",
    businessAccountIdMasked: config.businessAccountIdMasked || "",
    hasToken: Boolean(config.hasToken),
    hasAppSecret: Boolean(config.hasAppSecret),
    hasVerifyToken: Boolean(config.hasVerifyToken)
  });
}

function registerProtectedWhatsappProviderRoutes(app, { requireAnyPermission }) {
  const router = express.Router();
  const requireProviderAccess = requireAnyPermission([
    "can_manage_global_settings",
    "can_manage_store_settings",
    "can_use_whatsapp",
    "can_view_whatsapp_status"
  ], "Acesso restrito ao diagnostico do provider WhatsApp.");
  const requireConfigAdmin = requireAnyPermission([
    "can_manage_global_settings",
    "can_manage_store_settings"
  ], "Acesso restrito a configuracao do provider WhatsApp.");

  router.use(requireProviderAccess);

  router.get("/meta-credentials/status", requireConfigAdmin, (req, res) => {
    try {
      res.json(buildMetaCredentialsStatus());
    } catch (error) {
      res.status(500).json({ error: "Falha ao consultar status das credenciais Meta WhatsApp." });
    }
  });

  router.get("/store-configs", requireConfigAdmin, async (req, res) => {
    try {
      const configs = await listWhatsAppStoreConfigs();
      res.json({ configs, total: configs.length, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ error: "Falha ao listar configuracoes WhatsApp por loja." });
    }
  });

  router.get("/store-configs/:storeId", requireConfigAdmin, async (req, res) => {
    try {
      const config = await getWhatsAppStoreConfig(req.params.storeId || "");
      res.json({ config, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ error: "Falha ao carregar configuracao WhatsApp da loja." });
    }
  });

  router.put("/store-configs/:storeId", requireConfigAdmin, async (req, res) => {
    try {
      const blockedSecretFields = ["token", "access_token", "app_secret", "verify_token", "token_encrypted", "app_secret_encrypted", "verify_token_encrypted"];
      const receivedSecretField = blockedSecretFields.find((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));
      if (receivedSecretField) {
        return res.status(400).json({
          error: "Secrets reais ainda nao podem ser gravados por esta rota. Configure apenas metadados seguros nesta etapa.",
          field: receivedSecretField
        });
      }
      const config = await updateWhatsAppStoreConfig(req.params.storeId || "", req.body || {});
      console.info("[WHATSAPP STORE CONFIG UPDATED]", sanitizeStoreConfigAuditPayload(config));
      res.json({ config, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(400).json({ error: String(error.message || "Falha ao salvar configuracao WhatsApp da loja.") });
    }
  });

  router.get("/status", async (req, res) => {
    try {
      const context = buildContext(req);
      const config = await resolveOperationalWhatsAppConfig(context);
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
    } catch (error) {
      res.status(500).json({ error: "Falha ao resolver status do provider WhatsApp." });
    }
  });

  router.post("/test-text", async (req, res) => {
    try {
      const context = buildContext(req);
      const config = await resolveOperationalWhatsAppConfig(context);
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
    } catch (error) {
      res.status(500).json({ error: "Falha ao executar teste de texto do provider WhatsApp." });
    }
  });

  router.post("/test-template", async (req, res) => {
    try {
      const context = buildContext(req);
      const config = await resolveOperationalWhatsAppConfig(context);
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
    } catch (error) {
      res.status(500).json({ error: "Falha ao executar teste de template do provider WhatsApp." });
    }
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
