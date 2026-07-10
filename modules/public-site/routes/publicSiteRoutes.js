"use strict";

const express = require("express");
const path = require("path");
const {
  isPublicSiteHost,
  isPublicSitePath
} = require("../utils/publicSiteHost");
const { renderSitePage } = require("../services/publicSiteConfig");

const SITE_ROOT = path.join(__dirname, "..", "..", "..", "public", "site");
const SITE_ASSETS_ROOT = path.join(SITE_ROOT, "assets");

function applyPublicSiteSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
}

function sendRenderedPage(res, fileName) {
  applyPublicSiteSecurityHeaders(res);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(renderSitePage(fileName));
}

function sendSiteFile(res, relativePath, contentType) {
  const safeRelative = String(relativePath || "").replace(/^\/+/, "");
  const filePath = path.resolve(SITE_ROOT, safeRelative);
  if (!filePath.startsWith(path.resolve(SITE_ROOT))) {
    res.status(400).send("Caminho inválido.");
    return;
  }
  applyPublicSiteSecurityHeaders(res);
  if (contentType) {
    res.setHeader("Content-Type", contentType);
  }
  res.sendFile(filePath);
}

const CRM_STATIC_BLOCK = new Set(["/app.js", "/styles.css"]);

function canServePublicSiteAssets(req) {
  if (isPublicSiteHost(req)) {
    return true;
  }
  try {
    const { isShopHostAllowed } = require("../../shop/utils/shopHost");
    return isShopHostAllowed(req);
  } catch (error) {
    return false;
  }
}

function registerPublicSiteRoutes(app) {
  app.use((req, res, next) => {
    if (!isPublicSiteHost(req)) {
      return next();
    }
    if (CRM_STATIC_BLOCK.has(req.path)) {
      applyPublicSiteSecurityHeaders(res);
      return res.status(404).type("text/plain").send("Not found");
    }
    return next();
  });

  const siteAssetsStatic = express.static(SITE_ASSETS_ROOT, {
    fallthrough: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".css")) {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
      } else if (filePath.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      } else if (filePath.endsWith(".svg")) {
        res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      }
    }
  });

  app.use("/assets", (req, res, next) => {
    if (!canServePublicSiteAssets(req)) {
      return next();
    }
    return siteAssetsStatic(req, res, next);
  });

  app.get("/", (req, res, next) => {
    if (!isPublicSiteHost(req)) {
      return next();
    }
    return sendRenderedPage(res, "index.html");
  });

  app.get("/privacidade", (req, res, next) => {
    if (!isPublicSiteHost(req)) {
      return next();
    }
    return sendRenderedPage(res, "privacidade.html");
  });

  app.get("/termos", (req, res, next) => {
    if (!isPublicSiteHost(req)) {
      return next();
    }
    return sendRenderedPage(res, "termos.html");
  });

  app.get("/robots.txt", (req, res, next) => {
    if (!isPublicSiteHost(req)) {
      return next();
    }
    return sendSiteFile(res, "robots.txt", "text/plain; charset=utf-8");
  });

  app.get("/sitemap.xml", (req, res, next) => {
    if (!isPublicSiteHost(req)) {
      return next();
    }
    return sendSiteFile(res, "sitemap.xml", "application/xml; charset=utf-8");
  });

  app.use((req, res, next) => {
    if (!isPublicSiteHost(req)) {
      return next();
    }
    if (isPublicSitePath(req.path)) {
      return next();
    }
    applyPublicSiteSecurityHeaders(res);
    res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(renderSitePage("404.html"));
  });
}

module.exports = {
  registerPublicSiteRoutes,
  SITE_ROOT,
  SITE_ASSETS_ROOT
};
