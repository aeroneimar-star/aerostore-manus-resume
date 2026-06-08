const { getNotificationService } = require("../notification/NotificationService");
const { verifyMetaWebhookChallenge } = require("../whatsapp/metaWebhookUtils");
const { sanitizeForWhatsAppLog } = require("../whatsapp/whatsappLogSanitizer");

function sanitizeWebhookStatus(status = {}) {
  return {
    id: status.id || status.message_id || "",
    status: status.status || "",
    timestamp: status.timestamp || "",
    errors: Array.isArray(status.errors)
      ? status.errors.slice(0, 3).map((error) => ({
        code: error.code || "",
        title: String(error.title || error.message || "").slice(0, 160)
      }))
      : []
  };
}

function extractWebhookStatuses(payload = {}) {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const statuses = [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change.value || {};
      if (Array.isArray(value.statuses)) {
        statuses.push(...value.statuses.map(sanitizeWebhookStatus));
      }
    }
  }
  return statuses;
}

function registerPublicNotificationRoutes(app) {
  app.get("/api/whatsapp/webhook", (req, res) => {
    const verification = verifyMetaWebhookChallenge({
      query: req.query || {},
      expectedVerifyToken: process.env.WHATSAPP_CLOUD_VERIFY_TOKEN || ""
    });
    console.info("[WHATSAPP CLOUD WEBHOOK VERIFY]", sanitizeForWhatsAppLog(verification.safeLog));
    if (verification.ok) {
      return res.status(200).send(verification.body);
    }
    return res.status(403).send("Forbidden");
  });

  app.post("/api/whatsapp/webhook", async (req, res) => {
    res.status(200).json({ received: true });
    try {
      const statuses = extractWebhookStatuses(req.body || {});
      if (!statuses.length) return;
      const service = getNotificationService();
      for (const status of statuses) {
        await service.updateLogFromWebhook(status);
      }
    } catch (error) {
      console.error("[WHATSAPP CLOUD WEBHOOK] failed to process status", {
        error: String(error.message || error).slice(0, 160)
      });
    }
  });
}

function registerProtectedNotificationRoutes(app, { requireAnyPermission }) {
  const requireNotificationAdmin = requireAnyPermission([
    "can_manage_campaigns",
    "can_use_whatsapp",
    "can_view_whatsapp_status",
    "can_manage_global_settings"
  ]);

  app.get("/api/notification-status", requireNotificationAdmin, async (req, res) => {
    try {
      const status = await getNotificationService().getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: "Falha ao consultar status de notificacoes." });
    }
  });

  app.post("/api/notification/test-template", requireNotificationAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const result = await getNotificationService().sendTemplateTest({
        template: body.template,
        phone: body.phone,
        parameters: Array.isArray(body.parameters) ? body.parameters : [],
        dryRun: body.dryRun !== false,
        languageCode: body.languageCode
      });
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      res.status(500).json({ error: "Falha ao testar template WhatsApp." });
    }
  });
}

module.exports = {
  registerPublicNotificationRoutes,
  registerProtectedNotificationRoutes,
  extractWebhookStatuses
};
