"use strict";

const { resolveWhatsAppConfig, normalizeProvider } = require("./whatsappConfigService");
const { WhatsAppWebProvider } = require("./providers/WhatsAppWebProvider");
const { MetaWhatsAppCloudProvider } = require("./providers/MetaWhatsAppCloudProvider");

function createWhatsAppProviderRegistry(options = {}) {
  const providers = {
    web: options.webProvider || new WhatsAppWebProvider(options.web || {}),
    meta_cloud: options.metaProvider || new MetaWhatsAppCloudProvider(options.meta || {})
  };

  function getProvider(context = {}) {
    const provider = normalizeProvider(context.provider || resolveWhatsAppConfig(context).provider);
    return providers[provider] || providers.web;
  }

  return {
    providers,
    getProvider,
    getStatus(context = {}) {
      return getProvider(context).getStatus(context);
    },
    sendText(context = {}, payload = {}) {
      return getProvider(context).sendText(context, payload);
    },
    sendTemplate(context = {}, payload = {}) {
      return getProvider(context).sendTemplate(context, payload);
    },
    sendMedia(context = {}, payload = {}) {
      return getProvider(context).sendMedia(context, payload);
    },
    normalizeInbound(payload = {}) {
      return providers.meta_cloud.normalizeInbound(payload);
    },
    normalizeStatus(payload = {}) {
      return providers.meta_cloud.normalizeStatus(payload);
    }
  };
}

const defaultRegistry = createWhatsAppProviderRegistry();

module.exports = {
  createWhatsAppProviderRegistry,
  defaultRegistry
};
