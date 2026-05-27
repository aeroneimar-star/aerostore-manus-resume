"use strict";

const express = require("express");
const {
  finalizeSaleFromSession,
  cancelSale,
  issueGiftCard,
  createExchange,
  getSalesSummary,
  listPendingPaymentLinkSales,
  listPdvSalesOrders,
  getPdvSalesOrderDetail,
  bulkRefreshPdvSalesOrdersPaymentLinks,
  getSaleById,
  canAccessSale,
  buildSalePaymentLinkPayload,
  generateSalePaymentLink,
  refreshSalePaymentLinkStatus,
  getGiftCardByCode,
  getCustomerCashbackBalance,
  getCustomerCashbackSnapshot,
  applyCashbackToSession,
  removeCashbackFromSession,
  getCustomerExchangeCreditSnapshot,
  applyExchangeCreditToSession,
  removeExchangeCreditFromSession
} = require("../sales/pdvSalesService");
const { validateAuthorizationPin, getPdvUserRole } = require("../services/pdvControlService");
const { getSessionById } = require("../services/pdvOperationalService");
const { normalizeStoreKey } = require("../utils/pdvStoreUtils");
const { ensureOpenCashRegisterForStore } = require("../utils/pdvCashRegisterGuard");

const router = express.Router();

function hasPermission(user = {}, permission = "") {
  return Boolean(user?.permissions?.[permission]);
}

function hasAnyPermission(user = {}, permissions = []) {
  return permissions.some((permission) => hasPermission(user, permission));
}

function requireAnyPermission(permissions = [], message = "Voce nao tem permissao para executar esta acao.") {
  return (req, res, next) => {
    if (hasAnyPermission(req.user || {}, permissions)) {
      return next();
    }
    return res.status(403).json({ error: message, permissions });
  };
}

const canViewOrders = requireAnyPermission(["can_view_orders", "can_sell", "can_view_cash_register"], "Seu perfil nao pode acessar pedidos de venda.");
const canFinalizeSale = requireAnyPermission(["can_finalize_sale", "can_sell", "can_view_cash_register"], "Seu perfil nao pode finalizar venda.");
const canCancelSale = requireAnyPermission(["can_cancel_sale"], "Seu perfil nao pode cancelar venda.");
const canUseSaleBenefits = requireAnyPermission(["can_sell", "can_view_cashback", "can_view_exchanges"], "Seu perfil nao pode aplicar beneficios nesta venda.");
const canManagePaymentLinks = requireAnyPermission(["can_release_orders", "can_sell"], "Seu perfil nao pode gerar ou atualizar link de pagamento.");
const canIssueGiftCard = requireAnyPermission(["can_manage_cashback", "can_generate_exchange_credit"], "Seu perfil nao pode emitir vale presente.");
const canCreateExchange = requireAnyPermission(["can_view_exchanges", "can_generate_exchange_credit", "can_sell"], "Seu perfil nao pode registrar trocas.");

function ensureSaleAccess(req, res, sale = null) {
  if (sale && canAccessSale(sale, req.user || {})) {
    return true;
  }
  res.status(403).json({ error: "Voce nao tem permissao para acessar esta venda." });
  return false;
}

function getSaleStoreId(sale = {}) {
  return normalizeStoreKey(sale.loja || sale.loja_venda || sale.store_id || sale.store_context?.store_id || "");
}

async function ensureSaleCashRegister(req, sale = {}, options = {}) {
  return ensureOpenCashRegisterForStore(req, getSaleStoreId(sale), {
    module: options.module || "pdv_sales",
    action: options.action || "cash_register_required",
    entityType: options.entityType || "sale",
    entityId: options.entityId || sale.sale_id || sale.id || "",
    saleId: options.saleId || sale.sale_id || sale.id || "",
    message: options.message
  });
}

router.get("/summary", canViewOrders, async (req, res) => {
  try {
    res.json(getSalesSummary());
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o resumo de vendas do PDV." });
  }
});

router.get("/payment-links/pending", canViewOrders, async (req, res) => {
  try {
    res.json(listPendingPaymentLinkSales(req.user || {}));
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao carregar as vendas aguardando pagamento." });
  }
});

router.get("/orders", canViewOrders, async (req, res) => {
  try {
    res.json(listPdvSalesOrders(req.query || {}, req.user || {}));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message || "Falha ao carregar os pedidos de venda do PDV." });
  }
});

router.post("/orders/bulk/payment-link-refresh", canManagePaymentLinks, async (req, res) => {
  try {
    const saleIds = req.body?.sale_ids || req.body?.saleIds || [];
    for (const saleId of Array.isArray(saleIds) ? saleIds : []) {
      const sale = getSaleById(saleId);
      if (sale) {
        await ensureSaleCashRegister(req, sale, {
          action: "payment_link_blocked_without_open_cash",
          entityId: saleId,
          saleId,
          message: "Caixa fechado. Abra o caixa da loja antes de atualizar link de pagamento."
        });
      }
    }
    res.json(await bulkRefreshPdvSalesOrdersPaymentLinks(saleIds, req.user || {}));
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({ error: error.message || "Falha ao atualizar links PagBank em lote." });
  }
});

router.get("/orders/:saleId", canViewOrders, async (req, res) => {
  try {
    const detail = getPdvSalesOrderDetail(req.params.saleId, req.user || {});
    if (!detail) {
      return res.status(404).json({ error: "Venda do PDV nao encontrada." });
    }
    res.json(detail);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message || "Falha ao carregar o detalhe do pedido de venda." });
  }
});

router.post("/finalize/:sessionId", canFinalizeSale, async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (session) {
      await ensureOpenCashRegisterForStore(req, req.body?.loja || session.loja || session.store_id || "", {
        module: "pdv_sales",
        action: "sale_blocked_without_open_cash",
        entityType: "sale_session",
        entityId: req.params.sessionId,
        message: "Caixa fechado. Abra o caixa da loja antes de finalizar vendas."
      });
    }
    res.json(await finalizeSaleFromSession(req.params.sessionId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Falha ao finalizar a venda operacional do PDV." });
  }
});

router.post("/cancel/:saleId", canCancelSale, async (req, res) => {
  try {
    const sale = getSaleById(req.params.saleId);
    if (!sale) {
      return res.status(404).json({ error: "Venda do PDV nao encontrada." });
    }
    if (!ensureSaleAccess(req, res, sale)) {
      return;
    }

    await ensureSaleCashRegister(req, sale, {
      action: "sale_cancel_blocked_without_open_cash",
      message: "Caixa fechado. Abra o caixa da loja antes de cancelar vendas."
    });

    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      throw new Error("Cancelamento exige motivo obrigatorio.");
    }

    const role = getPdvUserRole(req.user || {});
    let authorization = null;

    if (role !== "GERENTE" && role !== "ADMIN") {
      if (!req.body?.pin) {
        throw new Error("Cancelamento por vendedor exige PIN temporario valido.");
      }
      authorization = validateAuthorizationPin({
        code: req.body.pin,
        type: "SALE_CANCELLATION",
        loja: req.body.loja || sale.loja || sale.loja_venda || "",
        context: {
          sale_id: req.params.saleId,
          action: "SALE_CANCELLATION",
          reason
        }
      }, req.user || {});
    } else if (req.body?.pin) {
      authorization = validateAuthorizationPin({
        code: req.body.pin,
        type: "SALE_CANCELLATION",
        loja: req.body.loja || sale.loja || sale.loja_venda || "",
        context: {
          sale_id: req.params.saleId,
          action: "SALE_CANCELLATION",
          reason
        }
      }, req.user || {});
    }

    res.json(cancelSale(req.params.saleId, req.user || {}, { reason, authorization }));
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({ error: error.message || "Falha ao cancelar a venda do PDV." });
  }
});

router.get("/sale/:saleId", canViewOrders, async (req, res) => {
  try {
    const sale = getSaleById(req.params.saleId);
    if (!sale) {
      return res.status(404).json({ error: "Venda do PDV nao encontrada." });
    }
    if (!ensureSaleAccess(req, res, sale)) {
      return;
    }
    res.json(sale);
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar a venda do PDV." });
  }
});

router.get("/sale/:saleId/payment-link", canViewOrders, async (req, res) => {
  try {
    const sale = getSaleById(req.params.saleId);
    if (!sale) {
      return res.status(404).json({ error: "Venda do PDV nao encontrada." });
    }
    if (!ensureSaleAccess(req, res, sale)) {
      return;
    }
    res.json({
      sale,
      payment_link: buildSalePaymentLinkPayload(sale)
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message || "Falha ao carregar o link de pagamento da venda." });
  }
});

router.post("/sale/:saleId/payment-link/generate", canManagePaymentLinks, async (req, res) => {
  try {
    const currentSale = getSaleById(req.params.saleId);
    if (!currentSale) {
      return res.status(404).json({ error: "Venda do PDV nao encontrada." });
    }
    if (!ensureSaleAccess(req, res, currentSale)) {
      return;
    }
    await ensureSaleCashRegister(req, currentSale, {
      action: "payment_link_blocked_without_open_cash",
      message: "Caixa fechado. Abra o caixa da loja antes de gerar link de pagamento."
    });
    const sale = await generateSalePaymentLink(req.params.saleId, req.user || {}, {
      forceGenerate: Boolean(req.body?.forceGenerate || req.body?.force_generate)
    });
    res.json({
      sale,
      payment_link: buildSalePaymentLinkPayload(sale)
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({ error: error.message || "Falha ao gerar o link de pagamento da venda." });
  }
});

router.post("/sale/:saleId/payment-link/refresh", canManagePaymentLinks, async (req, res) => {
  try {
    const currentSale = getSaleById(req.params.saleId);
    if (!currentSale) {
      return res.status(404).json({ error: "Venda do PDV nao encontrada." });
    }
    if (!ensureSaleAccess(req, res, currentSale)) {
      return;
    }
    await ensureSaleCashRegister(req, currentSale, {
      action: "payment_link_blocked_without_open_cash",
      message: "Caixa fechado. Abra o caixa da loja antes de atualizar link de pagamento."
    });
    const sale = await refreshSalePaymentLinkStatus(req.params.saleId, req.user || {});
    res.json({
      sale,
      payment_link: buildSalePaymentLinkPayload(sale)
    });
  } catch (error) {
    const statusCode = error.statusCode || 400;
    res.status(statusCode).json({ error: error.message || "Falha ao atualizar o status do link de pagamento." });
  }
});

router.get("/cashback/balance", canUseSaleBenefits, async (req, res) => {
  try {
    res.json({ balance: getCustomerCashbackBalance(req.query.phone || "") });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao consultar o saldo de cashback do PDV." });
  }
});

router.get("/customer/:customerId/cashback", canUseSaleBenefits, async (req, res) => {
  try {
    res.json(getCustomerCashbackSnapshot(req.query.phone || ""));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao consultar o cashback do cliente no PDV." });
  }
});

router.get("/customer/:customerId/exchange-credits", canUseSaleBenefits, async (req, res) => {
  try {
    res.json(getCustomerExchangeCreditSnapshot({
      customer_id: req.params.customerId,
      phone: req.query.phone || "",
      name: req.query.name || ""
    }));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao consultar Credito de Troca do cliente no PDV." });
  }
});

router.post("/session/:sessionId/apply-cashback", canUseSaleBenefits, async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (session) {
      await ensureOpenCashRegisterForStore(req, session.store_id || session.loja || "", {
        module: "cashback",
        action: "cashback_blocked_without_open_cash",
        entityType: "sale_session",
        entityId: req.params.sessionId,
        message: "Caixa fechado. Abra o caixa antes de aplicar cashback."
      });
    }
    res.json(applyCashbackToSession(req.params.sessionId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Falha ao aplicar cashback na venda do PDV." });
  }
});

router.post("/session/:sessionId/remove-cashback", canUseSaleBenefits, async (req, res) => {
  try {
    res.json(removeCashbackFromSession(req.params.sessionId, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao remover cashback da venda do PDV." });
  }
});

router.post("/session/:sessionId/apply-exchange-credit", canUseSaleBenefits, async (req, res) => {
  try {
    const session = getSessionById(req.params.sessionId);
    if (session) {
      await ensureOpenCashRegisterForStore(req, session.store_id || session.loja || "", {
        module: "exchange_credit",
        action: "exchange_credit_blocked_without_open_cash",
        entityType: "sale_session",
        entityId: req.params.sessionId,
        message: "Caixa fechado. Abra o caixa antes de aplicar Credito de Troca."
      });
    }
    res.json(applyExchangeCreditToSession(req.params.sessionId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message || "Falha ao aplicar Credito de Troca na venda do PDV." });
  }
});

router.post("/session/:sessionId/remove-exchange-credit", canUseSaleBenefits, async (req, res) => {
  try {
    res.json(removeExchangeCreditFromSession(req.params.sessionId, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao remover Credito de Troca da venda do PDV." });
  }
});

router.post("/gift-cards/issue", canIssueGiftCard, async (req, res) => {
  try {
    res.json(issueGiftCard(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao emitir o vale presente do PDV." });
  }
});

router.get("/gift-cards/:code", canUseSaleBenefits, async (req, res) => {
  try {
    const giftCard = getGiftCardByCode(req.params.code);
    if (!giftCard) {
      return res.status(404).json({ error: "Vale presente do PDV nao encontrado." });
    }
    res.json(giftCard);
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o vale presente do PDV." });
  }
});

router.post("/exchanges", canCreateExchange, async (req, res) => {
  try {
    res.json(createExchange(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao registrar a troca do PDV." });
  }
});

module.exports = {
  pdvSalesRouter: router
};
