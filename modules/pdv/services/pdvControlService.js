"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { run, get, all } = require("../../../db");
const { normalizeStoreKey, storesMatch, isActiveOperationalStore, isLegacyOperationalStore, getActiveOperationalStoreOptions } = require("../utils/pdvStoreUtils");

const controlRootDir = path.join(process.cwd(), "data", "pdv", "control");
const controlFiles = {
  cashRegisters: path.join(controlRootDir, "cash-registers.json"),
  authorizations: path.join(controlRootDir, "authorization-pins.json"),
  auditLogs: path.join(controlRootDir, "audit-logs.json"),
  authorizers: path.join(controlRootDir, "authorizers.json"),
  authorizationAudit: path.join(controlRootDir, "authorization-audit.json")
};
const salesFile = path.join(process.cwd(), "data", "pdv", "sales", "sales.json");

const USER_ROLES = {
  vendedor: "VENDEDOR",
  seller: "VENDEDOR",
  caixa: "CAIXA",
  cashier: "CAIXA",
  gerente: "GERENTE",
  manager: "GERENTE",
  admin: "ADMIN"
};

const AUTHORIZATION_TYPES = [
  "DISCOUNT_OVERRIDE",
  "SALE_CANCELLATION",
  "CASHBACK_ADJUSTMENT",
  "REOPEN_CASH_REGISTER",
  "REOPEN_SALE"
];

const AUTHORIZATION_OPERATION_TYPES = [
  "DISCOUNT_ABOVE_LIMIT",
  "ITEM_DISCOUNT_ABOVE_LIMIT",
  "SALE_DISCOUNT_ABOVE_LIMIT",
  "PERMUTA_AUTHORIZATION",
  "REGISTER_REOPEN",
  "SALE_CANCEL"
];

const CASH_MOVEMENT_TYPES = [
  "SALE",
  "SANGRIA",
  "SUPRIMENTO",
  "DESPESA",
  "AJUSTE",
  "EXCHANGE"
];

const CASH_REGISTER_STATUS = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
  REOPENED: "REOPENED",
  CANCELLED: "CANCELLED"
};
const CASH_COUNTABLE_SALE_STATUSES = new Set(["COMPLETED", "EXCHANGE"]);

const DISCOUNT_REASONS = [
  "QUEIMA",
  "CLIENTE_VIP",
  "PECA_PARADA",
  "DEFEITO",
  "NEGOCIACAO",
  "ACAO_GERENTE",
  "OUTRO"
];

const TOTP_ISSUER = "AEROSTORE OS";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const TOTP_DIGITS = 6;
const TOTP_SECRET_BYTES = 20;
const AUTHORIZATION_APPROVAL_TTL_MINUTES = 5;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const AUTOMATIC_DISCOUNT_ALLOWED_METHODS = new Set(["pix", "dinheiro"]);
const DISCOUNT_CONTEXT_IGNORED_METHODS = new Set([
  "cashback",
  "credito_troca",
  "credit_exchange",
  "exchange_credit",
  "vale_troca"
]);
const DISCOUNT_PAYMENT_METHOD_LABELS = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  debito: "Debito",
  debit: "Debito",
  cartao_debito: "Debito",
  credito: "Credito",
  credit: "Credito",
  cartao_credito: "Credito",
  credito_ate_10x: "Credito ate 10x",
  link_pagamento: "Link pagamento",
  vale_presente: "Vale-presente",
  credito_troca: "Credito troca",
  permuta: "Permuta"
};

function getSensitiveSecretSeed() {
  return String(
    process.env.PDV_TOTP_SECRET
    || process.env.AUTH_SECRET
    || process.env.APP_SECRET
    || process.env.CASHBACK_PIN_PEPPER
    || "aerostore-pdv-totp-local-secret"
  );
}

function getSensitiveCipherKey() {
  return crypto.createHash("sha256").update(getSensitiveSecretSeed()).digest();
}

function ensureControlDirs() {
  fs.mkdirSync(controlRootDir, { recursive: true });
  Object.values(controlFiles).forEach((filePath) => {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "[]", "utf8");
    }
  });
}

function readJson(filePath, fallback = []) {
  ensureControlDirs();
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureControlDirs();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(2));
}

function parseCashRegisterMoneyInput(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NaN;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return NaN;
  const sanitized = raw.replace(/[^\d,.-]/g, "");
  if (!/\d/.test(sanitized)) return NaN;
  const lastComma = sanitized.lastIndexOf(",");
  const lastDot = sanitized.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  let normalized = sanitized;
  if (decimalIndex >= 0) {
    const integerPart = sanitized.slice(0, decimalIndex).replace(/[.,]/g, "");
    const decimalPart = sanitized.slice(decimalIndex + 1).replace(/[.,]/g, "");
    normalized = `${integerPart || "0"}.${decimalPart}`;
  } else {
    normalized = sanitized.replace(/[.,]/g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseCashRegisterOpeningAmount(value) {
  return parseCashRegisterMoneyInput(value);
}

function safeJsonStringify(value = {}) {
  try {
    return JSON.stringify(value || {});
  } catch (error) {
    return "{}";
  }
}

function stableJsonStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashStableObject(value = {}) {
  return crypto.createHash("sha256").update(stableJsonStringify(value || {})).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(date, minutes) {
  const parsed = new Date(date);
  parsed.setMinutes(parsed.getMinutes() + minutes);
  return parsed.toISOString();
}

function buildId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeDiscountPaymentMethod(method = "") {
  const normalized = normalizeText(method || "").toLowerCase();
  if (!normalized) return "";
  if (["cash", "money"].includes(normalized)) return "dinheiro";
  if (["debit", "cartao_debito"].includes(normalized)) return "debito";
  if (["credit", "cartao_credito"].includes(normalized)) return "credito";
  if (["exchange_credit", "credit_exchange", "vale_troca"].includes(normalized)) return "credito_troca";
  return normalized;
}

function getDiscountPaymentMethodLabel(method = "") {
  const normalized = normalizeDiscountPaymentMethod(method);
  return DISCOUNT_PAYMENT_METHOD_LABELS[normalized] || formatMethodLabel(normalized);
}

function normalizeManualCashMovementType(type = "") {
  const normalized = normalizeText(type || "").toLowerCase();
  if (["aporte", "suprimento", "deposito", "deposit", "cash_in"].includes(normalized)) {
    return "aporte";
  }
  if (["sangria", "retirada", "withdrawal", "cash_out"].includes(normalized)) {
    return "sangria";
  }
  return "";
}

function mapManualCashMovementToRegisterType(type = "") {
  const normalized = normalizeManualCashMovementType(type);
  if (normalized === "aporte") return "SUPRIMENTO";
  if (normalized === "sangria") return "SANGRIA";
  return "";
}

function getManualCashMovementLabel(type = "") {
  const normalized = normalizeManualCashMovementType(type);
  if (normalized === "aporte") return "Aporte";
  if (normalized === "sangria") return "Sangria";
  return "Movimentacao";
}

function getEffectiveUserStore(user = {}, fallbackStore = "") {
  return normalizeStoreKey(
    fallbackStore
    || user.active_store_id
    || user.activeStoreId
    || user.active_store
    || user.store_id
    || user.store
    || ""
  );
}

function getCashMovementUser(user = {}) {
  return {
    id: user.id || user.user_id || null,
    email: normalizeText(user.email || user.login || ""),
    name: normalizeText(user.name || user.username || user.email || "sistema"),
    role: getPdvUserRole(user)
  };
}

function formatMethodLabel(method = "") {
  return normalizeText(method || "")
    .split("_")
    .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : "")
    .join(" ");
}

function uniqueStrings(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = normalizeText(value || "");
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function getDiscountRelevantPaymentMethods(paymentMethods = []) {
  return uniqueStrings((paymentMethods || []).map((item) => {
    if (typeof item === "string") {
      const method = normalizeDiscountPaymentMethod(item);
      return DISCOUNT_CONTEXT_IGNORED_METHODS.has(method) ? "" : method;
    }
    if (!item || typeof item !== "object") {
      return "";
    }
    const method = normalizeDiscountPaymentMethod(item.method || item.value || "");
    if (!method || DISCOUNT_CONTEXT_IGNORED_METHODS.has(method)) {
      return "";
    }
    if (Object.prototype.hasOwnProperty.call(item, "amount") && roundMoney(item.amount || 0) <= 0) {
      return "";
    }
    return method;
  }).filter(Boolean));
}

function isAutomaticDiscountAllowedPaymentMethod(method = "") {
  return AUTOMATIC_DISCOUNT_ALLOWED_METHODS.has(normalizeDiscountPaymentMethod(method));
}

function getDiscountPolicyForSale({
  paymentMethods = [],
  discountAmount = 0,
  discountPercent = 0,
  itemDiscountAmount = 0,
  discountBase = 0,
  subtotal = 0,
  cashbackUsed = 0,
  cashbackAmount = 0,
  cashbackApplied = 0,
  exchangeCredit = 0,
  exchangeCreditUsed = 0
} = {}) {
  const methods = getDiscountRelevantPaymentMethods(paymentMethods);
  const invalidMethods = methods.filter((method) => !isAutomaticDiscountAllowedPaymentMethod(method));
  const generalDiscountAmount = roundMoney(discountAmount || 0);
  const safeItemDiscountAmount = roundMoney(itemDiscountAmount || 0);
  const grossSubtotal = roundMoney(subtotal || 0);
  const safeCashbackUsed = roundMoney(cashbackUsed || cashbackAmount || cashbackApplied || 0);
  const safeExchangeCredit = roundMoney(exchangeCredit || exchangeCreditUsed || 0);
  const excessBalanceBeforeDiscount = roundMoney(Math.max(0, grossSubtotal - safeCashbackUsed - safeExchangeCredit));
  const policyBase = roundMoney(discountBase > 0 ? discountBase : grossSubtotal);
  const commercialDiscountTotal = roundMoney(safeItemDiscountAmount + generalDiscountAmount);
  const excessBalanceAfterDiscount = roundMoney(Math.max(0, excessBalanceBeforeDiscount - commercialDiscountTotal));
  const effectiveDiscountPercent = policyBase > 0
    ? Number(((commercialDiscountTotal / policyBase) * 100).toFixed(2))
    : Number(toNumber(discountPercent || 0).toFixed(2));
  const automaticLimitAmount = roundMoney((policyBase * 10) / 100);
  const hasDiscount = commercialDiscountTotal > 0 || effectiveDiscountPercent > 0;
  const hasGeneralDiscount = generalDiscountAmount > 0.009;
  const hasItemDiscount = safeItemDiscountAmount > 0.009;
  const eligiblePaymentTotal = roundMoney((paymentMethods || []).reduce((sum, item) => {
    const method = typeof item === "string" ? normalizeDiscountPaymentMethod(item) : normalizeDiscountPaymentMethod(item?.method || item?.value || "");
    if (!method || DISCOUNT_CONTEXT_IGNORED_METHODS.has(method) || !isAutomaticDiscountAllowedPaymentMethod(method)) {
      return sum;
    }
    return sum + roundMoney(typeof item === "string" ? 0 : item?.amount || 0);
  }, 0));
  const nonEligiblePaymentTotal = roundMoney((paymentMethods || []).reduce((sum, item) => {
    const method = typeof item === "string" ? normalizeDiscountPaymentMethod(item) : normalizeDiscountPaymentMethod(item?.method || item?.value || "");
    if (!method || DISCOUNT_CONTEXT_IGNORED_METHODS.has(method) || isAutomaticDiscountAllowedPaymentMethod(method)) {
      return sum;
    }
    return sum + roundMoney(typeof item === "string" ? 0 : item?.amount || 0);
  }, 0));
  const withinAutomaticPolicy = hasGeneralDiscount
    && methods.length > 0
    && !invalidMethods.length
    && effectiveDiscountPercent <= 10.001
    && commercialDiscountTotal <= automaticLimitAmount + 0.01
    && !hasItemDiscount;
  const invalidMethodsLabel = invalidMethods.map((method) => getDiscountPaymentMethodLabel(method)).join(" + ");

  if (!hasDiscount) {
    return {
      limitPercent: 10,
      reason: "NO_DISCOUNT",
      paymentMethods: methods,
      invalidMethods,
      invalidMethodsLabel,
      pendingPaymentMethod: false,
      requiresAuthorization: false,
      allowedWithoutAuthorization: true,
      message: "Sem desconto aplicado.",
      policyBase,
      cashbackUsed: safeCashbackUsed,
      exchangeCredit: safeExchangeCredit,
      excessBalanceBeforeDiscount,
      excessBalanceAfterDiscount,
      eligiblePaymentTotal,
      nonEligiblePaymentTotal,
      automaticLimitAmount,
      generalDiscountPercent: effectiveDiscountPercent,
      effectiveDiscountPercent,
      commercialDiscountTotal,
      generalWithinAutomaticPolicy: false,
      generalRequiresAuthorization: false,
      generalExceptionAmount: 0,
      authorizationAmount: 0,
      authorizationPercent: 0
    };
  }

  if (hasItemDiscount) {
    return {
      limitPercent: 10,
      reason: "ITEM_DISCOUNT_REQUIRES_AUTHORIZATION",
      paymentMethods: methods,
      invalidMethods,
      invalidMethodsLabel,
      pendingPaymentMethod: false,
      requiresAuthorization: true,
      allowedWithoutAuthorization: false,
      message: "Desconto direto no produto exige autorizacao gerencial.",
      policyBase,
      cashbackUsed: safeCashbackUsed,
      exchangeCredit: safeExchangeCredit,
      excessBalanceBeforeDiscount,
      excessBalanceAfterDiscount,
      eligiblePaymentTotal,
      nonEligiblePaymentTotal,
      automaticLimitAmount,
      generalDiscountPercent: effectiveDiscountPercent,
      effectiveDiscountPercent,
      commercialDiscountTotal,
      generalWithinAutomaticPolicy: false,
      generalRequiresAuthorization: true,
      generalExceptionAmount: safeItemDiscountAmount,
      authorizationAmount: commercialDiscountTotal,
      authorizationPercent: grossSubtotal > 0 ? Number(((commercialDiscountTotal / grossSubtotal) * 100).toFixed(2)) : effectiveDiscountPercent
    };
  }

  if (hasGeneralDiscount && policyBase <= 0) {
    return {
      limitPercent: 10,
      reason: "DISCOUNT_WITHOUT_EXCESS_BALANCE",
      paymentMethods: methods,
      invalidMethods,
      invalidMethodsLabel,
      pendingPaymentMethod: false,
      requiresAuthorization: true,
      allowedWithoutAuthorization: false,
      message: "Nao ha subtotal comercial para aplicar desconto geral automatico.",
      policyBase,
      cashbackUsed: safeCashbackUsed,
      exchangeCredit: safeExchangeCredit,
      excessBalanceBeforeDiscount,
      excessBalanceAfterDiscount,
      eligiblePaymentTotal,
      nonEligiblePaymentTotal,
      automaticLimitAmount,
      generalDiscountPercent: effectiveDiscountPercent,
      effectiveDiscountPercent,
      commercialDiscountTotal,
      generalWithinAutomaticPolicy: false,
      generalRequiresAuthorization: true,
      generalExceptionAmount: generalDiscountAmount,
      authorizationAmount: generalDiscountAmount,
      authorizationPercent: effectiveDiscountPercent
    };
  }

  if (hasGeneralDiscount && !methods.length) {
    return {
      limitPercent: 10,
      reason: "PENDING_PAYMENT_METHOD",
      paymentMethods: methods,
      invalidMethods,
      invalidMethodsLabel,
      pendingPaymentMethod: true,
      requiresAuthorization: false,
      allowedWithoutAuthorization: false,
      message: "Escolha a forma de pagamento para validar este desconto.",
      policyBase,
      cashbackUsed: safeCashbackUsed,
      exchangeCredit: safeExchangeCredit,
      excessBalanceBeforeDiscount,
      excessBalanceAfterDiscount,
      eligiblePaymentTotal,
      nonEligiblePaymentTotal,
      automaticLimitAmount,
      generalDiscountPercent: effectiveDiscountPercent,
      effectiveDiscountPercent,
      commercialDiscountTotal,
      generalWithinAutomaticPolicy: false,
      generalRequiresAuthorization: false,
      generalExceptionAmount: 0,
      authorizationAmount: 0,
      authorizationPercent: 0
    };
  }

  if (withinAutomaticPolicy) {
    return {
      limitPercent: 10,
      reason: "PIX_DINHEIRO_10",
      paymentMethods: methods,
      invalidMethods,
      invalidMethodsLabel,
      pendingPaymentMethod: false,
      requiresAuthorization: false,
      allowedWithoutAuthorization: true,
      message: "Desconto geral dentro da politica de 10% sobre saldo excedente em PIX/dinheiro.",
      policyBase,
      cashbackUsed: safeCashbackUsed,
      exchangeCredit: safeExchangeCredit,
      excessBalanceBeforeDiscount,
      excessBalanceAfterDiscount,
      eligiblePaymentTotal,
      nonEligiblePaymentTotal,
      automaticLimitAmount,
      generalDiscountPercent: effectiveDiscountPercent,
      effectiveDiscountPercent,
      commercialDiscountTotal,
      generalWithinAutomaticPolicy: true,
      generalRequiresAuthorization: false,
      generalExceptionAmount: 0,
      authorizationAmount: 0,
      authorizationPercent: 0
    };
  }

  return {
    limitPercent: 10,
    reason: invalidMethods.length ? "MANAGER_AUTH_REQUIRED_NON_CASH_METHOD" : "DISCOUNT_ABOVE_LIMIT",
    paymentMethods: methods,
    invalidMethods,
    invalidMethodsLabel,
    pendingPaymentMethod: false,
    requiresAuthorization: true,
    allowedWithoutAuthorization: false,
    message: invalidMethods.length
      ? "Desconto geral com esta forma de pagamento exige autorizacao gerencial."
      : "Desconto acima da politica de 10% sobre saldo excedente. Solicite autorizacao.",
    policyBase,
    cashbackUsed: safeCashbackUsed,
    exchangeCredit: safeExchangeCredit,
    excessBalanceBeforeDiscount,
    excessBalanceAfterDiscount,
    eligiblePaymentTotal,
    nonEligiblePaymentTotal,
    automaticLimitAmount,
    generalDiscountPercent: effectiveDiscountPercent,
    effectiveDiscountPercent,
    commercialDiscountTotal,
    generalWithinAutomaticPolicy: false,
    generalRequiresAuthorization: true,
    generalExceptionAmount: generalDiscountAmount,
    authorizationAmount: generalDiscountAmount,
    authorizationPercent: effectiveDiscountPercent
  };
}

function buildDiscountAuthorizationError(policy = {}) {
  if (policy.pendingPaymentMethod && !policy.requiresAuthorization) {
    return "Escolha a forma de pagamento para validar este desconto.";
  }
  if (policy.message) {
    return policy.message;
  }
  return "Autorizacao gerencial necessaria para desconto especial.";
}

function paymentMethodSetsMatch(left = [], right = []) {
  const normalizedLeft = getDiscountRelevantPaymentMethods(left).sort();
  const normalizedRight = getDiscountRelevantPaymentMethods(right).sort();
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function getPdvUserRole(user = {}) {
  const rawRole = String(user?.role || user?.perfil || "vendedor").trim().toLowerCase();
  return USER_ROLES[rawRole] || "VENDEDOR";
}

function getRolePriority(role) {
  if (role === "ADMIN") return 3;
  if (role === "GERENTE") return 2;
  return 1;
}

function requireMinimumRole(user, role) {
  const current = getPdvUserRole(user);
  if (getRolePriority(current) < getRolePriority(role)) {
    throw new Error(`Ação permitida apenas para ${role} ou superior.`);
  }
  return current;
}

function parseAllowedStores(value = [], fallbackStore = "") {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed || "[]");
    } catch (error) {
      parsed = parsed.split(",");
    }
  }
  const stores = (Array.isArray(parsed) ? parsed : [])
    .map((item) => normalizeStoreKey(item || ""))
    .filter(Boolean);
  const fallback = normalizeStoreKey(fallbackStore || "");
  return uniqueStrings([...stores, fallback].filter(Boolean));
}

function getActiveOperationalStoreIds() {
  return getActiveOperationalStoreOptions().map((item) => normalizeStoreKey(item.value || "")).filter(Boolean);
}

function parseUserPermissions(user = {}) {
  if (user?.permissions && typeof user.permissions === "object") return user.permissions;
  if (typeof user?.permissions_json === "string") {
    try {
      return JSON.parse(user.permissions_json || "{}") || {};
    } catch (error) {
      return {};
    }
  }
  if (user?.permissions_json && typeof user.permissions_json === "object") return user.permissions_json;
  return {};
}

function userHasGlobalStoreScope(user = {}) {
  const role = getPdvUserRole(user);
  const permissions = parseUserPermissions(user);
  return role === "ADMIN"
    || Boolean(permissions.can_view_all_stores)
    || parseAllowedStores(user.allowed_stores_json || user.allowed_stores || [], "")
      .some((storeId) => ["all_stores", "all", "*"].includes(normalizeText(storeId || "").toLowerCase()));
}

function normalizeAuthorizerRole(role = "") {
  const normalized = normalizeText(role || "").toUpperCase();
  if (["GESTOR", "GESTORA", "MANAGER"].includes(normalized)) return "GESTOR";
  if (["GERENTE"].includes(normalized)) return "GERENTE";
  return "AUTORIZADOR";
}

function getAuthorizerAllowedStores(authorizer = {}) {
  const rawStores = authorizer.allowed_stores_json ?? authorizer.allowed_stores ?? [];
  const rawStoreText = typeof rawStores === "string" ? rawStores : JSON.stringify(rawStores || []);
  if (["all_stores", "all", "*"].includes(normalizeText(rawStoreText || "").toLowerCase())) {
    return getActiveOperationalStoreIds();
  }
  const parsed = parseAllowedStores(rawStores, authorizer.store_id || authorizer.store || "");
  if (parsed.some((storeId) => ["all_stores", "all", "*"].includes(normalizeText(storeId || "").toLowerCase()))) {
    return getActiveOperationalStoreIds();
  }
  return parsed.filter((storeId) => isActiveOperationalStore(storeId) || isLegacyOperationalStore(storeId));
}

function authorizerCanAuthorizeStore(authorizer = {}, storeId = "") {
  const store = normalizeStoreKey(storeId || "");
  if (!store) return false;
  return getAuthorizerAllowedStores(authorizer).some((allowedStore) => storesMatch(allowedStore, store));
}

function userCanAuthorizeDiscountForStore(user = {}, storeId = "") {
  const role = getPdvUserRole(user);
  const store = normalizeStoreKey(storeId || "");
  if (!store) return false;
  if (role === "VENDEDOR" || role === "CAIXA") return false;
  if (role === "ADMIN") return isActiveOperationalStore(store) || isLegacyOperationalStore(store);
  if (role !== "GERENTE") return false;
  return parseAllowedStores(user.allowed_stores_json || user.allowed_stores || [], user.store_id || user.store)
    .some((allowedStore) => storesMatch(allowedStore, store));
}

function normalizeAuthorizerLookupValue(value = "") {
  return normalizeText(value || "").toLowerCase();
}

async function resolveAuthorizerLinkedUser(authorizer = {}) {
  const linkedUserId = normalizeText(authorizer.linked_user_id || "");
  const linkedEmail = normalizeAuthorizerLookupValue(authorizer.linked_user_email || "");
  const linkedName = normalizeAuthorizerLookupValue(authorizer.name || "");
  if (!linkedUserId && !linkedEmail && !linkedName) return null;
  return await get(
    `SELECT * FROM users
     WHERE (? <> '' AND CAST(id AS TEXT) = ?)
        OR (? <> '' AND lower(email) = ?)
        OR (? <> '' AND lower(username) = ?)
        OR (? <> '' AND lower(name) = ?)
     ORDER BY CASE
       WHEN ? <> '' AND CAST(id AS TEXT) = ? THEN 1
       WHEN ? <> '' AND lower(email) = ? THEN 2
       WHEN ? <> '' AND lower(username) = ? THEN 3
       ELSE 4
     END
     LIMIT 1`,
    [
      linkedUserId, linkedUserId,
      linkedEmail, linkedEmail,
      linkedName, linkedName,
      linkedName, linkedName,
      linkedUserId, linkedUserId,
      linkedEmail, linkedEmail,
      linkedName, linkedName
    ]
  );
}

function normalizeAuthorizationItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    id: normalizeText(item?.item_id || item?.id || item?.product_id || ""),
    sku: normalizeText(item?.sku || item?.codigo || item?.code || item?.codigo_etiqueta || ""),
    name: normalizeText(item?.nome || item?.name || item?.descricao || ""),
    quantity: roundMoney(item?.quantidade || item?.quantity || 0),
    unit_price: roundMoney(item?.preco_referencia || item?.unit_price || item?.price || item?.valor_unitario || 0),
    item_discount: roundMoney(item?.item_discount?.amount || item?.item_discount_amount || item?.discount_amount || 0)
  })).sort((left, right) =>
    left.sku.localeCompare(right.sku)
    || left.id.localeCompare(right.id)
    || left.name.localeCompare(right.name)
    || left.quantity - right.quantity
    || left.unit_price - right.unit_price
  );
}

function buildDiscountAuthorizationFingerprint(context = {}) {
  return hashStableObject(buildDiscountAuthorizationFingerprintPayload(context));
}

function buildDiscountAuthorizationFingerprintPayload(context = {}) {
  const subtotal = roundMoney(context.subtotal || 0);
  const itemDiscountAmount = roundMoney(context.itemDiscountAmount ?? context.item_discount_amount ?? 0);
  const generalDiscountAmount = roundMoney(context.generalDiscountAmount ?? context.general_discount_amount ?? context.extraDiscount ?? 0);
  const commercialDiscountTotal = roundMoney(context.commercialDiscountTotal ?? context.discount_amount ?? itemDiscountAmount + generalDiscountAmount);
  const providedCommercialPercent = context.commercialDiscountPercent ?? context.discount_percent;
  const commercialDiscountPercent = subtotal > 0
    ? Number(((commercialDiscountTotal / subtotal) * 100).toFixed(2))
    : (providedCommercialPercent !== undefined && providedCommercialPercent !== null && toNumber(providedCommercialPercent) > 0
      ? Number(toNumber(providedCommercialPercent).toFixed(2))
      : 0);
  return {
    loja: normalizeStoreKey(context.loja || context.store_id || ""),
    customer_id: normalizeText(context.customerId || context.customer_id || ""),
    subtotal,
    item_discount_amount: itemDiscountAmount,
    general_discount_amount: generalDiscountAmount,
    commercial_discount_total: commercialDiscountTotal,
    commercial_discount_percent: commercialDiscountPercent,
    payment_risk_methods: normalizeAuthorizationPaymentRiskMethods(context.paymentMethods || context.payment_methods || context.paymentAmounts || []),
    items: normalizeAuthorizationItems(context.items || [])
  };
}

function buildPermutaAuthorizationFingerprint(context = {}) {
  return hashStableObject(buildPermutaAuthorizationFingerprintPayload(context));
}

function buildPermutaAuthorizationFingerprintPayload(context = {}) {
  return {
    operation_type: "PERMUTA_AUTHORIZATION",
    reason: normalizeText(context.reason || "empresa").toLowerCase() || "empresa",
    loja: normalizeStoreKey(context.loja || context.store_id || ""),
    customer_id: normalizeText(context.customerId || context.customer_id || ""),
    seller: normalizeText(context.seller || context.sellerId || context.seller_id || ""),
    subtotal: roundMoney(context.subtotal || 0),
    item_discount_amount: roundMoney(context.itemDiscountAmount ?? context.item_discount_amount ?? 0),
    general_discount_amount: roundMoney(context.generalDiscountAmount ?? context.general_discount_amount ?? context.extraDiscount ?? 0),
    total_before_permuta: roundMoney(context.totalBeforePermuta ?? context.total_before_permuta ?? 0),
    permuta_amount: roundMoney(context.permutaAmount ?? context.permuta_amount ?? context.amount ?? 0),
    total_final: roundMoney(context.totalFinal ?? context.total_final ?? context.amountToPay ?? 0),
    paid_amount: roundMoney(context.paidAmount ?? context.paid_amount ?? 0),
    payment_methods: normalizeAuthorizationPaymentAmounts(context.paymentMethods || context.payment_methods || context.paymentAmounts || []),
    items: normalizeAuthorizationItems(context.items || [])
  };
}

function buildAuthorizationFingerprint(operationType = "", context = {}) {
  return hashStableObject(buildAuthorizationFingerprintPayload(operationType, context));
}

function buildAuthorizationFingerprintPayload(operationType = "", context = {}) {
  const normalizedOperationType = normalizeText(operationType || "").toUpperCase();
  if (normalizedOperationType === "PERMUTA_AUTHORIZATION") {
    return buildPermutaAuthorizationFingerprintPayload(context);
  }
  return buildDiscountAuthorizationFingerprintPayload(context);
}

function getAuthorizationPayloadDivergentFields(left = {}, right = {}) {
  const fields = new Set([
    ...Object.keys(left || {}),
    ...Object.keys(right || {})
  ]);
  return Array.from(fields).filter((field) =>
    JSON.stringify(left?.[field] ?? null) !== JSON.stringify(right?.[field] ?? null)
  );
}

function loadCashRegisters() {
  return readJson(controlFiles.cashRegisters, []);
}

function saveCashRegisters(rows) {
  writeJson(controlFiles.cashRegisters, rows);
}

function loadCashRegisterSales() {
  return readJson(salesFile, []);
}

function isCashCountableSaleStatus(status = "") {
  return CASH_COUNTABLE_SALE_STATUSES.has(normalizeText(status).toUpperCase());
}

// Read-model projection only; recovered movements are never persisted to cash-registers.json.
function buildCashRegisterSaleMovement(sale = {}) {
  const paymentTotals = (Array.isArray(sale.pagamentos) ? sale.pagamentos : []).reduce((totals, payment) => {
    const method = normalizeText(payment?.method || "").toLowerCase();
    const amount = roundMoney(payment?.amount || 0);
    if (method === "dinheiro") totals.money += amount;
    if (method === "pix") totals.pix += amount;
    if (["debito", "debit", "cartao_debito"].includes(method)) totals.debit += amount;
    if (["credito", "credit", "credito_ate_10x", "cartao_credito"].includes(method)) totals.credit += amount;
    if (method === "link_pagamento") totals.paymentLink += amount;
    return totals;
  }, {
    money: 0,
    pix: 0,
    debit: 0,
    credit: 0,
    paymentLink: 0
  });
  const saleId = normalizeText(sale.sale_id || "");
  return {
    movement_id: `SALE_LINK_${saleId}`,
    type: "SALE",
    value: roundMoney(sale.total_final ?? sale.net_amount ?? sale.paid_amount ?? 0),
    reason: "Venda vinculada ao caixa",
    observation: normalizeText(sale.observacoes || ""),
    responsible: normalizeText(sale.created_by || sale.vendedor || "sistema"),
    responsible_role: "",
    loja: normalizeStoreKey(sale.cash_register_store || sale.loja || sale.loja_venda || ""),
    created_at: normalizeText(sale.data_hora || sale.created_at || ""),
    payload: {
      sale_id: saleId,
      subtotal: roundMoney(sale.subtotal || 0),
      desconto_extra: roundMoney(sale.desconto_extra ?? sale.general_discount_amount ?? 0),
      money_amount: roundMoney(paymentTotals.money),
      pix_amount: roundMoney(paymentTotals.pix),
      debito_amount: roundMoney(paymentTotals.debit),
      credito_amount: roundMoney(paymentTotals.credit),
      link_pagamento_amount: roundMoney(paymentTotals.paymentLink),
      cashback_amount: roundMoney(sale.cashback_usado ?? sale.cashback_used_amount ?? 0),
      vale_presente_amount: roundMoney(sale.vale_presente_usado ?? 0),
      credito_troca_amount: roundMoney(sale.credito_troca_usado ?? 0),
      permuta_amount: roundMoney(sale.permuta_usada ?? 0),
      recovered_from_sale_link: true
    }
  };
}

function reconcileCashRegisterSales(register = {}, sales = loadCashRegisterSales()) {
  const cashRegisterId = normalizeText(register.cash_register_id || "");
  if (!cashRegisterId) {
    return register;
  }
  const normalizedSales = Array.isArray(sales) ? sales : [];
  const salesById = new Map(
    normalizedSales
      .map((sale) => [normalizeText(sale?.sale_id || ""), sale])
      .filter(([saleId]) => Boolean(saleId))
  );
  const movements = Array.isArray(register.movements) ? register.movements : [];
  const nonSaleMovements = movements.filter((movement) => normalizeText(movement?.type || "").toUpperCase() !== "SALE");
  const saleMovements = [];
  const linkedSaleIds = new Set();

  movements
    .filter((movement) => normalizeText(movement?.type || "").toUpperCase() === "SALE")
    .forEach((movement) => {
      const saleId = normalizeText(movement?.payload?.sale_id || "");
      const linkedSale = saleId ? salesById.get(saleId) : null;
      if (linkedSale && !isCashCountableSaleStatus(linkedSale.status)) {
        return;
      }
      if (saleId && linkedSaleIds.has(saleId)) {
        return;
      }
      if (saleId) {
        linkedSaleIds.add(saleId);
      }
      // Preserve legacy SALE movements when no sale record exists to invalidate them.
      saleMovements.push(movement);
    });

  normalizedSales
    .filter((sale) =>
      normalizeText(sale?.cash_register_id || "") === cashRegisterId
      && isCashCountableSaleStatus(sale?.status)
    )
    .forEach((sale) => {
      const saleId = normalizeText(sale?.sale_id || "");
      if (!saleId || linkedSaleIds.has(saleId)) {
        return;
      }
      linkedSaleIds.add(saleId);
      saleMovements.push(buildCashRegisterSaleMovement(sale));
    });

  saleMovements.sort((left, right) =>
    String(right?.created_at || "").localeCompare(String(left?.created_at || ""))
  );
  return {
    ...register,
    linked_sales: saleMovements.length,
    movements: [...saleMovements, ...nonSaleMovements]
  };
}

function loadAuthorizations() {
  return readJson(controlFiles.authorizations, []);
}

function saveAuthorizations(rows) {
  writeJson(controlFiles.authorizations, rows);
}

function loadAuditLogs() {
  return readJson(controlFiles.auditLogs, []);
}

function saveAuditLogs(rows) {
  writeJson(controlFiles.auditLogs, rows.slice(0, 10000));
}

function loadAuthorizers() {
  return readJson(controlFiles.authorizers, []);
}

function saveAuthorizers(rows) {
  writeJson(controlFiles.authorizers, rows);
}

function loadAuthorizationAudit() {
  return readJson(controlFiles.authorizationAudit, []);
}

function saveAuthorizationAudit(rows) {
  writeJson(controlFiles.authorizationAudit, rows.slice(0, 10000));
}

function appendAuditLog(entry) {
  const logs = loadAuditLogs();
  logs.unshift(entry);
  saveAuditLogs(logs);
}

function appendAuthorizationAudit(entry) {
  const rows = loadAuthorizationAudit();
  rows.unshift(entry);
  saveAuthorizationAudit(rows);
}

function encryptSensitiveValue(value = "") {
  const plaintext = String(value || "");
  if (!plaintext) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSensitiveCipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    value: encrypted.toString("base64")
  });
}

function decryptSensitiveValue(payload = "") {
  const raw = String(payload || "").trim();
  if (!raw) return "";
  const parsed = JSON.parse(raw);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getSensitiveCipherKey(),
    Buffer.from(String(parsed.iv || ""), "base64")
  );
  decipher.setAuthTag(Buffer.from(String(parsed.tag || ""), "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(String(parsed.value || ""), "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

function base32Encode(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(value = "") {
  const input = String(value || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let current = 0;
  const output = [];
  for (const char of input) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(TOTP_SECRET_BYTES));
}

function buildTotpCounter(counter = null) {
  const safeCounter = Number.isFinite(counter)
    ? Math.floor(counter)
    : Math.floor(Date.now() / (TOTP_PERIOD_SECONDS * 1000));
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(safeCounter));
  return buffer;
}

function generateTotpCode(secret = "", counter = null) {
  const key = base32Decode(secret);
  const hmac = crypto.createHmac("sha1", key).update(buildTotpCounter(counter)).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
}

function verifyTotpCode(secret = "", code = "", { window = TOTP_WINDOW } = {}) {
  const normalizedCode = normalizeText(code || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(normalizedCode)) {
    return { ok: false, counter: null };
  }
  const currentCounter = Math.floor(Date.now() / (TOTP_PERIOD_SECONDS * 1000));
  for (let delta = -window; delta <= window; delta += 1) {
    const counter = currentCounter + delta;
    const expected = generateTotpCode(secret, counter);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalizedCode))) {
      return { ok: true, counter };
    }
  }
  return { ok: false, counter: null };
}

function buildTotpUri({ secret = "", name = "" } = {}) {
  const label = `${TOTP_ISSUER} - ${normalizeText(name || "Autorizador")}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(TOTP_ISSUER)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

async function generateTotpSetupBundle(name = "") {
  const secret = generateTotpSecret();
  const otpAuthUrl = buildTotpUri({ secret, name });
  const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240
  });
  return {
    secret,
    otpAuthUrl,
    qrCodeDataUrl,
    manualEntryKey: secret
  };
}

function sanitizeAuthorizer(authorizer = {}) {
  const allowedStores = getAuthorizerAllowedStores(authorizer);
  return {
    authorizer_id: authorizer.authorizer_id,
    name: normalizeText(authorizer.name || ""),
    role: normalizeText(authorizer.role || ""),
    notes: normalizeText(authorizer.notes || ""),
    linked_user_email: normalizeText(authorizer.linked_user_email || ""),
    linked_user_id: normalizeText(authorizer.linked_user_id || ""),
    allowed_stores: allowedStores,
    allowed_stores_json: JSON.stringify(allowedStores),
    store_id: normalizeStoreKey(authorizer.store_id || authorizer.store || allowedStores[0] || ""),
    is_active: Boolean(authorizer.is_active),
    created_at: authorizer.created_at || "",
    activated_at: authorizer.activated_at || "",
    last_used_at: authorizer.last_used_at || "",
    created_by: normalizeText(authorizer.created_by || ""),
    deactivated_at: authorizer.deactivated_at || ""
  };
}

function listAuthorizers({ activeOnly = false } = {}) {
  return loadAuthorizers()
    .filter((item) => !activeOnly || item.is_active)
    .map(sanitizeAuthorizer)
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "pt-BR"));
}

async function createOrRefreshAuthorizer(payload = {}, user = {}) {
  requireMinimumRole(user, "GERENTE");
  const name = normalizeText(payload.name || "");
  if (!name) {
    throw new Error("Informe o nome do autorizador.");
  }
  const role = normalizeAuthorizerRole(payload.role || "AUTORIZADOR");
  const notes = normalizeText(payload.notes || "");
  const linkedUserEmail = normalizeText(payload.linked_user_email || payload.user_email || "");
  const linkedUserId = normalizeText(payload.linked_user_id || payload.user_id || "");
  const currentStore = normalizeStoreKey(payload.store_id || payload.current_store_id || payload.loja || user.active_store_id || user.store_id || user.store || "");
  const explicitAllowedStores = parseAllowedStores(payload.allowed_stores_json ?? payload.allowed_stores ?? [], "");
  const allowedStores = explicitAllowedStores.length
    ? explicitAllowedStores
    : (role === "GESTOR" && userHasGlobalStoreScope(user))
      ? getActiveOperationalStoreIds()
      : parseAllowedStores([], currentStore);
  if (!allowedStores.length) {
    throw new Error("Informe a loja permitida do autorizador.");
  }
  const authorizers = loadAuthorizers();
  const existing = authorizers.find((item) => normalizeText(item.name || "").toLowerCase() === name.toLowerCase());
  const setup = await generateTotpSetupBundle(name);
  const now = nowIso();
  const entry = existing || {
    authorizer_id: buildId("AUT"),
    created_at: now,
    created_by: user?.name || user?.email || "sistema"
  };
  entry.name = name;
  entry.role = role;
  entry.notes = notes;
  entry.linked_user_email = linkedUserEmail;
  entry.linked_user_id = linkedUserId;
  entry.allowed_stores_json = JSON.stringify(allowedStores);
  entry.allowed_stores = allowedStores;
  entry.store_id = allowedStores.length === 1 ? allowedStores[0] : currentStore;
  entry.totp_secret_encrypted = encryptSensitiveValue(setup.secret);
  entry.totp_algorithm = "SHA1";
  entry.totp_digits = TOTP_DIGITS;
  entry.totp_period = TOTP_PERIOD_SECONDS;
  entry.is_active = false;
  entry.activated_at = "";
  entry.deactivated_at = "";
  entry.updated_at = now;
  entry.last_used_at = entry.last_used_at || "";
  entry.last_approved_counter = null;
  if (!existing) {
    authorizers.unshift(entry);
  }
  saveAuthorizers(authorizers);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: existing ? "AUTHORIZER_RESET" : "AUTHORIZER_CREATED",
    created_at: now,
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: "",
    reason: notes,
    before: existing ? sanitizeAuthorizer(existing) : null,
    after: sanitizeAuthorizer(entry)
  });
  return {
    authorizer: sanitizeAuthorizer(entry),
    setup: {
      qr_code_data_url: setup.qrCodeDataUrl,
      otp_auth_url: setup.otpAuthUrl,
      manual_entry_key: setup.manualEntryKey
    }
  };
}

function verifyAuthorizerSetup(authorizerId = "", code = "", user = {}) {
  requireMinimumRole(user, "ADMIN");
  const authorizers = loadAuthorizers();
  const entry = authorizers.find((item) => item.authorizer_id === normalizeText(authorizerId || ""));
  if (!entry) {
    throw new Error("Autorizador nao encontrado.");
  }
  const secret = decryptSensitiveValue(entry.totp_secret_encrypted || "");
  const verification = verifyTotpCode(secret, code, { window: TOTP_WINDOW });
  if (!verification.ok) {
    throw new Error("Codigo invalido ou expirado.");
  }
  entry.is_active = true;
  entry.activated_at = nowIso();
  entry.updated_at = nowIso();
  saveAuthorizers(authorizers);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "AUTHORIZER_ACTIVATED",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: "",
    reason: "",
    before: null,
    after: sanitizeAuthorizer(entry)
  });
  return sanitizeAuthorizer(entry);
}

async function resetAuthorizerTotp(authorizerId = "", user = {}) {
  requireMinimumRole(user, "ADMIN");
  const authorizers = loadAuthorizers();
  const entry = authorizers.find((item) => item.authorizer_id === normalizeText(authorizerId || ""));
  if (!entry) {
    throw new Error("Autorizador nao encontrado.");
  }
  const setup = await generateTotpSetupBundle(entry.name || "Autorizador");
  entry.totp_secret_encrypted = encryptSensitiveValue(setup.secret);
  entry.is_active = false;
  entry.activated_at = "";
  entry.updated_at = nowIso();
  entry.last_approved_counter = null;
  saveAuthorizers(authorizers);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "AUTHORIZER_SECRET_RESET",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: "",
    reason: "",
    before: null,
    after: sanitizeAuthorizer(entry)
  });
  return {
    authorizer: sanitizeAuthorizer(entry),
    setup: {
      qr_code_data_url: setup.qrCodeDataUrl,
      otp_auth_url: setup.otpAuthUrl,
      manual_entry_key: setup.manualEntryKey
    }
  };
}

function setAuthorizerStatus(authorizerId = "", isActive = true, user = {}) {
  requireMinimumRole(user, "ADMIN");
  const authorizers = loadAuthorizers();
  const entry = authorizers.find((item) => item.authorizer_id === normalizeText(authorizerId || ""));
  if (!entry) {
    throw new Error("Autorizador nao encontrado.");
  }
  if (isActive && !entry.activated_at) {
    throw new Error("Ative o autorizador com o primeiro codigo antes de liberar uso.");
  }
  entry.is_active = Boolean(isActive);
  entry.updated_at = nowIso();
  entry.deactivated_at = entry.is_active ? "" : nowIso();
  saveAuthorizers(authorizers);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: entry.is_active ? "AUTHORIZER_ENABLED" : "AUTHORIZER_DISABLED",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: "",
    reason: "",
    before: null,
    after: sanitizeAuthorizer(entry)
  });
  return sanitizeAuthorizer(entry);
}

function getDiscountLimitForSale({
  paymentMethods = [],
  discountAmount = 0,
  discountPercent = 0,
  itemDiscountAmount = 0,
  discountBase = 0,
  subtotal = 0,
  cashbackUsed = 0,
  cashbackAmount = 0,
  cashbackApplied = 0,
  exchangeCredit = 0,
  exchangeCreditUsed = 0
} = {}) {
  return getDiscountPolicyForSale({
    paymentMethods,
    discountAmount,
    discountPercent,
    itemDiscountAmount,
    discountBase,
    subtotal,
    cashbackUsed,
    cashbackAmount,
    cashbackApplied,
    exchangeCredit,
    exchangeCreditUsed
  });
}

async function validateOperationAuthorization(payload = {}, user = {}) {
  const authorizerId = normalizeText(payload.authorizer_id || "");
  const operationType = normalizeText(payload.operation_type || "").toUpperCase();
  const reason = normalizeText(payload.reason || "");
  const saleSessionId = normalizeText(payload.sale_session_id || "");
  const saleId = normalizeText(payload.sale_id || "");
  const code = normalizeText(payload.code || "").replace(/\D/g, "");
  const amount = roundMoney(payload.amount || 0);
  const percent = Number(toNumber(payload.percent || 0).toFixed(2));
  const metadata = payload.context && typeof payload.context === "object" ? payload.context : {};
  const loja = normalizeStoreKey(payload.loja || metadata.loja || metadata.store_id || "");
  if (!AUTHORIZATION_OPERATION_TYPES.includes(operationType)) {
    throw new Error("Operacao sensivel invalida para autorizacao.");
  }
  if (!authorizerId) {
    throw new Error("Selecione um autorizador.");
  }
  if (!reason) {
    throw new Error("Informe o motivo da autorizacao.");
  }
  const authorizers = loadAuthorizers();
  const authorizer = authorizers.find((item) => item.authorizer_id === authorizerId);
  if (!authorizer || !authorizer.is_active) {
    throw new Error("Autorizador indisponivel para uso.");
  }
  const linkedUser = await resolveAuthorizerLinkedUser(authorizer);
  const hasAuthorizerStoreScope = authorizerCanAuthorizeStore(authorizer, loja);
  const hasLinkedUserStoreScope = linkedUser ? userCanAuthorizeDiscountForStore(linkedUser, loja) : false;
  if (!hasAuthorizerStoreScope && !hasLinkedUserStoreScope) {
    appendAuditLog({
      audit_id: buildId("AUD"),
      action: operationType === "PERMUTA_AUTHORIZATION" ? "PERMUTA_AUTH_STORE_SCOPE_DENIED" : "DISCOUNT_AUTH_STORE_SCOPE_DENIED",
      created_at: nowIso(),
      actor: normalizeText(user?.name || user?.email || "sistema"),
      actor_role: getPdvUserRole(user),
      loja,
      reason,
      before: null,
      after: {
        operation_type: operationType,
        authorizer_id: authorizer.authorizer_id,
        authorized_by_name: authorizer.name,
        linked_user_email: normalizeText(authorizer.linked_user_email || linkedUser?.email || ""),
        status: "DENIED_STORE_SCOPE"
      }
    });
    throw new Error("Autorizador sem permissao para esta loja. Configure as lojas permitidas do autorizador.");
  }
  const secret = decryptSensitiveValue(authorizer.totp_secret_encrypted || "");
  const verification = verifyTotpCode(secret, code, { window: TOTP_WINDOW });
  const authorizationFingerprint = buildAuthorizationFingerprint(operationType, {
    ...metadata,
    loja,
    subtotal: metadata.subtotal,
    itemDiscountAmount: metadata.item_discount_amount,
    generalDiscountAmount: metadata.general_discount_amount,
    commercialDiscountTotal: metadata.discount_amount,
    commercialDiscountPercent: metadata.discount_percent,
    totalBeforePermuta: metadata.total_before_permuta,
    permutaAmount: metadata.permuta_amount || amount,
    totalFinal: metadata.total_final,
    paidAmount: metadata.paid_amount,
    customerId: metadata.customer_id,
    seller: metadata.seller || metadata.seller_id,
    reason,
    paymentMethods: metadata.payment_methods || metadata.paymentMethods || [],
    items: metadata.items || []
  });
  const attempt = {
    authorization_id: buildId("AUTZ"),
    operation_type: operationType,
    sale_session_id: saleSessionId,
    sale_id: saleId,
    requested_by_user_id: normalizeText(user?.id || user?.user_id || ""),
    requested_by_name: normalizeText(user?.name || user?.email || "sistema"),
    authorized_by_id: authorizer.authorizer_id,
    authorized_by_name: authorizer.name,
    amount,
    percent,
    reason,
    status: verification.ok ? "APPROVED" : "INVALID",
    created_at: nowIso(),
    expires_at: addMinutes(nowIso(), AUTHORIZATION_APPROVAL_TTL_MINUTES),
    used_at: "",
    ip: normalizeText(payload.ip || ""),
    user_agent: normalizeText(payload.user_agent || ""),
    metadata_json: metadata,
    authorization_fingerprint: authorizationFingerprint,
    totp_counter: verification.counter
  };
  if (!verification.ok) {
    appendAuthorizationAudit(attempt);
    appendAuditLog({
      audit_id: buildId("AUD"),
      action: operationType === "PERMUTA_AUTHORIZATION" ? "PERMUTA_AUTH_INVALID" : "DISCOUNT_AUTH_INVALID",
      created_at: nowIso(),
      actor: attempt.requested_by_name,
      actor_role: getPdvUserRole(user),
      loja: normalizeStoreKey(payload.loja || metadata.loja || ""),
      reason,
      before: null,
      after: {
        operation_type: operationType,
        authorized_by_name: authorizer.name,
        status: "INVALID"
      }
    });
    throw new Error("Codigo invalido ou expirado.");
  }
  const reusedApproval = loadAuthorizationAudit().find((item) =>
    item.status === "APPROVED"
    && item.authorized_by_id === authorizer.authorizer_id
    && item.operation_type === operationType
    && item.sale_session_id === saleSessionId
    && Number(item.totp_counter || -1) === Number(verification.counter)
  );
  if (reusedApproval) {
    throw new Error("Esta autorizacao ja foi usada nesta operacao.");
  }
  authorizer.last_used_at = nowIso();
  authorizer.last_approved_counter = verification.counter;
  authorizer.updated_at = nowIso();
  saveAuthorizers(authorizers);
  appendAuthorizationAudit(attempt);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: operationType === "PERMUTA_AUTHORIZATION" ? "PERMUTA_AUTH_APPROVED" : "DISCOUNT_AUTH_APPROVED",
    created_at: nowIso(),
    actor: attempt.requested_by_name,
    actor_role: getPdvUserRole(user),
      loja: normalizeStoreKey(payload.loja || metadata.loja || ""),
    reason,
    before: null,
    after: {
      authorization_id: attempt.authorization_id,
      operation_type: operationType,
      authorized_by_name: authorizer.name,
      amount,
      percent,
      authorization_fingerprint: authorizationFingerprint,
      status: "APPROVED"
    }
  });
  return {
    authorization_id: attempt.authorization_id,
    status: attempt.status,
    authorized_by_id: attempt.authorized_by_id,
    authorized_by_name: attempt.authorized_by_name,
    operation_type: attempt.operation_type,
    reason: attempt.reason,
    amount: attempt.amount,
    percent: attempt.percent,
    authorization_fingerprint: authorizationFingerprint,
    created_at: attempt.created_at,
    expires_at: attempt.expires_at
  };
}

function compareAuthorizedNumber(actual = 0, expected = 0, label = "valor") {
  if (roundMoney(actual) !== roundMoney(expected)) {
    throw new Error(`Autorizacao emitida para outro ${label}.`);
  }
}

function normalizeAuthorizationPaymentAmounts(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((item) => ({
      method: normalizeDiscountPaymentMethod(item?.method || ""),
      amount: roundMoney(item?.amount || 0),
      installments: Math.max(1, Math.min(10, Math.round(toNumber(item?.installments || 1)))),
      installment_amount: roundMoney(item?.installment_amount || (toNumber(item?.amount || 0) / Math.max(1, Math.min(10, Math.round(toNumber(item?.installments || 1))))))
    }))
    .filter((item) => item.method && item.amount > 0)
    .sort((left, right) =>
      left.method.localeCompare(right.method)
      || left.amount - right.amount
      || left.installments - right.installments
    );
}

function normalizeAuthorizationPaymentRiskAmounts(values = []) {
  return normalizeAuthorizationPaymentAmounts(values)
    .filter((item) =>
      !DISCOUNT_CONTEXT_IGNORED_METHODS.has(item.method)
      && !isAutomaticDiscountAllowedPaymentMethod(item.method)
    );
}

function normalizeAuthorizationPaymentRiskMethods(values = []) {
  return normalizeAuthorizationPaymentRiskAmounts(values)
    .map((item) => ({
      method: item.method,
      installments: item.installments
    }))
    .sort((left, right) =>
      left.method.localeCompare(right.method)
      || left.installments - right.installments
    );
}

function paymentAmountSetsMatch(left = [], right = []) {
  const normalizedLeft = normalizeAuthorizationPaymentAmounts(left);
  const normalizedRight = normalizeAuthorizationPaymentAmounts(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((item, index) =>
    item.method === normalizedRight[index].method
    && Math.abs(item.amount - normalizedRight[index].amount) <= 0.01
    && Number(item.installments || 1) === Number(normalizedRight[index].installments || 1)
  );
}

function paymentRiskAmountSetsMatch(left = [], right = []) {
  const normalizedLeft = normalizeAuthorizationPaymentRiskAmounts(left);
  const normalizedRight = normalizeAuthorizationPaymentRiskAmounts(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((item, index) =>
    item.method === normalizedRight[index].method
    && Math.abs(item.amount - normalizedRight[index].amount) <= 0.01
    && Number(item.installments || 1) === Number(normalizedRight[index].installments || 1)
  );
}

function paymentRiskMethodSetsMatch(left = [], right = []) {
  const normalizedLeft = normalizeAuthorizationPaymentRiskMethods(left);
  const normalizedRight = normalizeAuthorizationPaymentRiskMethods(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((item, index) =>
    item.method === normalizedRight[index].method
    && Number(item.installments || 1) === Number(normalizedRight[index].installments || 1)
  );
}

function logAuthorizationFinalizeDenied({
  saleSessionId = "",
  saleId = "",
  authorizationIdReceived = "",
  authorizationTypeExpected = "",
  savedFingerprint = "",
  currentFingerprint = "",
  fingerprintMatch = false,
  paymentMethods = [],
  riskPaymentMethods = [],
  divergentFields = [],
  totalAPagar = 0,
  totalLancado = 0,
  discountTotal = 0,
  itemDiscountTotal = 0,
  generalDiscount = 0,
  reason = ""
} = {}) {
  const normalizedPayments = normalizeAuthorizationPaymentAmounts(paymentMethods).map((item) => ({
    method: item.method,
    amount: item.amount,
    installments: item.installments
  }));
  console.warn("[PDV][authorization] finalize denied", {
    saleSessionId: normalizeText(saleSessionId || ""),
    saleId: normalizeText(saleId || ""),
    authorizationIdReceived: normalizeText(authorizationIdReceived || ""),
    authorizationTypeExpected: normalizeText(authorizationTypeExpected || ""),
    savedFingerprint: normalizeText(savedFingerprint || ""),
    currentFingerprint: normalizeText(currentFingerprint || ""),
    fingerprintMatch: Boolean(fingerprintMatch),
    paymentMethods: normalizedPayments.map((item) => item.method),
    riskPaymentMethods: Array.isArray(riskPaymentMethods)
      ? riskPaymentMethods.map((item) => normalizeText(item?.method || item || "")).filter(Boolean)
      : [],
    divergentFields: Array.isArray(divergentFields) ? divergentFields.map((item) => normalizeText(item || "")).filter(Boolean) : [],
    installments: normalizedPayments.map((item) => ({ method: item.method, installments: item.installments })),
    totalAPagar: roundMoney(totalAPagar || 0),
    totalLancado: roundMoney(totalLancado || 0),
    discountTotal: roundMoney(discountTotal || 0),
    itemDiscountTotal: roundMoney(itemDiscountTotal || 0),
    generalDiscount: roundMoney(generalDiscount || 0),
    reason: normalizeText(reason || "")
  });
}

function validateValidatedAuthorization({
  authorizationId = "",
  operationType = "",
  saleSessionId = "",
  saleId = "",
  amount = 0,
  percent = 0,
  paymentMethods = [],
  paymentAmounts = [],
  items = [],
  loja = "",
  customerId = "",
  sellerId = "",
  itemDiscountAmount = 0,
  generalDiscountAmount = 0,
  exchangeCredit = 0,
  subtotal = 0,
  totalBeforePermuta = 0,
  permutaAmount = 0,
  cashbackApplied = 0,
  amountToPay = 0,
  paidAmount = 0
} = {}, user = {}, options = {}) {
  const shouldConsume = options?.consume !== false;
  const rows = loadAuthorizationAudit();
  const entry = rows.find((item) => item.authorization_id === normalizeText(authorizationId || ""));
  if (!entry) {
    throw new Error("Autorizacao nao encontrada.");
  }
  const normalizedOperationType = normalizeText(operationType || "").toUpperCase();
  const authorizationPaymentMethods = paymentAmounts.length ? paymentAmounts : paymentMethods;
  const expectedFingerprintContext = {
    loja,
    customerId,
    seller: sellerId,
    subtotal,
    itemDiscountAmount,
    generalDiscountAmount,
    commercialDiscountTotal: amount,
    commercialDiscountPercent: percent,
    totalBeforePermuta,
    permutaAmount: permutaAmount || amount,
    totalFinal: amountToPay,
    paidAmount,
    cashbackApplied,
    exchangeCredit,
    reason: entry.reason || "empresa",
    paymentMethods: authorizationPaymentMethods,
    items
  };
  const expectedFingerprint = buildAuthorizationFingerprint(normalizedOperationType, expectedFingerprintContext);
  const expectedFingerprintPayload = buildAuthorizationFingerprintPayload(normalizedOperationType, expectedFingerprintContext);
  const savedFingerprintPayload = entry.metadata_json && typeof entry.metadata_json === "object"
    ? buildAuthorizationFingerprintPayload(normalizedOperationType, {
      ...entry.metadata_json,
      loja: entry.metadata_json.loja || entry.metadata_json.store_id || loja,
      customerId: entry.metadata_json.customer_id || customerId,
      seller: entry.metadata_json.seller || entry.metadata_json.seller_id || sellerId,
      subtotal: entry.metadata_json.subtotal,
      itemDiscountAmount: entry.metadata_json.item_discount_amount,
      generalDiscountAmount: entry.metadata_json.general_discount_amount,
      commercialDiscountTotal: entry.metadata_json.discount_amount,
      commercialDiscountPercent: entry.metadata_json.discount_percent,
      totalBeforePermuta: entry.metadata_json.total_before_permuta,
      permutaAmount: entry.metadata_json.permuta_amount,
      totalFinal: entry.metadata_json.total_final,
      paidAmount: entry.metadata_json.paid_amount,
      paymentMethods: entry.metadata_json.payment_methods || entry.metadata_json.paymentMethods || [],
      items: entry.metadata_json.items || [],
      reason: entry.reason || entry.metadata_json.reason || "empresa"
    })
    : {};
  const divergentFields = getAuthorizationPayloadDivergentFields(savedFingerprintPayload, expectedFingerprintPayload);
  const riskPaymentMethods = normalizeAuthorizationPaymentRiskAmounts(authorizationPaymentMethods);
  if (entry.status !== "APPROVED") {
    logAuthorizationFinalizeDenied({
      saleSessionId,
      saleId,
      authorizationIdReceived: authorizationId,
      authorizationTypeExpected: normalizedOperationType,
      savedFingerprint: entry.authorization_fingerprint || entry.metadata_json?.authorization_fingerprint || "",
      currentFingerprint: expectedFingerprint,
      fingerprintMatch: false,
      paymentMethods: authorizationPaymentMethods,
      riskPaymentMethods,
      divergentFields,
      totalAPagar: amountToPay,
      totalLancado: paidAmount,
      discountTotal: amount,
      itemDiscountTotal: itemDiscountAmount,
      generalDiscount: generalDiscountAmount,
      reason: `status_${entry.status || "unknown"}`
    });
    throw new Error("Autorizacao invalida para concluir a operacao.");
  }
  if (entry.used_at) {
    throw new Error("Autorizacao ja utilizada.");
  }
  if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
    entry.status = "EXPIRED";
    saveAuthorizationAudit(rows);
    throw new Error("Autorizacao expirada. Gere uma nova aprovacao.");
  }
  if (normalizeText(operationType || "").toUpperCase() !== normalizeText(entry.operation_type || "").toUpperCase()) {
    throw new Error("Autorizacao emitida para outra operacao.");
  }
  if (normalizeText(saleSessionId || "") && normalizeText(entry.sale_session_id || "") !== normalizeText(saleSessionId || "")) {
    throw new Error("Autorizacao emitida para outra sessao de venda.");
  }
  if (normalizeText(saleId || "") && normalizeText(entry.sale_id || "") && normalizeText(entry.sale_id || "") !== normalizeText(saleId || "")) {
    throw new Error("Autorizacao emitida para outra venda.");
  }
  if (roundMoney(amount) > roundMoney(entry.amount || 0) + 0.01 || Number(percent || 0) > Number(entry.percent || 0) + 0.01) {
    throw new Error(normalizeText(operationType || "").toUpperCase() === "PERMUTA_AUTHORIZATION"
      ? "Autorizacao insuficiente para a permuta solicitada."
      : "Autorizacao insuficiente para o desconto solicitado.");
  }
  if (entry.metadata_json && Object.prototype.hasOwnProperty.call(entry.metadata_json, "subtotal")) {
    compareAuthorizedNumber(subtotal, entry.metadata_json.subtotal, "subtotal");
  }
  const approvedFingerprint = normalizeText(entry.authorization_fingerprint || entry.metadata_json?.authorization_fingerprint || "");
  if (approvedFingerprint && approvedFingerprint !== expectedFingerprint) {
    logAuthorizationFinalizeDenied({
      saleSessionId,
      saleId,
      authorizationIdReceived: authorizationId,
      authorizationTypeExpected: normalizedOperationType,
      savedFingerprint: approvedFingerprint,
      currentFingerprint: expectedFingerprint,
      fingerprintMatch: false,
      paymentMethods: authorizationPaymentMethods,
      riskPaymentMethods,
      divergentFields,
      totalAPagar: amountToPay,
      totalLancado: paidAmount,
      discountTotal: amount,
      itemDiscountTotal: itemDiscountAmount,
      generalDiscount: generalDiscountAmount,
      reason: "fingerprint_mismatch"
    });
    entry.status = "INVALIDATED";
    entry.invalidated_at = nowIso();
    entry.invalidated_reason = "SALE_CONTEXT_CHANGED";
    saveAuthorizationAudit(rows);
    appendAuditLog({
      audit_id: buildId("AUD"),
      action: normalizedOperationType === "PERMUTA_AUTHORIZATION" ? "PERMUTA_AUTH_INVALIDATED" : "DISCOUNT_AUTH_INVALIDATED",
      created_at: nowIso(),
      actor: normalizeText(user?.name || user?.email || "sistema"),
      actor_role: getPdvUserRole(user),
      loja: normalizeStoreKey(loja || entry.metadata_json?.loja || ""),
      reason: "Contexto comercial da venda mudou apos a autorizacao.",
      before: { authorization_id: entry.authorization_id, fingerprint: approvedFingerprint },
      after: { fingerprint: expectedFingerprint }
    });
    throw new Error(normalizedOperationType === "PERMUTA_AUTHORIZATION"
      ? "Alteracao na venda invalidou a autorizacao de permuta. Solicite autorizacao novamente."
      : "Alteracao na venda invalidou a autorizacao de desconto. Solicite autorizacao novamente.");
  }
  const paymentRiskMatches = normalizedOperationType === "PERMUTA_AUTHORIZATION"
    ? paymentRiskAmountSetsMatch(authorizationPaymentMethods, entry.metadata_json?.payment_methods || [])
    : paymentRiskMethodSetsMatch(authorizationPaymentMethods, entry.metadata_json?.payment_methods || []);
  if (entry.metadata_json?.payment_methods && !paymentRiskMatches) {
    logAuthorizationFinalizeDenied({
      saleSessionId,
      saleId,
      authorizationIdReceived: authorizationId,
      authorizationTypeExpected: normalizedOperationType,
      savedFingerprint: approvedFingerprint,
      currentFingerprint: expectedFingerprint,
      fingerprintMatch: true,
      paymentMethods: authorizationPaymentMethods,
      riskPaymentMethods,
      divergentFields,
      totalAPagar: amountToPay,
      totalLancado: paidAmount,
      discountTotal: amount,
      itemDiscountTotal: itemDiscountAmount,
      generalDiscount: generalDiscountAmount,
      reason: "payment_risk_methods_mismatch"
    });
    throw new Error("Autorizacao emitida para outra composicao de pagamentos de risco.");
  }
  if (shouldConsume) {
    entry.status = "CONSUMED";
    entry.used_at = nowIso();
    entry.used_by = normalizeText(user?.name || user?.email || "sistema");
    saveAuthorizationAudit(rows);
  }
  return entry;
}

function consumeValidatedAuthorization(payload = {}, user = {}) {
  return validateValidatedAuthorization(payload, user, { consume: true });
}

function assertValidatedAuthorization(payload = {}, user = {}) {
  return validateValidatedAuthorization(payload, user, { consume: false });
}

function getOpenCashRegisterByStore(store = "") {
  const normalizedStore = normalizeStoreKey(store);
  const register = loadCashRegisters().find((item) =>
    storesMatch(item.loja, normalizedStore)
    && [CASH_REGISTER_STATUS.OPEN, CASH_REGISTER_STATUS.REOPENED].includes(item.status)
  ) || null;
  return register ? reconcileCashRegisterSales(register) : null;
}

function getCashRegisterById(cashRegisterId = "") {
  const register = loadCashRegisters().find((item) => item.cash_register_id === String(cashRegisterId || "").trim()) || null;
  return register ? reconcileCashRegisterSales(register) : null;
}

function issueAuthorizationPin(payload = {}, user = {}) {
  const userRole = requireMinimumRole(user, "GERENTE");
  const type = normalizeText(payload.type || "").toUpperCase();
  if (!AUTHORIZATION_TYPES.includes(type)) {
    throw new Error("Tipo de autorização do PDV inválido.");
  }
  const authorizations = loadAuthorizations();
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const entry = {
    authorization_id: buildId("PIN"),
    code: pin,
    type,
    status: "ACTIVE",
    loja: normalizeStoreKey(payload.loja || ""),
    reason: normalizeText(payload.reason || ""),
    context: payload.context || {},
    issued_by: user?.name || user?.email || "sistema",
    issued_role: userRole,
    issued_at: nowIso(),
    expires_at: addMinutes(nowIso(), 5),
    used_at: "",
    used_by: ""
  };
  authorizations.unshift(entry);
  saveAuthorizations(authorizations);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "PIN_ISSUED",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: userRole,
    loja: entry.loja,
    reason: entry.reason,
    before: null,
    after: entry
  });
  return entry;
}

function validateAuthorizationPin({ code = "", type = "", loja = "", context = {} } = {}, user = {}) {
  const normalizedCode = normalizeText(code);
  const normalizedType = normalizeText(type).toUpperCase();
  if (!normalizedCode || !normalizedType) {
    throw new Error("Informe PIN e tipo de autorização do PDV.");
  }
  const authorizations = loadAuthorizations();
  const entry = authorizations.find((item) =>
    String(item.code || "") === normalizedCode
    && String(item.type || "") === normalizedType
    && item.status === "ACTIVE"
  );
  if (!entry) {
    throw new Error("PIN temporário inválido ou já utilizado.");
  }
  if (entry.loja && loja && normalizeStoreKey(entry.loja) !== normalizeStoreKey(loja)) {
    throw new Error("PIN temporário emitido para outra loja.");
  }
  if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
    entry.status = "EXPIRED";
    saveAuthorizations(authorizations);
    throw new Error("PIN temporário expirado.");
  }
  entry.status = "USED";
  entry.used_at = nowIso();
  entry.used_by = user?.name || user?.email || "sistema";
  entry.used_context = context || {};
  saveAuthorizations(authorizations);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "PIN_USED",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: entry.loja,
    reason: entry.reason,
    before: { status: "ACTIVE" },
    after: { ...entry }
  });
  return entry;
}

function openCashRegister(payload = {}, user = {}) {
  const role = getPdvUserRole(user);
  const loja = normalizeStoreKey(payload.loja || payload.store_id || "");
  if (!loja) {
    throw new Error("Informe a loja para abrir o caixa do PDV.");
  }
  if (!isActiveOperationalStore(loja)) {
    throw new Error("Selecione uma loja operacional ativa para abrir o caixa.");
  }
  const existingOpenRegister = getOpenCashRegisterByStore(loja);
  if (existingOpenRegister) {
    if (isLegacyOperationalStore(existingOpenRegister.loja)) {
      throw new Error("Este caixa pertence a uma loja legada/inativa. Use apenas para conferencia historica.");
    }
    return {
      ...existingOpenRegister,
      already_open: true,
      reused_existing: true
    };
  }
  const hasInitialAmount = payload.valor_inicial !== null
    && payload.valor_inicial !== undefined
    && String(payload.valor_inicial).trim() !== "";
  if (!hasInitialAmount) {
    throw new Error("Informe o saldo inicial para abrir o caixa.");
  }
  const parsedInitialAmount = parseCashRegisterOpeningAmount(payload.valor_inicial);
  if (!Number.isFinite(parsedInitialAmount)) {
    throw new Error("Informe um saldo inicial valido.");
  }
  const initialAmount = roundMoney(parsedInitialAmount);
  if (initialAmount < 0) {
    throw new Error("Saldo inicial não pode ser negativo.");
  }
  const cashRegisters = loadCashRegisters();
  const openedAt = nowIso();
  const openedBy = normalizeText(payload.operador || user?.name || user?.email || "sistema");
  const openingObservation = normalizeText(payload.observacao_abertura || payload.open_observation || payload.observacao || "");
  const entry = {
    cash_register_id: buildId("CX"),
    loja,
    operador: openedBy,
    operator_role: role,
    opened_by: openedBy,
    opened_by_role: role,
    status: CASH_REGISTER_STATUS.OPEN,
    valor_inicial: initialAmount,
    observacao: openingObservation,
    observacao_abertura: openingObservation,
    open_observation: openingObservation,
    criado_em: openedAt,
    aberto_em: openedAt,
    opened_at: openedAt,
    confirmado_em: "",
    reaberto_em: "",
    fechado_em: "",
    closed_by: "",
    reopen_reason: "",
    linked_sales: 0,
    movements: []
  };
  cashRegisters.unshift(entry);
  saveCashRegisters(cashRegisters);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "OPEN_CASH_REGISTER",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: role,
    loja,
    cash_register_id: entry.cash_register_id,
    valor_inicial: entry.valor_inicial,
    observacao_abertura: openingObservation,
    open_observation: openingObservation,
    status: entry.status,
    reason: entry.observacao,
    before: null,
    after: entry
  });
  return {
    ...entry,
    already_open: false,
    reused_existing: false
  };
}

function registerCashMovement({ cashRegisterId = "", type = "", value = 0, reason = "", observation = "", payload = {}, requireManager = false } = {}, user = {}) {
  const normalizedType = normalizeText(type).toUpperCase();
  if (!CASH_MOVEMENT_TYPES.includes(normalizedType)) {
    throw new Error("Tipo de movimentação de caixa do PDV inválido.");
  }
  if (normalizedType !== "SALE" && roundMoney(value) <= 0) {
    throw new Error("Movimentações operacionais do caixa exigem valor maior que zero.");
  }
  if (requireManager) {
    requireMinimumRole(user, "GERENTE");
  }
  const cashRegisters = loadCashRegisters();
  const register = cashRegisters.find((item) => item.cash_register_id === String(cashRegisterId || "").trim());
  if (!register) {
    throw new Error("Caixa do PDV não encontrado.");
  }
  if (register.status !== CASH_REGISTER_STATUS.OPEN && register.status !== CASH_REGISTER_STATUS.REOPENED) {
    const error = new Error("Caixa fechado. Abra o caixa antes de lançar movimentação.");
    error.statusCode = 409;
    error.code = "CASH_REGISTER_REQUIRED";
    throw error;
  }
  const movement = {
    movement_id: buildId("MOV"),
    type: normalizedType,
    value: roundMoney(value),
    reason: normalizeText(reason),
    observation: normalizeText(observation),
    responsible: user?.name || user?.email || "sistema",
    responsible_role: getPdvUserRole(user),
    loja: register.loja,
    created_at: nowIso(),
    payload
  };
  register.movements.unshift(movement);
  if (normalizedType === "SALE") {
    register.linked_sales += 1;
  }
  saveCashRegisters(cashRegisters);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: `CASH_MOVEMENT_${normalizedType}`,
    created_at: nowIso(),
    actor: movement.responsible,
    actor_role: movement.responsible_role,
    loja: register.loja,
    reason: movement.reason,
    before: null,
    after: movement
  });
  return movement;
}

function normalizeManualMovementFromRegister(movement = {}) {
  const registerType = normalizeText(movement.type || "").toUpperCase();
  const manualType = normalizeManualCashMovementType(movement.payload?.manual_type || movement.payload?.cash_movement_type || "");
  const type = manualType || (registerType === "SUPRIMENTO" ? "aporte" : registerType === "SANGRIA" ? "sangria" : "");
  if (!type) return null;
  return {
    id: movement.id || null,
    movement_id: normalizeText(movement.movement_id || ""),
    cash_register_id: normalizeText(movement.cash_register_id || movement.payload?.cash_register_id || ""),
    store_id: normalizeStoreKey(movement.store_id || movement.loja || ""),
    type,
    type_label: getManualCashMovementLabel(type),
    register_type: registerType,
    amount: roundMoney(movement.amount ?? movement.value ?? 0),
    reason: normalizeText(movement.reason || movement.observation || ""),
    user_id: movement.user_id || movement.payload?.user_id || null,
    user_email: normalizeText(movement.user_email || movement.payload?.user_email || ""),
    responsible: normalizeText(movement.responsible || movement.payload?.user_name || ""),
    created_at: normalizeText(movement.created_at || ""),
    metadata: movement.metadata || movement.payload || {}
  };
}

function listManualMovementsFromRegister(register = {}) {
  return (register.movements || [])
    .map((movement) => normalizeManualMovementFromRegister({
      ...movement,
      cash_register_id: register.cash_register_id,
      store_id: register.loja || register.store_id
    }))
    .filter(Boolean);
}

async function persistCashMovementRecord({ register = {}, movement = {}, type = "", amount = 0, reason = "", user = {} } = {}) {
  const actor = getCashMovementUser(user);
  await run(
    `INSERT INTO cash_movements (
      cash_register_id, store_id, type, amount, reason, user_id, user_email, created_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizeText(register.cash_register_id || ""),
      normalizeStoreKey(register.loja || register.store_id || ""),
      normalizeManualCashMovementType(type),
      roundMoney(amount),
      normalizeText(reason || movement.reason || movement.observation || ""),
      actor.id,
      actor.email,
      normalizeText(movement.created_at || nowIso()),
      safeJsonStringify({
        movement_id: movement.movement_id || "",
        register_type: movement.type || "",
        user_name: actor.name,
        user_role: actor.role,
        observation: movement.observation || "",
        payload: movement.payload || {}
      })
    ]
  );
}

async function listCashMovementsForRegister(cashRegisterId = "") {
  const normalizedId = normalizeText(cashRegisterId || "");
  if (!normalizedId) return [];
  const rows = await all(
    `SELECT id, cash_register_id, store_id, type, amount, reason, user_id, user_email, created_at, metadata_json
     FROM cash_movements
     WHERE cash_register_id = ?
     ORDER BY datetime(created_at) DESC, id DESC`,
    [normalizedId]
  ).catch(() => []);
  const dbRows = rows.map((row) => ({
    id: row.id,
    movement_id: "",
    cash_register_id: row.cash_register_id,
    store_id: row.store_id,
    type: normalizeManualCashMovementType(row.type),
    type_label: getManualCashMovementLabel(row.type),
    amount: roundMoney(row.amount),
    reason: normalizeText(row.reason || ""),
    user_id: row.user_id,
    user_email: normalizeText(row.user_email || ""),
    responsible: normalizeText(row.user_email || ""),
    created_at: normalizeText(row.created_at || ""),
    metadata: (() => {
      try {
        return JSON.parse(row.metadata_json || "{}");
      } catch (error) {
        return {};
      }
    })()
  }));
  if (dbRows.length) {
    return dbRows;
  }
  const register = getCashRegisterById(normalizedId);
  return listManualMovementsFromRegister(register || {});
}

async function registerManualCashMovement({ type = "", amount = 0, reason = "", observation = "", store_id = "", metadata = {} } = {}, user = {}) {
  const manualType = normalizeManualCashMovementType(type);
  const registerType = mapManualCashMovementToRegisterType(manualType);
  if (!manualType || !registerType) {
    throw new Error("Informe se a movimentacao e aporte ou sangria.");
  }
  const movementAmount = roundMoney(amount);
  if (movementAmount <= 0) {
    throw new Error("Informe um valor maior que zero para registrar a movimentacao.");
  }
  const storeId = getEffectiveUserStore(user, store_id);
  if (!storeId) {
    throw new Error("Selecione a loja ativa antes de registrar movimentacoes.");
  }
  const register = getOpenCashRegisterByStore(storeId);
  if (!register) {
    const error = new Error("Abra o caixa antes de registrar movimentacoes.");
    error.statusCode = 409;
    error.code = "CASH_REGISTER_REQUIRED";
    throw error;
  }
  const actor = getCashMovementUser(user);
  const expectedBefore = computeCashRegisterExpected(register);
  if (manualType === "sangria" && expectedBefore.dinheiro_esperado - movementAmount < -0.009 && !["ADMIN", "GERENTE"].includes(actor.role)) {
    const error = new Error("Sangria nao pode deixar o dinheiro esperado negativo sem autorizacao de gestor.");
    error.statusCode = 403;
    error.code = "NEGATIVE_EXPECTED_CASH_REQUIRES_MANAGER";
    throw error;
  }
  const movement = registerCashMovement({
    cashRegisterId: register.cash_register_id,
    type: registerType,
    value: movementAmount,
    reason: normalizeText(reason || getManualCashMovementLabel(manualType)),
    observation,
    payload: {
      ...metadata,
      manual_type: manualType,
      cash_movement_type: manualType,
      cash_register_id: register.cash_register_id,
      user_id: actor.id,
      user_email: actor.email,
      user_name: actor.name
    }
  }, user);
  const updatedRegister = getCashRegisterById(register.cash_register_id) || register;
  await persistCashMovementRecord({
    register: updatedRegister,
    movement,
    type: manualType,
    amount: movementAmount,
    reason,
    user
  });
  const movements = await listCashMovementsForRegister(updatedRegister.cash_register_id);
  return {
    movement: normalizeManualMovementFromRegister({
      ...movement,
      cash_register_id: updatedRegister.cash_register_id,
      store_id: updatedRegister.loja || updatedRegister.store_id
    }),
    cash_register: updatedRegister,
    expected: computeCashRegisterExpected(updatedRegister),
    movements
  };
}

function computeCashRegisterExpected(register) {
  const reconciledRegister = reconcileCashRegisterSales(register || {});
  const movements = reconciledRegister.movements || [];
  const saleMovements = movements.filter((item) => item.type === "SALE");
  const sumByType = (type) => roundMoney(movements.filter((item) => item.type === type).reduce((sum, item) => sum + toNumber(item.value), 0));
  const saleMoney = roundMoney(saleMovements.reduce((sum, item) => sum + toNumber(item.payload?.money_amount || 0), 0));
  const pixTotal = roundMoney(saleMovements.reduce((sum, item) => sum + toNumber(item.payload?.pix_amount || 0), 0));
  const debitTotal = roundMoney(saleMovements.reduce((sum, item) => sum + toNumber(item.payload?.debito_amount || 0), 0));
  const creditTotal = roundMoney(saleMovements.reduce((sum, item) => sum + toNumber(item.payload?.credito_amount || 0), 0));
  const suprimentos = sumByType("SUPRIMENTO");
  const sangrias = sumByType("SANGRIA");
  const despesas = sumByType("DESPESA");
  const ajustes = sumByType("AJUSTE");
  const expectedCash = roundMoney(toNumber(register.valor_inicial) + saleMoney + suprimentos - sangrias - despesas + ajustes);
  const countedCash = register.close_summary?.dinheiro_informado ?? register.close_summary?.counted_cash_amount ?? null;
  return {
    dinheiro_esperado: expectedCash,
    dinheiro_vendas: saleMoney,
    pix: pixTotal,
    pix_total: pixTotal,
    pix_count: saleMovements.filter((item) => toNumber(item.payload?.pix_amount || 0) > 0).length,
    debito: debitTotal,
    debit_total: debitTotal,
    debito_count: saleMovements.filter((item) => toNumber(item.payload?.debito_amount || 0) > 0).length,
    debit_count: saleMovements.filter((item) => toNumber(item.payload?.debito_amount || 0) > 0).length,
    credito: creditTotal,
    credit_total: creditTotal,
    credito_count: saleMovements.filter((item) => toNumber(item.payload?.credito_amount || 0) > 0).length,
    credit_count: saleMovements.filter((item) => toNumber(item.payload?.credito_amount || 0) > 0).length,
    link_pagamento: roundMoney(saleMovements.reduce((sum, item) => sum + toNumber(item.payload?.link_pagamento_amount || 0), 0)),
    cashback_usado: roundMoney(saleMovements.reduce((sum, item) => sum + toNumber(item.payload?.cashback_amount || 0), 0)),
    vale_presente_usado: roundMoney(saleMovements.reduce((sum, item) => sum + toNumber(item.payload?.vale_presente_amount || 0), 0)),
    permuta: roundMoney(saleMovements.reduce((sum, item) => sum + toNumber(item.payload?.permuta_amount || 0), 0)),
    credito_troca: roundMoney(saleMovements.reduce((sum, item) => sum + toNumber(item.payload?.credito_troca_amount || 0), 0)),
    descontos: roundMoney(saleMovements.reduce((sum, item) => sum + toNumber(item.payload?.desconto_extra || 0), 0)),
    sangrias,
    suprimentos,
    aportes: suprimentos,
    despesas,
    ajustes,
    exchanges: sumByType("EXCHANGE"),
    cash_in_sales_total: saleMoney,
    cash_deposits_total: suprimentos,
    aportes_total: suprimentos,
    cash_withdrawals_total: sangrias,
    sangrias_total: sangrias,
    expected_cash_amount: expectedCash,
    counted_cash_amount: countedCash === null || countedCash === undefined ? null : roundMoney(countedCash),
    cash_difference: countedCash === null || countedCash === undefined ? null : roundMoney(toNumber(countedCash) - expectedCash)
  };
}

function getCashRegisterDifferenceFlag(difference = 0) {
  const absDifference = Math.abs(roundMoney(difference));
  if (absDifference < 0.009) return "OK";
  if (absDifference < 20) return "MINOR";
  if (absDifference < 100) return "RELEVANT";
  return "CRITICAL";
}

function buildCashRegisterTicketSummary(expected = {}) {
  return {
    pix_total: roundMoney(expected.pix_total ?? expected.pix ?? 0),
    pix_count: Math.max(0, Math.round(toNumber(expected.pix_count || 0))),
    debit_total: roundMoney(expected.debit_total ?? expected.debito ?? 0),
    debit_count: Math.max(0, Math.round(toNumber(expected.debit_count ?? expected.debito_count ?? 0))),
    credit_total: roundMoney(expected.credit_total ?? expected.credito ?? 0),
    credit_count: Math.max(0, Math.round(toNumber(expected.credit_count ?? expected.credito_count ?? 0)))
  };
}

function closeCashRegister({
  cashRegisterId = "",
  dinheiro_informado = 0,
  observacao = "",
  diferenca_categoria = "",
  diferenca_justificativa = "",
  tickets_conferidos = null,
  tickets_pix_conferi = false,
  tickets_debito_conferi = false,
  tickets_credito_conferi = false
} = {}, user = {}) {
  const cashRegisters = loadCashRegisters();
  const register = cashRegisters.find((item) => item.cash_register_id === String(cashRegisterId || "").trim());
  if (!register) {
    throw new Error("Caixa do PDV não encontrado.");
  }
  if (register.status !== CASH_REGISTER_STATUS.OPEN && register.status !== CASH_REGISTER_STATUS.REOPENED) {
    const error = new Error("Caixa fechado. Abra o caixa da loja antes de fechar caixa.");
    error.statusCode = 409;
    error.code = "CASH_REGISTER_REQUIRED";
    throw error;
  }
  const expected = computeCashRegisterExpected(register);
  const hasCountedCash = dinheiro_informado !== null
    && dinheiro_informado !== undefined
    && String(dinheiro_informado).trim() !== "";
  if (!hasCountedCash) {
    throw new Error("Informe o dinheiro contado para fechar o caixa.");
  }
  const parsedCountedCash = parseCashRegisterMoneyInput(dinheiro_informado);
  if (!Number.isFinite(parsedCountedCash)) {
    throw new Error("Informe um valor contado valido para fechar o caixa.");
  }
  const countedCash = roundMoney(parsedCountedCash);
  if (countedCash < 0) {
    throw new Error("Dinheiro contado nao pode ser negativo.");
  }
  const difference = roundMoney(countedCash - expected.dinheiro_esperado);
  const absDifference = Math.abs(difference);
  const differenceFlag = getCashRegisterDifferenceFlag(difference);
  const requiresManagerReview = absDifference >= 100;
  const ticketSummary = buildCashRegisterTicketSummary(expected);
  const checkedTickets = {
    pix: Boolean(tickets_conferidos?.pix ?? tickets_pix_conferi),
    debit: Boolean(tickets_conferidos?.debit ?? tickets_conferidos?.debito ?? tickets_debito_conferi),
    credit: Boolean(tickets_conferidos?.credit ?? tickets_conferidos?.credito ?? tickets_credito_conferi)
  };

  // Validate difference handling
  if (absDifference >= 20 && !diferenca_categoria) {
    throw new Error("Categoria é obrigatória para diferenças >= R$ 20.");
  }
  if (absDifference >= 20 && (!diferenca_justificativa || String(diferenca_justificativa || "").trim().length < 20)) {
    throw new Error("Justificativa é obrigatória e deve ter no mínimo 20 caracteres para diferenças >= R$ 20.");
  }
  if (difference !== 0 && absDifference < 20 && !observacao) {
    throw new Error("Observação é obrigatória para pequenas diferenças (< R$ 20).");
  }

  if (ticketSummary.pix_total > 0 && !checkedTickets.pix) {
    throw new Error("Confira os tickets PIX antes de fechar o caixa.");
  }
  if (ticketSummary.debit_total > 0 && !checkedTickets.debit) {
    throw new Error("Confira os tickets de debito antes de fechar o caixa.");
  }
  if (ticketSummary.credit_total > 0 && !checkedTickets.credit) {
    throw new Error("Confira os tickets de credito antes de fechar o caixa.");
  }

  register.status = CASH_REGISTER_STATUS.CLOSED;
  register.fechado_em = nowIso();
  register.closed_by = user?.name || user?.email || "sistema";
  register.close_observation = normalizeText(observacao);
  register.close_summary = {
    ...expected,
    dinheiro_informado: countedCash,
    diferenca_final: difference,
    diferenca_percentual: expected.dinheiro_esperado > 0 ? Number((Math.abs(difference) / expected.dinheiro_esperado * 100).toFixed(2)) : 0,
    diferenca_categoria: normalizeText(diferenca_categoria || ""),
    diferenca_justificativa: normalizeText(diferenca_justificativa || ""),
    difference_flag: differenceFlag,
    requires_manager_review: requiresManagerReview,
    tem_diferenca_significativa: absDifference >= 20,
    tem_diferenca_critica: requiresManagerReview,
    tickets_pix_conferi: checkedTickets.pix,
    tickets_debito_conferi: checkedTickets.debit,
    tickets_credito_conferi: checkedTickets.credit,
    tickets_conferidos: checkedTickets,
    ticket_summary: ticketSummary
  };
  saveCashRegisters(cashRegisters);

  // Log large differences as warnings
  if (absDifference >= 20) {
    console.warn(`[CASH_REGISTER_CLOSE] Large difference detected: R$ ${difference.toFixed(2)} (${register.close_summary.diferenca_percentual.toFixed(2)}%) - Category: ${diferenca_categoria}`);
  }

  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "CLOSE_CASH_REGISTER",
    created_at: nowIso(),
    actor: register.closed_by,
    actor_role: getPdvUserRole(user),
    loja: register.loja,
    reason: register.close_observation,
    difference_amount: difference,
    difference_category: diferenca_categoria || "",
    difference_comment: diferenca_justificativa || "",
    difference_flag: differenceFlag,
    requires_manager_review: requiresManagerReview,
    tickets_conferidos: checkedTickets,
    ticket_summary: ticketSummary,
    before: { status: "OPEN" },
    after: register.close_summary
  });
  return register;
}

function reopenCashRegister({ cashRegisterId = "", reason = "", pin = "" } = {}, user = {}) {
  requireMinimumRole(user, "GERENTE");
  const cashRegisters = loadCashRegisters();
  const register = cashRegisters.find((item) => item.cash_register_id === String(cashRegisterId || "").trim());
  if (!register) {
    throw new Error("Caixa do PDV não encontrado.");
  }
  validateAuthorizationPin({
    code: pin,
    type: "REOPEN_CASH_REGISTER",
    loja: register.loja,
    context: {
      action: "REOPEN_CASH_REGISTER",
      cash_register_id: register.cash_register_id,
      reason: normalizeText(reason)
    }
  }, user);
  register.status = CASH_REGISTER_STATUS.REOPENED;
  register.reaberto_em = nowIso();
  register.reopen_reason = normalizeText(reason);
  saveCashRegisters(cashRegisters);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "REOPEN_CASH_REGISTER",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: register.loja,
    reason: register.reopen_reason,
    before: { status: "CLOSED" },
    after: { status: "REOPENED" }
  });
  return register;
}

function validateSaleControlsLegacyUnused({ saleContext = {}, authorization = {} } = {}, user = {}) {
  const subtotal = roundMoney(saleContext.subtotal || 0);
  const extraDiscount = roundMoney(saleContext.extraDiscount || 0);
  const itemDiscountAmount = roundMoney(saleContext.itemDiscountAmount || 0);
  const items = saleContext.items || [];
  const permutaAmount = roundMoney(saleContext.permutaAmount || 0);
  const loja = normalizeStoreKey(saleContext.loja || "");
  const saleId = normalizeText(saleContext.saleId || "");
  const discountPercent = subtotal > 0 ? Number(((extraDiscount / subtotal) * 100).toFixed(2)) : 0;
  const discountLimit = getDiscountLimitForSale({ subtotal, items });

  if (discountPercent > discountLimit) {
    if (!authorization.pin || !authorization.reason) {
      throw new Error(`Desconto acima de ${discountLimit}% exige PIN temporário e motivo obrigatório.`);
    }
    if (!DISCOUNT_REASONS.includes(normalizeText(authorization.reason).toUpperCase())) {
      throw new Error("Motivo de desconto acima do limite inválido.");
    }
    validateAuthorizationPin({
      code: authorization.pin,
      type: "DISCOUNT_OVERRIDE",
      loja,
      context: {
        action: "DISCOUNT_OVERRIDE",
        sale_id: saleId,
        discount_percent: discountPercent,
        discount_limit: discountLimit,
        reason: normalizeText(authorization.reason).toUpperCase()
      }
    }, user);
  }

  if (permutaAmount > 0) {
    throw new Error("Permuta exige autorização válida.");
  }

  return {
    discount_limit: discountLimit,
    discount_percent: discountPercent
  };
}

function validateSaleControls({ saleContext = {}, authorization = {} } = {}, user = {}) {
  const subtotal = roundMoney(saleContext.subtotal || 0);
  const extraDiscount = roundMoney(saleContext.extraDiscount || 0);
  const itemDiscountAmount = roundMoney(saleContext.itemDiscountAmount || 0);
  const permutaAmount = roundMoney(saleContext.permutaAmount || 0);
  const loja = normalizeStoreKey(saleContext.loja || "");
  const saleId = normalizeText(saleContext.saleId || "");
  const saleSessionId = normalizeText(saleContext.saleSessionId || "");
  const discountBase = roundMoney(saleContext.discountBase || 0);
  const commercialDiscountTotal = roundMoney(itemDiscountAmount + extraDiscount);
  const discountPercent = discountBase > 0
    ? Number(((commercialDiscountTotal / discountBase) * 100).toFixed(2))
    : (saleContext.discountPercent !== undefined && saleContext.discountPercent !== null && toNumber(saleContext.discountPercent) > 0
      ? Number(toNumber(saleContext.discountPercent).toFixed(2))
      : 0);
  const discountPolicy = getDiscountLimitForSale({
    subtotal,
    items: saleContext.items || [],
    paymentMethods: saleContext.paymentMethods || [],
    discountAmount: extraDiscount,
    discountPercent,
    itemDiscountAmount,
    discountBase,
    cashbackUsed: saleContext.cashbackUsed || saleContext.cashbackApplied || 0,
    exchangeCredit: saleContext.exchangeCredit || 0
  });
  const discountLimit = Number(toNumber(discountPolicy.limitPercent || 10).toFixed(2));

  if (discountPolicy.pendingPaymentMethod && extraDiscount > 0) {
    throw new Error(buildDiscountAuthorizationError(discountPolicy));
  }

  const pendingAuthorizations = [];
  if (discountPolicy.requiresAuthorization) {
    if (!authorization.discountAuthorizationId) {
      throw new Error(buildDiscountAuthorizationError(discountPolicy));
    }
    const currentDiscountAuthorizationContext = {
      paymentMethods: saleContext.paymentMethods || [],
      paymentAmounts: saleContext.paymentMethods || [],
      items: saleContext.items || [],
      loja,
      customerId: saleContext.customerId || "",
      itemDiscountAmount,
      generalDiscountAmount: extraDiscount,
      exchangeCredit: saleContext.exchangeCredit || 0,
      subtotal,
      cashbackApplied: saleContext.cashbackUsed || 0,
      amountToPay: saleContext.totalFinal || 0,
      paidAmount: saleContext.paidAmount || 0
    };
    const savedDiscountAuthorizationContext = saleContext.discountAuthorizationContext && typeof saleContext.discountAuthorizationContext === "object"
      ? saleContext.discountAuthorizationContext
      : null;
    if (savedDiscountAuthorizationContext) {
      const savedPayload = buildDiscountAuthorizationFingerprintPayload(savedDiscountAuthorizationContext);
      const currentPayload = buildDiscountAuthorizationFingerprintPayload(currentDiscountAuthorizationContext);
      const divergentFields = getAuthorizationPayloadDivergentFields(savedPayload, currentPayload);
      if (divergentFields.length) {
        logAuthorizationFinalizeDenied({
          saleSessionId,
          saleId,
          authorizationIdReceived: authorization.discountAuthorizationId,
          authorizationTypeExpected: "DISCOUNT_ABOVE_LIMIT",
          savedFingerprint: buildDiscountAuthorizationFingerprint(savedDiscountAuthorizationContext),
          currentFingerprint: buildDiscountAuthorizationFingerprint(currentDiscountAuthorizationContext),
          fingerprintMatch: false,
          paymentMethods: saleContext.paymentMethods || [],
          riskPaymentMethods: normalizeAuthorizationPaymentRiskAmounts(saleContext.paymentMethods || []),
          divergentFields,
          totalAPagar: saleContext.totalFinal || 0,
          totalLancado: saleContext.paidAmount || 0,
          discountTotal: itemDiscountAmount + extraDiscount,
          itemDiscountTotal: itemDiscountAmount,
          generalDiscount: extraDiscount,
          reason: "sale_context_changed_after_discount_authorization"
        });
        throw new Error("A venda foi alterada depois da solicitacao de autorizacao. Solicite uma nova autorizacao.");
      }
    }
    const validatedDiscountAuthorizationContext = savedDiscountAuthorizationContext || currentDiscountAuthorizationContext;
    const discountAuthorizationPayload = {
      authorizationId: authorization.discountAuthorizationId,
      operationType: "DISCOUNT_ABOVE_LIMIT",
      saleSessionId,
      saleId,
      amount: discountPolicy.authorizationAmount || (itemDiscountAmount + extraDiscount),
      percent: discountPolicy.authorizationPercent || discountPercent,
      paymentMethods: validatedDiscountAuthorizationContext.payment_methods || validatedDiscountAuthorizationContext.paymentMethods || saleContext.paymentMethods || [],
      paymentAmounts: validatedDiscountAuthorizationContext.payment_methods || validatedDiscountAuthorizationContext.paymentMethods || saleContext.paymentMethods || [],
      items: validatedDiscountAuthorizationContext.items || saleContext.items || [],
      loja,
      customerId: validatedDiscountAuthorizationContext.customer_id || validatedDiscountAuthorizationContext.customerId || saleContext.customerId || "",
      itemDiscountAmount: validatedDiscountAuthorizationContext.item_discount_amount ?? validatedDiscountAuthorizationContext.itemDiscountAmount ?? itemDiscountAmount,
      generalDiscountAmount: validatedDiscountAuthorizationContext.general_discount_amount ?? validatedDiscountAuthorizationContext.generalDiscountAmount ?? extraDiscount,
      exchangeCredit: validatedDiscountAuthorizationContext.exchange_credit ?? validatedDiscountAuthorizationContext.exchangeCredit ?? saleContext.exchangeCredit ?? 0,
      subtotal: validatedDiscountAuthorizationContext.subtotal ?? subtotal,
      cashbackApplied: validatedDiscountAuthorizationContext.cashback_applied ?? validatedDiscountAuthorizationContext.cashbackApplied ?? saleContext.cashbackUsed ?? 0,
      amountToPay: validatedDiscountAuthorizationContext.total_final ?? validatedDiscountAuthorizationContext.amountToPay ?? saleContext.totalFinal ?? 0,
      paidAmount: validatedDiscountAuthorizationContext.paid_amount ?? validatedDiscountAuthorizationContext.paidAmount ?? saleContext.paidAmount ?? 0
    };
    assertValidatedAuthorization(discountAuthorizationPayload, user);
    pendingAuthorizations.push(discountAuthorizationPayload);
  }

  if (permutaAmount > 0) {
    if (!authorization.permutaAuthorizationId) {
      throw new Error("Permuta exige autorizacao da gestao.");
    }
    const permutaAuthorizationPayload = {
      authorizationId: authorization.permutaAuthorizationId,
      operationType: "PERMUTA_AUTHORIZATION",
      saleSessionId,
      saleId,
      amount: permutaAmount,
      percent: 0,
      paymentMethods: saleContext.paymentMethods || [],
      paymentAmounts: saleContext.paymentMethods || [],
      items: saleContext.items || [],
      loja,
      customerId: saleContext.customerId || "",
      sellerId: saleContext.sellerId || saleContext.seller || "",
      itemDiscountAmount,
      generalDiscountAmount: extraDiscount,
      exchangeCredit: saleContext.exchangeCredit || 0,
      subtotal,
      totalBeforePermuta: saleContext.totalBeforePermuta || 0,
      permutaAmount,
      cashbackApplied: saleContext.cashbackUsed || 0,
      amountToPay: saleContext.totalFinal || 0,
      paidAmount: saleContext.paidAmount || 0
    };
    assertValidatedAuthorization(permutaAuthorizationPayload, user);
    pendingAuthorizations.push(permutaAuthorizationPayload);
  }

  return {
    discount_limit: discountLimit,
    discount_percent: discountPercent,
    discount_policy: discountPolicy,
    pending_authorizations: pendingAuthorizations
  };
}

function consumeSaleControlAuthorizations(controlValidation = {}, user = {}) {
  const pendingAuthorizations = Array.isArray(controlValidation.pending_authorizations)
    ? controlValidation.pending_authorizations
    : [];
  const consumed = [];
  for (const authorizationPayload of pendingAuthorizations) {
    consumed.push(consumeValidatedAuthorization(authorizationPayload, user));
  }
  return consumed;
}

function listCashRegisters() {
  const sales = loadCashRegisterSales();
  return loadCashRegisters().map((register) => reconcileCashRegisterSales(register, sales));
}

function getCashDashboard() {
  const cashRegisters = loadCashRegisters();
  const activeRegisters = cashRegisters.filter((item) => item.status === CASH_REGISTER_STATUS.OPEN || item.status === CASH_REGISTER_STATUS.REOPENED);
  const latest = cashRegisters[0] || null;
  const auditLogs = loadAuditLogs();
  return {
    metrics: {
      caixas_abertos: activeRegisters.length,
      caixas_fechados: cashRegisters.filter((item) => item.status === CASH_REGISTER_STATUS.CLOSED).length,
      autorizacoes_ativas: loadAuthorizations().filter((item) => item.status === "ACTIVE").length,
      auditorias: auditLogs.length,
      autorizadores_ativos: loadAuthorizers().filter((item) => item.is_active).length
    },
    activeRegisters,
    latestRegister: latest,
    recentAudits: auditLogs.slice(0, 40),
    authorizations: loadAuthorizations().slice(0, 40),
    authorizers: listAuthorizers(),
    authorizationAudit: loadAuthorizationAudit().slice(0, 60)
  };
}

module.exports = {
  AUTHORIZATION_TYPES,
  AUTHORIZATION_OPERATION_TYPES,
  CASH_MOVEMENT_TYPES,
  CASH_REGISTER_STATUS,
  DISCOUNT_REASONS,
  isAutomaticDiscountAllowedPaymentMethod,
  getDiscountPolicyForSale,
  getPdvUserRole,
  requireMinimumRole,
  openCashRegister,
  registerCashMovement,
  registerManualCashMovement,
  listCashMovementsForRegister,
  closeCashRegister,
  reopenCashRegister,
  issueAuthorizationPin,
  validateAuthorizationPin,
  validateSaleControls,
  consumeSaleControlAuthorizations,
  listCashRegisters,
  getCashRegisterById,
  getOpenCashRegisterByStore,
  getCashDashboard,
  computeCashRegisterExpected,
  appendAuditLog,
  loadAuditLogs,
  listAuthorizers,
  createOrRefreshAuthorizer,
  verifyAuthorizerSetup,
  resetAuthorizerTotp,
  setAuthorizerStatus,
  validateOperationAuthorization,
  consumeValidatedAuthorization,
  buildDiscountAuthorizationFingerprint,
  buildDiscountAuthorizationFingerprintPayload,
  loadAuthorizationAudit,
  saveAuthorizationAudit
};
