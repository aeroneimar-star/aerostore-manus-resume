"use strict";

const express = require("express");
const {
  getCashRegisterById,
  getOpenCashRegisterByStore,
  computeCashRegisterExpected,
  registerManualCashMovement,
  listCashMovementsForRegister
} = require("../services/pdvControlService");
const { normalizeStoreKey, storesMatch } = require("../utils/pdvStoreUtils");
const { recordAuditEvent } = require("../../audit/auditService");

const router = express.Router();

function normalizeStoreScope(value = "") {
  return normalizeStoreKey(value || "");
}

function hasPermission(user = {}, permission = "") {
  return Boolean(user?.permissions?.[permission]);
}

function getAllowedStores(user = {}) {
  return Array.isArray(user.allowed_stores)
    ? user.allowed_stores.map((item) => normalizeStoreScope(item)).filter(Boolean)
    : [];
}

function getEffectiveStore(user = {}, fallback = "") {
  return normalizeStoreScope(
    fallback
    || user.active_store_id
    || user.activeStoreId
    || user.active_store
    || user.store_id
    || user.store
    || ""
  );
}

function canAccessStore(user = {}, storeId = "") {
  const normalizedStore = normalizeStoreScope(storeId);
  if (!normalizedStore || user?.permissions?.can_view_all_stores) {
    return true;
  }
  const allowedStores = getAllowedStores(user);
  return !allowedStores.length || allowedStores.some((allowedStore) => storesMatch(allowedStore, normalizedStore));
}

function normalizeMovementType(type = "") {
  const normalized = String(type || "").trim().toLowerCase();
  if (["aporte", "suprimento", "deposito", "deposit"].includes(normalized)) return "aporte";
  if (["sangria", "retirada", "withdrawal"].includes(normalized)) return "sangria";
  return "";
}

function buildCashSummary(register = {}) {
  const expected = computeCashRegisterExpected(register || {});
  return {
    cash_register_id: register?.cash_register_id || "",
    store_id: normalizeStoreScope(register?.loja || register?.store_id || ""),
    status: register?.status || "",
    initial_cash_amount: Number(register?.valor_inicial || 0),
    cash_in_sales_total: expected.cash_in_sales_total || 0,
    cash_deposits_total: expected.cash_deposits_total || expected.aportes_total || 0,
    aportes_total: expected.aportes_total || expected.cash_deposits_total || 0,
    cash_withdrawals_total: expected.cash_withdrawals_total || expected.sangrias_total || 0,
    sangrias_total: expected.sangrias_total || expected.cash_withdrawals_total || 0,
    expected_cash_amount: expected.expected_cash_amount || expected.dinheiro_esperado || 0,
    counted_cash_amount: expected.counted_cash_amount,
    cash_difference: expected.cash_difference,
    expected
  };
}

router.post("/movements", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_register_cash_movement")) {
      return res.status(403).json({ error: "Seu perfil nao pode registrar sangria ou aporte." });
    }
    const storeId = getEffectiveStore(req.user || {}, req.body?.store_id || req.body?.store || "");
    if (!canAccessStore(req.user || {}, storeId)) {
      return res.status(403).json({ error: "Acesso restrito a sua loja.", store_id: storeId });
    }
    const type = normalizeMovementType(req.body?.type || "");
    const result = await registerManualCashMovement({
      type,
      amount: req.body?.amount,
      reason: req.body?.reason,
      observation: req.body?.observation,
      store_id: storeId,
      metadata: {
        source: "pdv_cash_movements_endpoint",
        route: "/api/pdv/cash/movements"
      }
    }, req.user || {});
    const auditAction = type === "sangria" ? "pdv_cash_withdrawal_registered" : "pdv_cash_deposit_registered";
    recordAuditEvent({
      req,
      module: "pdv_cash",
      action: auditAction,
      entity_type: "cash_register",
      entity_id: result.cash_register?.cash_register_id || "",
      entity_label: type,
      store_id: result.cash_register?.loja || storeId,
      amount: result.movement?.amount || req.body?.amount || 0,
      reason: req.body?.reason || "",
      after: result.movement,
      metadata: {
        movement_id: result.movement?.movement_id || "",
        cash_register_id: result.cash_register?.cash_register_id || "",
        type
      },
      includeBody: false
    }).catch(() => null);
    res.json({
      ok: true,
      movement: result.movement,
      cash_register: {
        ...result.cash_register,
        expected: result.expected
      },
      summary: buildCashSummary(result.cash_register),
      movements: result.movements
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Falha ao registrar movimentacao de caixa." });
  }
});

router.get("/movements", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_view_cash_register")) {
      return res.status(403).json({ error: "Seu perfil nao pode consultar movimentacoes de caixa." });
    }
    const explicitRegisterId = String(req.query.cash_register_id || req.query.cashRegisterId || "").trim();
    const register = explicitRegisterId
      ? getCashRegisterById(explicitRegisterId)
      : getOpenCashRegisterByStore(getEffectiveStore(req.user || {}, req.query.store || req.query.store_id || ""));
    if (!register) {
      return res.status(404).json({ error: "Caixa operacional do PDV nao encontrado." });
    }
    const storeId = normalizeStoreScope(register.loja || register.store_id || "");
    if (!canAccessStore(req.user || {}, storeId)) {
      return res.status(403).json({ error: "Acesso restrito a sua loja.", store_id: storeId });
    }
    const movements = await listCashMovementsForRegister(register.cash_register_id);
    res.json({
      items: movements,
      summary: buildCashSummary(register)
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Falha ao carregar movimentacoes de caixa." });
  }
});

module.exports = {
  pdvCashRouter: router
};
