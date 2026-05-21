"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const controlService = require("../modules/pdv/services/pdvControlService");
const operationalService = require("../modules/pdv/services/pdvOperationalService");
const salesService = require("../modules/pdv/sales/pdvSalesService");

const adminUser = {
  id: "USR_STAGE_819",
  user_id: "USR_STAGE_819",
  name: "Admin AEROSTORE",
  email: "admin@aerostore.local",
  role: "ADMIN",
  store_id: "vila_masc",
  permissions: {
    can_approve_discount_authorization: true,
    can_view_all_stores: true
  }
};

const cashbackLedgerPath = path.join(process.cwd(), "data", "pdv", "sales", "cashback-ledger.json");
const qaCashbackPhone = "16999990001";

function readJson(filePath, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function roundMoney(value = 0) {
  return Number(Number(value || 0).toFixed(2));
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function decodeBase32(secret = "") {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = normalizeText(secret).replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) {
      throw new Error("Base32 invalido para TOTP.");
    }
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotpCode(secret = "", counter = Math.floor(Date.now() / 30000)) {
  const key = decodeBase32(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, "0");
}

function ensureOpenCashRegister(storeId) {
  const existing = controlService.getOpenCashRegisterByStore(storeId);
  if (existing) {
    return existing;
  }
  return controlService.openCashRegister({
    loja: storeId,
    operador: adminUser.name,
    valor_inicial: 500
  }, adminUser);
}

async function ensureAuthorizer(name, role) {
  const existing = controlService.listAuthorizers().find((item) => normalizeText(item.name).toLowerCase() === normalizeText(name).toLowerCase());
  if (existing?.is_active) {
    return existing;
  }
  const created = await controlService.createOrRefreshAuthorizer({ name, role }, adminUser);
  const code = generateTotpCode(created.setup.manual_entry_key);
  const activated = controlService.verifyAuthorizerSetup(created.authorizer.authorizer_id, code, adminUser);
  return activated;
}

function ensureQaCashbackCustomer() {
  let created = null;
  try {
    created = operationalService.createQuickCustomer({
      name: "QA CLIENTE PDV MULTILOJA",
      phone: qaCashbackPhone,
      email: "qa.cliente.multiloja@aerostore.local",
      notes: "QA Stage 8.19 - cashback e desconto supervisionado",
      loja: "vila_masc",
      store_id: "vila_masc"
    }, adminUser);
  } catch (error) {
    if (error?.details?.existing_customer || error?.existing_customer) {
      created = error.details?.existing_customer || error.existing_customer;
    } else {
      throw error;
    }
  }
  const ledger = readJson(cashbackLedgerPath, []);
  const sourceKey = "QA_STAGE_8_19";
  const existingEntry = ledger.find((item) =>
    normalizeDigits(item.customer_phone || "") === qaCashbackPhone
    && normalizeText(item.source || "") === sourceKey
    && normalizeText(item.origin || "") === "MANUAL_QA"
  );
  const baseEntry = {
    cashback_id: existingEntry?.cashback_id || `CBK_QA_STAGE819_${Date.now()}`,
    sale_id: "",
    customer_phone: qaCashbackPhone,
    customer_name: "QA CLIENTE PDV MULTILOJA",
    source: sourceKey,
    origin: "MANUAL_QA",
    status: "AVAILABLE",
    amount: 100,
    remaining_amount: 100,
    available_at: addDays(-1),
    expires_at: addDays(30),
    created_at: new Date().toISOString(),
    created_by: adminUser.name,
    notes: "Saldo QA para validacao de desconto + cashback."
  };
  if (existingEntry) {
    Object.assign(existingEntry, baseEntry);
  } else {
    ledger.unshift(baseEntry);
  }
  writeJson(cashbackLedgerPath, ledger);
  return created;
}

async function getProductBySku(sku, storeId) {
  const rows = await operationalService.searchProducts(sku, { storeId, limit: 20 });
  const exact = rows.find((item) => normalizeText(item.sku || "").toUpperCase() === normalizeText(sku).toUpperCase());
  if (!exact) {
    throw new Error(`Produto ${sku} nao encontrado para a loja ${storeId}.`);
  }
  return exact;
}

async function buildSaleSession({ sku, storeId, customer = null }) {
  const session = operationalService.openCustomerSession({
    seller: adminUser.name,
    loja: storeId
  }, adminUser);
  const product = await getProductBySku(sku, storeId);
  operationalService.addProductToCart(session.session_id, {
    loja: storeId,
    sku: product.sku,
    codigo: product.codigo,
    nome: product.nome,
    preco_venda: product.preco_venda,
    preco_referencia: product.preco_venda,
    product_id: product.product_id,
    selected_product_id: product.product_id,
    inventory_id: product.inventory_id,
    selected_inventory_id: product.inventory_id,
    store_id: product.store_id || storeId,
    availability_label: product.availability_label || "",
    cor: product.cor || "",
    tamanho: product.tamanho || "",
    quantidade: 1
  }, adminUser);
  if (customer) {
    await operationalService.attachCustomerToSession(session.session_id, customer, adminUser);
  }
  return operationalService.getSessionById(session.session_id);
}

function updatePayment(sessionId, methods) {
  operationalService.updatePaymentPlan(sessionId, methods);
  return operationalService.getSessionById(sessionId);
}

function updateDiscount(sessionId, mode, value, reason) {
  operationalService.updateSessionDiscount(sessionId, { mode, value, reason });
  return operationalService.getSessionById(sessionId);
}

function finalizeSale(sessionId, payload = {}) {
  return salesService.finalizeSaleFromSession(sessionId, {
    loja: "vila_masc",
    ...payload
  }, adminUser);
}

async function main() {
  ensureOpenCashRegister("vila_masc");
  const neimar = await ensureAuthorizer("Neimar", "GESTOR");
  const gestora = await ensureAuthorizer("Gestora", "GESTORA");
  const qaCustomer = ensureQaCashbackCustomer();

  const results = {
    authorizers: {
      neimar: Boolean(neimar?.is_active),
      gestora: Boolean(gestora?.is_active)
    },
    tests: {}
  };

  results.tests.A = {
    ok: Boolean(neimar?.is_active),
    authorizer: neimar?.name || ""
  };

  results.tests.B = {
    ok: Boolean(gestora?.is_active),
    authorizer: gestora?.name || ""
  };

  const saleC = await buildSaleSession({ sku: "QA-PDV-ML-010", storeId: "vila_masc" });
  updateDiscount(saleC.session_id, "percent", 10, "Desconto PIX ate limite");
  updatePayment(saleC.session_id, [{ method: "pix", amount: 180, installments: 1 }]);
  const completedC = await finalizeSale(saleC.session_id, {
    paymentMethods: [{ method: "pix", amount: 180, installments: 1 }],
    desconto_extra: 20
  });
  results.tests.C = {
    ok: completedC.total_final === 180 && completedC.desconto_extra === 20,
    totalFinal: completedC.total_final,
    discount: completedC.desconto_extra,
    discountAuthorizationId: completedC.discount_authorization_id || null
  };

  const saleD = await buildSaleSession({ sku: "QA-PDV-ML-010", storeId: "vila_masc" });
  updateDiscount(saleD.session_id, "percent", 10, "Desconto dinheiro ate limite");
  updatePayment(saleD.session_id, [{ method: "dinheiro", amount: 180, installments: 1 }]);
  const completedD = await finalizeSale(saleD.session_id, {
    paymentMethods: [{ method: "dinheiro", amount: 180, installments: 1 }],
    desconto_extra: 20
  });
  results.tests.D = {
    ok: completedD.total_final === 180 && completedD.desconto_extra === 20,
    totalFinal: completedD.total_final
  };

  const saleE = await buildSaleSession({ sku: "QA-PDV-ML-010", storeId: "vila_masc" });
  updateDiscount(saleE.session_id, "percent", 15, "Tentativa sem autorizacao");
  let errorE = "";
  try {
    updatePayment(saleE.session_id, [{ method: "pix", amount: 170, installments: 1 }]);
    await finalizeSale(saleE.session_id, {
      paymentMethods: [{ method: "pix", amount: 170, installments: 1 }],
      desconto_extra: 30
    });
  } catch (error) {
    errorE = error.message || String(error);
  }
  results.tests.E = {
    ok: /exige autorizacao/i.test(errorE),
    error: errorE
  };

  const saleF = await buildSaleSession({ sku: "QA-PDV-ML-010", storeId: "vila_masc" });
  updateDiscount(saleF.session_id, "percent", 15, "Liberacao comercial QA");
  // Gera novamente a partir do reset de setup nao expondo secret em log
  const refreshF = await controlService.createOrRefreshAuthorizer({ name: "Neimar", role: "GESTOR" }, adminUser);
  const codeF = generateTotpCode(refreshF.setup.manual_entry_key);
  const activatedF = controlService.verifyAuthorizerSetup(refreshF.authorizer.authorizer_id, codeF, adminUser);
  const approvalF = controlService.validateOperationAuthorization({
    authorizer_id: activatedF.authorizer_id,
    code: codeF,
    operation_type: "DISCOUNT_ABOVE_LIMIT",
    sale_session_id: saleF.session_id,
    amount: 30,
    percent: 15,
    reason: "Liberacao comercial QA",
    context: { loja: "vila_masc", payment_methods: ["pix"] }
  }, adminUser);
  updatePayment(saleF.session_id, [{ method: "pix", amount: 170, installments: 1 }]);
  const completedF = await finalizeSale(saleF.session_id, {
    paymentMethods: [{ method: "pix", amount: 170, installments: 1 }],
    desconto_extra: 30,
    discount_authorization_id: approvalF.authorization_id
  });
  const auditF = controlService.loadAuthorizationAudit().find((item) => item.authorization_id === approvalF.authorization_id);
  results.tests.F = {
    ok: completedF.total_final === 170 && Boolean(completedF.discount_authorization_id) && auditF?.status === "CONSUMED",
    saleId: completedF.sale_id,
    approvalStatus: auditF?.status || ""
  };

  let errorG = "";
  try {
    controlService.validateOperationAuthorization({
      authorizer_id: activatedF.authorizer_id,
      code: "000000",
      operation_type: "DISCOUNT_ABOVE_LIMIT",
      sale_session_id: "SES_INVALID_STAGE819",
      amount: 30,
      percent: 15,
      reason: "Teste invalido",
      context: { loja: "vila_masc", payment_methods: ["pix"] }
    }, adminUser);
  } catch (error) {
    errorG = error.message || String(error);
  }
  results.tests.G = {
    ok: /invalido|expirado/i.test(errorG),
    error: errorG
  };

  const saleH = await buildSaleSession({ sku: "QA-PDV-ML-010", storeId: "vila_masc" });
  updateDiscount(saleH.session_id, "percent", 15, "Reuso de codigo");
  const refreshH = await controlService.createOrRefreshAuthorizer({ name: "Gestora", role: "GESTORA" }, adminUser);
  const codeH = generateTotpCode(refreshH.setup.manual_entry_key);
  const activatedH = controlService.verifyAuthorizerSetup(refreshH.authorizer.authorizer_id, codeH, adminUser);
  controlService.validateOperationAuthorization({
    authorizer_id: activatedH.authorizer_id,
    code: codeH,
    operation_type: "DISCOUNT_ABOVE_LIMIT",
    sale_session_id: saleH.session_id,
    amount: 30,
    percent: 15,
    reason: "Primeira aprovacao",
    context: { loja: "vila_masc", payment_methods: ["pix"] }
  }, adminUser);
  let errorH = "";
  try {
    controlService.validateOperationAuthorization({
      authorizer_id: activatedH.authorizer_id,
      code: codeH,
      operation_type: "DISCOUNT_ABOVE_LIMIT",
      sale_session_id: saleH.session_id,
      amount: 30,
      percent: 15,
      reason: "Reuso indevido",
      context: { loja: "vila_masc", payment_methods: ["pix"] }
    }, adminUser);
  } catch (error) {
    errorH = error.message || String(error);
  }
  results.tests.H = {
    ok: /ja foi usada/i.test(errorH),
    error: errorH
  };

  results.tests.I = {
    ok: false,
    status: "prepared_only",
    note: "Desconto por item ficou preparado para etapa futura; esta stage implementa desconto geral supervisionado."
  };

  results.tests.J = {
    ok: results.tests.F.ok,
    status: "discount_total_supervised",
    totalFinal: completedF.total_final
  };

  const saleK = await buildSaleSession({
    sku: "QA-PDV-ML-010",
    storeId: "vila_masc",
    customer: {
      master_customer_id: qaCustomer.master_customer_id || qaCustomer.id || "",
      name: qaCustomer.name,
      phone: qaCashbackPhone,
      email: qaCustomer.email || "",
      origin: qaCustomer.origin || "PDV",
      origin_label: qaCustomer.origin_label || "Cadastro rapido PDV"
    }
  });
  updateDiscount(saleK.session_id, "percent", 10, "Cashback sobre base com desconto");
  salesService.applyCashbackToSession(saleK.session_id, { amount: 90 }, adminUser);
  updatePayment(saleK.session_id, [{ method: "pix", amount: 90, installments: 1 }]);
  const completedK = await finalizeSale(saleK.session_id, {
    paymentMethods: [{ method: "pix", amount: 90, installments: 1 }],
    desconto_extra: 20,
    cashback_application: {
      amount: 90,
      customer_phone: qaCashbackPhone,
      customer_name: qaCustomer.name,
      customer_id: qaCustomer.master_customer_id || qaCustomer.id || ""
    }
  });
  results.tests.K = {
    ok: roundMoney(completedK.gross_amount || completedK.subtotal || 0) === 200
      && completedK.desconto_extra === 20
      && completedK.cashback_used_amount === 90
      && completedK.total_final === 90
      && roundMoney(completedK.cashback_generated?.amount || 0) === 10.8,
    gross: roundMoney(completedK.gross_amount || completedK.subtotal || 0),
    discount: completedK.desconto_extra,
    cashbackUsed: completedK.cashback_used_amount,
    totalFinal: completedK.total_final,
    cashbackGenerated: roundMoney(completedK.cashback_generated?.amount || 0)
  };

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
