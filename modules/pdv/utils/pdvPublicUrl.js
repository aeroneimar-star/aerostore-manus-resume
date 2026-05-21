"use strict";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeBaseUrl(value = "") {
  const normalized = normalizeText(value).replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  if (!/^https?:\/\//i.test(normalized)) {
    return "";
  }
  return normalized;
}

function isDevelopmentEnvironment() {
  return normalizeText(process.env.NODE_ENV || "").toLowerCase() !== "production";
}

function isLocalHostName(hostname = "") {
  const normalized = normalizeText(hostname).toLowerCase();
  return [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1"
  ].includes(normalized);
}

function isLocalUrl(value = "") {
  try {
    const parsed = new URL(String(value || ""));
    return isLocalHostName(parsed.hostname || "");
  } catch (error) {
    return false;
  }
}

function getRequestBaseUrl(req = null) {
  if (!req) {
    return "";
  }
  const protocol = normalizeText(
    req.headers?.["x-forwarded-proto"]
    || req.protocol
    || "http"
  ).split(",")[0].trim();
  const host = normalizeText(
    req.headers?.["x-forwarded-host"]
    || (typeof req.get === "function" ? req.get("host") : "")
    || req.headers?.host
    || ""
  ).split(",")[0].trim();
  if (!host) {
    return "";
  }
  return normalizeBaseUrl(`${protocol}://${host}`);
}

function logDevelopmentFallback(message = "") {
  if (!message) {
    return;
  }
  console.warn(`[AEROSTORE PDV] ${message}`);
}

function getPublicBaseUrl(req = null) {
  const configured = normalizeBaseUrl(process.env.AEROSTORE_PUBLIC_BASE_URL || "");
  if (configured) {
    return configured;
  }
  const requestBaseUrl = getRequestBaseUrl(req);
  if (isDevelopmentEnvironment()) {
    if (requestBaseUrl) {
      logDevelopmentFallback("AEROSTORE_PUBLIC_BASE_URL não configurada; usando base local apenas para desenvolvimento.");
      return requestBaseUrl;
    }
    logDevelopmentFallback("AEROSTORE_PUBLIC_BASE_URL não configurada; usando localhost apenas para desenvolvimento.");
    return "http://localhost:3000";
  }
  return "";
}

function toPublicUrl(pathOrUrl = "", req = null) {
  const normalizedValue = normalizeText(pathOrUrl || "");
  if (!normalizedValue) {
    return "";
  }
  const publicBaseUrl = getPublicBaseUrl(req);
  if (/^https?:\/\//i.test(normalizedValue)) {
    if (publicBaseUrl && isLocalUrl(normalizedValue)) {
      try {
        const parsed = new URL(normalizedValue);
        const suffix = `${parsed.pathname || ""}${parsed.search || ""}${parsed.hash || ""}`;
        return `${publicBaseUrl}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
      } catch (error) {
        return normalizedValue;
      }
    }
    return normalizedValue;
  }
  if (!publicBaseUrl) {
    return "";
  }
  return `${publicBaseUrl}${normalizedValue.startsWith("/") ? normalizedValue : `/${normalizedValue.replace(/^\/+/, "")}`}`;
}

module.exports = {
  getPublicBaseUrl,
  getRequestBaseUrl,
  isDevelopmentEnvironment,
  isLocalUrl,
  normalizeBaseUrl,
  toPublicUrl
};
