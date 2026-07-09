"use strict";

const DEFAULT_PUBLIC_SITE_HOSTS = ["aerostore.site", "www.aerostore.site"];
const DEFAULT_CRM_HOSTS = ["crm.aerostore.site"];
const LOCAL_DEV_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];

function normalizeText(value = "") {
  return String(value || "").trim();
}

function parseHostList(envValue = "", fallback = []) {
  const raw = normalizeText(envValue);
  if (!raw) {
    return fallback.slice();
  }
  return Array.from(new Set(
    raw
      .split(",")
      .map((item) => normalizeText(item).toLowerCase())
      .filter(Boolean)
  ));
}

function getPublicSiteHosts() {
  return parseHostList(process.env.AEROSTORE_PUBLIC_SITE_HOST, DEFAULT_PUBLIC_SITE_HOSTS);
}

function getCrmHosts() {
  return parseHostList(process.env.AEROSTORE_CRM_HOST, DEFAULT_CRM_HOSTS);
}

function getRequestHost(req = null) {
  if (!req) {
    return "";
  }
  const forwarded = normalizeText(req.headers?.["x-forwarded-host"] || "");
  const direct = normalizeText(
    typeof req.get === "function" ? req.get("host") : ""
  ) || normalizeText(req.headers?.host || "");
  const host = (forwarded || direct).split(",")[0].trim().toLowerCase();
  return host.split(":")[0];
}

function isLocalDevHost(hostname = "") {
  return LOCAL_DEV_HOSTS.includes(normalizeText(hostname).toLowerCase());
}

function isPublicSiteHost(req = null) {
  const host = getRequestHost(req);
  if (!host) {
    return false;
  }
  return getPublicSiteHosts().includes(host);
}

function isCrmHost(req = null) {
  const host = getRequestHost(req);
  if (!host) {
    return true;
  }
  if (getCrmHosts().includes(host)) {
    return true;
  }
  if (isLocalDevHost(host)) {
    return true;
  }
  return !isPublicSiteHost(req);
}

function isPublicSitePath(pathname = "") {
  const path = normalizeText(pathname).split("?")[0] || "/";
  if (path === "/" || path === "/privacidade" || path === "/termos") {
    return true;
  }
  if (path === "/robots.txt" || path === "/sitemap.xml") {
    return true;
  }
  if (path.startsWith("/assets/")) {
    return true;
  }
  return false;
}

module.exports = {
  DEFAULT_PUBLIC_SITE_HOSTS,
  DEFAULT_CRM_HOSTS,
  LOCAL_DEV_HOSTS,
  getPublicSiteHosts,
  getCrmHosts,
  getRequestHost,
  isLocalDevHost,
  isPublicSiteHost,
  isCrmHost,
  isPublicSitePath
};
