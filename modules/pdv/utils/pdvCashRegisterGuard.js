"use strict";

const { recordAuditEvent } = require("../../audit/auditService");
const { getOpenCashRegisterByStore } = require("../services/pdvControlService");
const { formatStoreLabel, normalizeStoreKey } = require("./pdvStoreUtils");

const CASH_REGISTER_REQUIRED_CODE = "CASH_REGISTER_REQUIRED";
const CASH_REGISTER_REQUIRED_STATUS = 409;
const CASH_REGISTER_REQUIRED_MESSAGE = "Caixa fechado. Abra o caixa da loja antes de operar vendas.";

function createCashRegisterRequiredError(message = CASH_REGISTER_REQUIRED_MESSAGE, storeId = "") {
  const error = new Error(message || CASH_REGISTER_REQUIRED_MESSAGE);
  error.statusCode = CASH_REGISTER_REQUIRED_STATUS;
  error.code = CASH_REGISTER_REQUIRED_CODE;
  error.reason = "caixa_fechado";
  error.store_id = normalizeStoreKey(storeId || "");
  return error;
}

function getRequestStoreFallback(req = {}) {
  return normalizeStoreKey(
    req.body?.store_id
    || req.body?.loja
    || req.body?.store
    || req.query?.store_id
    || req.query?.store
    || req.user?.store_id
    || req.user?.store
    || req.user?.loja
    || ""
  );
}

function getOpenCashRegisterForStore(storeId = "") {
  const normalizedStore = normalizeStoreKey(storeId || "");
  if (!normalizedStore) {
    return null;
  }
  return getOpenCashRegisterByStore(normalizedStore);
}

async function recordCashRegisterBlockedAttempt(req = {}, options = {}) {
  const storeId = normalizeStoreKey(options.storeId || options.store_id || getRequestStoreFallback(req));
  try {
    await recordAuditEvent({
      req,
      module: options.module || "pdv_cash_register",
      action: options.action || "cash_register_required",
      entity_type: options.entityType || options.entity_type || "",
      entity_id: options.entityId || options.entity_id || "",
      sale_id: options.saleId || options.sale_id || "",
      store_id: storeId,
      store_name: formatStoreLabel(storeId),
      result: "blocked",
      reason: "caixa_fechado",
      message: options.message || CASH_REGISTER_REQUIRED_MESSAGE,
      source: "backend",
      includeBody: false,
      metadata: {
        code: CASH_REGISTER_REQUIRED_CODE,
        route_action: options.action || "cash_register_required",
        store_id: storeId,
        store_label: formatStoreLabel(storeId)
      }
    });
  } catch (error) {
    console.error("[PDV CASH GUARD] Falha ao auditar bloqueio de caixa", error);
  }
}

async function ensureOpenCashRegisterForStore(req = {}, storeId = "", options = {}) {
  const normalizedStore = normalizeStoreKey(storeId || getRequestStoreFallback(req));
  const openRegister = getOpenCashRegisterForStore(normalizedStore);
  if (openRegister) {
    return openRegister;
  }
  const message = options.message || CASH_REGISTER_REQUIRED_MESSAGE;
  await recordCashRegisterBlockedAttempt(req, {
    ...options,
    storeId: normalizedStore,
    message
  });
  throw createCashRegisterRequiredError(message, normalizedStore);
}

module.exports = {
  CASH_REGISTER_REQUIRED_CODE,
  CASH_REGISTER_REQUIRED_MESSAGE,
  CASH_REGISTER_REQUIRED_STATUS,
  createCashRegisterRequiredError,
  ensureOpenCashRegisterForStore,
  getOpenCashRegisterForStore,
  recordCashRegisterBlockedAttempt
};
