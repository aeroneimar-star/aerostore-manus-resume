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

const router = express.Router();

function hasPermission(user = {}, permission = "") {
  return Boolean(user?.permissions?.[permission]);
}

function isAdminOrManager(user = {}) {
  const role = String(user?.role_key || user?.role || "").toLowerCase();
  return ["admin", "manager"].includes(role);
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
    res.status(400).json({ error: error.message || "Falha ao criar campanha." });
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

module.exports = { pdvCommercialRouter: router };