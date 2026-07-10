"use strict";

const { loadShopSettings } = require("../services/shopSettingsService");

const buckets = new Map();

function getClientIp(req = {}) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "unknown";
}

function createRateLimiter(options = {}) {
  const windowMs = Number(options.windowMs || 60_000);
  const maxRequests = Number(options.maxRequests || 60);
  const bucketKey = String(options.bucketKey || "default");

  return function shopRateLimitMiddleware(req, res, next) {
    const ip = getClientIp(req);
    const key = `${bucketKey}:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > maxRequests) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "Muitas requisições. Tente novamente em instantes.",
        code: "RATE_LIMITED",
        retry_after_seconds: retryAfter
      });
    }
    return next();
  };
}

function createCatalogRateLimiter() {
  const settings = loadShopSettings();
  return createRateLimiter({
    bucketKey: "catalog",
    maxRequests: Number(settings?.api?.rate_limit_catalog_per_minute || 60)
  });
}

function applyPublicApiHeaders(res, cacheSeconds = 120) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", `public, max-age=${cacheSeconds}`);
}

function applyCors(req, res) {
  const settings = loadShopSettings();
  const origins = Array.isArray(settings?.api?.cors_origins) ? settings.api.cors_origins : [];
  const origin = String(req.headers?.origin || "").trim();
  if (origin && origins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = {
  createRateLimiter,
  createCatalogRateLimiter,
  applyPublicApiHeaders,
  applyCors
};
