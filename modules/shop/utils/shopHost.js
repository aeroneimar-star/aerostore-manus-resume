"use strict";

const {
  isPublicSiteHost,
  isLocalDevHost,
  getRequestHost
} = require("../../public-site/utils/publicSiteHost");

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizePath(pathname = "") {
  return normalizeText(pathname).split("?")[0] || "/";
}

function isShopPublicPagePath(pathname = "") {
  const path = normalizePath(pathname);
  if (path === "/catalogo") {
    return true;
  }
  if (path.startsWith("/produto/")) {
    return true;
  }
  if (path.startsWith("/shop/assets/")) {
    return true;
  }
  return false;
}

function isShopPublicApiPath(pathname = "") {
  return normalizePath(pathname).startsWith("/public-api/");
}

function shouldBypassPublicSite404(pathname = "") {
  return isShopPublicPagePath(pathname) || isShopPublicApiPath(pathname);
}

function isShopLocalPreviewEnabled() {
  const flag = normalizeText(process.env.AEROSTORE_SHOP_LOCAL_PREVIEW || "").toLowerCase();
  if (["1", "true", "yes", "on"].includes(flag)) {
    return true;
  }
  return process.env.NODE_ENV !== "production";
}

function isShopHostAllowed(req) {
  if (isPublicSiteHost(req)) {
    return true;
  }
  if (isShopLocalPreviewEnabled() && isLocalDevHost(getRequestHost(req))) {
    return true;
  }
  return false;
}

function requirePublicSiteHost(req, res, next) {
  if (!isShopHostAllowed(req)) {
    return next("route");
  }
  return next();
}

module.exports = {
  isShopPublicPagePath,
  isShopPublicApiPath,
  shouldBypassPublicSite404,
  isShopLocalPreviewEnabled,
  isShopHostAllowed,
  requirePublicSiteHost
};
