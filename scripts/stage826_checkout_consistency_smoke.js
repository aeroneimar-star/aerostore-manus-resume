"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const {
  openCustomerSession,
  saveSession,
  getSessionById,
  updateSessionDiscount,
  updatePaymentPlan
} = require("../modules/pdv/services/pdvOperationalService");
const {
  applyCashbackToSession,
  finalizeSaleFromSession
} = require("../modules/pdv/sales/pdvSalesService");

const sessionsPath = path.join(process.cwd(), "data", "pdv", "operational", "customer-sessions.json");
const originalSessions = fs.existsSync(sessionsPath) ? fs.readFileSync(sessionsPath, "utf8") : "[]";

function roundMoney(value) {
  return Number(Math.max(0, Number(value || 0)).toFixed(2));
}

function computeCheckout({ subtotal, discount, cashback, paid }) {
  const totalAfterDiscount = roundMoney(subtotal - discount);
  const maxCashback = roundMoney(totalAfterDiscount * 0.5);
  const validCashback = cashback > maxCashback + 0.009 ? 0 : cashback;
  const amountToPay = roundMoney(totalAfterDiscount - validCashback);
  return {
    totalAfterDiscount,
    maxCashback,
    validCashback,
    amountToPay,
    pending: roundMoney(amountToPay - paid),
    change: roundMoney(paid - amountToPay)
  };
}

async function main() {
  try {
    const session = openCustomerSession({
      sessionId: `SMOKE_CHECKOUT_${Date.now()}`,
      seller: "Stage 826",
      loja: "vila_masc"
    }, { name: "Stage 826", role: "ADMIN", email: "admin@aerostore.local" });

    session.customer = {
      name: "STELA MARIA MOREIRA LINS",
      phone: "47996453731",
      master_customer_id: "stage826-stela"
    };
    session.cart_items = [{
      item_id: "ITEM_STAGE826",
      product_id: "PROD_STAGE826",
      inventory_id: "INV_STAGE826",
      sku: "STAGE826",
      nome: "Item stage checkout",
      quantidade: 1,
      preco_venda: 89.90,
      preco_referencia: 89.90,
      loja_origem_estoque: "vila_masc",
      stock_source_store_id: "vila_masc",
      fulfillment_type: "LOCAL_STOCK",
      fulfillment_mode: "NORMAL",
      fulfillment_status: "CONFIRMED"
    }];
    saveSession(session);

    try {
      applyCashbackToSession(session.session_id, { amount: 44.95 }, { name: "Stage 826", role: "ADMIN" });
    } catch (error) {
      const current = getSessionById(session.session_id);
      current.cashback_application = {
        amount: 44.95,
        customer_phone: session.customer.phone,
        customer_name: session.customer.name,
        customer_id: session.customer.master_customer_id,
        applied_at: new Date().toISOString(),
        applied_by: "Stage 826"
      };
      saveSession(current);
    }

    updateSessionDiscount(session.session_id, { mode: "percent", value: 90, reason: "stage826" });
    updatePaymentPlan(session.session_id, [{ method: "link_pagamento", amount: 8.99, installments: 1 }]);

    const expected = computeCheckout({
      subtotal: 89.90,
      discount: 80.91,
      cashback: 44.95,
      paid: 8.99
    });
    assert.strictEqual(expected.amountToPay, 8.99, "cashback invalido nao deve zerar cliente_vai_pagar");
    assert.strictEqual(expected.change, 0, "pagamento exato nao deve gerar excedente");
    assert.strictEqual(expected.pending, 0, "pagamento exato nao deve deixar restante");

    let blocked = false;
    try {
      await finalizeSaleFromSession(session.session_id, {
        loja: "vila_masc",
        desconto_extra: 80.91,
        cashback_application: getSessionById(session.session_id).cashback_application,
        paymentMethods: [{ method: "link_pagamento", amount: 8.99, installments: 1 }]
      }, { name: "Stage 826", role: "ADMIN", email: "admin@aerostore.local" });
    } catch (error) {
      blocked = /cashback|autorizacao|autorizacao|saldo|limite|autoriz/i.test(String(error.message || ""));
    }
    assert.strictEqual(blocked, true, "backend deve bloquear finalizacao inconsistente sem autorizacao/revisao");

    console.log(JSON.stringify({
      ok: true,
      bugOriginal: {
        amountToPay: expected.amountToPay,
        paid: 8.99,
        change: expected.change,
        pending: expected.pending
      },
      backendBlocked: blocked
    }, null, 2));
  } finally {
    fs.writeFileSync(sessionsPath, originalSessions, "utf8");
  }
}

main().catch((error) => {
  fs.writeFileSync(sessionsPath, originalSessions, "utf8");
  console.error(error);
  process.exit(1);
});
