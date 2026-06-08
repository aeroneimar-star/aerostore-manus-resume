"use strict";

const DEFAULT_PROVIDER = "web";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeProvider(value = "") {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "meta" || normalized === "cloud" || normalized === "meta_cloud") {
    return "meta_cloud";
  }
  return "web";
}

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return Boolean(fallback);
  return ["1", "true", "yes", "sim", "on"].includes(normalizeText(value).toLowerCase());
}

function isDryRunEnabled() {
  return normalizeText(process.env.NOTIFICATION_DRY_RUN || "true").toLowerCase() !== "false";
}

function resolveStoreId(context = {}) {
  return normalizeText(
    context.storeId
    || context.store_id
    || context.activeStoreId
    || context.active_store_id
    || context.user?.active_store_id
    || context.user?.store_id
    || context.user?.store
    || process.env.STORE_ID
    || ""
  );
}

function resolveWhatsAppConfig(context = {}) {
  const storeConfig = context.storeConfig && typeof context.storeConfig === "object" ? context.storeConfig : null;
  const provider = normalizeProvider(storeConfig?.provider || context.provider || process.env.WHATSAPP_PROVIDER || DEFAULT_PROVIDER);
  const cloudEnabled = readBoolean(process.env.WHATSAPP_CLOUD_ENABLED, false);
  const webEnabled = readBoolean(process.env.WHATSAPP_WEB_ENABLED, true);
  const hasStoreConfig = Boolean(storeConfig);
  const storeEnabled = readBoolean(storeConfig?.enabled, false);
  const enabled = hasStoreConfig ? storeEnabled : (provider === "meta_cloud" ? cloudEnabled : webEnabled);
  const storeDryRun = readBoolean(storeConfig?.dryRun ?? storeConfig?.dry_run, true);
  const dryRun = hasStoreConfig
    ? storeDryRun || (provider === "meta_cloud" && !enabled)
    : (provider === "meta_cloud" ? isDryRunEnabled() || !cloudEnabled : isDryRunEnabled());
  const storeTemplates = storeConfig?.templates && typeof storeConfig.templates === "object" ? storeConfig.templates : {};

  return {
    storeId: resolveStoreId(context),
    provider,
    enabled,
    dryRun,
    phoneNumberId: normalizeText(storeConfig?.phoneNumberId || context.phoneNumberId || process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID || ""),
    businessAccountId: normalizeText(storeConfig?.businessAccountId || context.businessAccountId || process.env.WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID || ""),
    displayName: normalizeText(storeConfig?.displayName || context.displayName || context.storeName || context.user?.store || ""),
    apiVersion: normalizeText(process.env.WHATSAPP_CLOUD_API_VERSION || "v20.0"),
    token: normalizeText(storeConfig?.token || context.token || ""),
    verifyToken: normalizeText(storeConfig?.verifyToken || context.verifyToken || ""),
    appSecret: normalizeText(storeConfig?.appSecret || context.appSecret || ""),
    templates: {
      language: normalizeText(storeTemplates.language || process.env.WHATSAPP_TEMPLATE_LANG || "pt_BR"),
      cashback: normalizeText(storeTemplates.cashback || process.env.WHATSAPP_TEMPLATE_CASHBACK || "cashback_notificacao"),
      aviso10: normalizeText(storeTemplates.aviso10 || process.env.WHATSAPP_TEMPLATE_AVISO_10 || "cashback_aviso_10dias"),
      aviso3: normalizeText(storeTemplates.aviso3 || process.env.WHATSAPP_TEMPLATE_AVISO_3 || "cashback_aviso_3dias")
    }
  };
}

module.exports = {
  DEFAULT_PROVIDER,
  normalizeProvider,
  readBoolean,
  isDryRunEnabled,
  resolveWhatsAppConfig
};
