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

// Le um env tentando varios nomes (atalho + nome canonico legado).
// Nao filtra valores sensiveis aqui; quem chama decide se mascara/loga.
function readEnvFromCandidates(keys = []) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

const PHONE_NUMBER_ID_KEYS = [
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_CLOUD_PHONE_NUMBER_ID"
];
const BUSINESS_ACCOUNT_ID_KEYS = [
  "WHATSAPP_WABA_ID",
  "WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_BUSINESS_ACCOUNT_ID"
];
const ACCESS_TOKEN_KEYS = [
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_CLOUD_TOKEN"
];
const VERIFY_TOKEN_KEYS = [
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_CLOUD_VERIFY_TOKEN"
];
const APP_SECRET_KEYS = [
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_CLOUD_APP_SECRET"
];
const APP_ID_KEYS = [
  "WHATSAPP_APP_ID",
  "WHATSAPP_CLOUD_APP_ID"
];
const BASE_URL_KEYS = [
  "WHATSAPP_CLOUD_BASE_URL"
];
const API_VERSION_KEYS = [
  "WHATSAPP_CLOUD_API_VERSION"
];

function resolveCloudPhoneNumberId() {
  return readEnvFromCandidates(PHONE_NUMBER_ID_KEYS);
}

function resolveCloudBusinessAccountId() {
  return readEnvFromCandidates(BUSINESS_ACCOUNT_ID_KEYS);
}

function resolveCloudAccessToken() {
  return readEnvFromCandidates(ACCESS_TOKEN_KEYS);
}

function resolveCloudVerifyToken() {
  return readEnvFromCandidates(VERIFY_TOKEN_KEYS);
}

function resolveCloudAppSecret() {
  return readEnvFromCandidates(APP_SECRET_KEYS);
}

function resolveCloudAppId() {
  return readEnvFromCandidates(APP_ID_KEYS);
}

function resolveCloudBaseUrl() {
  const raw = readEnvFromCandidates(BASE_URL_KEYS);
  if (!raw) return "https://graph.facebook.com";
  return raw.replace(/\/+$/g, "");
}

function resolveCloudApiVersion() {
  const raw = readEnvFromCandidates(API_VERSION_KEYS);
  return raw || "v24.0";
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
  const contextPhoneNumberId = normalizeText(storeConfig?.phoneNumberId || context.phoneNumberId || "");
  const contextBusinessAccountId = normalizeText(storeConfig?.businessAccountId || context.businessAccountId || "");
  const contextToken = normalizeText(storeConfig?.token || context.token || "");
  const contextVerifyToken = normalizeText(storeConfig?.verifyToken || context.verifyToken || "");
  const contextAppSecret = normalizeText(storeConfig?.appSecret || context.appSecret || "");

  return {
    storeId: resolveStoreId(context),
    provider,
    enabled,
    dryRun,
    phoneNumberId: normalizeText(contextPhoneNumberId || resolveCloudPhoneNumberId()),
    businessAccountId: normalizeText(contextBusinessAccountId || resolveCloudBusinessAccountId()),
    displayName: normalizeText(storeConfig?.displayName || context.displayName || context.storeName || context.user?.store || ""),
    apiVersion: resolveCloudApiVersion(),
    baseUrl: resolveCloudBaseUrl(),
    token: normalizeText(contextToken || resolveCloudAccessToken()),
    verifyToken: normalizeText(contextVerifyToken || resolveCloudVerifyToken()),
    appSecret: normalizeText(contextAppSecret || resolveCloudAppSecret()),
    appId: resolveCloudAppId(),
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
  resolveWhatsAppConfig,
  resolveCloudPhoneNumberId,
  resolveCloudBusinessAccountId,
  resolveCloudAccessToken,
  resolveCloudVerifyToken,
  resolveCloudAppSecret,
  resolveCloudAppId,
  resolveCloudBaseUrl,
  resolveCloudApiVersion,
  PHONE_NUMBER_ID_KEYS,
  BUSINESS_ACCOUNT_ID_KEYS,
  ACCESS_TOKEN_KEYS,
  VERIFY_TOKEN_KEYS,
  APP_SECRET_KEYS,
  APP_ID_KEYS,
  BASE_URL_KEYS,
  API_VERSION_KEYS
};
