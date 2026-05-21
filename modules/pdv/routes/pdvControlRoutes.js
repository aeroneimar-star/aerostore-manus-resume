"use strict";

const express = require("express");
const {
  AUTHORIZATION_TYPES,
  AUTHORIZATION_OPERATION_TYPES,
  CASH_MOVEMENT_TYPES,
  DISCOUNT_REASONS,
  getPdvUserRole,
  openCashRegister,
  registerCashMovement,
  closeCashRegister,
  reopenCashRegister,
  issueAuthorizationPin,
  listCashRegisters,
  getCashRegisterById,
  getCashDashboard,
  computeCashRegisterExpected,
  loadAuditLogs,
  listAuthorizers,
  createOrRefreshAuthorizer,
  verifyAuthorizerSetup,
  resetAuthorizerTotp,
  setAuthorizerStatus,
  validateOperationAuthorization,
  loadAuthorizationAudit
} = require("../services/pdvControlService");
const { normalizeStoreKey } = require("../utils/pdvStoreUtils");

const router = express.Router();

function normalizeStoreScope(value = "") {
  return normalizeStoreKey(value || "");
}

function isCashStoreMatch(left = "", right = "") {
  const leftStore = normalizeStoreScope(left);
  const rightStore = normalizeStoreScope(right);
  if (!leftStore || !rightStore) {
    return false;
  }
  if (leftStore === rightStore) {
    return true;
  }
  if ((leftStore === "vila" && rightStore === "vila_masc") || (leftStore === "vila_masc" && rightStore === "vila")) {
    return true;
  }
  return false;
}

function getAllowedStores(user = {}) {
  return Array.isArray(user.allowed_stores)
    ? user.allowed_stores.map((item) => normalizeStoreScope(item)).filter(Boolean)
    : [];
}

function hasPermission(user = {}, permission = "") {
  return Boolean(user?.permissions?.[permission]);
}

function ensureStoreAccess(req, res, storeValue = "") {
  const user = req.user || {};
  const targetStore = normalizeStoreScope(storeValue);
  if (!targetStore || user?.permissions?.can_view_all_stores) {
    return true;
  }
  const allowedStores = getAllowedStores(user);
  if (!allowedStores.length || allowedStores.some((allowedStore) => isCashStoreMatch(allowedStore, targetStore))) {
    return true;
  }
  res.status(403).json({ error: "Acesso restrito à sua loja.", store_id: targetStore });
  return false;
}

function filterByStore(req, items = []) {
  const user = req.user || {};
  if (user?.permissions?.can_view_all_stores) {
    return Array.isArray(items) ? items : [];
  }
  const allowedStores = getAllowedStores(user);
  if (!allowedStores.length) {
    return Array.isArray(items) ? items : [];
  }
  return (Array.isArray(items) ? items : []).filter((item) => {
    const itemStore = normalizeStoreScope(item?.loja || item?.store_id || item?.store || "");
    return !itemStore || allowedStores.some((allowedStore) => isCashStoreMatch(allowedStore, itemStore));
  });
}

router.get("/manifest", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_view_cash_register")) {
      return res.status(403).json({ error: "Seu perfil não pode acessar o manifesto do caixa." });
    }
    res.json({
      roles: ["VENDEDOR", "GERENTE", "ADMIN"],
      authorizationTypes: AUTHORIZATION_TYPES,
      authorizationOperationTypes: AUTHORIZATION_OPERATION_TYPES,
      movementTypes: CASH_MOVEMENT_TYPES,
      discountReasons: DISCOUNT_REASONS,
      currentRole: getPdvUserRole(req.user || {})
    });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o manifesto de controle do PDV." });
  }
});

router.get("/dashboard", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_view_cash_register")) {
      return res.status(403).json({ error: "Seu perfil não pode acessar o dashboard do caixa." });
    }
    const dashboard = getCashDashboard();
    res.json({
      ...dashboard,
      activeRegisters: filterByStore(req, dashboard.activeRegisters || []),
      recentAudits: filterByStore(req, dashboard.recentAudits || []),
      authorizations: filterByStore(req, dashboard.authorizations || []),
      latestRegister: ensureStoreAccess(req, { status() { return { json() {} }; } }, dashboard.latestRegister?.loja || "")
        ? dashboard.latestRegister
        : null
    });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o dashboard do caixa operacional do PDV." });
  }
});

router.get("/registers", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_view_cash_register")) {
      return res.status(403).json({ error: "Seu perfil não pode acessar os caixas operacionais." });
    }
    res.json({ items: filterByStore(req, listCashRegisters()).slice(0, 120) });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar os caixas operacionais do PDV." });
  }
});

router.post("/registers/open", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_open_close_register")) {
      return res.status(403).json({ error: "Seu perfil não pode abrir caixa." });
    }
    if (!ensureStoreAccess(req, res, req.body?.loja || req.body?.store_id || "")) {
      return;
    }
    res.json(openCashRegister(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao abrir o caixa operacional do PDV." });
  }
});

router.get("/registers/:cashRegisterId", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_view_cash_register")) {
      return res.status(403).json({ error: "Seu perfil não pode acessar o detalhe do caixa." });
    }
    const register = getCashRegisterById(req.params.cashRegisterId);
    if (!register) {
      return res.status(404).json({ error: "Caixa operacional do PDV não encontrado." });
    }
    if (!ensureStoreAccess(req, res, register.loja || register.store_id || "")) {
      return;
    }
    res.json({
      ...register,
      expected: computeCashRegisterExpected(register)
    });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o detalhe do caixa operacional do PDV." });
  }
});

router.post("/registers/:cashRegisterId/movements", async (req, res) => {
  try {
    const register = getCashRegisterById(req.params.cashRegisterId);
    if (!register) {
      return res.status(404).json({ error: "Caixa operacional do PDV não encontrado." });
    }
    if (!ensureStoreAccess(req, res, register.loja || register.store_id || "")) {
      return;
    }
    if (!hasPermission(req.user || {}, "can_register_cash_movement")) {
      return res.status(403).json({ error: "Seu perfil não pode registrar movimentações de caixa." });
    }
    res.json(registerCashMovement({
      cashRegisterId: req.params.cashRegisterId,
      type: req.body?.type,
      value: req.body?.value,
      reason: req.body?.reason,
      observation: req.body?.observation,
      payload: req.body?.payload || {},
      requireManager: ["SANGRIA", "SUPRIMENTO", "DESPESA", "AJUSTE"].includes(String(req.body?.type || "").toUpperCase())
    }, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao registrar movimentação de caixa do PDV." });
  }
});

router.post("/registers/:cashRegisterId/close", async (req, res) => {
  try {
    const register = getCashRegisterById(req.params.cashRegisterId);
    if (!register) {
      return res.status(404).json({ error: "Caixa operacional do PDV não encontrado." });
    }
    if (!ensureStoreAccess(req, res, register.loja || register.store_id || "")) {
      return;
    }
    if (!hasPermission(req.user || {}, "can_close_register")) {
      return res.status(403).json({ error: "Seu perfil não pode fechar caixa." });
    }
    res.json(closeCashRegister({
      cashRegisterId: req.params.cashRegisterId,
      dinheiro_informado: req.body?.dinheiro_informado,
      observacao: req.body?.observacao
    }, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao fechar o caixa operacional do PDV." });
  }
});

router.post("/registers/:cashRegisterId/reopen", async (req, res) => {
  try {
    const register = getCashRegisterById(req.params.cashRegisterId);
    if (!register) {
      return res.status(404).json({ error: "Caixa operacional do PDV não encontrado." });
    }
    if (!ensureStoreAccess(req, res, register.loja || register.store_id || "")) {
      return;
    }
    if (!hasPermission(req.user || {}, "can_close_register")) {
      return res.status(403).json({ error: "Seu perfil não pode reabrir caixa." });
    }
    res.json(reopenCashRegister({
      cashRegisterId: req.params.cashRegisterId,
      reason: req.body?.reason,
      pin: req.body?.pin
    }, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao reabrir o caixa operacional do PDV." });
  }
});

router.post("/authorizations/issue", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_approve_discount_authorization")) {
      return res.status(403).json({ error: "Seu perfil não pode emitir PIN temporário do PDV." });
    }
    if (!ensureStoreAccess(req, res, req.body?.loja || req.body?.store_id || "")) {
      return;
    }
    res.json(issueAuthorizationPin(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao emitir PIN temporário do PDV." });
  }
});

router.get("/authorizers", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_request_discount_authorization") && !hasPermission(req.user || {}, "can_approve_discount_authorization")) {
      return res.status(403).json({ error: "Seu perfil nao pode consultar autorizadores do PDV." });
    }
    const activeOnly = req.query.activeOnly === "1" || req.query.activeOnly === "true";
    res.json({ items: listAuthorizers({ activeOnly }) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao carregar os autorizadores do PDV." });
  }
});

router.post("/authorizers", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_approve_discount_authorization")) {
      return res.status(403).json({ error: "Seu perfil nao pode cadastrar autorizadores do PDV." });
    }
    res.json(await createOrRefreshAuthorizer(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao criar o autorizador do PDV." });
  }
});

router.post("/authorizers/:authorizerId/verify-setup", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_approve_discount_authorization")) {
      return res.status(403).json({ error: "Seu perfil nao pode ativar autorizadores do PDV." });
    }
    res.json({ authorizer: verifyAuthorizerSetup(req.params.authorizerId, req.body?.code || "", req.user || {}) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao validar o primeiro codigo do autorizador." });
  }
});

router.post("/authorizers/:authorizerId/reset", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_approve_discount_authorization")) {
      return res.status(403).json({ error: "Seu perfil nao pode resetar autorizadores do PDV." });
    }
    res.json(await resetAuthorizerTotp(req.params.authorizerId, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao resetar o autenticador do autorizador." });
  }
});

router.patch("/authorizers/:authorizerId/status", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_approve_discount_authorization")) {
      return res.status(403).json({ error: "Seu perfil nao pode alterar status de autorizadores." });
    }
    res.json({ authorizer: setAuthorizerStatus(req.params.authorizerId, Boolean(req.body?.is_active), req.user || {}) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao atualizar o status do autorizador." });
  }
});

router.post("/authorizations/validate", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_request_discount_authorization")) {
      return res.status(403).json({ error: "Seu perfil nao pode solicitar autorizacoes do PDV." });
    }
    res.json(validateOperationAuthorization({
      ...(req.body || {}),
      ip: req.ip || "",
      user_agent: req.headers["user-agent"] || ""
    }, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao validar a autorizacao do PDV." });
  }
});

router.get("/authorizations/audit", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_view_audit")) {
      return res.status(403).json({ error: "Seu perfil nao pode acessar a auditoria de autorizacoes." });
    }
    res.json({ items: loadAuthorizationAudit().slice(0, 200) });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar a auditoria de autorizacoes do PDV." });
  }
});

router.get("/audit", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_view_audit")) {
      return res.status(403).json({ error: "Seu perfil não pode acessar a auditoria do PDV." });
    }
    res.json({ items: filterByStore(req, loadAuditLogs()).slice(0, 200) });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar os logs de auditoria do PDV." });
  }
});

module.exports = {
  pdvControlRouter: router
};
