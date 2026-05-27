"use strict";

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const ACTIVE_OPERATIONAL_STORE_OPTIONS = [
  { value: "vila", label: "Vila", active: true },
  { value: "botanico", label: "Botânico", active: true },
  { value: "sul", label: "Sul", active: true }
];

const ACTIVE_OPERATIONAL_STORE_KEYS = new Set(
  ACTIVE_OPERATIONAL_STORE_OPTIONS.map((item) => item.value)
);

const ADJACENT_STORE_GROUPS = [];

const SAME_CITY_STORE_GROUPS = {
  ribeirao_preto: ["vila", "botanico", "loja_geral"],
  sul: ["sul", "camboriu"]
};

function normalizeStoreAscii(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeStoreKey(value = "") {
  const ascii = normalizeStoreAscii(value);
  if (!ascii) {
    return "";
  }
  if (ascii === "loja geral" || ascii === "loja_geral" || ascii === "geral") return "loja_geral";
  if (ascii === "sul" || ascii.includes("loja sul") || ascii.includes("aerostore sul")) return "sul";
  if (
    ascii === "vila"
    || ascii === "vila masc"
    || ascii === "vila_masc"
    || ascii === "vila masculino"
    || ascii === "vila masculina"
    || ascii === "vila fem"
    || ascii === "vila_fem"
    || ascii === "vila infantil"
    || ascii === "vila infant"
    || ascii === "vila_infant"
    || ascii === "vila fem infant"
    || ascii === "vila_fem_infant"
    || ascii === "vila feminina"
    || ascii === "vila infantil feminina"
    || ascii === "vila feminina infantil"
    || ascii.includes("vila masc")
    || ascii.includes("vila masculino")
    || ascii.includes("vila feminina")
    || ascii.includes("vila infantil")
    || ascii.includes("vila fem")
  ) return "vila";
  if (ascii.includes("botanico")) return "botanico";
  if (ascii.includes("vila")) return "vila";
  if (ascii.includes("bonfim")) return "bonfim";
  if (ascii.includes("camboriu")) return "camboriu";
  return ascii
    .replace(/\b(aerostore|loja|store|unidade|filial|operacional|pdv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "_");
}

function formatStoreLabel(value = "") {
  const key = normalizeStoreKey(value);
  const predefined = {
    vila_masc: "Vila",
    vila_fem: "Vila",
    vila_fem_infant: "Vila",
    vila_infant: "Vila",
    vila: "Vila",
    botanico: "Botânico",
    bonfim: "Bonfim (legado)",
    camboriu: "Camboriu / Sul",
    sul: "Sul",
    loja_geral: "Estoque geral interno"
  };
  if (predefined[key]) {
    return predefined[key];
  }
  const clean = normalizeText(value || key || "");
  if (!clean) {
    return "Loja";
  }
  return clean
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getActiveOperationalStoreOptions() {
  return ACTIVE_OPERATIONAL_STORE_OPTIONS.map((item) => ({ ...item }));
}

function isActiveOperationalStore(value = "") {
  return ACTIVE_OPERATIONAL_STORE_KEYS.has(normalizeStoreKey(value));
}

function isInternalOperationalStore(value = "") {
  return normalizeStoreKey(value) === "loja_geral";
}

function isLegacyOperationalStore(value = "") {
  const key = normalizeStoreKey(value);
  return Boolean(key)
    && !isActiveOperationalStore(key)
    && !isInternalOperationalStore(key)
    && key !== "camboriu";
}

function getStoreLookupKey(value = "") {
  const key = normalizeStoreKey(value);
  if (["vila", "vila_masc", "vila_fem", "vila_fem_infant", "vila_infant"].includes(key)) {
    return "vila";
  }
  return key;
}

function buildStoreOptions(values = [], { activeOnly = false } = {}) {
  if (activeOnly) {
    return getActiveOperationalStoreOptions();
  }
  const seen = new Map();
  values.flat().forEach((value) => {
    const key = normalizeStoreKey(value);
    if (!key) {
      return;
    }
    const label = formatStoreLabel(value || key);
    const current = seen.get(key);
    if (!current || current.label.length < label.length) {
      seen.set(key, {
        value: key,
        label,
        active: true
      });
    }
  });
  return Array.from(seen.values()).sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
}

function storesMatch(left = "", right = "") {
  const leftKey = getStoreLookupKey(left);
  const rightKey = getStoreLookupKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function isSulStore(value = "") {
  return ["sul", "camboriu"].includes(normalizeStoreKey(value));
}

function isSelectableStockOriginStore(value = "") {
  const key = normalizeStoreKey(value);
  if (!key) {
    return false;
  }
  if (key === "bonfim") {
    return false;
  }
  return isActiveOperationalStore(key) || ["camboriu", "loja_geral"].includes(key);
}

function getStoreLogisticsGroup(value = "") {
  const key = normalizeStoreKey(value);
  if (!key) {
    return "";
  }
  if (SAME_CITY_STORE_GROUPS.ribeirao_preto.includes(key)) {
    return "ribeirao_preto";
  }
  if (SAME_CITY_STORE_GROUPS.sul.includes(key)) {
    return "sul";
  }
  if (key === "bonfim") {
    return "legacy_inactive";
  }
  return key;
}

function isAdjacentOperationalStorePair(left = "", right = "") {
  const leftKey = normalizeStoreKey(left);
  const rightKey = normalizeStoreKey(right);
  if (!leftKey || !rightKey || leftKey === rightKey) {
    return false;
  }
  return ADJACENT_STORE_GROUPS.some((group) => group.includes(leftKey) && group.includes(rightKey));
}

function isSameCityOperationalStorePair(left = "", right = "") {
  const leftGroup = getStoreLogisticsGroup(left);
  const rightGroup = getStoreLogisticsGroup(right);
  return Boolean(leftGroup && rightGroup && leftGroup === "ribeirao_preto" && rightGroup === "ribeirao_preto");
}

function getStoreLogisticsRelation(saleStoreValue = "", sourceStoreValue = "") {
  const saleStore = normalizeStoreKey(saleStoreValue);
  const sourceStore = normalizeStoreKey(sourceStoreValue);
  if (!saleStore || !sourceStore) {
    return "unknown";
  }
  if (saleStore === sourceStore) {
    return "local";
  }
  if (!isSelectableStockOriginStore(sourceStore)) {
    return "inactive_legacy";
  }
  if (isAdjacentOperationalStorePair(saleStore, sourceStore)) {
    return "adjacent";
  }
  if (isSameCityOperationalStorePair(saleStore, sourceStore)) {
    return "same_city";
  }
  if (getStoreLogisticsGroup(saleStore) === getStoreLogisticsGroup(sourceStore)) {
    return "same_region";
  }
  return "other_region";
}

module.exports = {
  ACTIVE_OPERATIONAL_STORE_OPTIONS,
  normalizeStoreKey,
  getStoreLookupKey,
  formatStoreLabel,
  buildStoreOptions,
  getActiveOperationalStoreOptions,
  isActiveOperationalStore,
  isInternalOperationalStore,
  isLegacyOperationalStore,
  isSelectableStockOriginStore,
  getStoreLogisticsGroup,
  isAdjacentOperationalStorePair,
  isSameCityOperationalStorePair,
  getStoreLogisticsRelation,
  storesMatch,
  isSulStore
};
