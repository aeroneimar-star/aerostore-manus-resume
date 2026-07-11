"use strict";

const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "..", "config", "shop-settings.json");
const PILOT_PATH = path.join(__dirname, "..", "config", "pilot-publications.json");

let cachedSettings = null;
let cachedSettingsMtime = 0;
let cachedPilot = null;
let cachedPilotMtime = 0;

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseEnvBoolean(name, defaultValue = false) {
  const raw = normalizeText(process.env[name] || "").toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return defaultValue;
}

function loadJsonCached(filePath, cacheRef) {
  const stat = fs.statSync(filePath);
  if (!cacheRef.value || stat.mtimeMs !== cacheRef.mtime) {
    cacheRef.value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    cacheRef.mtime = stat.mtimeMs;
  }
  return cacheRef.value;
}

const settingsCache = { value: null, mtime: 0 };
const pilotCache = { value: null, mtime: 0 };

function loadShopSettings() {
  return loadJsonCached(SETTINGS_PATH, settingsCache);
}

function loadPilotPublications() {
  return loadJsonCached(PILOT_PATH, pilotCache);
}

function isPilotJsonEnabled() {
  return Boolean(loadShopSettings()?.use_pilot_json);
}

/**
 * Deploy A1: false por padrão — catálogo público OFF em produção até liberação explícita.
 * Admin CRM (/shop/publicacao) e API autenticada não dependem desta flag.
 */
function isShopPublicCatalogEnabled() {
  return parseEnvBoolean("SHOP_PUBLIC_CATALOG_ENABLED", false);
}

module.exports = {
  loadShopSettings,
  loadPilotPublications,
  isPilotJsonEnabled,
  isShopPublicCatalogEnabled,
  parseEnvBoolean,
  SETTINGS_PATH,
  PILOT_PATH
};
