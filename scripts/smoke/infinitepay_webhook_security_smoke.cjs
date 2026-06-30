"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "infinitepay-smoke-"));
const tempSalesDir = path.join(tempRoot, "data", "pdv", "sales");
fs.mkdirSync(tempSalesDir, { recursive: true });

const fakeSales = [
  {
    sale_id: "SAL_TEST_ACTIVE",
    total_final: 299.90,
    total: 299.90,
    status: "COMPLETED",
    payment_link_provider: "infinitepay",
    payment_link_url: "https://checkout.infinitepay.com.br/x?lenc=abc",
    payment_link_checkout_id: "abc",
    payment_link_status: "generated",
    payment_link_payment_status: "awaiting_payment",
    payment_link_provider_status: "PENDING",
    items: [
      { sku: "X1", nome: "Camiseta", quantidade: 1, preco_referencia: 299.90 }
    ]
  },
  {
    sale_id: "SAL_TEST_LEGACY_PAGBANK",
    total_final: 199.90,
    total: 199.90,
    status: "COMPLETED",
    payment_link_provider: "pagbank",
    payment_link_url: "https://pagseguro.uol.com.br/x",
    payment_link_checkout_id: "OLDCHK123",
    payment_link_status: "generated",
    payment_link_payment_status: "awaiting_payment",
    items: []
  },
  {
    sale_id: "SAL_TEST_CANCELED",
    total_final: 99.90,
    total: 99.90,
    status: "CANCELLED",
    cancelled_at: "2026-06-30T00:00:00.000Z",
    payment_link_provider: "infinitepay",
    payment_link_url: "https://checkout.infinitepay.com.br/y?lenc=xyz",
    payment_link_checkout_id: "xyz",
    payment_link_status: "generated",
    payment_link_payment_status: "awaiting_payment",
    pagamentos: [{ method: "link_pagamento", amount: 99.90 }],
    loja: "vila",
    loja_venda: "vila",
    store_id: "vila",
    items: []
  }
];

fs.writeFileSync(path.join(tempSalesDir, "sales.json"), JSON.stringify(fakeSales, null, 2));
console.log("[setup] temp root:", tempRoot);

process.env.INFINITEPAY_HANDLE = "minhaloja";
process.env.INFINITEPAY_REDIRECT_URL = "http://localhost:3000/pdv/pagamento/infinitepay/retorno";
process.env.INFINITEPAY_WEBHOOK_URL = "http://localhost:3000/api/pdv/payments/infinitepay/webhook";
process.env.PAYMENT_PROVIDER = "infinitepay";

const originalCwd = process.cwd();
process.chdir(tempRoot);

let failures = 0;
function assert(label, cond) {
  if (!cond) {
    console.error("FAIL:", label);
    failures += 1;
  } else {
    console.log("PASS:", label);
  }
}

function pass(label) {
  console.log("PASS:", label);
}
function fail(label) {
  failures += 1;
  console.error("FAIL:", label);
}

async function main() {
  const svc = require(path.join(originalCwd, "modules", "pdv", "sales", "pdvSalesService"));

  const saleActive = svc.getSaleById("SAL_TEST_ACTIVE");
  const saleLegacy = svc.getSaleById("SAL_TEST_LEGACY_PAGBANK");
  assert("resolveSalePaymentLinkProvider active infinitepay -> infinitepay",
    svc.resolveSalePaymentLinkProvider(saleActive) === "infinitepay");
  assert("resolveSalePaymentLinkProvider legacy pagbank -> pagbank",
    svc.resolveSalePaymentLinkProvider(saleLegacy) === "pagbank");

  const r1 = svc.applyInfinitePayWebhookToSale({
    order_nsu: "SAL_NOTFOUND",
    invoice_slug: "aa",
    transaction_nsu: "tx-1",
    status: "PAID",
    paid_amount_cents: 29990,
    amount_cents: 29990
  });
  assert("webhook order_nsu inexistente -> matched false", r1.matched === false);
  assert("webhook order_nsu inexistente -> reason sale_not_found", r1.reason === "sale_not_found");

  const r2 = svc.applyInfinitePayWebhookToSale({
    order_nsu: "SAL_TEST_ACTIVE",
    invoice_slug: "abc",
    transaction_nsu: "",
    status: "PAID",
    paid_amount_cents: 29990,
    amount_cents: 29990
  });
  assert("webhook sem transaction_nsu -> reason missing_transaction_nsu", r2.reason === "missing_transaction_nsu");

  const r3 = svc.applyInfinitePayWebhookToSale({
    order_nsu: "SAL_TEST_CANCELED",
    invoice_slug: "xyz",
    transaction_nsu: "tx-c1",
    status: "PAID",
    paid_amount_cents: 9990,
    amount_cents: 9990
  });
  assert("webhook venda cancelada -> matched false", r3.matched === false);
  assert("webhook venda cancelada -> reason sale_canceled", r3.reason === "sale_canceled");

  const r4 = svc.applyInfinitePayWebhookToSale({
    order_nsu: "SAL_TEST_LEGACY_PAGBANK",
    invoice_slug: "OLDCHK123",
    transaction_nsu: "tx-l1",
    status: "PAID",
    paid_amount_cents: 19990,
    amount_cents: 19990
  });
  assert("webhook legacy pagbank -> matched false", r4.matched === false);
  assert("webhook legacy pagbank -> reason provider_mismatch", r4.reason === "provider_mismatch");

  // 6. Valor divergente > 1 cent
  const r5 = svc.applyInfinitePayWebhookToSale({
    order_nsu: "SAL_TEST_ACTIVE",
    invoice_slug: "abc",
    transaction_nsu: "tx-div",
    status: "PAID",
    paid_amount_cents: 1000,
    amount_cents: 1000
  });
  assert("webhook valor divergente -> matched false", r5.matched === false);
  assert("webhook valor divergente -> reason amount_mismatch", r5.reason === "amount_mismatch");

  // 6b. Diferenca de 1 centavo -> aceito
  const r5b = svc.applyInfinitePayWebhookToSale({
    order_nsu: "SAL_TEST_ACTIVE",
    invoice_slug: "abc",
    transaction_nsu: "tx-1cent",
    status: "PAID",
    paid_amount_cents: 29991,
    amount_cents: 29991
  });
  assert("webhook +1 centavo -> aceito", r5b.ok === true);

  // 6c. paid_amount abaixo do esperado
  const r5c = svc.applyInfinitePayWebhookToSale({
    order_nsu: "SAL_TEST_ACTIVE",
    invoice_slug: "abc",
    transaction_nsu: "tx-paid-low",
    status: "PAID",
    paid_amount_cents: 1000,
    amount_cents: 29990
  });
  assert("webhook paid_amount abaixo -> reason paid_amount_below_expected", r5c.reason === "paid_amount_below_expected");

  // 7. Webhook valido
  const r6 = svc.applyInfinitePayWebhookToSale({
    order_nsu: "SAL_TEST_ACTIVE",
    invoice_slug: "abc",
    transaction_nsu: "tx-ok-2",
    status: "PAID",
    paid_amount_cents: 29990,
    amount_cents: 29990,
    receipt_url: "https://example.com/receipt",
    installments: 3,
    capture_method: "credit_card"
  });
  assert("webhook valido -> matched true", r6.matched === true);
  assert("webhook valido -> paid confirmado", r6.sale.payment_link_payment_status === "paid");
  assert("webhook valido -> receipt_url gravado", r6.sale.payment_link_receipt_url === "https://example.com/receipt");
  assert("webhook valido -> transaction_nsu gravado", r6.sale.payment_link_transaction_nsu === "tx-ok-2");
  assert("webhook valido -> installments gravado", r6.sale.payment_link_installments === 3);
  assert("webhook valido -> capture_method gravado", r6.sale.payment_link_capture_method === "credit_card");
  assert("webhook valido -> amount_cents gravado", r6.sale.payment_link_amount_cents === 29990);

  // 8. Webhook duplicado
  const r7 = svc.applyInfinitePayWebhookToSale({
    order_nsu: "SAL_TEST_ACTIVE",
    invoice_slug: "abc",
    transaction_nsu: "tx-ok-2",
    status: "PAID",
    paid_amount_cents: 29990,
    amount_cents: 29990
  });
  assert("webhook duplicado -> matched true", r7.matched === true);
  assert("webhook duplicado -> duplicate true", r7.duplicate === true);
  assert("webhook duplicado -> paid_at NAO sobrescrito",
    r7.sale.payment_link_paid_at === r6.sale.payment_link_paid_at);

  // 9. capture_method boleto -> rejeitado
  const r8 = svc.applyInfinitePayWebhookToSale({
    order_nsu: "SAL_TEST_ACTIVE",
    invoice_slug: "abc",
    transaction_nsu: "tx-boleto",
    status: "PAID",
    paid_amount_cents: 29990,
    amount_cents: 29990,
    capture_method: "boleto"
  });
  if (r8.sale.payment_link_capture_method === "boleto") {
    fail("webhook capture_method boleto -> NAO devia aceitar boleto");
  } else {
    pass("webhook capture_method boleto -> rejeitado");
  }

  // 9b. capture_method debit_card -> rejeitado
  const r8b = svc.applyInfinitePayWebhookToSale({
    order_nsu: "SAL_TEST_ACTIVE",
    invoice_slug: "abc",
    transaction_nsu: "tx-debit",
    status: "PAID",
    paid_amount_cents: 29990,
    amount_cents: 29990,
    capture_method: "debit_card"
  });
  if (r8b.sale.payment_link_capture_method === "debit_card") {
    fail("webhook capture_method debit_card -> NAO devia aceitar");
  } else {
    pass("webhook capture_method debit_card -> rejeitado");
  }

  // 10. installments 13 -> rejeitado
  const r9 = svc.applyInfinitePayWebhookToSale({
    order_nsu: "SAL_TEST_ACTIVE",
    invoice_slug: "abc",
    transaction_nsu: "tx-13x",
    status: "PAID",
    paid_amount_cents: 29990,
    amount_cents: 29990,
    installments: 13
  });
  assert("webhook installments 13 -> reason invalid_installments", r9.reason === "invalid_installments");

  // 11. ensureInfinitePayLinkForSale em venda cancelada
  try {
    const fakeUser = { role: "ADMIN", permissions: { can_release_orders: true, can_sell: true, can_view_all_stores: true }, allowed_stores: [] };
    await svc.generateSalePaymentLink("SAL_TEST_CANCELED", fakeUser, { forceGenerate: true });
    fail("ensureInfinitePayLinkForSale cancelada -> deveria jogar");
  } catch (e) {
    assert("ensureInfinitePayLinkForSale cancelada -> erro",
      /cancelada|canceled/i.test(e.message));
  }

  // 12. Venda com provider=infinitepay + env incompleto -> erro infinitepay_not_configured
  const savedHandle = process.env.INFINITEPAY_HANDLE;
  const savedRedirect = process.env.INFINITEPAY_REDIRECT_URL;
  const savedWebhook = process.env.INFINITEPAY_WEBHOOK_URL;
  delete process.env.INFINITEPAY_HANDLE;
  delete process.env.INFINITEPAY_REDIRECT_URL;
  delete process.env.INFINITEPAY_WEBHOOK_URL;
  // Persistir pagamentos no disco
  const salesPath = path.join(tempRoot, "data", "pdv", "sales", "sales.json");
  const salesArr = JSON.parse(fs.readFileSync(salesPath, "utf8"));
  const idx = salesArr.findIndex((s) => s.sale_id === "SAL_TEST_ACTIVE");
  if (idx >= 0) {
    salesArr[idx] = {
      ...salesArr[idx],
      pagamentos: [{ method: "link_pagamento", amount: 299.90 }],
      loja: "vila",
      loja_venda: "vila",
      store_id: "vila"
    };
    fs.writeFileSync(salesPath, JSON.stringify(salesArr, null, 2));
  }
  try {
    const fakeUserAdmin = { role: "ADMIN", permissions: { can_release_orders: true, can_sell: true, can_view_all_stores: true }, allowed_stores: [] };
    await svc.generateSalePaymentLink("SAL_TEST_ACTIVE", fakeUserAdmin, { forceGenerate: true });
    fail("env incompleto + provider infinitepay -> deveria jogar");
  } catch (e) {
    assert("env incompleto + provider infinitepay -> erro infinitepay_not_configured",
      /infinitepay_not_configured|INFINITEPAY_HANDLE/i.test(e.message));
  }
  // Restaurar env
  process.env.INFINITEPAY_HANDLE = savedHandle;
  process.env.INFINITEPAY_REDIRECT_URL = savedRedirect;
  process.env.INFINITEPAY_WEBHOOK_URL = savedWebhook;
}

main().then(() => {
  process.chdir(originalCwd);
  fs.rmSync(tempRoot, { recursive: true, force: true });
  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  } else {
    console.log("\nAll smoke tests passed.");
  }
}).catch((err) => {
  console.error("Smoke error:", err);
  process.exit(1);
});