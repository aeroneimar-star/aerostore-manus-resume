"use strict";

const { isSulStore } = require("../utils/pdvStoreUtils");

const DEFAULT_LABEL_HEADER = "AEROSTORE";
const SUL_LABEL_HEADER = "Casa Camborê";

const SUL_LABEL_PRINT_ALLOWLIST = Object.freeze({
  userIds: Object.freeze([1, 10]),
  emails: Object.freeze([
    "admin@aerostore.local",
    "stela@aerostore.local"
  ])
});

function normalizeUserEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeUserId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveLabelHeaderText(storeId = "") {
  return isSulStore(storeId) ? SUL_LABEL_HEADER : DEFAULT_LABEL_HEADER;
}

function canPrintSulStoreLabel(user = {}) {
  const userId = normalizeUserId(user.id);
  const email = normalizeUserEmail(user.email);
  if (userId !== null && SUL_LABEL_PRINT_ALLOWLIST.userIds.includes(userId)) {
    return true;
  }
  if (email && SUL_LABEL_PRINT_ALLOWLIST.emails.includes(email)) {
    return true;
  }
  return false;
}

function assertCanPrintSulStoreLabel(user = {}, storeId = "") {
  if (!isSulStore(storeId)) {
    return;
  }
  if (canPrintSulStoreLabel(user)) {
    return;
  }
  const error = new Error("Você não tem permissão para imprimir etiquetas da loja Sul.");
  error.statusCode = 403;
  throw error;
}

function resolveLabelStoreId(sources = {}) {
  const candidates = [
    sources.payload_store_id,
    sources.payload_loja,
    sources.inventory_store_id,
    sources.catalog_store_id,
    sources.ai_store
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function buildLabelStoreTrace(sources = {}, resolvedStoreId = "") {
  return {
    product_id_received: sources.product_id_received || "",
    variation_id_received: sources.variation_id_received || "",
    store_id_received: sources.payload_store_id || "",
    loja_received: sources.payload_loja || "",
    lookup_source: sources.lookup_source || "",
    pdv_parent_id: sources.pdv_parent_id || "",
    legacy_ai_product_id: sources.legacy_ai_product_id || "",
    catalog_store_raw: sources.ai_store || "",
    inventory_store_id: sources.inventory_store_id || "",
    resolved_store_id: resolvedStoreId || "",
    label_header: resolveLabelHeaderText(resolvedStoreId)
  };
}

module.exports = {
  DEFAULT_LABEL_HEADER,
  SUL_LABEL_HEADER,
  SUL_LABEL_PRINT_ALLOWLIST,
  resolveLabelHeaderText,
  resolveLabelStoreId,
  buildLabelStoreTrace,
  canPrintSulStoreLabel,
  assertCanPrintSulStoreLabel
};
