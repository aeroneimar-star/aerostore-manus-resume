"use strict";

const express = require("express");
const {
  ensurePdvConsolidationDirs,
  consolidatePdvData,
  getPdvConsolidationManifest,
  getPdvConsolidationSummary,
  listPdvConsolidatedCustomers,
  getPdvConsolidatedCustomer
} = require("../services/pdvConsolidationService");

ensurePdvConsolidationDirs();

const router = express.Router();

function ensureAdmin(req, res) {
  const role = String(req.user?.role || req.user?.legacyRole || "").trim().toLowerCase();
  if (role === "admin") {
    return true;
  }
  res.status(403).json({ error: "A consolidação estratégica do PDV está liberada apenas para administradores nesta fase." });
  return false;
}

router.get("/manifest", async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    res.json(getPdvConsolidationManifest());
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o manifesto da consolidação do PDV." });
  }
});

router.get("/summary", async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    res.json(getPdvConsolidationSummary());
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o resumo da consolidação do PDV." });
  }
});

router.post("/run", async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const result = consolidatePdvData(req.user || {});
    res.json(result);
  } catch (error) {
    console.error("[PDV CONSOLIDATION RUN]", error);
    res.status(400).json({ error: error.message || "Falha ao consolidar os dados estratégicos do PDV." });
  }
});

router.get("/customers", async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    res.json({
      customers: listPdvConsolidatedCustomers({
        search: req.query.search || "",
        score: req.query.score || "",
        abcClass: req.query.abcClass || ""
      })
    });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar os clientes consolidados do PDV." });
  }
});

router.get("/customer/:masterCustomerId", async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const customer = getPdvConsolidatedCustomer(req.params.masterCustomerId);
    if (!customer) {
      return res.status(404).json({ error: "Cliente consolidado do PDV não encontrado." });
    }
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o detalhe do cliente consolidado do PDV." });
  }
});

module.exports = {
  pdvConsolidationRouter: router
};
