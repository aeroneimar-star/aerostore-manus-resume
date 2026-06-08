"use strict";

class WhatsAppWebProvider {
  constructor(options = {}) {
    this.provider = "web";
    this.runtime = options.runtime || null;
  }

  getStatus(context = {}) {
    const runtime = typeof this.runtime?.getStatus === "function" ? this.runtime.getStatus(context) : {};
    return {
      provider: this.provider,
      status: runtime.status || "legacy_routes",
      enabled: runtime.enabled !== undefined ? Boolean(runtime.enabled) : true,
      dryRun: false,
      message: "Provider web permanece nas rotas antigas do WhatsApp CRM."
    };
  }

  async sendText() {
    return {
      success: false,
      status: "legacy_routes",
      provider: this.provider,
      errorCode: "web_provider_uses_legacy_routes",
      errorMessage: "O provider web continua nas rotas antigas. Esta rota testa apenas a nova camada."
    };
  }

  async sendTemplate() {
    return this.sendText();
  }

  async sendMedia() {
    return {
      success: false,
      status: "not_implemented",
      provider: this.provider,
      errorCode: "web_media_legacy_routes",
      errorMessage: "Envio de midia web permanece no fluxo legado."
    };
  }

  normalizeInbound(payload = {}) {
    return payload;
  }

  normalizeStatus(payload = {}) {
    return payload;
  }
}

module.exports = {
  WhatsAppWebProvider
};
