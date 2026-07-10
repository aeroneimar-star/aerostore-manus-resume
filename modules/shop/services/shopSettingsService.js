"use strict";

const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "..", "config", "shop-settings.json");
const PILOT_PATH = path.join(__dirname, "..", "config", "pilot-publications.json");

let cachedSettings = null;
let cachedSettingsMtime = 0;
let cachedPilot = null;
let cachedPilotMtime = 0;

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

module.exports = {
  loadShopSettings,
  loadPilotPublications,
  isPilotJsonEnabled,
  SETTINGS_PATH,
  PILOT_PATH
};
