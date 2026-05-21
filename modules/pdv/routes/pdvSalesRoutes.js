"use strict";

const express = require("express");
const {
  finalizeSaleFromSession,
  cancelSale,
  issueGiftCard,
  createExchange,
  getSalesSummary,
  listPendingPaymentLinkSales,
  getSaleById,
  canAccessSale,
  buildSalePaymentLinkPayload,
  generateSalePaymentLink,
  refreshSalePaymentLinkStatus,
  getGiftCardByCode,
  getCustomerCashbackBalance,
  getCustomerCashbackSnapshot,
  applyCashbackToSession,
  removeCashbackFromSession
} = require("../sales/pdvSalesService");
const { validateAuthorizationPin, getPdvUserRole } = require("../services/pdvControlService");

const router = express.Router();

function ensureSaleAccess(req, res, sale = null) {
  if (sale && canAccessSale(sale, req.user || {})) {
    return true;
  }
  res.status(403).json({ error: "Voce nao tem permissao para acessar esta venda." });
  return false;
}

router.get("/summary", async (req, res) => {
  try {
    res.json(getSalesSummary());
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar o resumo de vendas do PDV." });
  }
});

router.get("/payment-links/pending", async (req, res) => {
  try {
    res.json(listPendingPaymentLinkSales(req.user || {}));
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao carregar as vendas aguardando pagamento." });
  }
});

router.post("/finalize/:sessionId", async (req, res) => {
  try {
    res.json(await finalizeSaleFromSession(req.params.sessionId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao finalizar a venda operacional do PDV." });
  }
});

router.post("/cancel/:saleId", async (req, res) => {
  try {
    const sale = getSaleById(req.params.saleId);
    if (!sale) {
      return res.status(404).json({ error: "Venda do PDV nao encontrada." });
    }
    if (!ensureSaleAccess(req, res, sale)) {
      return;
    }

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

router.get("/sale/:saleId", async (req, res) => {
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

router.get("/sale/:saleId/payment-link", async (req, res) => {
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

router.post("/sale/:saleId/payment-link/generate", async (req, res) => {
  try {
    const currentSale = getSaleById(req.params.saleId);
    if (!currentSale) {
      return res.status(404).json({ error: "Venda do PDV nao encontrada." });
    }
    if (!ensureSaleAccess(req, res, currentSale)) {
      return;
    }
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

router.post("/sale/:saleId/payment-link/refresh", async (req, res) => {
  try {
    const currentSale = getSaleById(req.params.saleId);
    if (!currentSale) {
      return res.status(404).json({ error: "Venda do PDV nao encontrada." });
    }
    if (!ensureSaleAccess(req, res, currentSale)) {
      return;
    }
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

router.get("/cashback/balance", async (req, res) => {
  try {
    res.json({ balance: getCustomerCashbackBalance(req.query.phone || "") });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao consultar o saldo de cashback do PDV." });
  }
});

router.get("/customer/:customerId/cashback", async (req, res) => {
  try {
    res.json(getCustomerCashbackSnapshot(req.query.phone || ""));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao consultar o cashback do cliente no PDV." });
  }
});

router.post("/session/:sessionId/apply-cashback", async (req, res) => {
  try {
    res.json(applyCashbackToSession(req.params.sessionId, req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao aplicar cashback na venda do PDV." });
  }
});

router.post("/session/:sessionId/remove-cashback", async (req, res) => {
  try {
    res.json(removeCashbackFromSession(req.params.sessionId, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao remover cashback da venda do PDV." });
  }
});

router.post("/gift-cards/issue", async (req, res) => {
  try {
    res.json(issueGiftCard(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao emitir o vale presente do PDV." });
  }
});

router.get("/gift-cards/:code", async (req, res) => {
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

router.post("/exchanges", async (req, res) => {
  try {
    res.json(createExchange(req.body || {}, req.user || {}));
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao registrar a troca do PDV." });
  }
});

module.exports = {
  pdvSalesRouter: router
};
