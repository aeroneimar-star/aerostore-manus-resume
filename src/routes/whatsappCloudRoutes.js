"use strict";

const express = require("express");
const { defaultRegistry } = require("../whatsapp/WhatsAppProviderRegistry");
const { buildMetaCredentialsStatus } = require("../whatsapp/metaWebhookUtils");
const { resolveOperationalWhatsAppConfig } = require("../whatsapp/whatsappStoreConfigService");
const {
  maskPhone,
  sanitizeForWhatsAppLog,
  buildTextMetadata
} = require("../whatsapp/whatsappLogSanitizer");

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

function buildCloudStatusPayload() {
  // Status global do provider Cloud (sem loja especifica) - diagnostico seguro.
  // Nunca retorna o token cru.
  return buildMetaCredentialsStatus();
}

function registerProtectedWhatsappCloudRoutes(app, { requireAnyPermission }) {
  const router = express.Router();
  const requireDiagnosticsAccess = requireAnyPermission([
    "can_manage_global_settings",
    "can_manage_store_settings",
    "can_use_whatsapp",
    "can_view_whatsapp_status"
  ], "Acesso restrito ao diagnostico Cloud API WhatsApp.");
  const requireConfigAdmin = requireAnyPermission([
    "can_manage_global_settings",
    "can_manage_store_settings"
  ], "Acesso restrito a configuracao Cloud API WhatsApp.");

  router.use(requireDiagnosticsAccess);

  router.get("/status", (_req, res) => {
    try {
      const status = buildCloudStatusPayload();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: "Falha ao consultar status Cloud API WhatsApp." });
    }
  });

  router.get("/store-status", requireConfigAdmin, async (req, res) => {
    try {
      const context = buildContext(req);
      const config = await resolveOperationalWhatsAppConfig(context);
      const credentials = buildMetaCredentialsStatus();
      const providerStatus = defaultRegistry.getStatus(config);
      res.json({
        provider: config.provider,
        storeId: config.storeId,
        enabled: Boolean(config.enabled),
        dryRun: Boolean(config.dryRun),
        phoneNumberId: maskPhone(config.phoneNumberId || "").replace(/\*/g, "*"),
        phoneNumberIdPresent: Boolean(config.phoneNumberId),
        accessTokenPresent: Boolean(credentials.hasToken),
        wabaIdPresent: Boolean(config.businessAccountId),
        apiVersion: config.apiVersion,
        baseUrl: config.baseUrl,
        credentials,
        providerStatus,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: "Falha ao consultar status Cloud API da loja." });
    }
  });

  router.post("/test-message", requireConfigAdmin, async (req, res) => {
    try {
      const context = buildContext(req);
      const config = await resolveOperationalWhatsAppConfig(context);
      const body = req.body || {};
      const messageText = String(body.body ?? body.message ?? body.text ?? "").trim();
      const to = String(body.to || body.phone || "").trim();

      // Auditoria: nunca logar o conteudo da mensagem; apenas metadata.
      console.info("[WHATSAPP CLOUD TEST MESSAGE]", sanitizeForWhatsAppLog({
        provider: config.provider,
        storeId: config.storeId,
        to: to,
        message: buildTextMetadata(messageText)
      }));

      if (!to) {
        return res.status(400).json({ error: "Campo 'to' obrigatorio." });
      }
      if (!messageText) {
        return res.status(400).json({ error: "Campo 'body' obrigatorio." });
      }

      const result = await defaultRegistry.sendText(config, {
        to,
        message: messageText
      });

      res.status(result.success || result.status === "dry_run" || result.status === "legacy_routes" ? 200 : 400).json({
        provider: config.provider,
        storeId: config.storeId,
        dryRun: config.dryRun,
        enabled: config.enabled,
        apiVersion: config.apiVersion,
        baseUrl: config.baseUrl,
        phoneNumberIdMasked: config.phoneNumberId ? `***${config.phoneNumberId.slice(-4)}` : "",
        toMasked: maskPhone(to),
        result: sanitizeProviderResult(result),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({ error: "Falha ao executar teste Cloud API WhatsApp." });
    }
  });

  app.use("/api/whatsapp/cloud", router);
}

module.exports = {
  registerProtectedWhatsappCloudRoutes,
  buildCloudStatusPayload
};