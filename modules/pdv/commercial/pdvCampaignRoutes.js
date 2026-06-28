"use strict";

const express = require("express");
const {
  getSellerPerformance,
  getPerformanceRanking,
  getStorePerformance,
  listCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  activateCampaign,
  cancelCampaign,
  getLiveStatus,
  settleCampaign,
  getCampaignResults,
  markRewardPaid
} = require("./pdvCampaignService");
const {
  listGoals,
  getGoalById,
  createGoal,
  updateGoal,
  activateGoal,
  cancelGoal,
  closeGoal,
  deleteGoal,
  getGoalProgress,
  snapshotGoalProgress,
  getGoalsSellerPerformance,
  getGoalsStorePerformance,
  listSellerOptions
} = require("./pdvCommercialGoalsService");

const router = express.Router();

function hasPermission(user = {}, permission = "") {
  const perms = user?.permissions || user?.perms || {};
  return Boolean(perms[permission]);
}

function isAdminOrManager(user = {}) {
  const rawRole = String(user?.role_key || user?.role || user?.perfil || user?.profile || user?.permission_profile || "").toLowerCase();
  const normalizedRole = (() => {
    if (["admin", "administrator", "administrador"].includes(rawRole)) return "admin";
    if (["manager", "gerente", "gestor"].includes(rawRole)) return "gestor";
    return rawRole;
  })();
  return ["admin", "gestor"].includes(normalizedRole);
}

function requireCommercialAccess(req, res, next) {
  if (isAdminOrManager(req.user) || hasPermission(req.user, "can_view_commercial_management")) {
    return next();
  }
  return res.status(403).json({ error: "Voce nao tem acesso a Gestao Comercial." });
}

function requireCampaignManage(req, res, next) {
  if (isAdminOrManager(req.user) || hasPermission(req.user, "can_manage_campaign_challenges")) {
    return next();
  }
  return res.status(403).json({ error: "Voce nao tem permissao para gerenciar Corridinhas." });
}

function requireSettleAccess(req, res, next) {
  if (isAdminOrManager(req.user) || hasPermission(req.user, "can_settle_campaign_rewards")) {
    return next();
  }
  return res.status(403).json({ error: "Voce nao tem permissao para apurar campanhas." });
}

function requireGoalsManage(req, res, next) {
  if (isAdminOrManager(req.user) || hasPermission(req.user, "can_manage_commercial_goals")) {
    return next();
  }
  return res.status(403).json({ error: "Voce nao tem permissao para gerenciar metas comerciais." });
}

// Vendedor logado sem ser admin/gestor: seu escopo de leitura deve se limitar
// as proprias metas. Helpers abaixo aplicam o filtro/forcam 403 quando ele tenta
// acessar dados de outro vendedor via URL ou query param.
function isSellerOnly(req) {
  if (!req || !req.user) return false;
  if (isAdminOrManager(req.user)) return false;
  const rawRole = String(req.user?.role_key || req.user?.role || req.user?.perfil || req.user?.profile || req.user?.permission_profile || "").toLowerCase();
  return ["seller", "vendedor", "sales"].includes(rawRole);
}

// ── Performance Base ─────────────────────────────────────────────────

router.get("/performance/seller/:seller_id", requireCommercialAccess, async (req, res) => {
  try {
    const { start_date, end_date, store_id } = req.query;
    const result = await getSellerPerformance(req.params.seller_id, { start_date, end_date, store_id });
    if (!result) return res.status(404).json({ error: "Vendedor nao encontrado." });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao buscar desempenho do vendedor." });
  }
});

router.get("/performance/ranking", requireCommercialAccess, async (req, res) => {
  try {
    const { store_id, start_date, end_date, limit } = req.query;
    const result = await getPerformanceRanking({ store_id, start_date, end_date, limit });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao buscar ranking." });
  }
});

router.get("/performance/store/:store_id", requireCommercialAccess, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const result = await getStorePerformance(req.params.store_id, { start_date, end_date });
    if (!result) return res.status(404).json({ error: "Loja nao encontrada." });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao buscar desempenho da loja." });
  }
});

// ── Campaigns CRUD ───────────────────────────────────────────────────

router.get("/campaigns", requireCommercialAccess, async (req, res) => {
  try {
    const { store_id, status } = req.query;
    const result = await listCampaigns({ store_id, status });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao listar campanhas." });
  }
});

router.post("/campaigns", requireCampaignManage, async (req, res) => {
  try {
    const result = await createCampaign(req.body, req.user || {});
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    const status = error.status === 400 ? 400 : 500;
    res.status(status).json({ error: error.message || "Falha ao criar campanha." });
  }
});

router.get("/campaigns/:id", requireCommercialAccess, async (req, res) => {
  try {
    const result = await getCampaignById(req.params.id);
    if (!result) return res.status(404).json({ error: "Campanha nao encontrada." });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao buscar campanha." });
  }
});

router.put("/campaigns/:id", requireCampaignManage, async (req, res) => {
  try {
    const existing = await getCampaignById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Campanha nao encontrada." });
    if (existing.status !== "draft") return res.status(400).json({ error: "Apenas campanhas em rascunho podem ser editadas." });
    const result = await updateCampaign(req.params.id, req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao atualizar campanha." });
  }
});

router.delete("/campaigns/:id", requireCampaignManage, async (req, res) => {
  try {
    const existing = await getCampaignById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Campanha nao encontrada." });
    if (existing.status === "active" || existing.status === "settled") {
      return res.status(400).json({ error: "Campanhas ativas ou apuradas nao podem ser excluidas." });
    }
    await deleteCampaign(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao excluir campanha." });
  }
});

// ── Campaign Status ──────────────────────────────────────────────────

router.post("/campaigns/:id/activate", requireCampaignManage, async (req, res) => {
  try {
    const result = await activateCampaign(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao ativar campanha." });
  }
});

router.post("/campaigns/:id/cancel", requireCampaignManage, async (req, res) => {
  try {
    const result = await cancelCampaign(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao cancelar campanha." });
  }
});

// ── Live / Ranking ───────────────────────────────────────────────────

router.get("/campaigns/:id/live", requireCommercialAccess, async (req, res) => {
  try {
    const result = await getLiveStatus(req.params.id, req.query);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao buscar ranking live." });
  }
});

// ── Settle ───────────────────────────────────────────────────────────

router.post("/campaigns/:id/settle", requireSettleAccess, async (req, res) => {
  try {
    const result = await settleCampaign(req.params.id, req.user || {});
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao apurar campanha." });
  }
});

// ── Results ──────────────────────────────────────────────────────────

router.get("/campaigns/:id/results", requireCommercialAccess, async (req, res) => {
  try {
    const result = await getCampaignResults(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao buscar resultados." });
  }
});

router.post("/campaigns/:id/results/:result_id/mark-paid", requireSettleAccess, async (req, res) => {
  try {
    const result = await markRewardPaid(req.params.result_id, req.user || {});
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao marcar premio como pago." });
  }
});

// ── Commercial Goals (Motor de Metas) ────────────────────────────────

router.get("/goals/catalog/sellers", requireCommercialAccess, async (req, res) => {
  try {
    const sellers = await listSellerOptions();
    res.json({ success: true, data: sellers });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao listar vendedores." });
  }
});

router.get("/goals/performance/seller/:seller_id", requireCommercialAccess, async (req, res) => {
  try {
    if (isSellerOnly(req)) {
      const userSellerId = Number(req.user?.seller_id || 0);
      const requestedSellerId = Number(req.params.seller_id || 0);
      if (!userSellerId || userSellerId !== requestedSellerId) {
        return res.status(403).json({ error: "Voce so pode consultar sua propria performance." });
      }
    }
    const { start_date, end_date } = req.query;
    const result = await getGoalsSellerPerformance(req.params.seller_id, { start_date, end_date });
    if (!result) return res.status(404).json({ error: "Vendedor nao encontrado." });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao buscar desempenho do vendedor (metas)." });
  }
});

router.get("/goals/performance/store/:store_id", requireCommercialAccess, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const result = await getGoalsStorePerformance(req.params.store_id, { start_date, end_date });
    if (!result) return res.status(404).json({ error: "Loja invalida." });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao buscar desempenho da loja (metas)." });
  }
});

router.get("/goals", requireCommercialAccess, async (req, res) => {
  try {
    const { store_id, status } = req.query;
    // Vendedor nao pode forcar query param para ver metas de outro seller.
    let effectiveSellerId;
    if (isSellerOnly(req)) {
      const userSellerId = Number(req.user?.seller_id || 0);
      effectiveSellerId = Number.isFinite(userSellerId) && userSellerId > 0 ? userSellerId : -1;
    } else {
      effectiveSellerId = req.query.seller_id ? Number(req.query.seller_id) : undefined;
    }
    const result = await listGoals({ store_id, status, seller_id: effectiveSellerId });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao listar metas." });
  }
});

router.post("/goals", requireGoalsManage, async (req, res) => {
  try {
    const result = await createGoal(req.body || {}, req.user || {}, req);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    const status = error.status === 400 ? 400 : 500;
    res.status(status).json({ error: error.message || "Falha ao criar meta." });
  }
});

router.get("/goals/:id", requireCommercialAccess, async (req, res) => {
  try {
    const result = await getGoalById(req.params.id);
    if (!result) return res.status(404).json({ error: "Meta nao encontrada." });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao buscar meta." });
  }
});

router.put("/goals/:id", requireGoalsManage, async (req, res) => {
  try {
    const result = await updateGoal(req.params.id, req.body || {}, req.user || {}, req);
    res.json({ success: true, data: result });
  } catch (error) {
    const status = error.status === 400 ? 400 : error.status === 404 ? 404 : 500;
    res.status(status).json({ error: error.message || "Falha ao atualizar meta." });
  }
});

router.post("/goals/:id/activate", requireGoalsManage, async (req, res) => {
  try {
    const result = await activateGoal(req.params.id, req.user || {}, req);
    res.json({ success: true, data: result });
  } catch (error) {
    const status = error.status === 400 ? 400 : error.status === 404 ? 404 : 500;
    res.status(status).json({ error: error.message || "Falha ao ativar meta." });
  }
});

router.post("/goals/:id/cancel", requireGoalsManage, async (req, res) => {
  try {
    const result = await cancelGoal(req.params.id, req.user || {}, req);
    res.json({ success: true, data: result });
  } catch (error) {
    const status = error.status === 400 ? 400 : error.status === 404 ? 404 : 500;
    res.status(status).json({ error: error.message || "Falha ao cancelar meta." });
  }
});

router.post("/goals/:id/close", requireGoalsManage, async (req, res) => {
  try {
    const result = await closeGoal(req.params.id, req.user || {}, req);
    res.json({ success: true, data: result });
  } catch (error) {
    const status = error.status === 400 ? 400 : error.status === 404 ? 404 : 500;
    res.status(status).json({ error: error.message || "Falha ao encerrar meta." });
  }
});

router.get("/goals/:id/progress", requireCommercialAccess, async (req, res) => {
  try {
    const result = await getGoalProgress(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    const status = error.status === 404 ? 404 : 500;
    res.status(status).json({ error: error.message || "Falha ao calcular progresso." });
  }
});

router.post("/goals/:id/snapshot", requireGoalsManage, async (req, res) => {
  try {
    const result = await snapshotGoalProgress(req.params.id);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    const status = error.status === 404 ? 404 : 500;
    res.status(status).json({ error: error.message || "Falha ao registrar snapshot." });
  }
});

router.delete("/goals/:id", requireGoalsManage, async (req, res) => {
  try {
    const result = await deleteGoal(req.params.id, req.user || {}, req);
    res.json({ success: true, data: result });
  } catch (error) {
    const status = error.status === 400 ? 400 : error.status === 404 ? 404 : 500;
    res.status(status).json({ error: error.message || "Falha ao excluir meta." });
  }
});

module.exports = { pdvCommercialRouter: router };