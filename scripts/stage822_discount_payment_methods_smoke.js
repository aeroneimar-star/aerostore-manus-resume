"use strict";

const crypto = require("crypto");
const { blockProduction, requireExplicitConfirmation, warnLocalOnly } = require("./scriptSafety");

blockProduction("stage822_discount_payment_methods_smoke.js");
warnLocalOnly("stage822_discount_payment_methods_smoke.js");

const controlService = require("../modules/pdv/services/pdvControlService");

const adminUser = {
  id: "USR_STAGE_822",
  user_id: "USR_STAGE_822",
  name: "Admin AEROSTORE",
  email: "admin@aerostore.local",
  role: "ADMIN",
  store_id: "vila_masc",
  permissions: {
    can_approve_discount_authorization: true,
    can_view_all_stores: true
  }
};

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
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

async function ensureAuthorizer(name, role) {
  const created = await controlService.createOrRefreshAuthorizer({ name, role }, adminUser);
  const code = generateTotpCode(created.setup.manual_entry_key);
  return {
    setup: created.setup,
    authorizer: controlService.verifyAuthorizerSetup(created.authorizer.authorizer_id, code, adminUser)
  };
}

function buildSaleContext(paymentMethods, extraDiscount = 20, subtotal = 200, saleSessionId = "SES_STAGE_822", saleId = "SAL_STAGE_822") {
  return {
    subtotal,
    extraDiscount,
    permutaAmount: 0,
    loja: "vila_masc",
    saleSessionId,
    saleId,
    paymentMethods
  };
}

async function expectThrows(run, matcher) {
  try {
    await run();
    return { ok: false, message: "Nao bloqueou." };
  } catch (error) {
    const message = normalizeText(error?.message || "");
    const ok = typeof matcher === "function"
      ? Boolean(matcher(message))
      : message.includes(String(matcher || ""));
    return { ok, message };
  }
}

async function main() {
  requireExplicitConfirmation("--confirm");
  const qaAuthorizer = await ensureAuthorizer("QA Stage 822", "GESTOR");
  const validCode = generateTotpCode(qaAuthorizer.setup.manual_entry_key);
  const results = {};

  const pixContext = buildSaleContext([{ method: "pix", amount: 180 }], 20, 200, "SES_PIX", "SAL_PIX");
  results.pix10 = {
    ok: !controlService.validateSaleControls({ saleContext: pixContext, authorization: {} }, adminUser).discount_policy.requiresAuthorization
  };

  const cashContext = buildSaleContext([{ method: "dinheiro", amount: 180 }], 20, 200, "SES_DIN", "SAL_DIN");
  results.cash10 = {
    ok: !controlService.validateSaleControls({ saleContext: cashContext, authorization: {} }, adminUser).discount_policy.requiresAuthorization
  };

  const debitContext = buildSaleContext([{ method: "debito", amount: 180 }], 20, 200, "SES_DEB", "SAL_DEB");
  results.debit10 = await expectThrows(() => controlService.validateSaleControls({ saleContext: debitContext, authorization: {} }, adminUser), "PIX ou Dinheiro");

  const creditContext = buildSaleContext([{ method: "credito_ate_10x", amount: 180, installments: 2 }], 20, 200, "SES_CRE", "SAL_CRE");
  results.credit10 = await expectThrows(() => controlService.validateSaleControls({ saleContext: creditContext, authorization: {} }, adminUser), "PIX ou Dinheiro");

  const linkContext = buildSaleContext([{ method: "link_pagamento", amount: 180 }], 20, 200, "SES_LNK", "SAL_LNK");
  results.link10 = await expectThrows(() => controlService.validateSaleControls({ saleContext: linkContext, authorization: {} }, adminUser), "PIX ou Dinheiro");

  const pendingPolicy = controlService.getDiscountPolicyForSale({
    paymentMethods: [],
    discountAmount: 20,
    discountPercent: 10
  });
  results.discountBeforeMethod = {
    ok: pendingPolicy.reason === "PENDING_PAYMENT_METHOD" && !pendingPolicy.requiresAuthorization,
    policy: pendingPolicy
  };

  const pixPolicy = controlService.getDiscountPolicyForSale({
    paymentMethods: [{ method: "pix", amount: 180 }],
    discountAmount: 20,
    discountPercent: 10
  });
  const debitPolicy = controlService.getDiscountPolicyForSale({
    paymentMethods: [{ method: "debito", amount: 180 }],
    discountAmount: 20,
    discountPercent: 10
  });
  results.switchPixToDebit = {
    ok: pixPolicy.reason === "PIX_DINHEIRO_10" && debitPolicy.reason === "MANAGER_AUTH_REQUIRED_NON_CASH_METHOD",
    before: pixPolicy,
    after: debitPolicy
  };

  const mixedCashContext = buildSaleContext([
    { method: "pix", amount: 90 },
    { method: "dinheiro", amount: 90 }
  ], 20, 200, "SES_MIX_OK", "SAL_MIX_OK");
  results.mixedPixCash = {
    ok: !controlService.validateSaleControls({ saleContext: mixedCashContext, authorization: {} }, adminUser).discount_policy.requiresAuthorization
  };

  const mixedDebitContext = buildSaleContext([
    { method: "pix", amount: 90 },
    { method: "debito", amount: 90 }
  ], 20, 200, "SES_MIX_DEB", "SAL_MIX_DEB");
  results.mixedPixDebit = await expectThrows(() => controlService.validateSaleControls({ saleContext: mixedDebitContext, authorization: {} }, adminUser), "PIX ou Dinheiro");

  const approval = controlService.validateOperationAuthorization({
    authorizer_id: qaAuthorizer.authorizer.authorizer_id,
    code: validCode,
    operation_type: "DISCOUNT_ABOVE_LIMIT",
    sale_session_id: debitContext.saleSessionId,
    sale_id: debitContext.saleId,
    amount: 20,
    percent: 10,
    reason: "NEGOCIACAO",
    context: {
      loja: "vila_masc",
      payment_methods: ["debito"]
    }
  }, adminUser);
  const debitWithTotp = controlService.validateSaleControls({
    saleContext: debitContext,
    authorization: {
      discountAuthorizationId: approval.authorization_id
    }
  }, adminUser);
  results.debitWithTotp = {
    ok: debitWithTotp.discount_policy.requiresAuthorization,
    authorizationId: approval.authorization_id
  };

  const creditApproval = controlService.validateOperationAuthorization({
    authorizer_id: qaAuthorizer.authorizer.authorizer_id,
    code: generateTotpCode(qaAuthorizer.setup.manual_entry_key),
    operation_type: "DISCOUNT_ABOVE_LIMIT",
    sale_session_id: creditContext.saleSessionId,
    sale_id: creditContext.saleId,
    amount: 20,
    percent: 10,
    reason: "NEGOCIACAO CREDITO",
    context: {
      loja: "vila_masc",
      payment_methods: ["credito_ate_10x"]
    }
  }, adminUser);
  const creditWithTotp = controlService.validateSaleControls({
    saleContext: creditContext,
    authorization: {
      discountAuthorizationId: creditApproval.authorization_id
    }
  }, adminUser);
  results.creditWithTotp = {
    ok: creditWithTotp.discount_policy.requiresAuthorization,
    authorizationId: creditApproval.authorization_id
  };

  const linkApproval = controlService.validateOperationAuthorization({
    authorizer_id: qaAuthorizer.authorizer.authorizer_id,
    code: generateTotpCode(qaAuthorizer.setup.manual_entry_key),
    operation_type: "DISCOUNT_ABOVE_LIMIT",
    sale_session_id: linkContext.saleSessionId,
    sale_id: linkContext.saleId,
    amount: 20,
    percent: 10,
    reason: "NEGOCIACAO LINK",
    context: {
      loja: "vila_masc",
      payment_methods: ["link_pagamento"]
    }
  }, adminUser);
  const linkWithTotp = controlService.validateSaleControls({
    saleContext: linkContext,
    authorization: {
      discountAuthorizationId: linkApproval.authorization_id
    }
  }, adminUser);
  results.linkWithTotp = {
    ok: linkWithTotp.discount_policy.requiresAuthorization,
    authorizationId: linkApproval.authorization_id
  };

  const methodChangeApproval = controlService.validateOperationAuthorization({
    authorizer_id: qaAuthorizer.authorizer.authorizer_id,
    code: generateTotpCode(qaAuthorizer.setup.manual_entry_key),
    operation_type: "DISCOUNT_ABOVE_LIMIT",
    sale_session_id: "SES_METHOD_CHANGE",
    sale_id: "SAL_METHOD_CHANGE",
    amount: 20,
    percent: 10,
    reason: "NEGOCIACAO PIX",
    context: {
      loja: "vila_masc",
      payment_methods: ["pix"]
    }
  }, adminUser);
  results.authorizationInvalidIfMethodChanges = await expectThrows(() => controlService.validateSaleControls({
    saleContext: buildSaleContext([{ method: "debito", amount: 180 }], 20, 200, "SES_METHOD_CHANGE", "SAL_METHOD_CHANGE"),
    authorization: {
      discountAuthorizationId: methodChangeApproval.authorization_id
    }
  }, adminUser), (message) => message.includes("outra combinacao de pagamento") || message.includes("Autorizacao invalida"));

  results.invalidTotp = await expectThrows(() => controlService.validateOperationAuthorization({
    authorizer_id: qaAuthorizer.authorizer.authorizer_id,
    code: "000000",
    operation_type: "DISCOUNT_ABOVE_LIMIT",
    sale_session_id: "SES_INVALID",
    sale_id: "SAL_INVALID",
    amount: 20,
    percent: 10,
    reason: "NEGOCIACAO",
    context: {
      loja: "vila_masc",
      payment_methods: ["debito"]
    }
  }, adminUser), "Codigo invalido");

  results.reusedAuthorization = await expectThrows(() => controlService.validateSaleControls({
    saleContext: debitContext,
    authorization: {
      discountAuthorizationId: approval.authorization_id
    }
  }, adminUser), (message) => message.includes("Autorizacao ja utilizada") || message.includes("Autorizacao invalida"));

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
