const crypto = require("crypto");

const DEFAULT_API_VERSION = "v19.0";
const DEFAULT_LANGUAGE = "pt_BR";

function normalizePhoneForWhatsApp(phone = "") {
  const digits = String(phone || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  return `55${digits}`;
}

function isValidWhatsAppPhone(phone = "") {
  const normalized = normalizePhoneForWhatsApp(phone);
  return normalized.length >= 12 && normalized.length <= 14;
}

function maskPhone(phone = "") {
  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return "";
  return `***${normalized.slice(-4)}`;
}

function hashPhone(phone = "") {
  const normalized = normalizePhoneForWhatsApp(phone);
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function isWhatsAppCloudEnabled() {
  return String(process.env.WHATSAPP_CLOUD_ENABLED || "false").trim().toLowerCase() === "true";
}

function buildTemplatePayload({ to, templateName, languageCode, parameters }) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode || process.env.WHATSAPP_TEMPLATE_LANG || DEFAULT_LANGUAGE },
      components: [
        {
          type: "body",
          parameters: (parameters || []).map((text) => ({
            type: "text",
            text: String(text ?? "")
          }))
        }
      ]
    }
  };
}

function sanitizePayloadSummary(payload = {}) {
  return {
    messaging_product: payload.messaging_product || "whatsapp",
    to: maskPhone(payload.to || ""),
    type: payload.type || "template",
    template: {
      name: payload.template?.name || "",
      language: payload.template?.language || { code: DEFAULT_LANGUAGE },
      parameter_count: payload.template?.components?.[0]?.parameters?.length || 0
    }
  };
}

class WhatsAppCloudProvider {
  constructor(options = {}) {
    this.apiVersion = options.apiVersion || process.env.WHATSAPP_CLOUD_API_VERSION || DEFAULT_API_VERSION;
    this.phoneNumberId = options.phoneNumberId || process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID || "";
    this.token = options.token || process.env.WHATSAPP_CLOUD_TOKEN || "";
    this.languageCode = options.languageCode || process.env.WHATSAPP_TEMPLATE_LANG || DEFAULT_LANGUAGE;
  }

  normalizePhoneForWhatsApp(phone = "") {
    return normalizePhoneForWhatsApp(phone);
  }

  getMessagesUrl() {
    return `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
  }

  async sendTemplateMessage(input = {}) {
    const normalizedPhone = normalizePhoneForWhatsApp(input.to || "");
    const templateName = String(input.templateName || "").trim();
    const dryRun = Boolean(input.dryRun) || !isWhatsAppCloudEnabled();
    const payload = buildTemplatePayload({
      to: normalizedPhone,
      templateName,
      languageCode: input.languageCode || this.languageCode,
      parameters: input.parameters || []
    });
    const payloadSummary = sanitizePayloadSummary(payload);

    if (!templateName) {
      return {
        success: false,
        status: "failed",
        provider: "meta_whatsapp_cloud",
        channel: "whatsapp",
        templateName,
        toMasked: maskPhone(normalizedPhone),
        phoneHash: hashPhone(normalizedPhone),
        dryRun,
        payloadSummary,
        errorCode: "missing_template",
        errorMessage: "Template WhatsApp nao informado."
      };
    }

    if (!isValidWhatsAppPhone(normalizedPhone)) {
      return {
        success: false,
        status: "failed",
        provider: "meta_whatsapp_cloud",
        channel: "whatsapp",
        templateName,
        toMasked: maskPhone(normalizedPhone),
        phoneHash: hashPhone(normalizedPhone),
        dryRun,
        payloadSummary,
        errorCode: "invalid_phone",
        errorMessage: "Telefone WhatsApp invalido."
      };
    }

    if (dryRun) {
      return {
        success: true,
        status: "dry_run",
        provider: "meta_whatsapp_cloud",
        channel: "whatsapp",
        templateName,
        toMasked: maskPhone(normalizedPhone),
        phoneHash: hashPhone(normalizedPhone),
        dryRun: true,
        payloadSummary
      };
    }

    if (!this.phoneNumberId || !this.token) {
      return {
        success: false,
        status: "failed",
        provider: "meta_whatsapp_cloud",
        channel: "whatsapp",
        templateName,
        toMasked: maskPhone(normalizedPhone),
        phoneHash: hashPhone(normalizedPhone),
        dryRun: false,
        payloadSummary,
        errorCode: "missing_config",
        errorMessage: "WHATSAPP_CLOUD_TOKEN ou WHATSAPP_CLOUD_PHONE_NUMBER_ID ausente."
      };
    }

    try {
      const response = await fetch(this.getMessagesUrl(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          success: false,
          status: "failed",
          provider: "meta_whatsapp_cloud",
          channel: "whatsapp",
          templateName,
          toMasked: maskPhone(normalizedPhone),
          phoneHash: hashPhone(normalizedPhone),
          dryRun: false,
          payloadSummary,
          errorCode: String(responseBody?.error?.code || response.status || "meta_error"),
          errorMessage: String(responseBody?.error?.message || "Falha na API Meta WhatsApp Cloud.").slice(0, 240)
        };
      }
      return {
        success: true,
        status: "sent",
        provider: "meta_whatsapp_cloud",
        channel: "whatsapp",
        templateName,
        toMasked: maskPhone(normalizedPhone),
        phoneHash: hashPhone(normalizedPhone),
        dryRun: false,
        payloadSummary,
        metaMessageId: responseBody?.messages?.[0]?.id || ""
      };
    } catch (error) {
      return {
        success: false,
        status: "failed",
        provider: "meta_whatsapp_cloud",
        channel: "whatsapp",
        templateName,
        toMasked: maskPhone(normalizedPhone),
        phoneHash: hashPhone(normalizedPhone),
        dryRun: false,
        payloadSummary,
        errorCode: "request_failed",
        errorMessage: String(error.message || "Falha de rede ao enviar WhatsApp.").slice(0, 240)
      };
    }
  }

  sendCashbackNotification(data = {}) {
    return this.sendTemplateMessage({
      to: data.phone,
      templateName: process.env.WHATSAPP_TEMPLATE_CASHBACK || "cashback_notificacao",
      languageCode: data.languageCode,
      parameters: [data.name, data.value, data.startDate, data.endDate, data.minPurchase],
      dryRun: data.dryRun
    });
  }

  sendCashbackAviso10Dias(data = {}) {
    return this.sendTemplateMessage({
      to: data.phone,
      templateName: process.env.WHATSAPP_TEMPLATE_AVISO_10 || "cashback_aviso_10dias",
      languageCode: data.languageCode,
      parameters: [data.name, data.value, data.expiryDate, data.minPurchase],
      dryRun: data.dryRun
    });
  }

  sendCashbackAviso3Dias(data = {}) {
    return this.sendTemplateMessage({
      to: data.phone,
      templateName: process.env.WHATSAPP_TEMPLATE_AVISO_3 || "cashback_aviso_3dias",
      languageCode: data.languageCode,
      parameters: [data.name, data.value, data.expiryDate, data.minPurchase],
      dryRun: data.dryRun
    });
  }
}

module.exports = {
  WhatsAppCloudProvider,
  normalizePhoneForWhatsApp,
  isValidWhatsAppPhone,
  maskPhone,
  hashPhone,
  isWhatsAppCloudEnabled,
  sanitizePayloadSummary
};
