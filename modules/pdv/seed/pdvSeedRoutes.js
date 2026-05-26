"use strict";

const express = require("express");
const {
  getSeedStatus,
  getSeedPreview,
  generateSeedData,
  clearSeedData
} = require("./pdvSeedService");

const router = express.Router();

function hasPermission(user = {}, permission = "") {
  return Boolean(user?.permissions?.[permission]);
}

function requireSeedPermission(req, res, next) {
  if (hasPermission(req.user || {}, "can_manage_global_settings") || hasPermission(req.user || {}, "can_view_audit")) {
    return next();
  }
  return res.status(403).json({ error: "Seu perfil nao pode operar a massa de teste do PDV." });
}

router.use(requireSeedPermission);

router.get("/status", async (req, res) => {
  try {
    res.json(getSeedStatus());
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao carregar o status da massa de teste do PDV." });
  }
});

router.get("/preview", async (req, res) => {
  try {
    res.json(getSeedPreview());
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao carregar a previa da massa de teste do PDV." });
  }
});

router.post("/generate", async (req, res) => {
  try {
    res.json(generateSeedData());
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao gerar a massa de teste do PDV." });
  }
});

router.post("/clear", async (req, res) => {
  try {
    res.json(clearSeedData());
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao limpar a massa de teste do PDV." });
  }
});

module.exports = {
  pdvSeedRouter: router
};
