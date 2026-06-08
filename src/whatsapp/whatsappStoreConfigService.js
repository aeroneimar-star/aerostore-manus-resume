"use strict";

const { run, get, all } = require("../../db");
const { normalizeStoreKey, formatStoreLabel, getActiveOperationalStoreOptions } = require("../../modules/pdv/utils/pdvStoreUtils");
const { resolveWhatsAppConfig, normalizeProvider, readBoolean, isDryRunEnabled } = require("./whatsappConfigService");
const { maskIdentifier } = require("./whatsappLogSanitizer");

const TABLE_NAME = "whatsapp_store_configs";
const VALID_PROVIDERS = new Set(["web", "meta_cloud"]);
const ACTIVE_STATUS = "active";
const INACTIVE_STATUS = "inactive";

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeConfigBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return Boolean(fallback);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return ["1", "true", "yes", "sim", "on", "ativo", "active"].includes(normalizeText(value).toLowerCase());
}

function normalizeStatus(value = "") {
  const normalized = normalizeText(value).toLowerCase();
  if (["inactive", "inativo", "disabled", "off"].includes(normalized)) return INACTIVE_STATUS;
  return ACTIVE_STATUS;
}

function parseTemplatesJson(value = {}) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeTemplatesInput(value = {}) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("templates_json deve ser um objeto JSON.");
      }
      return parsed;
    } catch (error) {
      throw new Error("templates_json invalido.");
    }
  }
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("templates_json deve ser um objeto JSON.");
  }
  return value;
}

function normalizeStoreId(value = "") {
  return normalizeStoreKey(value || "");
}

function validateProvider(value = "") {
  const raw = normalizeText(value || "web").toLowerCase();
  if (!["web", "meta", "cloud", "meta_cloud"].includes(raw)) {
    throw new Error("Provider WhatsApp invalido. Use web ou meta_cloud.");
  }
  const provider = normalizeProvider(raw);
  if (!VALID_PROVIDERS.has(provider)) {
    throw new Error("Provider WhatsApp invalido. Use web ou meta_cloud.");
  }
  return provider;
}

function getDefaultStoreConfigs() {
  return getActiveOperationalStoreOptions().map((store) => ({
    store_id: normalizeStoreId(store.value),
    provider: "web",
    enabled: false,
    dry_run: true,
    display_name: normalizeText(store.label || formatStoreLabel(store.value)),
    phone_number_id: "",
    business_account_id: "",
    token_status: "not_configured",
    verify_token_status: "not_configured",
    app_secret_status: "not_configured",
    templates_json: "{}",
    status: ACTIVE_STATUS
  }));
}

async function ensureWhatsAppStoreConfigTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL DEFAULT 'web',
      enabled INTEGER NOT NULL DEFAULT 0,
      dry_run INTEGER NOT NULL DEFAULT 1,
      display_name TEXT NOT NULL DEFAULT '',
      phone_number_id TEXT NOT NULL DEFAULT '',
      business_account_id TEXT NOT NULL DEFAULT '',
      token_status TEXT NOT NULL DEFAULT 'not_configured',
      verify_token_status TEXT NOT NULL DEFAULT 'not_configured',
      app_secret_status TEXT NOT NULL DEFAULT 'not_configured',
      templates_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_whatsapp_store_configs_store ON ${TABLE_NAME}(store_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_whatsapp_store_configs_provider ON ${TABLE_NAME}(provider)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_whatsapp_store_configs_status ON ${TABLE_NAME}(status)`);
}

async function seedDefaultWhatsAppStoreConfigs() {
  await ensureWhatsAppStoreConfigTable();
  for (const config of getDefaultStoreConfigs()) {
    await run(
      `INSERT INTO ${TABLE_NAME}
        (store_id, provider, enabled, dry_run, display_name, phone_number_id, business_account_id,
         token_status, verify_token_status, app_secret_status, templates_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(store_id) DO UPDATE SET
         display_name = COALESCE(NULLIF(display_name, ''), excluded.display_name),
         updated_at = updated_at`,
      [
        config.store_id,
        config.provider,
        config.enabled ? 1 : 0,
        config.dry_run ? 1 : 0,
        config.display_name,
        config.phone_number_id,
        config.business_account_id,
        config.token_status,
        config.verify_token_status,
        config.app_secret_status,
        config.templates_json,
        config.status
      ]
    );
  }
}

function sanitizeStoreConfigRow(row = {}) {
  const storeId = normalizeStoreId(row.store_id || "");
  const templates = parseTemplatesJson(row.templates_json || "{}");
  return {
    id: Number(row.id || 0),
    store_id: storeId,
    storeId,
    provider: validateProvider(row.provider || "web"),
    enabled: Boolean(Number(row.enabled || 0)),
    dryRun: Boolean(Number(row.dry_run ?? 1)),
    dry_run: Boolean(Number(row.dry_run ?? 1)),
    display_name: normalizeText(row.display_name || formatStoreLabel(storeId)),
    displayName: normalizeText(row.display_name || formatStoreLabel(storeId)),
    phoneNumberIdMasked: maskIdentifier(row.phone_number_id || ""),
    businessAccountIdMasked: maskIdentifier(row.business_account_id || ""),
    hasPhoneNumberId: Boolean(normalizeText(row.phone_number_id || "")),
    hasBusinessAccountId: Boolean(normalizeText(row.business_account_id || "")),
    hasToken: normalizeText(row.token_status || "") === "configured",
    hasVerifyToken: normalizeText(row.verify_token_status || "") === "configured",
    hasAppSecret: normalizeText(row.app_secret_status || "") === "configured",
    tokenStatus: normalizeText(row.token_status || "not_configured"),
    verifyTokenStatus: normalizeText(row.verify_token_status || "not_configured"),
    appSecretStatus: normalizeText(row.app_secret_status || "not_configured"),
    templates,
    templates_json: templates,
    status: normalizeStatus(row.status || ACTIVE_STATUS),
    created_at: row.created_at || "",
    updated_at: row.updated_at || ""
  };
}

function toOperationalStoreConfig(row = {}) {
  const sanitized = sanitizeStoreConfigRow(row);
  return {
    ...sanitized,
    phoneNumberId: normalizeText(row.phone_number_id || ""),
    businessAccountId: normalizeText(row.business_account_id || ""),
    token: "",
    verifyToken: "",
    appSecret: ""
  };
}

async function getRawStoreConfig(storeId = "") {
  await ensureWhatsAppStoreConfigTable();
  const normalizedStoreId = normalizeStoreId(storeId);
  if (!normalizedStoreId) return null;
  return get(`SELECT * FROM ${TABLE_NAME} WHERE store_id = ? LIMIT 1`, [normalizedStoreId]);
}

async function listWhatsAppStoreConfigs() {
  await seedDefaultWhatsAppStoreConfigs();
  const rows = await all(`SELECT * FROM ${TABLE_NAME} ORDER BY store_id COLLATE NOCASE ASC`);
  return rows.map(sanitizeStoreConfigRow);
}

async function getWhatsAppStoreConfig(storeId = "") {
  await seedDefaultWhatsAppStoreConfigs();
  const row = await getRawStoreConfig(storeId);
  if (row) return sanitizeStoreConfigRow(row);
  const normalizedStoreId = normalizeStoreId(storeId);
  return sanitizeStoreConfigRow({
    store_id: normalizedStoreId,
    provider: "web",
    enabled: 0,
    dry_run: 1,
    display_name: formatStoreLabel(normalizedStoreId),
    templates_json: "{}",
    status: ACTIVE_STATUS
  });
}

function normalizeUpdatePayload(storeId = "", payload = {}, current = {}) {
  const normalizedStoreId = normalizeStoreId(storeId || payload.store_id || payload.storeId || "");
  if (!normalizedStoreId) {
    throw new Error("store_id WhatsApp e obrigatorio.");
  }
  const provider = validateProvider(payload.provider ?? current.provider ?? "web");
  const templatesInput = payload.templates_json ?? payload.templates ?? current.templates_json ?? "{}";
  const templates = normalizeTemplatesInput(templatesInput);
  return {
    store_id: normalizedStoreId,
    provider,
    enabled: normalizeConfigBoolean(payload.enabled, Boolean(Number(current.enabled || 0))) ? 1 : 0,
    dry_run: normalizeConfigBoolean(payload.dry_run ?? payload.dryRun, Boolean(Number(current.dry_run ?? 1))) ? 1 : 0,
    display_name: normalizeText(payload.display_name ?? payload.displayName ?? current.display_name ?? formatStoreLabel(normalizedStoreId)),
    phone_number_id: normalizeText(payload.phone_number_id ?? payload.phoneNumberId ?? current.phone_number_id ?? ""),
    business_account_id: normalizeText(payload.business_account_id ?? payload.businessAccountId ?? payload.waba_id ?? current.business_account_id ?? ""),
    token_status: normalizeText(current.token_status || "not_configured"),
    verify_token_status: normalizeText(current.verify_token_status || "not_configured"),
    app_secret_status: normalizeText(current.app_secret_status || "not_configured"),
    templates_json: JSON.stringify(templates),
    status: normalizeStatus(payload.status ?? current.status ?? ACTIVE_STATUS)
  };
}

async function updateWhatsAppStoreConfig(storeId = "", payload = {}) {
  await ensureWhatsAppStoreConfigTable();
  const current = await getRawStoreConfig(storeId);
  const next = normalizeUpdatePayload(storeId, payload, current || {});
  const existing = current?.id;
  if (existing) {
    await run(
      `UPDATE ${TABLE_NAME} SET
         provider = ?,
         enabled = ?,
         dry_run = ?,
         display_name = ?,
         phone_number_id = ?,
         business_account_id = ?,
         token_status = ?,
         verify_token_status = ?,
         app_secret_status = ?,
         templates_json = ?,
         status = ?,
         updated_at = datetime('now')
       WHERE store_id = ?`,
      [
        next.provider,
        next.enabled,
        next.dry_run,
        next.display_name,
        next.phone_number_id,
        next.business_account_id,
        next.token_status,
        next.verify_token_status,
        next.app_secret_status,
        next.templates_json,
        next.status,
        next.store_id
      ]
    );
  } else {
    await run(
      `INSERT INTO ${TABLE_NAME}
        (store_id, provider, enabled, dry_run, display_name, phone_number_id, business_account_id,
         token_status, verify_token_status, app_secret_status, templates_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        next.store_id,
        next.provider,
        next.enabled,
        next.dry_run,
        next.display_name,
        next.phone_number_id,
        next.business_account_id,
        next.token_status,
        next.verify_token_status,
        next.app_secret_status,
        next.templates_json,
        next.status
      ]
    );
  }
  return getWhatsAppStoreConfig(next.store_id);
}

async function resolveOperationalWhatsAppConfig(context = {}) {
  await ensureWhatsAppStoreConfigTable();
  const storeId = normalizeStoreId(
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
  const row = await getRawStoreConfig(storeId);
  if (!row || normalizeStatus(row.status || ACTIVE_STATUS) !== ACTIVE_STATUS) {
    return resolveWhatsAppConfig({ ...context, storeId });
  }
  const storeConfig = toOperationalStoreConfig(row);
  const base = resolveWhatsAppConfig({ ...context, storeId, storeConfig });
  return {
    ...base,
    dryRun: storeConfig.provider === "meta_cloud"
      ? Boolean(storeConfig.dryRun || isDryRunEnabled() || !storeConfig.enabled)
      : Boolean(storeConfig.dryRun || isDryRunEnabled()),
    token: "",
    verifyToken: "",
    appSecret: ""
  };
}

module.exports = {
  TABLE_NAME,
  ensureWhatsAppStoreConfigTable,
  seedDefaultWhatsAppStoreConfigs,
  listWhatsAppStoreConfigs,
  getWhatsAppStoreConfig,
  updateWhatsAppStoreConfig,
  resolveOperationalWhatsAppConfig,
  sanitizeStoreConfigRow,
  normalizeUpdatePayload
};
