"use strict";

const express = require("express");
const {
  getSeedStatus,
  getSeedPreview,
  generateSeedData,
  clearSeedData
} = require("./pdvSeedService");

const router = express.Router();

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
