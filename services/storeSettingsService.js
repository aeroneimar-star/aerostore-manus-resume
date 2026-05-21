"use strict";

const fs = require("fs");
const path = require("path");
const {
  getActiveOperationalStoreOptions,
  normalizeStoreKey,
  formatStoreLabel
} = require("../modules/pdv/utils/pdvStoreUtils");

const STORE_SETTINGS_DIR = path.join(__dirname, "..", "data", "settings");
const STORE_SETTINGS_PATH = path.join(STORE_SETTINGS_DIR, "store-settings.json");
const STORE_STATUSES = ["active", "inactive"];
const STORE_TYPES = ["physical_store", "kiosk", "ecommerce", "deposit", "test"];

function nowIso() {
  return new Date().toISOString();
}

function safeClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeStoreAscii(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeStringArray(value = []) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((item) => item.trim());
  return Array.from(new Set(list.map((item) => normalizeText(item)).filter(Boolean)));
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return Boolean(fallback);
  return ["true", "1", "yes", "sim", "on"].includes(normalized);
}

function getDefaultStoreType(storeId = "") {
  if (storeId === "sul") return "physical_store";
  if (storeId === "vila_fem_infant") return "physical_store";
  if (storeId === "botanico") return "physical_store";
  return "physical_store";
}

function getDefaultLegacyAliases(storeId = "", label = "") {
  const normalizedLabel = formatStoreLabel(label || storeId);
  const map = {
    vila_masc: ["vila", "Vila Masc.", "Vila", "AEROSTORE Vila Masculina"],
    vila_fem_infant: ["vila_fem", "Vila Fem.", "Vila Fem/Infant.", "Vila Infantil"],
    botanico: ["Botanico", "Botânico", "Loja Botanico"],
    sul: ["Sul", "Loja Sul"]
  };
  const base = map[storeId] || [];
  return Array.from(new Set([normalizedLabel, ...base].filter(Boolean)));
}

function createDefaultStoreRecord(storeId = "", label = "") {
  const normalizedId = normalizeStoreKey(storeId || label || "");
  const displayName = formatStoreLabel(label || normalizedId);
  return {
    store_id: normalizedId,
    legacy_aliases: getDefaultLegacyAliases(normalizedId, displayName),
    display_name: displayName,
    internal_name: `AEROSTORE ${displayName}`.trim(),
    status: "active",
    type: getDefaultStoreType(normalizedId),
    company: {
      legal_name: "",
      trade_name: displayName,
      cnpj: "",
      state_registration: "",
      municipal_registration: "",
      tax_regime_label: ""
    },
    address: {
      zip: "",
      street: "",
      number: "",
      complement: "",
      district: "",
      city: "",
      state: "",
      country: "Brasil"
    },
    contact: {
      phone: "",
      whatsapp: "",
      email: "",
      manager_name: "",
      opening_hours: ""
    },
    terminal: {
      default_register_id: "",
      default_terminal_label: "",
      default_printer_label: "",
      receipt_footer: "",
      sale_prefix: ""
    },
    inventory: {
      primary_deposit_id: "",
      linked_deposit_ids: [],
      allows_shared_stock: true,
      allows_transfer_request: true,
      requires_cross_state_transfer_review: false
    },
    policies: {
      cashback_generate_enabled: true,
      cashback_redeem_enabled: true,
      payment_link_enabled: true,
      gift_card_enabled: true,
      exchange_enabled: true,
      auto_discount_enabled: true,
      local_discount_limit_percent: null,
      pickup_enabled: true,
      delivery_enabled: false,
      delivery_policy_label: "",
      operational_notes: ""
    },
    integrations: {
      whatsapp_instance_id: "",
      pagbank_account_label: "",
      tiny_store_id: "",
      tiny_deposit_id: ""
    },
    metadata: {
      created_at: nowIso(),
      updated_at: nowIso(),
      updated_by: "system"
    }
  };
}

function createDefaultStoreSettingsData() {
  const stores = getActiveOperationalStoreOptions().map((item) => createDefaultStoreRecord(item.value, item.label));
  return { stores };
}

function normalizeStoreRecord(record = {}, fallback = {}) {
  const base = createDefaultStoreRecord(
    normalizeStoreKey(record.store_id || fallback.store_id || ""),
    record.display_name || fallback.display_name || ""
  );
  const merged = {
    ...base,
    ...safeClone(fallback || {}),
    ...safeClone(record || {})
  };
  const normalizedId = normalizeStoreKey(merged.store_id || fallback.store_id || base.store_id);
  const displayName = normalizeText(merged.display_name || fallback.display_name || base.display_name || formatStoreLabel(normalizedId));
  return {
    ...base,
    ...merged,
    store_id: normalizedId,
    legacy_aliases: normalizeStringArray(merged.legacy_aliases || base.legacy_aliases),
    display_name: displayName,
    internal_name: normalizeText(merged.internal_name || fallback.internal_name || base.internal_name),
    status: STORE_STATUSES.includes(String(merged.status || "").trim().toLowerCase()) ? String(merged.status).trim().toLowerCase() : base.status,
    type: STORE_TYPES.includes(String(merged.type || "").trim().toLowerCase()) ? String(merged.type).trim().toLowerCase() : base.type,
    company: {
      ...base.company,
      ...(merged.company || {})
    },
    address: {
      ...base.address,
      ...(merged.address || {})
    },
    contact: {
      ...base.contact,
      ...(merged.contact || {})
    },
    terminal: {
      ...base.terminal,
      ...(merged.terminal || {})
    },
    inventory: {
      ...base.inventory,
      ...(merged.inventory || {}),
      linked_deposit_ids: normalizeStringArray(merged.inventory?.linked_deposit_ids || base.inventory.linked_deposit_ids)
    },
    policies: {
      ...base.policies,
      ...(merged.policies || {})
    },
    integrations: {
      ...base.integrations,
      ...(merged.integrations || {})
    },
    metadata: {
      ...base.metadata,
      ...(merged.metadata || {})
    }
  };
}

function ensureStoreSettingsDir() {
  if (!fs.existsSync(STORE_SETTINGS_DIR)) {
    fs.mkdirSync(STORE_SETTINGS_DIR, { recursive: true });
  }
}

function ensureStoreSettingsFile() {
  ensureStoreSettingsDir();
  if (!fs.existsSync(STORE_SETTINGS_PATH)) {
    fs.writeFileSync(STORE_SETTINGS_PATH, `${JSON.stringify(createDefaultStoreSettingsData(), null, 2)}\n`, "utf8");
  }
}

function readStoreSettingsFile() {
  ensureStoreSettingsFile();
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_SETTINGS_PATH, "utf8"));
    const currentRows = Array.isArray(raw?.stores) ? raw.stores : [];
    const byId = new Map(
      currentRows
        .map((item) => normalizeStoreRecord(item))
        .filter((item) => item.store_id)
        .map((item) => [item.store_id, item])
    );
    getActiveOperationalStoreOptions().forEach((option) => {
      const storeId = normalizeStoreKey(option.value || "");
      if (!byId.has(storeId)) {
        byId.set(storeId, createDefaultStoreRecord(storeId, option.label));
      }
    });
    const stores = Array.from(byId.values()).sort((left, right) =>
      String(left.display_name || left.store_id).localeCompare(String(right.display_name || right.store_id), "pt-BR")
    );
    return { stores };
  } catch (error) {
    const fallback = createDefaultStoreSettingsData();
    fs.writeFileSync(STORE_SETTINGS_PATH, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
    return fallback;
  }
}

function writeStoreSettingsFile(payload = {}) {
  ensureStoreSettingsDir();
  const data = {
    stores: Array.isArray(payload.stores) ? payload.stores.map((item) => normalizeStoreRecord(item)).filter((item) => item.store_id) : []
  };
  fs.writeFileSync(STORE_SETTINGS_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
}

function listStoreSettings() {
  return readStoreSettingsFile().stores.map((item) => safeClone(item));
}

function getStoreSettingsById(storeId = "") {
  const normalizedId = normalizeStoreKey(storeId || "");
  if (!normalizedId) return null;
  return listStoreSettings().find((item) => item.store_id === normalizedId) || null;
}

function findStoreSettingsRecord(storeIdOrAlias = "") {
  const normalizedId = normalizeStoreKey(storeIdOrAlias || "");
  const normalizedInput = normalizeStoreAscii(storeIdOrAlias || "");
  if (!normalizedId && !normalizedInput) {
    return null;
  }
  return listStoreSettings().find((item) => {
    const normalizedAliases = normalizeStringArray(item.legacy_aliases || []);
    const recordKeys = new Set([
      normalizeStoreKey(item.store_id || ""),
      normalizeStoreKey(item.display_name || ""),
      ...normalizedAliases.map((alias) => normalizeStoreKey(alias))
    ].filter(Boolean));
    if (normalizedId && recordKeys.has(normalizedId)) {
      return true;
    }
    if (!normalizedInput) {
      return false;
    }
    const recordAliases = [
      item.store_id || "",
      item.display_name || "",
      ...normalizedAliases
    ].map((alias) => normalizeStoreAscii(alias)).filter(Boolean);
    return recordAliases.includes(normalizedInput);
  }) || null;
}

function buildStorePublicContext(record = {}, fallback = {}) {
  const defaultRecord = createDefaultStoreRecord(
    normalizeStoreKey(fallback.store_id || fallback.display_name || record?.store_id || ""),
    fallback.display_name || record?.display_name || record?.store_id || ""
  );
  const resolved = record && typeof record === "object"
    ? normalizeStoreRecord(record, defaultRecord)
    : defaultRecord;
  const fallbackId = normalizeStoreKey(fallback.store_id || fallback.display_name || resolved.store_id || "");
  const storeId = normalizeStoreKey(resolved.store_id || fallbackId || "");
  const displayName = normalizeText(
    resolved.display_name
    || resolved.company?.trade_name
    || fallback.display_name
    || formatStoreLabel(storeId || fallbackId || "")
  );
  return {
    store_id: storeId,
    display_name: displayName || formatStoreLabel(storeId || fallbackId || ""),
    internal_name: normalizeText(resolved.internal_name || ""),
    type: normalizeText(resolved.type || ""),
    status: normalizeText(resolved.status || ""),
    company: {
      legal_name: normalizeText(resolved.company?.legal_name || ""),
      trade_name: normalizeText(resolved.company?.trade_name || displayName || ""),
      cnpj: normalizeText(resolved.company?.cnpj || ""),
      state_registration: normalizeText(resolved.company?.state_registration || "")
    },
    address: {
      zip: normalizeText(resolved.address?.zip || ""),
      street: normalizeText(resolved.address?.street || ""),
      number: normalizeText(resolved.address?.number || ""),
      complement: normalizeText(resolved.address?.complement || ""),
      district: normalizeText(resolved.address?.district || ""),
      city: normalizeText(resolved.address?.city || ""),
      state: normalizeText(resolved.address?.state || ""),
      country: normalizeText(resolved.address?.country || "Brasil")
    },
    contact: {
      phone: normalizeText(resolved.contact?.phone || ""),
      whatsapp: normalizeText(resolved.contact?.whatsapp || ""),
      email: normalizeText(resolved.contact?.email || ""),
      manager_name: normalizeText(resolved.contact?.manager_name || ""),
      opening_hours: normalizeText(resolved.contact?.opening_hours || "")
    },
    terminal: {
      default_register_id: normalizeText(resolved.terminal?.default_register_id || ""),
      default_terminal_label: normalizeText(resolved.terminal?.default_terminal_label || ""),
      receipt_footer: normalizeText(resolved.terminal?.receipt_footer || ""),
      sale_prefix: normalizeText(resolved.terminal?.sale_prefix || "")
    },
    policies: {
      pickup_enabled: normalizeBoolean(resolved.policies?.pickup_enabled, true),
      delivery_enabled: normalizeBoolean(resolved.policies?.delivery_enabled, false),
      delivery_policy_label: normalizeText(resolved.policies?.delivery_policy_label || "")
    },
    metadata: {
      updated_at: normalizeText(resolved.metadata?.updated_at || ""),
      updated_by: normalizeText(resolved.metadata?.updated_by || "")
    }
  };
}

function getStorePublicContext(storeIdOrAlias = "", fallback = {}) {
  const record = findStoreSettingsRecord(storeIdOrAlias)
    || (fallback.store_id ? findStoreSettingsRecord(fallback.store_id) : null)
    || (fallback.display_name ? findStoreSettingsRecord(fallback.display_name) : null)
    || getStoreSettingsById(storeIdOrAlias);
  return buildStorePublicContext(record, {
    store_id: normalizeStoreKey(storeIdOrAlias || fallback.store_id || ""),
    display_name: normalizeText(fallback.display_name || formatStoreLabel(storeIdOrAlias || fallback.store_id || ""))
  });
}

function saveStoreSettingsRecord(storeId = "", nextRecord = {}) {
  const normalizedId = normalizeStoreKey(storeId || nextRecord.store_id || "");
  if (!normalizedId) {
    throw new Error("Loja inválida para persistência.");
  }
  const current = readStoreSettingsFile();
  const rows = Array.isArray(current.stores) ? current.stores : [];
  const index = rows.findIndex((item) => normalizeStoreKey(item.store_id || "") === normalizedId);
  const fallback = index >= 0 ? rows[index] : createDefaultStoreRecord(normalizedId, nextRecord.display_name || normalizedId);
  const merged = normalizeStoreRecord({ ...fallback, ...nextRecord, store_id: normalizedId }, fallback);
  if (index >= 0) {
    rows[index] = merged;
  } else {
    rows.push(merged);
  }
  const saved = writeStoreSettingsFile({ stores: rows });
  return saved.stores.find((item) => item.store_id === normalizedId) || merged;
}

module.exports = {
  STORE_SETTINGS_PATH,
  STORE_STATUSES,
  STORE_TYPES,
  createDefaultStoreRecord,
  ensureStoreSettingsFile,
  listStoreSettings,
  getStoreSettingsById,
  findStoreSettingsRecord,
  buildStorePublicContext,
  getStorePublicContext,
  saveStoreSettingsRecord,
  normalizeStoreRecord,
  normalizeStringArray,
  normalizeBoolean
};
