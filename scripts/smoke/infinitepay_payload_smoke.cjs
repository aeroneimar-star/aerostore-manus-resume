"use strict";

const path = require("path");

process.env.INFINITEPAY_HANDLE = "minhaloja";
process.env.INFINITEPAY_REDIRECT_URL = "http://localhost:3000/pdv/pagamento/infinitepay/retorno";
process.env.INFINITEPAY_WEBHOOK_URL = "http://localhost:3000/api/pdv/payments/infinitepay/webhook";

const ip = require(path.join(__dirname, "..", "..", "services", "infinitepayService"));

let failures = 0;
function assert(label, cond) {
  if (!cond) {
    console.error("FAIL:", label);
    failures += 1;
  } else {
    console.log("PASS:", label);
  }
}

// 1. Handle ausente -> erro
try {
  delete process.env.INFINITEPAY_HANDLE;
  ip.buildInfinitePayPayload({ order_nsu: "X", items: [{ quantity: 1, unitPrice: 10, name: "A" }] });
  assert("handle ausente -> erro", false);
} catch (e) {
  assert("handle ausente -> erro", /handle/i.test(e.message));
} finally {
  process.env.INFINITEPAY_HANDLE = "minhaloja";
}

// 2. Items com price quebrado (centavos seguros)
const r1 = ip.buildInfinitePayPayload({
  order_nsu: "SAL_X",
  customer: { name: "Maria", email: "m@a.com", phone: "+5516999999999" },
  items: [{ quantity: 2, unitPrice: 49.90, name: "Camiseta" }],
  expectedTotalCents: 9980
});
assert("price em centavos inteiros", r1.payload.items[0].price === 4990);
assert("quantity preservada", r1.payload.items[0].quantity === 2);
assert("itemsTotalCents bate expected", r1.itemsTotalCents === 9980);

// 3. Total divergente -> erro
try {
  const r = ip.buildInfinitePayPayload({
    order_nsu: "SAL_X",
    items: [{ quantity: 1, unitPrice: 100, name: "A" }],
    expectedTotalCents: 99999
  });
  console.log("UNEXPECTED result:", JSON.stringify(r));
  assert("total divergente -> erro", false);
} catch (e) {
  console.log("got error message:", e.message);
  assert("total divergente -> erro", /diverge/i.test(e.message));
}

// 4. Sem items -> erro
try {
  ip.buildInfinitePayPayload({ order_nsu: "SAL_X", items: [] });
  assert("sem items -> erro", false);
} catch (e) {
  assert("sem items -> erro", /item/i.test(e.message));
}

// 5. Sem order_nsu -> erro
try {
  ip.buildInfinitePayPayload({ order_nsu: "", items: [{ quantity: 1, unitPrice: 100, name: "A" }] });
  assert("sem order_nsu -> erro", false);
} catch (e) {
  assert("sem order_nsu -> erro", /order_nsu/i.test(e.message));
}

// 6. capture_method whitelist
assert("capture_method credit_card aceito", ip.isAllowedCaptureMethod("credit_card"));
assert("capture_method pix aceito", ip.isAllowedCaptureMethod("pix"));
assert("capture_method boleto rejeitado", !ip.isAllowedCaptureMethod("boleto"));
assert("capture_method debit_card rejeitado", !ip.isAllowedCaptureMethod("debit_card"));
assert("capture_method cripto rejeitado", !ip.isAllowedCaptureMethod("criptomoeda"));

// 7. installments 1-12 (nao mais 1-36)
assert("installments 1 -> 1", ip.normalizeSafeInstallments(1) === 1);
assert("installments 12 -> 12", ip.normalizeSafeInstallments(12) === 12);
assert("installments 0 -> 0 (rejeitado)", ip.normalizeSafeInstallments(0) === 0);
assert("installments 13 -> 0 (rejeitado)", ip.normalizeSafeInstallments(13) === 0);
assert("installments 40 -> 0 (rejeitado)", ip.normalizeSafeInstallments(40) === 0);
assert("installments -1 -> 0 (rejeitado)", ip.normalizeSafeInstallments(-1) === 0);
assert("installments 1 in range", ip.isInstallmentsInRange(1));
assert("installments 12 in range", ip.isInstallmentsInRange(12));
assert("installments 13 NOT in range", !ip.isInstallmentsInRange(13));

// 8. paid status correto
assert("isInfinitePaidStatus PAID", ip.isInfinitePaidStatus("PAID"));
assert("isInfinitePaidStatus approved", ip.isInfinitePaidStatus("approved"));
assert("!isInfinitePaidStatus pending", !ip.isInfinitePaidStatus("pending"));
assert("!isInfinitePaidStatus DECLINED", !ip.isInfinitePaidStatus("DECLINED"));

// 9. phone normalizado
const norm = ip.buildInfinitePayPayload({
  order_nsu: "SAL_P",
  customer: { name: "Joao", phone: "16999998888" },
  items: [{ quantity: 1, unitPrice: 50, name: "X" }]
});
assert("phone vira +55...", norm.payload.customer.phone_number === "+5516999998888");

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll payload smoke tests passed.");