"use strict";

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { PDV_IMPORT_TYPES, getPdvImportTypeConfig } = require("../utils/pdvImportConfig");
const {
  ensurePdvImportDirs,
  createPdvImportPreview,
  commitPdvImportPreview,
  listPdvImportHistory,
  getPdvImportSummary,
  getPdvImportDatasetsOverview,
  rollbackPdvImportBatch
} = require("../importers/pdvImportService");

ensurePdvImportDirs();

const router = express.Router();

const pdvImportIncomingDir = path.join(process.cwd(), "data", "imports", "pdv", "incoming");
const pdvImportStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, pdvImportIncomingDir),
  filename: (req, file, cb) => {
    const extension = path.extname(String(file.originalname || "")).toLowerCase() || ".xlsx";
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`);
  }
});

const pdvImportUpload = multer({
  storage: pdvImportStorage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

router.get("/manifest", async (req, res) => {
  try {
    res.json({
      importTypes: PDV_IMPORT_TYPES,
      summary: getPdvImportSummary(),
      datasets: getPdvImportDatasetsOverview()
    });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o manifesto das importações do PDV." });
  }
});

router.get("/history", async (req, res) => {
  try {
    const type = String(req.query.type || "").trim();
    res.json({
      history: listPdvImportHistory(type).slice(0, 80),
      summary: getPdvImportSummary(type),
      datasets: getPdvImportDatasetsOverview()
    });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o histórico de importações do PDV." });
  }
});

router.post("/:type/preview", pdvImportUpload.single("file"), async (req, res) => {
  try {
    const type = String(req.params.type || "").trim();
    const typeConfig = getPdvImportTypeConfig(type);
    if (!typeConfig) {
      return res.status(404).json({ error: "Tipo de importação do PDV não encontrado." });
    }
    if (!req.file?.path) {
      return res.status(400).json({ error: "Envie um arquivo .xlsx, .xls ou .csv para validar a importação." });
    }
    const payload = await createPdvImportPreview(type, req.file, req.user || {});
    res.json(payload);
  } catch (error) {
    console.error("[PDV IMPORT PREVIEW]", error);
    res.status(400).json({ error: error.message || "Falha ao gerar a prévia da importação do PDV." });
  }
});

router.post("/:type/commit", async (req, res) => {
  try {
    const type = String(req.params.type || "").trim();
    const typeConfig = getPdvImportTypeConfig(type);
    if (!typeConfig) {
      return res.status(404).json({ error: "Tipo de importação do PDV não encontrado." });
    }
    const previewId = String(req.body?.previewId || "").trim();
    if (!previewId) {
      return res.status(400).json({ error: "Informe o previewId validado antes de confirmar a importação." });
    }
    const result = await commitPdvImportPreview(type, previewId, req.user || {});
    res.json(result);
  } catch (error) {
    console.error("[PDV IMPORT COMMIT]", error);
    res.status(400).json({ error: error.message || "Falha ao confirmar a importação do PDV." });
  }
});

router.post("/rollback/:batchId", async (req, res) => {
  try {
    const result = rollbackPdvImportBatch(String(req.params.batchId || "").trim(), req.user || {});
    res.json(result);
  } catch (error) {
    console.error("[PDV IMPORT ROLLBACK]", error);
    res.status(400).json({ error: error.message || "Falha ao executar rollback do lote do PDV." });
  }
});

module.exports = {
  pdvImportRouter: router
};
