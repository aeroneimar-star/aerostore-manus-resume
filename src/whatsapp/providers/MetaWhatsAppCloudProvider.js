"use strict";

const {
  normalizePhoneForWhatsApp,
  maskPhone,
  hashPhone,
  buildTextMetadata
} = require("../whatsappLogSanitizer");
const { resolveWhatsAppConfig, isDryRunEnabled } = require("../whatsappConfigService");
const { normalizeMetaWebhookPayload } = require("../metaWebhookUtils");

function isValidWhatsAppPhone(phone = "") {
  const normalized = normalizePhoneForWhatsApp(phone);
  return normalized.length >= 12 && normalized.length <= 14;
}

function buildTextPayload({ to, text }) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: false,
      body: String(text || "")
    }
  };
}

function buildTemplatePayload({ to, templateName, languageCode, components }) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: String(templateName || ""),
      language: { code: languageCode || "pt_BR" },
      components: Array.isArray(components) ? components : []
    }
  };
}

function summarizePayload(payload = {}) {
  return {
    messaging_product: payload.messaging_product || "whatsapp",
    to: maskPhone(payload.to || ""),
    type: payload.type || "",
    text: payload.type === "text" ? buildTextMetadata(payload.text?.body || "") : null,
    template: payload.template ? {
      name: payload.template.name || "",
      language: payload.template.language || {},
      component_count: Array.isArray(payload.template.components) ? payload.template.components.length : 0
    } : null
  };
}

class MetaWhatsAppCloudProvider {
  constructor(options = {}) {
    this.provider = "meta_cloud";
    this.fetch = options.fetch || global.fetch;
  }

  getConfig(context = {}) {
    const base = resolveWhatsAppConfig({ ...context, provider: "meta_cloud" });
    const enabled = String(process.env.WHATSAPP_CLOUD_ENABLED || "false").trim().toLowerCase() === "true";
    return {
      ...base,
      enabled,
      dryRun: isDryRunEnabled() || !enabled,
      token: String(context.token || process.env.WHATSAPP_CLOUD_TOKEN || "").trim(),
      phoneNumberId: String(context.phoneNumberId || base.phoneNumberId || "").trim()
    };
  }

  getMessagesUrl(config) {
    return `https://graph.facebook.com/${config.apiVersion || "v20.0"}/${config.phoneNumberId}/messages`;
  }

  getStatus(context = {}) {
    const config = this.getConfig(context);
    return {
      provider: this.provider,
      status: config.enabled ? (config.dryRun ? "dry_run" : "enabled") : "disabled",
      enabled: config.enabled,
      dryRun: config.dryRun,
      hasToken: Boolean(config.token),
      hasPhoneNumberId: Boolean(config.phoneNumberId),
      hasAppSecret: Boolean(process.env.WHATSAPP_CLOUD_APP_SECRET),
      storeId: config.storeId
    };
  }

  async sendText(context = {}, payload = {}) {
    const config = this.getConfig(context);
    const to = normalizePhoneForWhatsApp(payload.to || payload.phone || "");
    const text = String(payload.text || payload.message || "").trim();
    return this.sendGraphMessage(config, buildTextPayload({ to, text }), "send_text");
  }

  async sendTemplate(context = {}, payload = {}) {
    const config = this.getConfig(context);
    const to = normalizePhoneForWhatsApp(payload.to || payload.phone || "");
    return this.sendGraphMessage(config, buildTemplatePayload({
      to,
      templateName: payload.templateName || payload.template || "",
      languageCode: payload.languageCode || config.templates?.language || "pt_BR",
      components: payload.components || []
    }), "send_template");
  }

  async sendMedia() {
    const config = this.getConfig();
    return {
      success: false,
      status: "not_implemented",
      provider: this.provider,
      dryRun: config.dryRun,
      errorCode: "media_not_implemented",
      errorMessage: "Envio de midia pela Meta Cloud ainda nao foi liberado nesta etapa."
    };
  }

  async sendGraphMessage(config, payload, operation = "") {
    const base = {
      provider: this.provider,
      channel: "whatsapp",
      operation,
      toMasked: maskPhone(payload.to || ""),
      phoneHash: hashPhone(payload.to || ""),
      dryRun: Boolean(config.dryRun),
      payloadSummary: summarizePayload(payload)
    };

    if (!isValidWhatsAppPhone(payload.to || "")) {
      return { ...base, success: false, status: "failed", errorCode: "invalid_phone", errorMessage: "Telefone WhatsApp invalido." };
    }
    if (payload.type === "text" && !String(payload.text?.body || "").trim()) {
      return { ...base, success: false, status: "failed", errorCode: "missing_text", errorMessage: "Texto da mensagem WhatsApp nao informado." };
    }
    if (payload.type === "template" && !String(payload.template?.name || "").trim()) {
      return { ...base, success: false, status: "failed", errorCode: "missing_template", errorMessage: "Template WhatsApp nao informado." };
    }
    if (config.dryRun) {
      return { ...base, success: true, status: "dry_run", mockMessageId: `dryrun_${Date.now()}` };
    }
    if (!config.enabled || !config.token || !config.phoneNumberId) {
      return { ...base, success: false, status: "failed", dryRun: false, errorCode: "missing_config", errorMessage: "Meta WhatsApp Cloud sem token ou phone_number_id configurado." };
    }
    if (typeof this.fetch !== "function") {
      return { ...base, success: false, status: "failed", dryRun: false, errorCode: "fetch_unavailable", errorMessage: "Runtime sem fetch para chamar a API da Meta." };
    }

    try {
      const response = await this.fetch(this.getMessagesUrl(config), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ...base,
          success: false,
          status: "failed",
          dryRun: false,
          errorCode: String(responseBody?.error?.code || response.status || "meta_error"),
          errorMessage: String(responseBody?.error?.message || "Falha na API Meta WhatsApp Cloud.").slice(0, 240)
        };
      }
      return { ...base, success: true, status: "sent", dryRun: false, metaMessageId: responseBody?.messages?.[0]?.id || "" };
    } catch (error) {
      return { ...base, success: false, status: "failed", dryRun: false, errorCode: "request_failed", errorMessage: String(error.message || "Falha de rede ao enviar WhatsApp.").slice(0, 240) };
    }
  }

  normalizeInbound(payload = {}) {
    return normalizeMetaWebhookPayload(payload).messages;
  }

  normalizeStatus(payload = {}) {
    return normalizeMetaWebhookPayload(payload).statuses;
  }
}

module.exports = {
  MetaWhatsAppCloudProvider,
  buildTextPayload,
  buildTemplatePayload,
  summarizePayload,
  isValidWhatsAppPhone
};
