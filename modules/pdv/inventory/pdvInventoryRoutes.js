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
  createInventoryProductFromLabel,
  updateInventoryProduct,
  createManualAdjustment,
  createStockCountAdjustment,
  createTransfer,
  releaseReservationById,
  convertReservationById
} = require("./pdvInventoryService");
const { projectInventoryPayloadPhotos } = require("./pdvInventoryPhotoProjectionService");
const { recordAuditEvent } = require("../../audit/auditService");

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

function hasPermission(user = {}, permission = "") {
  return Boolean(user?.permissions?.[permission]);
}

function hasAnyPermission(user = {}, permissions = []) {
  return permissions.some((permission) => hasPermission(user, permission));
}

function requireInventoryPermission(permissions = [], message = "Seu perfil nao pode executar esta acao de estoque.") {
  return (req, res, next) => {
    if (hasAnyPermission(req.user || {}, permissions)) {
      return next();
    }
    return res.status(403).json({ error: message, permissions });
  };
}

const canViewInventory = requireInventoryPermission(["can_view_stock", "can_view_products", "can_sell"], "Seu perfil nao pode consultar estoque.");
const canManageInventory = requireInventoryPermission(["can_manage_products", "can_move_stock"], "Seu perfil nao pode alterar estoque.");
const canMoveInventory = requireInventoryPermission(["can_move_stock"], "Seu perfil nao pode movimentar estoque.");

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

router.get("/summary", canViewInventory, async (req, res) => {
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

router.get("/products", canViewInventory, async (req, res) => {
  try {
    const storeScope = resolveInventoryStoreScope(req, res);
    if (storeScope === null) {
      return;
    }
    const payload = listInventoryProducts({
      q: req.query.q || "",
      storeId: storeScope,
      status: req.query.status || "",
      alert: req.query.alert || "",
      page: req.query.page || 1,
      limit: req.query.limit || req.query.pageSize || req.query.page_size || 100
    });
    res.json(await projectInventoryPayloadPhotos(payload));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao listar os produtos do estoque operacional do PDV." });
  }
});

router.get("/product/:productId", canViewInventory, async (req, res) => {
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

router.post("/products", canManageInventory, async (req, res) => {
  try {
    res.json(createInventoryProduct(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao cadastrar o produto operacional do PDV." });
  }
});

router.post("/products/from-label", canManageInventory, async (req, res) => {
  try {
    const targetStore = req.body?.store_id || req.body?.storeId || getDefaultStoreScope(req.user || {});
    if (!ensureStoreAccess(req, res, targetStore)) {
      return;
    }
    const result = createInventoryProductFromLabel({
      ...(req.body || {}),
      store_id: targetStore
    }, req.user || {});
    recordAuditEvent({
      req,
      module: "inventory",
      action: result.created ? "product_created_from_label" : "product_label_duplicate_found",
      store_id: normalizeStoreScope(targetStore),
      store_name: targetStore,
      entityType: "product",
      entityId: result.product?.product_id || "",
      entityLabel: result.product?.nome || req.body?.nome || req.body?.name || "",
      productId: result.product?.product_id || "",
      productName: result.product?.nome || req.body?.nome || req.body?.name || "",
      result: result.created ? "success" : "blocked",
      includeBody: false,
      metadata: {
        internal_code: req.body?.label_code || req.body?.codigo || req.body?.codigo_interno || "",
        barcode: req.body?.barcode || req.body?.ean || req.body?.gtin || "",
        store_id: normalizeStoreScope(targetStore),
        quantity: req.body?.estoque || req.body?.estoque_inicial || req.body?.available_qty || 0,
        origem: "etiqueta_aerostore",
        duplicate: result.duplicate || null
      }
    }).catch((error) => console.warn("[AUDIT] product label audit failed", error.message || String(error)));
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    recordAuditEvent({
      req,
      module: "inventory",
      action: "product_created_from_label",
      store_id: req.body?.store_id || req.body?.storeId || "",
      entityType: "product",
      result: "failed",
      message: error.message || "Falha ao cadastrar produto por etiqueta.",
      includeBody: false,
      metadata: {
        internal_code: req.body?.label_code || req.body?.codigo || req.body?.codigo_interno || "",
        store_id: req.body?.store_id || req.body?.storeId || ""
      }
    }).catch(() => {});
    res.status(400).json({ error: error.message || "Falha ao cadastrar o produto pela etiqueta." });
  }
});

router.put("/products/:productId", canManageInventory, async (req, res) => {
  try {
    res.json(updateInventoryProduct(req.params.productId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao atualizar o produto operacional do PDV." });
  }
});

router.post("/adjust", canMoveInventory, async (req, res) => {
  try {
    const payload = req.body || {};
    const adjustmentMode = String(payload.mode || payload.adjustment_mode || "").trim().toLowerCase();
    const isStockCount = adjustmentMode === "stock_count"
      || adjustmentMode === "contagem"
      || payload.target_quantity !== undefined
      || payload.targetQuantity !== undefined
      || payload.counted_quantity !== undefined
      || payload.countedQuantity !== undefined
      || payload.quantity_counted !== undefined;
    res.json(isStockCount
      ? createStockCountAdjustment(payload, req.user || {})
      : createManualAdjustment(payload, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao ajustar o estoque operacional do PDV." });
  }
});

router.post("/transfer", canMoveInventory, async (req, res) => {
  try {
    res.json(createTransfer(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao transferir o estoque operacional entre lojas." });
  }
});

router.post("/reservations/:reservationId/release", canMoveInventory, async (req, res) => {
  try {
    res.json(releaseReservationById(req.params.reservationId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao liberar a reserva no estoque operacional do PDV." });
  }
});

router.post("/reservations/:reservationId/convert", canMoveInventory, async (req, res) => {
  try {
    res.json(convertReservationById(req.params.reservationId, req.body?.sale_id || req.body?.saleId || "", req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao converter a reserva no estoque operacional do PDV." });
  }
});

router.get("/movements", canViewInventory, async (req, res) => {
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

router.get("/alerts", canViewInventory, async (req, res) => {
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
