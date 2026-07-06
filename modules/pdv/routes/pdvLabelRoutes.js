"use strict";

const express = require("express");
const {
  getArgoxLabelConfig,
  getLabelTemplates,
  buildLabelPreview,
  printLabel,
  resolveLabelPrintPlan,
  enrichLabelPrintPayloadStore,
  buildTestPrint,
  getPrnFile
} = require("../services/pdvLabelPrintService");

const router = express.Router();

function normalizeRole(user = {}) {
  return String(user?.role || "").trim().toLowerCase();
}

function canUseLabelPrinter(user = {}) {
  const role = normalizeRole(user);
  return role === "admin"
    || role === "manager"
    || role === "gerente"
    || Boolean(user?.permissions?.can_view_products)
    || Boolean(user?.permissions?.can_manage_products);
}

function ensureLabelAccess(req, res) {
  if (canUseLabelPrinter(req.user || {})) {
    return true;
  }
  res.status(403).json({ error: "Seu perfil nao pode imprimir etiquetas de produtos." });
  return false;
}

router.get("/config", (req, res) => {
  if (!ensureLabelAccess(req, res)) return;
  res.json(getArgoxLabelConfig());
});

router.get("/templates", (req, res) => {
  if (!ensureLabelAccess(req, res)) return;
  res.json({ items: getLabelTemplates() });
});

router.post("/resolve-plan", async (req, res) => {
  try {
    if (!ensureLabelAccess(req, res)) return;
    const enrichedPayload = await enrichLabelPrintPayloadStore(req.body || {}, req.user || {});
    res.json({
      success: true,
      print_plan: await resolveLabelPrintPlan(enrichedPayload, req.user || {})
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Falha ao resolver plano de impressao." });
  }
});

router.post("/preview", async (req, res) => {
  try {
    if (!ensureLabelAccess(req, res)) return;
    res.json(await buildLabelPreview(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Falha ao gerar preview da etiqueta." });
  }
});

router.post("/print", async (req, res) => {
  try {
    if (!ensureLabelAccess(req, res)) return;
    res.json(await printLabel(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Falha ao preparar impressao da etiqueta." });
  }
});

router.post("/test-print", async (req, res) => {
  try {
    if (!ensureLabelAccess(req, res)) return;
    res.json(await buildTestPrint(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Falha ao preparar etiqueta teste Argox." });
  }
});

router.get("/files/:filename", (req, res) => {
  try {
    if (!ensureLabelAccess(req, res)) return;
    const file = getPrnFile(req.params.filename || "");
    if (!file) {
      return res.status(404).json({ error: "Arquivo PRN nao encontrado." });
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.content);
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao baixar arquivo PRN." });
  }
});

module.exports = {
  pdvLabelRouter: router
};
