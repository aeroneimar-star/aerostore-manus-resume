"use strict";

const express = require("express");
const {
  ensureOperationalDirs,
  getPdvOperationalManifest,
  searchProducts,
  searchProductsDetailed,
  searchCustomers,
  createQuickCustomer,
  openCustomerSession,
  getSessionById,
  addProductToCart,
  updateCartItem,
  updateCartItemDiscount,
  removeCartItem,
  attachCustomerToSession,
  detachCustomerFromSession,
  saveCartDraft,
  listCartDrafts,
  deleteCartDraft,
  restoreCartDraft,
  updatePaymentPlan,
  updateSessionDiscount,
  createQuoteFromSession,
  createReservationFromSession,
  createInternalConsumption,
  prepareCoupon,
  getOperationalDashboard,
  loadQuotes,
  loadReservations,
  loadInternalConsumption,
  loadEvents,
  listProductsCatalog,
  listCustomersCatalog,
  debugUnifiedSearch
} = require("../services/pdvOperationalService");
const { ensureOpenCashRegisterForStore } = require("../utils/pdvCashRegisterGuard");

ensureOperationalDirs();

const router = express.Router();

function normalizeStoreScope(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function getAllowedStores(user = {}) {
  return Array.isArray(user.allowed_stores)
    ? user.allowed_stores.map((item) => normalizeStoreScope(item)).filter(Boolean)
    : [];
}

function hasPermission(user = {}, permission = "") {
  return Boolean(user?.permissions?.[permission]);
}

function hasAnyPermission(user = {}, permissions = []) {
  return permissions.some((permission) => hasPermission(user, permission));
}

function requireOperationalPermission(permissions = [], message = "Seu perfil nao pode executar esta acao do PDV.") {
  return (req, res, next) => {
    if (hasAnyPermission(req.user || {}, permissions)) {
      return next();
    }
    return res.status(403).json({ error: message, permissions });
  };
}

const canCreateCustomer = requireOperationalPermission(["can_create_customers", "can_sell"], "Seu perfil nao pode cadastrar clientes.");
const canApplyDiscount = requireOperationalPermission(["can_apply_discount", "can_sell"], "Seu perfil nao pode aplicar desconto.");
const canOperatePaymentPlan = requireOperationalPermission(["can_finalize_sale", "can_sell", "can_view_cash_register"], "Seu perfil nao pode alterar pagamentos da venda.");
const canRegisterInternalConsumption = requireOperationalPermission(["can_move_stock", "can_manage_products"], "Seu perfil nao pode registrar uso e consumo.");

function ensureStoreAccess(req, res, storeValue = "") {
  const user = req.user || {};
  const targetStore = normalizeStoreScope(storeValue);
  if (!targetStore || user?.permissions?.can_view_all_stores) {
    return true;
  }
  const allowedStores = getAllowedStores(user);
  if (!allowedStores.length || allowedStores.includes(targetStore)) {
    return true;
  }
  res.status(403).json({ error: "Acesso restrito à sua loja.", store_id: targetStore });
  return false;
}

function filterStoreItems(req, items = []) {
  const user = req.user || {};
  if (user?.permissions?.can_view_all_stores) {
    return Array.isArray(items) ? items : [];
  }
  const allowedStores = getAllowedStores(user);
  if (!allowedStores.length) {
    return Array.isArray(items) ? items : [];
  }
  return (Array.isArray(items) ? items : []).filter((item) => {
    const itemStore = normalizeStoreScope(
      item?.store_id
      || item?.loja
      || item?.store
      || item?.customer?.store_id
      || item?.payload?.store_id
      || ""
    );
    return !itemStore || allowedStores.includes(itemStore);
  });
}

router.get("/manifest", async (req, res) => {
  try {
    res.json(getPdvOperationalManifest());
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o manifesto operacional do PDV." });
  }
});

router.get("/dashboard", async (req, res) => {
  try {
    res.json(getOperationalDashboard());
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o dashboard operacional do PDV." });
  }
});

router.get("/search/products", async (req, res) => {
  try {
    if (!ensureStoreAccess(req, res, req.query.store || req.query.storeId || "")) {
      return;
    }
    const detailed = await searchProductsDetailed(req.query.q || "", {
      storeId: req.query.store || req.query.storeId || "",
      page: req.query.page || 1,
      limit: req.query.limit || 24
    });
    res.json({
      items: detailed.unified || [],
      pagination: detailed.pagination || {
        page: Math.max(1, Number(req.query.page || 1)),
        limit: Math.max(1, Math.min(100, Number(req.query.limit || 24))),
        total: (detailed.unified || []).length,
        totalPages: 1,
        total_pages: 1,
        has_more: false
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao buscar produtos operacionais do PDV." });
  }
});

router.get("/products", async (req, res) => {
  try {
    const requestedStore = req.query.store || req.query.storeId || (req.user?.permissions?.can_view_all_stores ? "" : req.user?.store_id || getAllowedStores(req.user || {})[0] || "");
    if (!ensureStoreAccess(req, res, requestedStore)) {
      return;
    }
    res.json(await listProductsCatalog({
      query: req.query.q || "",
      storeId: requestedStore,
      limit: req.query.limit || 60,
      status: req.query.status || "",
      pendingOnly: req.query.pending === "1" || req.query.pending === "true"
    }));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao carregar a base operacional de produtos do PDV." });
  }
});

router.get("/search/customers", async (req, res) => {
  try {
    res.json({
      items: await searchCustomers(req.query.q || "", {
        limit: req.query.limit || 15
      })
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao buscar clientes operacionais do PDV." });
  }
});

router.get("/customers", async (req, res) => {
  try {
    const requestedStore = req.query.store || req.query.storeId || (req.user?.permissions?.can_view_all_stores ? "" : req.user?.store_id || getAllowedStores(req.user || {})[0] || "");
    if (!ensureStoreAccess(req, res, requestedStore)) {
      return;
    }
    res.json(await listCustomersCatalog({
      query: req.query.q || "",
      phoneQuery: req.query.phone || "",
      storeId: requestedStore,
      limit: req.query.limit || 60,
      origin: req.query.origin || ""
    }));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao carregar a base operacional de clientes do PDV." });
  }
});

router.get("/debug-search", async (req, res) => {
  try {
    if (!hasPermission(req.user || {}, "can_view_store_reports")) {
      return res.status(403).json({ error: "Apenas gestores autorizados podem usar o diagnóstico de busca unificada do PDV." });
    }
    if (!ensureStoreAccess(req, res, req.query.store || req.query.storeId || "")) {
      return;
    }
    res.json(await debugUnifiedSearch(req.query.q || "", req.query.type || "all", {
      storeId: req.query.store || req.query.storeId || ""
    }));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao diagnosticar a busca unificada do PDV." });
  }
});

router.post("/customers/quick-register", canCreateCustomer, async (req, res) => {
  try {
    res.json(createQuickCustomer(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao criar cadastro rápido do PDV." });
  }
});

router.post("/session/open", async (req, res) => {
  try {
    if (!ensureStoreAccess(req, res, req.body?.store_id || req.body?.selected_loja || req.body?.loja || "")) {
      return;
    }
    res.json(openCustomerSession(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao abrir a sessão operacional do PDV." });
  }
});

router.get("/session/:sessionId", async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sessão operacional do PDV não encontrada." });
    }
    if (!ensureStoreAccess(req, res, session.store_id || session.loja || "")) {
      return;
    }
    res.json(session);
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao carregar a sessão operacional do PDV." });
  }
});

router.post("/session/:sessionId/customer", async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sessão operacional do PDV não encontrada." });
    }
    if (!ensureStoreAccess(req, res, session.store_id || session.loja || "")) {
      return;
    }
    res.json(await attachCustomerToSession(req.params.sessionId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao vincular o cliente na sessão do PDV." });
  }
});

router.delete("/session/:sessionId/customer", async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "SessÃ£o operacional do PDV nÃ£o encontrada." });
    }
    if (!ensureStoreAccess(req, res, session.store_id || session.loja || "")) {
      return;
    }
    res.json(detachCustomerFromSession(req.params.sessionId, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao remover o cliente da sessÃ£o do PDV." });
  }
});

router.post("/cart/:sessionId/items", async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sessão operacional do PDV não encontrada." });
    }
    if (!ensureStoreAccess(req, res, session.store_id || session.loja || "")) {
      return;
    }
    res.json(addProductToCart(req.params.sessionId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao adicionar o item ao carrinho do PDV." });
  }
});

router.patch("/cart/:sessionId/items/:itemId", async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sessão operacional do PDV não encontrada." });
    }
    if (!ensureStoreAccess(req, res, session.store_id || session.loja || "")) {
      return;
    }
    res.json(updateCartItem(req.params.sessionId, req.params.itemId, req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao atualizar o item do carrinho do PDV." });
  }
});

router.patch("/cart/:sessionId/items/:itemId/discount", canApplyDiscount, async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "SessÃ£o operacional do PDV nÃ£o encontrada." });
    }
    if (!ensureStoreAccess(req, res, session.store_id || session.loja || "")) {
      return;
    }
    res.json(updateCartItemDiscount(req.params.sessionId, req.params.itemId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao atualizar o desconto do item do carrinho." });
  }
});

router.delete("/cart/:sessionId/items/:itemId", async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sessão operacional do PDV não encontrada." });
    }
    if (!ensureStoreAccess(req, res, session.store_id || session.loja || "")) {
      return;
    }
    res.json(removeCartItem(req.params.sessionId, req.params.itemId));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao remover o item do carrinho do PDV." });
  }
});

router.post("/cart/:sessionId/draft", async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sessão operacional do PDV não encontrada." });
    }
    if (!ensureStoreAccess(req, res, session.store_id || session.loja || "")) {
      return;
    }
    res.json(saveCartDraft(req.params.sessionId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao salvar o rascunho do carrinho do PDV." });
  }
});

router.get("/drafts", async (req, res) => {
  try {
    const storeId = normalizeStoreScope(req.query.store || req.user?.store_id || req.user?.store || "");
    res.json({ items: listCartDrafts({ loja: storeId }) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao carregar os rascunhos do PDV." });
  }
});

router.post("/drafts/:draftId/restore", async (req, res) => {
  try {
    const restored = restoreCartDraft(req.params.draftId, req.user || {});
    if (!ensureStoreAccess(req, res, restored.session?.store_id || restored.session?.loja || restored.draft?.loja || "")) {
      return;
    }
    res.json(restored);
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao restaurar o rascunho do PDV." });
  }
});

router.delete("/drafts/:draftId", async (req, res) => {
  try {
    const draft = deleteCartDraft(req.params.draftId);
    if (!ensureStoreAccess(req, res, draft?.loja || "")) {
      return;
    }
    res.json({ success: true, draft });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao excluir o rascunho do PDV." });
  }
});

router.post("/cart/:sessionId/payment-plan", canOperatePaymentPlan, async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sessão operacional do PDV não encontrada." });
    }
    if (!ensureStoreAccess(req, res, session.store_id || session.loja || "")) {
      return;
    }
    await ensureOpenCashRegisterForStore(req, session.store_id || session.loja || "", {
      module: "pdv_sales",
      action: "payment_blocked_without_open_cash",
      entityType: "sale_session",
      entityId: req.params.sessionId,
      message: "Caixa fechado. Abra o caixa antes de lançar pagamento."
    });
    res.json(updatePaymentPlan(req.params.sessionId, req.body?.methods || []));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Falha ao preparar os meios de pagamento do PDV." });
  }
});

router.patch("/cart/:sessionId/discount", canApplyDiscount, async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sessao operacional do PDV nao encontrada." });
    }
    if (!ensureStoreAccess(req, res, session.store_id || session.loja || "")) {
      return;
    }
    res.json(updateSessionDiscount(req.params.sessionId, req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao atualizar o desconto da venda no PDV." });
  }
});

router.post("/cart/:sessionId/coupon", async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sessão operacional do PDV não encontrada." });
    }
    if (!ensureStoreAccess(req, res, session.store_id || session.loja || "")) {
      return;
    }
    res.json(prepareCoupon(req.params.sessionId, req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao preparar o cupom não fiscal do PDV." });
  }
});

router.post("/quotes/from-session/:sessionId", async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sessão operacional do PDV não encontrada." });
    }
    if (!ensureStoreAccess(req, res, session.store_id || session.loja || "")) {
      return;
    }
    res.json(createQuoteFromSession(req.params.sessionId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao criar o orçamento do PDV." });
  }
});

router.get("/quotes", async (req, res) => {
  try {
    res.json({ items: filterStoreItems(req, loadQuotes()).slice(0, 120) });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar os orçamentos do PDV." });
  }
});

router.post("/reservations/from-session/:sessionId", async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sessão operacional do PDV não encontrada." });
    }
    if (!ensureStoreAccess(req, res, session.store_id || session.loja || "")) {
      return;
    }
    res.json(createReservationFromSession(req.params.sessionId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao criar a reserva do PDV." });
  }
});

router.get("/reservations", async (req, res) => {
  try {
    res.json({ items: filterStoreItems(req, loadReservations()).slice(0, 120) });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar as reservas do PDV." });
  }
});

router.post("/internal-consumption", canRegisterInternalConsumption, async (req, res) => {
  try {
    if (!ensureStoreAccess(req, res, req.body?.store_id || req.body?.loja || "")) {
      return;
    }
    res.json(createInternalConsumption(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao registrar o uso e consumo do PDV." });
  }
});

router.get("/internal-consumption", async (req, res) => {
  try {
    res.json({ items: filterStoreItems(req, loadInternalConsumption()).slice(0, 120) });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o uso e consumo do PDV." });
  }
});

router.get("/events", async (req, res) => {
  try {
    res.json({ items: filterStoreItems(req, loadEvents()).slice(0, 200) });
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar os eventos do PDV." });
  }
});

module.exports = {
  pdvOperationalRouter: router
};
