"use strict";

const express = require("express");
const { normalizeStoreKey } = require("../utils/pdvStoreUtils");
const {
  ensureInventoryDirs,
  ensureInventorySeeded,
  getInventorySummary,
  listInventoryProducts,
  getInventoryProduct,
  getInventoryMovements,
  getInventoryAlerts,
  createInventoryProduct,
  updateInventoryProduct,
  createManualAdjustment,
  createTransfer,
  releaseReservationById,
  convertReservationById
} = require("./pdvInventoryService");
const { projectInventoryPayloadPhotos } = require("./pdvInventoryPhotoProjectionService");

ensureInventoryDirs();
ensureInventorySeeded();

const router = express.Router();

function normalizeStoreScope(value = "") {
  return normalizeStoreKey(value || "");
}

function canViewAllStores(user = {}) {
  return Boolean(user?.permissions?.can_view_all_stores);
}

function getAllowedStores(user = {}) {
  return Array.isArray(user?.allowed_stores)
    ? user.allowed_stores.map((item) => normalizeStoreScope(item)).filter(Boolean)
    : [];
}

function getDefaultStoreScope(user = {}) {
  return normalizeStoreScope(user?.store_id || user?.storeId || user?.store || "") || getAllowedStores(user)[0] || "";
}

function ensureStoreAccess(req, res, storeValue = "") {
  const targetStore = normalizeStoreScope(storeValue);
  if (!targetStore || canViewAllStores(req.user || {})) {
    return true;
  }
  const allowedStores = getAllowedStores(req.user || {});
  if (!allowedStores.length || allowedStores.includes(targetStore)) {
    return true;
  }
  res.status(403).json({ error: "Acesso restrito à sua loja.", store_id: targetStore });
  return false;
}

function resolveInventoryStoreScope(req, res) {
  const requestedStore = req.query.store || req.query.storeId || "";
  if (requestedStore) {
    if (!ensureStoreAccess(req, res, requestedStore)) {
      return null;
    }
    return requestedStore;
  }
  if (canViewAllStores(req.user || {})) {
    return "";
  }
  return getDefaultStoreScope(req.user || {});
}

router.get("/summary", async (req, res) => {
  try {
    const storeScope = resolveInventoryStoreScope(req, res);
    if (storeScope === null) {
      return;
    }
    res.json(getInventorySummary({ storeId: storeScope }));
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao carregar o resumo do estoque operacional do PDV." });
  }
});

router.get("/products", async (req, res) => {
  try {
    const storeScope = resolveInventoryStoreScope(req, res);
    if (storeScope === null) {
      return;
    }
    const payload = listInventoryProducts({
      q: req.query.q || "",
      storeId: storeScope,
      status: req.query.status || "",
      alert: req.query.alert || ""
    });
    res.json(await projectInventoryPayloadPhotos(payload));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao listar os produtos do estoque operacional do PDV." });
  }
});

router.get("/product/:productId", async (req, res) => {
  try {
    const storeScope = resolveInventoryStoreScope(req, res);
    if (storeScope === null) {
      return;
    }
    const item = getInventoryProduct(req.params.productId, { storeId: storeScope });
    if (!item) {
      return res.status(404).json({ error: "Produto não encontrado no estoque operacional do PDV." });
    }
    return res.json(await projectInventoryPayloadPhotos(item));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Falha ao consultar o produto do estoque operacional do PDV." });
  }
});

router.post("/products", async (req, res) => {
  try {
    res.json(createInventoryProduct(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao cadastrar o produto operacional do PDV." });
  }
});

router.put("/products/:productId", async (req, res) => {
  try {
    res.json(updateInventoryProduct(req.params.productId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao atualizar o produto operacional do PDV." });
  }
});

router.post("/adjust", async (req, res) => {
  try {
    res.json(createManualAdjustment(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao ajustar o estoque operacional do PDV." });
  }
});

router.post("/transfer", async (req, res) => {
  try {
    res.json(createTransfer(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao transferir o estoque operacional entre lojas." });
  }
});

router.post("/reservations/:reservationId/release", async (req, res) => {
  try {
    res.json(releaseReservationById(req.params.reservationId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao liberar a reserva no estoque operacional do PDV." });
  }
});

router.post("/reservations/:reservationId/convert", async (req, res) => {
  try {
    res.json(convertReservationById(req.params.reservationId, req.body?.sale_id || req.body?.saleId || "", req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao converter a reserva no estoque operacional do PDV." });
  }
});

router.get("/movements", async (req, res) => {
  try {
    const storeScope = resolveInventoryStoreScope(req, res);
    if (storeScope === null) {
      return;
    }
    res.json(getInventoryMovements({
      storeId: storeScope,
      productId: req.query.productId || req.query.product_id || "",
      referenceId: req.query.referenceId || req.query.reference_id || "",
      limit: req.query.limit || 200
    }));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao carregar as movimentações do estoque operacional do PDV." });
  }
});

router.get("/alerts", async (req, res) => {
  try {
    const storeScope = resolveInventoryStoreScope(req, res);
    if (storeScope === null) {
      return;
    }
    res.json(getInventoryAlerts({
      storeId: storeScope,
      limit: req.query.limit || 200
    }));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao carregar os alertas do estoque operacional do PDV." });
  }
});

module.exports = {
  pdvInventoryRouter: router
};
