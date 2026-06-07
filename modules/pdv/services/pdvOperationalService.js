"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { get, all } = require("../../../db");
const { PDV_PAYMENT_METHODS } = require("../utils/pdvConfig");
const { normalizeStoreKey, storesMatch, formatStoreLabel, getStoreDisplayText } = require("../utils/pdvStoreUtils");
const {
  normalizeManualProductSizeStockEntries,
  buildManualProductSizeVariantIdentity
} = require("../inventory/pdvManualProductStockUtils");
const {
  getDiscountPolicyForSale,
  buildDiscountAuthorizationFingerprint,
  buildDiscountAuthorizationFingerprintPayload
} = require("./pdvControlService");

const GENERAL_DISCOUNT_ALLOWED_PAYMENT_METHODS = new Set(["pix", "dinheiro"]);
const GENERAL_DISCOUNT_IGNORED_PAYMENT_METHODS = new Set([
  "cashback",
  "credito_troca",
  "credit_exchange",
  "exchange_credit",
  "vale_troca"
]);

const operationalRootDir = path.join(process.cwd(), "data", "pdv", "operational");
const operationalFiles = {
  sessions: path.join(operationalRootDir, "customer-sessions.json"),
  quotes: path.join(operationalRootDir, "quotes.json"),
  reservations: path.join(operationalRootDir, "reservations.json"),
  internalConsumption: path.join(operationalRootDir, "internal-consumption.json"),
  quickCustomers: path.join(operationalRootDir, "quick-customers.json"),
  events: path.join(operationalRootDir, "events.json"),
  drafts: path.join(operationalRootDir, "cart-drafts.json")
};

const pdvImportDatasetDir = path.join(process.cwd(), "data", "imports", "pdv", "datasets");
const pdvConsolidationCustomersPath = path.join(process.cwd(), "data", "imports", "pdv", "consolidation", "master-customers.json");
const pdvSalesRootDir = path.join(process.cwd(), "data", "pdv", "sales");
const pdvSalesFiles = {
  sales: path.join(pdvSalesRootDir, "sales.json"),
  exchanges: path.join(pdvSalesRootDir, "exchanges.json"),
  giftCards: path.join(pdvSalesRootDir, "gift-cards.json")
};

const SESSION_STATUS = {
  OPEN: "OPEN",
  QUOTE: "QUOTE",
  RESERVED: "RESERVED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED"
};

const EVENT_TYPES = [
  "PRODUCT_VIEW",
  "PRODUCT_ADDED",
  "CUSTOMER_IDENTIFIED",
  "QUOTE_CREATED",
  "RESERVATION_CREATED",
  "INTERNAL_CONSUMPTION_CREATED",
  "SALE_COMPLETED",
  "SALE_CANCELLED",
  "CASHBACK_GRANTED",
  "CASHBACK_USED",
  "GIFT_CARD_ISSUED",
  "GIFT_CARD_USED",
  "EXCHANGE_CREATED",
  "COUPON_GENERATED",
  "COUPON_SENT",
  "GIFT_SENT",
  "WELCOME_BONUS_GRANTED",
  "MESSAGE_SCHEDULED",
  "MESSAGE_SENT",
  "INVENTORY_MOVEMENT",
  "STOCK_LOW",
  "STOCK_OUT",
  "SALE_ITEM_PHYSICAL_CONFIRMATION",
  "RESERVATION_HOLD",
  "RESERVATION_RELEASED",
  "TRANSFER_CREATED",
  "INTERNAL_CONSUMPTION_STOCK_OUT"
];

function ensureOperationalDirs() {
  fs.mkdirSync(operationalRootDir, { recursive: true });
  Object.values(operationalFiles).forEach((filePath) => {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "[]", "utf8");
    }
  });
}

// Cache em memÃ³ria para datasets grandes â€” invalida automaticamente quando o arquivo muda no disco
const _jsonCache = new Map();

function readJson(filePath, fallback = []) {
  ensureOperationalDirs();
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const mtime = fs.statSync(filePath).mtimeMs;
    const cached = _jsonCache.get(filePath);
    if (cached && cached.mtime === mtime) {
      return cached.data;
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    _jsonCache.set(filePath, { mtime, data });
    return data;
  } catch (error) {
    return fallback;
  }
}

function invalidateJsonCache(filePath) {
  _jsonCache.delete(filePath);
}

function writeJson(filePath, value) {
  ensureOperationalDirs();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  invalidateJsonCache(filePath);
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(value = "") {
  let digits = normalizeDigits(value);
  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }
  return digits;
}

function getCartItemUnitPrice(item = {}) {
  return toNumber(item.preco_venda || item.price || item.preco_referencia || 0);
}

function getCartItemQuantity(item = {}) {
  return Math.max(1, Math.round(toNumber(item.quantidade || 1)));
}

function normalizeCartItemDiscount(item = {}) {
  const unitPrice = getCartItemUnitPrice(item);
  const quantity = getCartItemQuantity(item);
  const gross = Number((unitPrice * quantity).toFixed(2));
  const source = item.item_discount && typeof item.item_discount === "object"
    ? item.item_discount
    : {};
  const mode = normalizeText(source.mode || source.discount_mode || "amount").toLowerCase() === "percent" ? "percent" : "amount";
  const value = Number(Math.max(0, toNumber(source.value ?? source.percent ?? source.amount ?? 0)).toFixed(2));
  let amount = mode === "percent"
    ? Number(((gross * value) / 100).toFixed(2))
    : Number(value.toFixed(2));
  amount = Number(Math.min(gross, Math.max(0, amount)).toFixed(2));
  const percent = gross > 0 ? Number(((amount / gross) * 100).toFixed(2)) : 0;
  if (amount <= 0) {
    return null;
  }
  return {
    mode,
    value,
    amount,
    percent,
    reason: normalizeText(source.reason || ""),
    applied_by: normalizeText(source.applied_by || ""),
    applied_at: normalizeText(source.applied_at || "")
  };
}

function getCartItemsGrossSubtotal(cartItems = []) {
  return Number((Array.isArray(cartItems) ? cartItems : []).reduce((sum, item) => {
    return sum + (getCartItemUnitPrice(item) * getCartItemQuantity(item));
  }, 0).toFixed(2));
}

function getCartItemsDiscountTotal(cartItems = []) {
  return Number((Array.isArray(cartItems) ? cartItems : []).reduce((sum, item) => {
    return sum + toNumber(normalizeCartItemDiscount(item)?.amount || 0);
  }, 0).toFixed(2));
}

function getCartItemsNetSubtotal(cartItems = []) {
  return Number(Math.max(0, getCartItemsGrossSubtotal(cartItems) - getCartItemsDiscountTotal(cartItems)).toFixed(2));
}

function getSessionGeneralDiscountBase(session = {}) {
  const cartItems = Array.isArray(session?.cart_items) ? session.cart_items : [];
  const itemsNetSubtotal = getCartItemsNetSubtotal(cartItems);
  const cashbackUsed = toNumber(session?.cashback_application?.amount || 0);
  const exchangeCredit = sumSessionPaymentMethods(session, ["credito_troca"]) || toNumber(session?.exchange_credit_application?.amount || 0);
  return Number(Math.max(0, itemsNetSubtotal - cashbackUsed - exchangeCredit).toFixed(2));
}

function recalculateSessionGeneralDiscountAmount(session = {}) {
  const mode = normalizeText(session?.discount_mode || "percent").toLowerCase() === "value" ? "value" : "percent";
  const base = getSessionGeneralDiscountBase(session);
  const currentAmount = toNumber(session?.desconto_extra ?? session?.extra_discount ?? session?.discount_amount ?? 0);
  const currentPercent = toNumber(session?.discount_percent || 0);
  if (currentAmount <= 0 && currentPercent <= 0) {
    return session;
  }
  const nextAmount = mode === "percent"
    ? Number((base > 0 ? Math.min(base, (base * Math.max(0, currentPercent)) / 100) : 0).toFixed(2))
    : Number((base > 0 ? Math.min(base, Math.max(0, currentAmount)) : 0).toFixed(2));
  const nextPercent = mode === "percent"
    ? Number(Math.max(0, currentPercent).toFixed(2))
    : (base > 0 ? Number(((nextAmount / base) * 100).toFixed(2)) : 0);
  session.desconto_extra = nextAmount;
  session.extra_discount = nextAmount;
  session.discount_amount = nextAmount;
  session.discount_percent = nextPercent;
  return session;
}

function sumSessionPaymentMethods(session = {}, methods = []) {
  const allowed = new Set(methods);
  return Number((Array.isArray(session?.payment_plan?.methods) ? session.payment_plan.methods : []).reduce((sum, item) => {
    const method = normalizeText(item?.method || "");
    if (!allowed.has(method)) {
      return sum;
    }
    return sum + toNumber(item?.amount || 0);
  }, 0).toFixed(2));
}

function isPaymentMethodEligibleForGeneralDiscount(method = "") {
  return GENERAL_DISCOUNT_ALLOWED_PAYMENT_METHODS.has(normalizeText(method || "").toLowerCase());
}

function getGeneralDiscountBlockingPaymentMethods(session = {}) {
  const launched = (Array.isArray(session?.payment_plan?.methods) ? session.payment_plan.methods : [])
    .map((item) => ({
      method: normalizeText(item?.method || "").toLowerCase(),
      amount: toNumber(item?.amount || 0)
    }))
    .filter((item) => item.method && item.amount > 0.01);
  const cashbackAmount = toNumber(session?.cashback_application?.amount || 0);
  if (cashbackAmount > 0.01 && !launched.some((item) => item.method === "cashback")) {
    launched.push({ method: "cashback", amount: cashbackAmount });
  }
  const exchangeCreditAmount = sumSessionPaymentMethods(session, ["credito_troca"]) || toNumber(session?.exchange_credit_application?.amount || 0);
  if (exchangeCreditAmount > 0.01 && !launched.some((item) => item.method === "credito_troca")) {
    launched.push({ method: "credito_troca", amount: exchangeCreditAmount });
  }
  return launched.filter((item) =>
    !GENERAL_DISCOUNT_IGNORED_PAYMENT_METHODS.has(item.method)
    && !isPaymentMethodEligibleForGeneralDiscount(item.method)
  );
}

function getPaymentMethodPolicyLabel(method = "") {
  const labels = {
    pix: "Pix",
    dinheiro: "Dinheiro",
    debito: "Cartão de débito",
    credito: "Cartão de crédito",
    credito_ate_10x: "Cartão de crédito",
    link_pagamento: "Link pagamento",
    credito_troca: "Crédito de Troca",
    cashback: "Cashback",
    vale_presente: "Vale presente",
    permuta: "Permuta"
  };
  return labels[normalizeText(method || "").toLowerCase()] || normalizeText(method || "Método não elegível");
}

function getSessionDiscountPolicy(session = {}) {
  const cartItems = Array.isArray(session?.cart_items) ? session.cart_items : [];
  const itemDiscountAmount = getCartItemsDiscountTotal(cartItems);
  const generalDiscountAmount = toNumber(
    session?.desconto_extra
    ?? session?.discount_amount
    ?? 0
  );
  const subtotal = getCartItemsGrossSubtotal(cartItems);
  const cashbackUsed = toNumber(session?.cashback_application?.amount || 0);
  const exchangeCredit = sumSessionPaymentMethods(session, ["credito_troca"]) || toNumber(session?.exchange_credit_application?.amount || 0);
  const policyBase = getSessionGeneralDiscountBase(session);
  const storedPercent = toNumber(session?.discount_percent || 0);
  const discountPercent = normalizeText(session?.discount_mode || "percent").toLowerCase() === "percent" && storedPercent > 0
    ? Number(storedPercent.toFixed(2))
    : (policyBase > 0 ? Number(((generalDiscountAmount / policyBase) * 100).toFixed(2)) : 0);
  return getDiscountPolicyForSale({
    paymentMethods: session?.payment_plan?.methods || [],
    discountAmount: generalDiscountAmount,
    discountPercent,
    itemDiscountAmount,
    discountBase: policyBase,
    subtotal,
    cashbackUsed,
    exchangeCredit
  });
}

function computeSessionDiscountUpdate(session = {}, payload = {}) {
  const cartItems = Array.isArray(session.cart_items) ? session.cart_items : [];
  const discountBase = getSessionGeneralDiscountBase(session);
  const mode = normalizeText(payload.mode || payload.discount_mode || "percent").toLowerCase() === "value" ? "value" : "percent";
  const rawValue = toNumber(payload.value ?? payload.amount ?? payload.percent ?? 0);
  const reason = normalizeText(payload.reason || "");
  let discountAmount = 0;
  let discountPercent = 0;
  if (mode === "percent") {
    discountPercent = Number(Math.max(0, rawValue).toFixed(2));
    if (discountPercent > 0 && discountBase <= 0) {
      throw new Error("Nao ha base elegivel para aplicar desconto geral apos Cashback e Credito de Troca.");
    }
    discountAmount = Number(((discountBase * discountPercent) / 100).toFixed(2));
  } else {
    discountAmount = Number(Math.max(0, rawValue).toFixed(2));
    if (discountAmount > discountBase + 0.009) {
      throw new Error("O desconto geral nao pode superar a base elegivel apos Cashback e Credito de Troca.");
    }
    discountPercent = discountBase > 0 ? Number(((discountAmount / discountBase) * 100).toFixed(2)) : 0;
  }
  discountAmount = Number(Math.min(discountAmount, discountBase).toFixed(2));
  discountPercent = mode === "percent"
    ? Number(Math.max(0, rawValue).toFixed(2))
    : (discountBase > 0 ? Number(((discountAmount / discountBase) * 100).toFixed(2)) : 0);
  return {
    cartItems,
    discountBase,
    mode,
    rawValue,
    reason,
    discountAmount,
    discountPercent
  };
}

function assignSessionGeneralDiscount(session = {}, discountUpdate = {}) {
  session.desconto_extra = toNumber(discountUpdate.discountAmount || 0);
  session.extra_discount = toNumber(discountUpdate.discountAmount || 0);
  session.discount_amount = toNumber(discountUpdate.discountAmount || 0);
  session.discount_percent = toNumber(discountUpdate.discountPercent || 0);
  session.discount_mode = normalizeText(discountUpdate.mode || "percent");
  session.discount_reason = normalizeText(discountUpdate.reason || "");
  applySessionDiscountPolicy(session);
  return session;
}

function applySessionDiscountPolicy(session = {}) {
  recalculateSessionGeneralDiscountAmount(session);
  const discountPolicy = getSessionDiscountPolicy(session);
  session.discount_policy = discountPolicy;
  session.authorization_required = Boolean(discountPolicy.requiresAuthorization);
  session.discount_authorization_required = Boolean(discountPolicy.requiresAuthorization);
  return session;
}

function normalizeCashbackApplication(entry = null) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const amount = toNumber(entry.amount || 0);
  if (amount <= 0) {
    return null;
  }
  return {
    amount,
    customer_phone: normalizePhone(entry.customer_phone || entry.phone || ""),
    customer_name: normalizeText(entry.customer_name || entry.name || ""),
    customer_id: normalizeText(entry.customer_id || entry.master_customer_id || ""),
    applied_at: normalizeText(entry.applied_at || ""),
    applied_by: normalizeText(entry.applied_by || "")
  };
}

function normalizeLookup(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizePhoneLookup(value = "") {
  const phone = normalizePhone(value);
  if (!phone) {
    return "";
  }
  return phone.startsWith("55") && phone.length > 11 ? phone.slice(2) : phone;
}

function buildOperationalError(message = "", statusCode = 400, extra = {}) {
  const error = new Error(message || "Falha operacional do PDV.");
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

function getAllowedOperationalStores(user = {}) {
  return Array.isArray(user?.allowed_stores)
    ? user.allowed_stores.map((item) => normalizeStoreKey(item || "")).filter(Boolean)
    : [];
}

function canUserViewAllStores(user = {}) {
  return Boolean(user?.permissions?.can_view_all_stores);
}

function resolveQuickCustomerStoreId(payload = {}, user = {}) {
  const requestedStore = normalizeStoreKey(
    payload.store_id
    || payload.store
    || payload.loja
    || payload.store_origin
    || payload.loja_favorita
    || ""
  );
  const ownedStore = normalizeStoreKey(user?.store_id || user?.store || user?.loja || "");
  const allowedStores = getAllowedOperationalStores(user);
  if (canUserViewAllStores(user)) {
    const adminStore = requestedStore || ownedStore || allowedStores[0] || "";
    if (!adminStore) {
      throw buildOperationalError("Selecione a loja do cadastro rapido antes de salvar o cliente.", 400);
    }
    return adminStore;
  }
  const scopedStore = ownedStore || allowedStores[0] || "";
  if (!scopedStore) {
    throw buildOperationalError("Nao foi possivel identificar a loja ativa para o cadastro rapido.", 403);
  }
  return scopedStore;
}

function mapQuickCustomerToUnified(item = {}) {
  const phone = normalizePhone(item.phone || item.telefone || "");
  const document = normalizeDigits(item.document || item.cpf || "");
  const storeId = normalizeStoreKey(
    item.store_id
    || item.loja
    || item.store
    || item.store_origin
    || item.loja_favorita
    || ""
  );
  return {
    master_customer_id: item.id,
    master_key: document || phone || normalizeLookup(item.name || ""),
    name: normalizeText(item.name || item.nome || "Cliente PDV"),
    phone,
    phones: phone ? [phone] : [],
    document,
    documents: document ? [document] : [],
    email: normalizeText(item.email || "").toLowerCase(),
    city: normalizeText(item.city || ""),
    state: normalizeText(item.state || ""),
    notes: normalizeText(item.notes || item.observacao || ""),
    total_comprado: 0,
    ticket_medio: 0,
    ultima_compra: "",
    classe_abc: "",
    saldo_cashback: 0,
    consolidation_score: "BAIXO",
    quick_register: true,
    origin: normalizeText(item.origin || "PDV") || "PDV",
    origin_label: normalizeText(item.origin_label || "Cadastro rapido PDV"),
    cashback_legado: 0,
    cashback_legacy_origin: "",
    crm_contact_id: null,
    legacy_contact_id: null,
    created_at: item.created_at || "",
    created_by: item.created_by || "",
    store_id: storeId,
    store_origin: storeId,
    loja_favorita: storeId,
    observacao: normalizeText(item.notes || item.observacao || ""),
    status: normalizeText(item.status || "quick_register")
  };
}

function normalizeCodeLookup(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function buildCustomerSearchKey(customer = {}) {
  return normalizeDigits(customer.document || "")
    || normalizePhone(customer.phone || "")
    || normalizeLookup(customer.name || "");
}

function matchesCustomerSearch(customer = {}, normalizedQuery = "", phoneQuery = "") {
  if (!normalizedQuery && !phoneQuery) {
    return true;
  }
  const searchableText = [
    customer.name,
    customer.phone,
    customer.document,
    customer.city,
    customer.loja_favorita,
    customer.vendedor_favorito,
    customer.email,
    customer.origin_label
  ].map((value) => normalizeLookup(value)).join(" ");
  const customerPhone = normalizePhone(customer.phone || "");
  const customerDocument = normalizeDigits(customer.document || "");
  return searchableText.includes(normalizedQuery)
    || (phoneQuery && (customerPhone.includes(phoneQuery) || customerDocument.includes(phoneQuery)));
}

function buildCustomerSearchText(customer = {}) {
  return normalizeLookup([
    customer.name,
    customer.phone,
    customer.document,
    customer.email,
    customer.city,
    customer.state,
    customer.notes,
    customer.origin_label
  ].join(" "));
}

function getCustomerCompletenessScore(customer = {}) {
  return [
    customer.name,
    customer.phone,
    customer.document,
    customer.email,
    customer.city,
    customer.notes,
    customer.total_comprado,
    customer.ticket_medio,
    customer.ultima_compra,
    customer.saldo_cashback,
    customer.cashback_legado,
    customer.crm_contact_id,
    customer.legacy_contact_id
  ].reduce((score, value) => score + (value ? 1 : 0), 0);
}

function scoreCustomerSearchMatch(customer = {}, query = "") {
  const textQuery = normalizeLookup(query);
  const digitsQuery = normalizeDigits(query);
  const phoneValue = normalizePhone(customer.phone || "");
  const documentValue = normalizeDigits(customer.document || "");
  const nameValue = normalizeLookup(customer.name || "");
  const searchText = buildCustomerSearchText(customer);
  let score = 0;
  if (digitsQuery && documentValue && documentValue === digitsQuery) score = Math.max(score, 1200);
  if (digitsQuery && phoneValue && phoneValue === digitsQuery) score = Math.max(score, 1100);
  if (digitsQuery && documentValue && documentValue.startsWith(digitsQuery)) score = Math.max(score, 950);
  if (digitsQuery && phoneValue && phoneValue.includes(digitsQuery)) score = Math.max(score, 900);
  if (textQuery && nameValue && nameValue === textQuery) score = Math.max(score, 860);
  if (textQuery && searchText.includes(textQuery)) score = Math.max(score, 420);
  return score + getCustomerCompletenessScore(customer);
}

function mergeCustomerSearchRow(target = {}, source = {}) {
  const merged = {
    ...source,
    ...target,
    master_customer_id: normalizeText(target.master_customer_id || source.master_customer_id || ""),
    name: normalizeText(target.name || source.name || ""),
    phone: normalizePhone(target.phone || source.phone || ""),
    document: normalizeDigits(target.document || source.document || ""),
    email: normalizeText(target.email || source.email || ""),
    city: normalizeText(target.city || source.city || ""),
    state: normalizeText(target.state || source.state || ""),
    notes: normalizeText(target.notes || source.notes || ""),
    top_size: normalizeText(target.top_size || source.top_size || ""),
    bottom_size: normalizeText(target.bottom_size || source.bottom_size || ""),
    shoe_size: normalizeText(target.shoe_size || source.shoe_size || ""),
    total_comprado: Math.max(toNumber(target.total_comprado || 0), toNumber(source.total_comprado || 0)),
    ticket_medio: Math.max(toNumber(target.ticket_medio || 0), toNumber(source.ticket_medio || 0)),
    saldo_cashback: Math.max(toNumber(target.saldo_cashback || 0), toNumber(source.saldo_cashback || 0)),
    cashback_legado: Math.max(toNumber(target.cashback_legado || 0), toNumber(source.cashback_legado || 0)),
    crm_contact_id: normalizeText(target.crm_contact_id || source.crm_contact_id || ""),
    legacy_contact_id: normalizeText(target.legacy_contact_id || source.legacy_contact_id || ""),
    origin: normalizeText(target.origin || source.origin || "PDV"),
    origin_label: normalizeText(target.origin_label || source.origin_label || ""),
    sources: uniqueStrings([...(target.sources || []), ...(source.sources || []), target.origin_label, source.origin_label].filter(Boolean))
  };
  if (!merged.origin_label && merged.sources.length) {
    merged.origin_label = merged.sources[0];
  }
  return merged;
}

function findMergedCustomerKey(map, customer = {}) {
  const directKey = buildCustomerSearchKey(customer);
  if (directKey && map.has(directKey)) {
    return directKey;
  }
  const phone = normalizePhone(customer.phone || "");
  const document = normalizeDigits(customer.document || "");
  const name = normalizeLookup(customer.name || "");
  for (const [key, existing] of map.entries()) {
    const existingPhone = normalizePhone(existing.phone || "");
    const existingDocument = normalizeDigits(existing.document || "");
    const existingName = normalizeLookup(existing.name || "");
    if (document && existingDocument && document === existingDocument) {
      return key;
    }
    if (phone && existingPhone && phone === existingPhone) {
      return key;
    }
    if (!document && !phone && name && existingName === name) {
      return key;
    }
  }
  return directKey;
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseFlexibleNumber(value) {
  if (typeof value === "number") {
    return toNumber(value);
  }
  const raw = normalizeText(value || "");
  if (!raw) return 0;
  const sanitized = raw.replace(/[^\d,.-]/g, "");
  if (!sanitized) return 0;
  const lastComma = sanitized.lastIndexOf(",");
  const lastDot = sanitized.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  if (decimalIndex >= 0) {
    const integerPart = sanitized.slice(0, decimalIndex).replace(/[.,]/g, "");
    const decimalPart = sanitized.slice(decimalIndex + 1).replace(/[.,]/g, "");
    return toNumber(`${integerPart || "0"}.${decimalPart}`);
  }
  return toNumber(sanitized.replace(/[.,]/g, ""));
}

function normalizeCashbackLedgerStatus(status = "", origin = "") {
  const normalizedStatus = normalizeLookup(status || "");
  const normalizedOrigin = normalizeLookup(origin || "");
  const isLegacy = normalizedOrigin.includes("migracao") || normalizedOrigin.includes("legado") || normalizedOrigin.includes("crm bonus");
  if (["disponivel", "ativo", "liberado", "available"].includes(normalizedStatus)) {
    return isLegacy ? "pending_migration" : "available";
  }
  if (["pending pin", "pending_pin", "a receber", "a_receber", "pendente", "pending"].includes(normalizedStatus)) {
    return "pending";
  }
  if (["usado", "used", "resgatado"].includes(normalizedStatus)) {
    return "used";
  }
  if (["vencido", "expirado", "expired"].includes(normalizedStatus)) {
    return "expired";
  }
  if (["cancelado", "cancelled", "canceled"].includes(normalizedStatus)) {
    return "cancelled";
  }
  return isLegacy ? "pending_migration" : "pending";
}

function normalizeCashbackLedgerType(origin = "") {
  const normalizedOrigin = normalizeLookup(origin || "");
  if (!normalizedOrigin) {
    return "operational";
  }
  if (normalizedOrigin.includes("migracao") || normalizedOrigin.includes("legado") || normalizedOrigin.includes("crm bonus")) {
    return "legacy";
  }
  return "operational";
}

async function loadCashbackLedgerEntriesForCustomer(customer = {}, signals = null) {
  const customerSignals = signals || buildCustomerSignals(customer);
  const knownContactIds = [
    customer.contact_id,
    customer.legacy_contact_id,
    customer.cashback_contact_id
  ].map((value) => Number(value || 0)).filter((value) => value > 0);
  const knownPhones = uniqueStrings([
    normalizePhone(customer.phone || ""),
    normalizePhone(customer.mobile || ""),
    normalizePhone(customer.customer_phone || "")
  ]).filter(Boolean);
  const clauses = [];
  const params = [];
  if (knownContactIds.length) {
    clauses.push(`cb.contact_id IN (${knownContactIds.map(() => "?").join(", ")})`);
    params.push(...knownContactIds);
  }
  if (knownPhones.length) {
    clauses.push(`(
      cb.customer_phone IN (${knownPhones.map(() => "?").join(", ")})
      OR c.phone IN (${knownPhones.map(() => "?").join(", ")})
    )`);
    params.push(...knownPhones, ...knownPhones);
  }
  if (!clauses.length && customerSignals?.name) {
    clauses.push("(lower(COALESCE(cb.customer_name, '')) LIKE ? OR lower(COALESCE(c.name, '')) LIKE ?)");
    params.push(`%${customerSignals.name}%`, `%${customerSignals.name}%`);
  }
  if (!clauses.length) {
    return [];
  }

  const rows = await all(
    `SELECT
       cb.*,
       c.name AS contact_name,
       c.phone AS contact_phone
     FROM cashbacks cb
     LEFT JOIN contacts c ON c.id = cb.contact_id
     WHERE ${clauses.join(" OR ")}
     ORDER BY cb.created_at DESC, cb.id DESC`,
    params
  );

  const seen = new Set();
  return rows
    .filter((row) => {
      const key = Number(row.id || 0);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((row) => {
      const type = normalizeCashbackLedgerType(row.origin || "");
      const status = normalizeCashbackLedgerStatus(row.status || "", row.origin || "");
      const amountSource = status === "available"
        ? row.available_balance
        : status === "used"
          ? row.used_value
          : status === "expired" || status === "cancelled"
            ? row.lost_value || row.generated_value
            : row.generated_value || row.available_balance;
      return {
        id: row.id,
        type,
        amount: toNumber(amountSource),
        status,
        available_at: row.valid_from || "",
        created_at: row.created_at || "",
        updated_at: row.updated_at || "",
        validade: row.expires_at || "",
        origin: row.origin || (type === "legacy" ? "CRM antigo" : "PDV operacional")
      };
    })
    .filter((entry) => entry.amount > 0);
}

function nowIso() {
  return new Date().toISOString();
}

function buildId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function getDataset(type) {
  return readJson(path.join(pdvImportDatasetDir, `${type}.json`), []);
}

function getProductAvailabilityLabel(stock) {
  const quantity = toNumber(stock);
  if (quantity <= 0) return "Esgotado";
  if (quantity === 1) return "Ãšltima peÃ§a";
  return "DisponÃ­vel";
}

function loadProductsDataset() {
  return getDataset("produtos");
}

function loadConsolidatedCustomers() {
  return readJson(pdvConsolidationCustomersPath, []);
}

function loadQuickCustomers() {
  return readJson(operationalFiles.quickCustomers, []);
}

function loadSessions() {
  return readJson(operationalFiles.sessions, []);
}

function saveSessions(rows) {
  writeJson(operationalFiles.sessions, rows);
}

function loadQuotes() {
  return readJson(operationalFiles.quotes, []);
}

function saveQuotes(rows) {
  writeJson(operationalFiles.quotes, rows);
}

function loadReservations() {
  return readJson(operationalFiles.reservations, []);
}

function saveReservations(rows) {
  writeJson(operationalFiles.reservations, rows);
}

function loadInternalConsumption() {
  return readJson(operationalFiles.internalConsumption, []);
}

function saveInternalConsumption(rows) {
  writeJson(operationalFiles.internalConsumption, rows);
}

function loadEvents() {
  return readJson(operationalFiles.events, []);
}

function saveEvents(rows) {
  writeJson(operationalFiles.events, rows.slice(0, 10000));
}

function loadDrafts() {
  return readJson(operationalFiles.drafts, []);
}

function saveDrafts(rows) {
  writeJson(operationalFiles.drafts, rows);
}

function cloneSerializable(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function loadPdvSales() {
  return readJson(pdvSalesFiles.sales, []);
}

function loadPdvExchanges() {
  return readJson(pdvSalesFiles.exchanges, []);
}

function loadPdvGiftCards() {
  return readJson(pdvSalesFiles.giftCards, []);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const items = [];
  values.forEach((value) => {
    const normalized = normalizeText(value || "");
    const lookup = normalizeLookup(normalized);
    if (!lookup || seen.has(lookup)) {
      return;
    }
    seen.add(lookup);
    items.push(normalized);
  });
  return items;
}

function pickMostFrequentValue(values = []) {
  const counts = new Map();
  values.forEach((value) => {
    const normalized = normalizeText(value || "");
    if (!normalized) {
      return;
    }
    counts.set(normalized, Number(counts.get(normalized) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([value]) => value)[0] || "";
}

function averageDaysBetweenDates(values = []) {
  const ordered = values
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());
  if (ordered.length < 2) {
    return 0;
  }
  let totalDays = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    totalDays += Math.max(0, Math.round((ordered[index].getTime() - ordered[index - 1].getTime()) / 86400000));
  }
  return Math.round(totalDays / (ordered.length - 1));
}

function daysUntil(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function appendEvent(eventType, context = {}, payload = {}, user = {}) {
  if (!EVENT_TYPES.includes(eventType)) {
    return null;
  }
  const events = loadEvents();
  const event = {
    event_id: buildId("EVT"),
    event_type: eventType,
    origem: "PDV_AEROSTORE",
    usuario: user?.name || user?.email || "sistema",
    loja: normalizeStoreKey(context.loja || payload.loja || ""),
    data_hora: nowIso(),
    contexto: context,
    payload
  };
  events.unshift(event);
  saveEvents(events);
  return event;
}

function getPdvOperationalManifest() {
  ensureOperationalDirs();
  return {
    module: "PDV AEROSTORE",
    stage: "2",
    route: "/pdv/venda",
    routes: ["/pdv/venda", "/pdv/orcamentos", "/pdv/reservas", "/pdv/clientes", "/pdv/consumo", "/pdv/eventos"],
    sessionStatuses: Object.values(SESSION_STATUS),
    paymentMethods: PDV_PAYMENT_METHODS,
    eventTypes: EVENT_TYPES
  };
}

function buildProductSearchText(product) {
  return normalizeLookup([
    product.codigo,
    product.sku,
    product.codigo_tiny,
    product.tiny_id,
    product.codigo_etiqueta,
    product.codigo_interno,
    product.ean,
    product.codigo_barras,
    product.gtin,
    product.gtin_ean,
    product.nome,
    product.descricao,
    product.marca,
    product.categoria,
    product.tipo,
    product.cor,
    product.tamanho
  ].join(" "));
}

function normalizeSearchLimit(limit, fallback, max) {
  const parsed = Number(limit || fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function canRunPdvProductSearch(query = "") {
  const normalized = normalizeText(query || "");
  return normalized.length >= 2 || /^\d+$/.test(normalized) || /^(sku|cod)[a-z0-9_-]*$/i.test(normalized);
}

function canRunPdvCustomerSearch(query = "") {
  return normalizeText(query || "").length >= 2;
}

function searchProducts(query = "", { storeId = "" } = {}) {
  try {
    const { searchInventoryProducts } = require("../inventory/pdvInventoryService");
    const items = searchInventoryProducts(query, { storeId });
    if (items.length) {
      const priceByReference = new Map();
      if (items.some((item) => toNumber(item.preco_venda || item.price || 0) <= 0)) {
        const products = loadProductsDataset();
        products.forEach((product) => {
          const keys = [
            normalizeText(product.product_id || ""),
            normalizeText(product.sku || ""),
            normalizeText(product.codigo || ""),
            normalizeText(product.codigo_tiny || ""),
            normalizeText(product.codigo_etiqueta || ""),
            normalizeDigits(product.ean || product.codigo_barras || ""),
            normalizeText(product.codigo_interno || "")
          ].filter(Boolean);
          const nextPrice = toNumber(product.preco_venda || product.price || 0);
          keys.forEach((key) => {
            const currentPrice = toNumber(priceByReference.get(key) || 0);
            if (!priceByReference.has(key) || (currentPrice <= 0 && nextPrice > 0)) {
              priceByReference.set(key, nextPrice);
            }
          });
        });
      }
      return items.map((item) => {
        const lookupKeys = [
          normalizeText(item.product_id || ""),
          normalizeText(item.sku || ""),
          normalizeText(item.codigo || ""),
          normalizeText(item.codigo_tiny || ""),
          normalizeText(item.codigo_etiqueta || ""),
          normalizeDigits(item.ean || item.codigo_barras || ""),
          normalizeText(item.codigo_interno || "")
        ].filter(Boolean);
        const resolvedPrice = lookupKeys.reduce((found, key) => {
          if (found > 0) {
            return found;
          }
          return toNumber(priceByReference.get(key) || 0);
        }, toNumber(item.preco_venda || item.price || 0));
        return {
          ...item,
          preco_venda: resolvedPrice
        };
      });
    }
  } catch (error) {
    // fallback silencioso para a base importada se o estoque operacional ainda nÃ£o estiver montado
  }
  const normalizedQuery = normalizeLookup(query);
  const searchTokens = tokenizeProductSearchQuery(query);
  const products = loadProductsDataset();
  const filtered = !normalizedQuery
    ? products
    : products.filter((product) => productMatchesTokenSearch(product, query, searchTokens));
  return filtered.slice(0, 40).map((product) => ({
    id: normalizeText(product.sku || product.codigo || product.nome || buildId("PRD")),
    product_id: normalizeText(product.product_id || ""),
    codigo: normalizeText(product.codigo || ""),
    sku: normalizeText(product.sku || product.codigo || ""),
    codigo_tiny: normalizeText(product.codigo_tiny || ""),
    codigo_etiqueta: normalizeText(product.codigo_etiqueta || ""),
    ean: normalizeDigits(product.ean || product.codigo_barras || ""),
    codigo_barras: normalizeDigits(product.codigo_barras || product.ean || ""),
    codigo_interno: normalizeText(product.codigo_interno || ""),
    nome: normalizeText(product.nome || ""),
    marca: normalizeText(product.marca || ""),
    categoria: normalizeText(product.categoria || ""),
    linha_genero: normalizeText(product.linha_genero || ""),
    tipo: normalizeText(product.tipo || ""),
    cor: normalizeText(product.cor || ""),
    tamanho: normalizeText(product.tamanho || ""),
    descricao: normalizeText(product.descricao || ""),
    preco_venda: toNumber(product.preco_venda),
    estoque: toNumber(product.estoque),
    available_qty: toNumber(product.estoque),
    reserved_qty: 0,
    store_id: normalizeStoreKey(storeId || "LOJA_GERAL") || "LOJA_GERAL",
    availability_label: getProductAvailabilityLabel(product.estoque),
    image: "",
    tags: [normalizeText(product.marca || ""), normalizeText(product.categoria || ""), normalizeText(product.tipo || "")].filter(Boolean)
  }));
}

async function searchCustomers(query = "") {
  const normalizedQuery = normalizeLookup(query);
  const normalizedPhoneQuery = normalizePhoneLookup(query);
  const consolidated = loadConsolidatedCustomers();
  const quickCustomers = loadQuickCustomers();
  const localMatches = consolidated
    .filter((customer) => matchesCustomerSearch(customer, normalizedQuery, normalizedPhoneQuery))
    .slice(0, 30)
    .map((customer) => ({
      ...customer,
      origin: "PDV",
      origin_label: "Cliente PDV",
      cashback_legado: 0,
      cashback_legacy_origin: "",
      crm_contact_id: null,
      legacy_contact_id: null
    }));

  const quickMatches = quickCustomers
    .filter((customer) => matchesCustomerSearch(customer, normalizedQuery, normalizedPhoneQuery))
    .slice(0, 15)
    .map((item) => ({
      master_customer_id: item.id,
      name: item.name,
      phone: item.phone,
      document: "",
      total_comprado: 0,
      ticket_medio: 0,
      ultima_compra: "",
      classe_abc: "",
      saldo_cashback: 0,
      consolidation_score: "BAIXO",
      quick_register: true,
      origin: "PDV",
      origin_label: "Cadastro rÃ¡pido PDV",
      cashback_legado: 0,
      cashback_legacy_origin: "",
      crm_contact_id: null,
      legacy_contact_id: null
    }));

  let crmMatches = [];
  let crmLegacyMatches = [];
  if (!localMatches.length && !quickMatches.length && (normalizedQuery || normalizedPhoneQuery)) {
    const lookup = `%${normalizedQuery}%`;
    const lookupDigits = normalizedPhoneQuery ? `%${normalizedPhoneQuery}%` : "";
    try {
      const crmPhoneClauses = normalizedPhoneQuery
        ? `OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(mobile, phone, ''), '+', ''), '(', ''), ')', ''), '-', ''), ' ', '') LIKE ?
           OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone, mobile, ''), '+', ''), '(', ''), ')', ''), '-', ''), ' ', '') LIKE ?
           OR COALESCE(document, '') LIKE ?`
        : "";
      const crmParams = normalizedPhoneQuery
        ? [lookup, lookup, lookup, lookup, lookup, lookup, lookupDigits, lookupDigits, lookupDigits]
        : [lookup, lookup, lookup, lookup, lookup, lookup];
      crmMatches = await all(
        `SELECT id, name, mobile, phone, document, email, city, state, seller_name
         FROM crm_contacts
         WHERE lower(name) LIKE ?
            OR lower(fantasy_name) LIKE ?
            OR lower(email) LIKE ?
            OR lower(city) LIKE ?
            OR lower(state) LIKE ?
            OR lower(seller_name) LIKE ?
            ${crmPhoneClauses}
         LIMIT 15`,
        crmParams
      );
    } catch (error) {
      crmMatches = [];
    }
    try {
      const legacyPhoneClause = normalizedPhoneQuery
        ? "OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(c.phone, ''), '+', ''), '(', ''), ')', ''), '-', ''), ' ', '') LIKE ?"
        : "";
      const legacyParams = normalizedPhoneQuery
        ? [lookup, lookupDigits]
        : [lookup];
      crmLegacyMatches = await all(
        `SELECT
           c.id,
           c.name,
           c.phone,
           c.gender,
           c.store,
           c.seller_name,
           c.cashback,
           c.validity,
           c.status,
           c.created_at,
           c.updated_at
         FROM contacts c
         WHERE lower(COALESCE(c.name, '')) LIKE ?
            ${legacyPhoneClause}
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT 20`,
        legacyParams
      );
    } catch (error) {
      crmLegacyMatches = [];
    }
  }

  const merged = [];
  const seen = new Set();
  const legacyMap = new Map();
  crmLegacyMatches.forEach((item) => {
    const key = normalizePhone(item.phone || "") || normalizeLookup(item.name || "");
    if (key && !legacyMap.has(key)) {
      legacyMap.set(key, item);
    }
  });
  [
    ...localMatches,
    ...quickMatches,
    ...crmMatches.map((item) => {
      const phone = normalizePhone(item.mobile || item.phone || "");
      const legacy = legacyMap.get(phone) || null;
      return {
        master_customer_id: `CRM_${item.id}`,
        name: item.name,
        phone,
        document: normalizeDigits(item.document || ""),
        email: item.email || "",
        city: item.city || "",
        total_comprado: 0,
        ticket_medio: 0,
        ultima_compra: "",
        classe_abc: "",
        saldo_cashback: 0,
        consolidation_score: "MEDIO",
        crm_contact_id: item.id,
        legacy_contact_id: legacy?.id || null,
        cashback_legado: toNumber(legacy?.cashback || 0),
        cashback_legacy_origin: legacy ? "CRM_LEGADO" : "",
        origin: "CRM",
        origin_label: "Contato encontrado no CRM"
      };
    }),
    ...crmLegacyMatches.map((item) => ({
      master_customer_id: `CRM_LEGACY_${item.id}`,
      name: item.name,
      phone: normalizePhone(item.phone || ""),
      document: "",
      email: "",
      city: "",
      total_comprado: 0,
      ticket_medio: 0,
      ultima_compra: item.updated_at || item.created_at || "",
      classe_abc: "",
      saldo_cashback: 0,
      consolidation_score: "MEDIO",
      crm_contact_id: null,
      legacy_contact_id: item.id,
      cashback_legado: toNumber(item.cashback || 0),
      cashback_legacy_origin: "CRM_BONUS",
      origin: "CRM",
      origin_label: "Contato encontrado no CRM"
    }))
  ].forEach((customer) => {
    const key = buildCustomerSearchKey(customer);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(customer);
  });
  return merged.slice(0, 40);
}

function buildUnifiedProductSearchText(product = {}) {
  return normalizeLookup([
    product.id,
    product.product_id,
    product.codigo,
    product.sku,
    product.codigo_tiny,
    product.codigo_etiqueta,
    product.ean,
    product.codigo_barras,
    product.barcode,
    product.gtin,
    product.gtin_ean,
    product.codigo_interno,
    product.nome,
    product.name,
    product.descricao,
    product.short_description,
    product.marca,
    product.categoria,
    product.category,
    product.tipo,
    product.cor,
    product.color,
    product.tamanho
  ].join(" "));
}

const PRODUCT_SIZE_TOKENS = new Set([
  "pp", "p", "m", "g", "gg", "xg", "xgg", "eg", "egg", "un", "u",
  "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48"
]);

function tokenizeProductSearchQuery(query = "") {
  const normalized = normalizeLookup(query || "");
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .map((token) => normalizeLookup(token || ""))
    .filter(Boolean)
    .filter((token, index, list) => {
      if (token.length > 1) return true;
      return PRODUCT_SIZE_TOKENS.has(token) && list.length > 1;
    })
    .filter((token, index, list) => list.indexOf(token) === index);
}

function splitSearchFieldTokens(value = "") {
  return normalizeLookup(value || "").split(/\s+/).filter(Boolean);
}

function fieldHasExactSearchToken(value = "", token = "") {
  const normalizedToken = normalizeLookup(token || "");
  if (!normalizedToken) return false;
  return splitSearchFieldTokens(value).includes(normalizedToken);
}

function productHasSearchToken(product = {}, token = "") {
  const normalizedToken = normalizeLookup(token || "");
  if (!normalizedToken) return true;
  if (PRODUCT_SIZE_TOKENS.has(normalizedToken)) {
    return [
      product.tamanho,
      product.size,
      product.grade,
      product.sizes,
      product.nome,
      product.name,
      product.categoria,
      product.category,
      product.tipo,
      product.cor,
      product.color
    ].some((value) => fieldHasExactSearchToken(value, normalizedToken));
  }
  if (/^\d{1,3}$/.test(normalizedToken)) {
    return [
      product.tamanho,
      product.size,
      product.grade,
      product.sizes,
      product.nome,
      product.name,
      product.sku,
      product.codigo,
      product.codigo_tiny,
      product.codigo_etiqueta,
      product.codigo_interno
    ].some((value) => fieldHasExactSearchToken(value, normalizedToken) || normalizeLookup(value || "").includes(normalizedToken));
  }
  return buildUnifiedProductSearchText(product).includes(normalizedToken);
}

function productMatchesTokenSearch(product = {}, query = "", tokens = null) {
  const normalizedQuery = normalizeLookup(query || "");
  if (!normalizedQuery) return true;
  const searchTokens = Array.isArray(tokens) ? tokens : tokenizeProductSearchQuery(query);
  if (!searchTokens.length) return buildUnifiedProductSearchText(product).includes(normalizedQuery);
  return searchTokens.every((token) => productHasSearchToken(product, token));
}

function scoreProductTokenSearchMatch(product = {}, query = "", tokens = null) {
  const searchTokens = Array.isArray(tokens) ? tokens : tokenizeProductSearchQuery(query);
  if (!searchTokens.length) return 0;
  const strongText = normalizeLookup([
    product.marca,
    product.brand,
    product.categoria,
    product.category,
    product.tipo,
    product.tamanho,
    product.size,
    product.grade,
    product.sizes,
    product.cor,
    product.color
  ].join(" "));
  const nameText = normalizeLookup([product.nome, product.name, product.descricao, product.short_description].join(" "));
  const allText = buildUnifiedProductSearchText(product);
  let score = 0;
  searchTokens.forEach((token) => {
    if (strongText.includes(token) || fieldHasExactSearchToken(strongText, token)) score += 90;
    if (nameText.includes(token) || fieldHasExactSearchToken(nameText, token)) score += 55;
    if (allText.includes(token)) score += 20;
  });
  if (searchTokens.every((token) => strongText.includes(token) || fieldHasExactSearchToken(strongText, token))) score += 220;
  if (searchTokens.every((token) => nameText.includes(token) || fieldHasExactSearchToken(nameText, token))) score += 140;
  return score;
}

function buildProductSearchIdentifiers(product = {}) {
  return {
    textCodes: [
      product.sku,
      product.codigo_tiny,
      product.tiny_id,
      product.codigo_etiqueta,
      product.codigo_interno,
      product.codigo,
      product.product_id,
      product.id
    ].map((value) => normalizeCodeLookup(value)).filter(Boolean),
    digitCodes: [
      product.ean,
      product.codigo_barras,
      product.barcode,
      product.gtin,
      product.gtin_ean
    ].map((value) => normalizeDigits(value)).filter(Boolean),
    name: normalizeLookup(product.nome || product.name || ""),
    text: buildUnifiedProductSearchText(product)
  };
}

function scoreProductSearchMatch(product = {}, query = "") {
  const textQuery = normalizeCodeLookup(query);
  const digitsQuery = normalizeDigits(query);
  const normalizedTextQuery = normalizeLookup(query);
  const identifiers = buildProductSearchIdentifiers(product);
  let score = 0;
  if (digitsQuery && identifiers.digitCodes.includes(digitsQuery)) score = Math.max(score, 1300);
  if (textQuery && identifiers.textCodes.includes(textQuery)) score = Math.max(score, 1200);
  if (textQuery && identifiers.textCodes.some((value) => value.startsWith(textQuery))) score = Math.max(score, 980);
  if (textQuery && identifiers.textCodes.some((value) => value.includes(textQuery))) score = Math.max(score, 920);
  if (normalizedTextQuery && identifiers.name === normalizedTextQuery) score = Math.max(score, 820);
  if (normalizedTextQuery && identifiers.text.includes(normalizedTextQuery)) score = Math.max(score, 420);
  score = Math.max(score, scoreProductTokenSearchMatch(product, query));
  return score;
}

function isStrictProductCodeSearch(query = "") {
  const raw = normalizeText(query || "");
  if (!raw || /\s/.test(raw)) {
    return false;
  }
  const code = normalizeCodeLookup(raw);
  const digits = normalizeDigits(raw);
  if (digits && digits.length >= 5 && /^[\d.\-_/]+$/.test(raw)) {
    return true;
  }
  if (/[a-z]/i.test(raw) && /\d/.test(raw) && code.length >= 6) {
    return true;
  }
  return /^(sku|cod|codigo|qa|prd|codex)[a-z0-9._-]+$/i.test(raw);
}

function productMatchesExactIdentifier(product = {}, query = "") {
  const textQuery = normalizeCodeLookup(query);
  const digitsQuery = normalizeDigits(query);
  const identifiers = buildProductSearchIdentifiers(product);
  return Boolean(
    (textQuery && identifiers.textCodes.includes(textQuery))
    || (digitsQuery && identifiers.digitCodes.includes(digitsQuery))
  );
}

const PRODUCT_SOURCE_PRIORITY = {
  PDV_ESTOQUE: 300,
  PDV_IMPORT: 200,
  CRM_CATALOG: 100
};

function getProductSourcePriority(product = {}) {
  const origin = normalizeText(product.origin || "").toUpperCase();
  if (PRODUCT_SOURCE_PRIORITY[origin]) {
    return PRODUCT_SOURCE_PRIORITY[origin];
  }
  const label = normalizeLookup([product.origin_label, ...(product.origins || [])].join(" "));
  if (label.includes("estoque operacional")) return PRODUCT_SOURCE_PRIORITY.PDV_ESTOQUE;
  if (label.includes("pdv import")) return PRODUCT_SOURCE_PRIORITY.PDV_IMPORT;
  if (label.includes("crm") || label.includes("tiny") || label.includes("vitrine")) return PRODUCT_SOURCE_PRIORITY.CRM_CATALOG;
  return 0;
}

function pickProductPrimaryRow(left = {}, right = {}) {
  const leftPriority = getProductSourcePriority(left);
  const rightPriority = getProductSourcePriority(right);
  if (rightPriority > leftPriority) {
    return { primary: right, secondary: left };
  }
  return { primary: left, secondary: right };
}

function buildProductDedupeIdentifiers(product = {}) {
  const textIdentifiers = [
    product.sku,
    product.codigo_etiqueta,
    product.codigo,
    product.codigo_tiny,
    product.codigo_interno
  ].map((value) => normalizeCodeLookup(value || "")).filter(Boolean);
  const digitIdentifiers = [
    product.ean,
    product.codigo_barras,
    product.barcode,
    product.gtin,
    product.gtin_ean
  ].map((value) => normalizeDigits(value || "")).filter(Boolean);
  return {
    textIdentifiers: uniqueStrings(textIdentifiers),
    digitIdentifiers: uniqueStrings(digitIdentifiers)
  };
}

function buildProductMatchKey(product = {}) {
  const identifiers = buildProductDedupeIdentifiers(product);
  return identifiers.textIdentifiers[0]
    || identifiers.digitIdentifiers[0]
    || normalizeText(product.product_id || "")
    || normalizeText(product.id || "")
    || normalizeLookup([product.nome, product.marca, product.cor, product.tamanho, product.store_id].join(" "));
}

function hasValidPromotionalPrice(normalPrice = 0, promotionalPrice = 0) {
  const normal = toNumber(normalPrice || 0);
  const promo = toNumber(promotionalPrice || 0);
  return promo > 0 && normal > 0 && promo < normal;
}

function applyProductEffectivePricing(product = {}, override = null) {
  const catalogPrice = toNumber(override?.price || 0);
  const catalogPromotionalPrice = toNumber(override?.promotional_price || 0);
  const currentPrice = toNumber(product.preco_venda || product.price || product.sale_price || 0);
  const normalPrice = catalogPrice > 0 ? catalogPrice : toNumber(product.original_price || product.compare_at_price || currentPrice || 0);
  const existingPromotionalPrice = toNumber(product.promotional_price || product.promotionalPrice || 0);
  const promotionalPrice = catalogPromotionalPrice > 0 ? catalogPromotionalPrice : existingPromotionalPrice;
  if (!hasValidPromotionalPrice(normalPrice, promotionalPrice)) {
    return {
      ...product,
      original_price: toNumber(product.original_price || product.compare_at_price || normalPrice || currentPrice || 0) || null,
      promotional_price: existingPromotionalPrice > 0 ? existingPromotionalPrice : null,
      used_promotional_price: Boolean(product.used_promotional_price)
    };
  }
  return {
    ...product,
    price: promotionalPrice,
    preco_venda: promotionalPrice,
    sale_price: promotionalPrice,
    original_price: normalPrice,
    compare_at_price: normalPrice,
    promotional_price: promotionalPrice,
    promotionalPrice: promotionalPrice,
    used_promotional_price: true,
    price_source: "catalog_promotional_price"
  };
}

async function applyCatalogPromotionalPriceOverrides(products = []) {
  const rows = Array.isArray(products) ? products : [];
  const lookupCodes = uniqueStrings(rows.flatMap((product) => {
    const identifiers = buildProductDedupeIdentifiers(product);
    return identifiers.textIdentifiers;
  })).slice(0, 220);
  if (!lookupCodes.length) {
    return rows.map((product) => applyProductEffectivePricing(product));
  }
  try {
    const placeholders = lookupCodes.map(() => "?").join(", ");
    const catalogRows = await all(
      `SELECT id, sku, codigo, tiny_id, price, promotional_price, updated_at
       FROM ai_products
       WHERE COALESCE(deleted_at, '') = ''
         AND (
           lower(COALESCE(sku, '')) IN (${placeholders})
           OR lower(COALESCE(codigo, '')) IN (${placeholders})
           OR lower(COALESCE(tiny_id, '')) IN (${placeholders})
         )
       ORDER BY updated_at DESC, id DESC`,
      [...lookupCodes, ...lookupCodes, ...lookupCodes]
    );
    const overrideMap = new Map();
    (catalogRows || []).forEach((row) => {
      const keys = uniqueStrings([row.sku, row.codigo, row.tiny_id].map((value) => normalizeCodeLookup(value || "")).filter(Boolean));
      keys.forEach((key) => {
        if (!overrideMap.has(key)) {
          overrideMap.set(key, row);
        }
      });
    });
    return rows.map((product) => {
      const identifiers = buildProductDedupeIdentifiers(product);
      const override = identifiers.textIdentifiers.map((key) => overrideMap.get(key)).find(Boolean) || null;
      return applyProductEffectivePricing(product, override);
    });
  } catch (error) {
    console.warn("[PDV][products] Falha ao aplicar overlay de preco promocional", {
      reason: normalizeText(error?.message || "unknown")
    });
    return rows.map((product) => applyProductEffectivePricing(product));
  }
}

function normalizeUnifiedProductStatusValue(value = "", fallbackQty = 0) {
  const normalized = normalizeLookup(value || "");
  if (normalized === "pending review" || normalized === "pending_review") return "pending_review";
  if (normalized === "pending migration" || normalized === "pending_migration") return "pending_migration";
  if (["active", "ativo", "available", "disponivel"].includes(normalized)) return "active";
  if (["out", "inactive", "inativo", "esgotado", "sold_out"].includes(normalized)) return "out";
  if (!normalized) {
    return toNumber(fallbackQty) > 0 ? "active" : "out";
  }
  return normalized.replace(/\s+/g, "_");
}

function getUnifiedProductStatusLabel(status = "") {
  const normalized = normalizeUnifiedProductStatusValue(status);
  if (normalized === "pending_review") return "Pendente de revisao";
  if (normalized === "pending_migration") return "Migracao pendente";
  if (normalized === "active") return "Ativo";
  if (normalized === "out") return "Sem saldo";
  return normalizeText(status || normalized || "Ativo") || "Ativo";
}

function mergeUnifiedProductRow(target = {}, source = {}) {
  const { primary, secondary } = pickProductPrimaryRow(target, source);
  const mergedOrigins = uniqueStrings([...(target.origins || []), ...(source.origins || []), source.origin_label]);
  const targetPrice = toNumber(target.preco_venda || 0);
  const sourcePrice = toNumber(source.preco_venda || 0);
  const primaryPrice = toNumber(primary.preco_venda || 0);
  const secondaryPrice = toNumber(secondary.preco_venda || 0);
  const primaryPromotionalPrice = toNumber(primary.promotional_price || primary.promotionalPrice || 0);
  const secondaryPromotionalPrice = toNumber(secondary.promotional_price || secondary.promotionalPrice || 0);
  const primaryOriginalPrice = toNumber(primary.original_price || primary.compare_at_price || 0);
  const secondaryOriginalPrice = toNumber(secondary.original_price || secondary.compare_at_price || 0);
  const priceConflict = Boolean(
    targetPrice > 0
    && sourcePrice > 0
    && Math.abs(targetPrice - sourcePrice) >= 0.01
  );
  const merged = {
    ...secondary,
    ...primary,
    id: normalizeText(primary.id || secondary.id || primary.product_id || primary.sku || primary.codigo || secondary.product_id || secondary.sku || secondary.codigo || buildId("PRD")),
    product_id: normalizeText(primary.product_id || secondary.product_id || ""),
    codigo: normalizeText(primary.codigo || secondary.codigo || ""),
    sku: normalizeText(primary.sku || secondary.sku || ""),
    codigo_tiny: normalizeText(primary.codigo_tiny || secondary.codigo_tiny || ""),
    codigo_etiqueta: normalizeText(primary.codigo_etiqueta || secondary.codigo_etiqueta || ""),
    ean: normalizeDigits(primary.ean || secondary.ean || primary.codigo_barras || secondary.codigo_barras || ""),
    codigo_barras: normalizeDigits(primary.codigo_barras || secondary.codigo_barras || primary.ean || secondary.ean || ""),
    codigo_interno: normalizeText(primary.codigo_interno || secondary.codigo_interno || ""),
    nome: normalizeText(primary.nome || secondary.nome || ""),
    descricao: normalizeText(primary.descricao || secondary.descricao || ""),
    marca: normalizeText(primary.marca || secondary.marca || ""),
    categoria: normalizeText(primary.categoria || secondary.categoria || ""),
    linha_genero: normalizeText(primary.linha_genero || secondary.linha_genero || ""),
    tipo: normalizeText(primary.tipo || secondary.tipo || ""),
    cor: normalizeText(primary.cor || secondary.cor || ""),
    tamanho: normalizeText(primary.tamanho || secondary.tamanho || ""),
    preco_venda: primaryPrice > 0 ? primaryPrice : secondaryPrice,
    original_price: primaryOriginalPrice > 0 ? primaryOriginalPrice : (secondaryOriginalPrice > 0 ? secondaryOriginalPrice : null),
    compare_at_price: primaryOriginalPrice > 0 ? primaryOriginalPrice : (secondaryOriginalPrice > 0 ? secondaryOriginalPrice : null),
    promotional_price: primaryPromotionalPrice > 0 ? primaryPromotionalPrice : (secondaryPromotionalPrice > 0 ? secondaryPromotionalPrice : null),
    promotionalPrice: primaryPromotionalPrice > 0 ? primaryPromotionalPrice : (secondaryPromotionalPrice > 0 ? secondaryPromotionalPrice : null),
    used_promotional_price: Boolean(primary.used_promotional_price || secondary.used_promotional_price),
    estoque: Math.max(toNumber(target.estoque || 0), toNumber(source.estoque || 0)),
    available_qty: Math.max(toNumber(target.available_qty || 0), toNumber(source.available_qty || 0)),
    reserved_qty: Math.max(toNumber(target.reserved_qty || 0), toNumber(source.reserved_qty || 0)),
    unavailable_qty: Math.max(toNumber(target.unavailable_qty || 0), toNumber(source.unavailable_qty || 0)),
    media_id: Number(primary.media_id || secondary.media_id || 0) || null,
    photo_preview_url: normalizeText(primary.photo_preview_url || secondary.photo_preview_url || primary.preview_url || secondary.preview_url || ""),
    media_url: normalizeText(primary.media_url || secondary.media_url || ""),
    foto: normalizeText(primary.foto || secondary.foto || primary.photo_preview_url || secondary.photo_preview_url || ""),
    observacao: normalizeText(primary.observacao || secondary.observacao || ""),
    store_id: normalizeStoreKey(primary.store_id || secondary.store_id || ""),
    tags: uniqueStrings([...(target.tags || []), ...(source.tags || [])]),
    origins: mergedOrigins,
    origin_label: mergedOrigins.join(" + "),
    cashback_blocked_for_redemption: Boolean(target.cashback_blocked_for_redemption || source.cashback_blocked_for_redemption),
    source_priority: Math.max(getProductSourcePriority(target), getProductSourcePriority(source)),
    price_conflict: Boolean(target.price_conflict || source.price_conflict || priceConflict),
    price_conflict_sources: priceConflict
      ? uniqueStrings([...(target.price_conflict_sources || []), target.origin || target.origin_label || "", source.origin || source.origin_label || ""].filter(Boolean))
      : uniqueStrings([...(target.price_conflict_sources || []), ...(source.price_conflict_sources || [])])
  };
  merged.status = normalizeUnifiedProductStatusValue(
    target.status || source.status || "",
    merged.available_qty || merged.estoque || 0
  );
  merged.status_label = getUnifiedProductStatusLabel(merged.status);
  merged.availability_label = getProductAvailabilityLabel(merged.available_qty || merged.estoque || 0);
  return merged;
}

function cloneOperationalSourceOption(option = null) {
  if (!option || typeof option !== "object") {
    return null;
  }
  return {
    store_id: normalizeStoreKey(option.store_id || ""),
    store_name: normalizeText(option.store_name || formatStoreLabel(option.store_id || "")),
    inventory_id: normalizeText(option.inventory_id || ""),
    product_id: normalizeText(option.product_id || ""),
    sku: normalizeText(option.sku || ""),
    codigo: normalizeText(option.codigo || ""),
    available_qty: toNumber(option.available_qty || 0),
    tiny_stock_quantity: toNumber(option.tiny_stock_quantity || 0),
    estoque_status: normalizeText(option.estoque_status || ""),
    inventory_status: normalizeText(option.inventory_status || ""),
    needs_physical_confirmation: Boolean(option.needs_physical_confirmation),
    stock_count_confirmed: Boolean(option.stock_count_confirmed),
    is_provisional: Boolean(option.is_provisional),
    is_divergent: Boolean(option.is_divergent),
    logistics_group: normalizeText(option.logistics_group || ""),
    logistics_relation: normalizeText(option.logistics_relation || "")
  };
}

function buildOperationalProductSummary(item = {}, availability = null, saleStoreId = "") {
  const saleStoreLabel = formatStoreLabel(saleStoreId || "");
  const saleStoreText = getStoreDisplayText(saleStoreId || saleStoreLabel || "");
  if (!availability) {
    const fallbackQty = toNumber(item.available_qty || item.estoque || 0);
    return {
      status: fallbackQty > 0 ? "AVAILABLE_LOCAL" : "UNAVAILABLE",
      summary: fallbackQty > 0
        ? `Disponível ${saleStoreText.in || "na loja atual"} - ${fallbackQty} un.`
        : "Sem saldo confirmado",
      detail: fallbackQty > 0 ? "Venda liberada na loja atual." : "Produto cadastrado no catálogo global. Confirme fisicamente antes de vender.",
      button_label: fallbackQty > 0 ? "Adicionar" : "Conferir",
      can_add_directly: fallbackQty > 0,
      requires_resolution: fallbackQty <= 0,
      requires_logistics_review: false,
      is_unavailable: false
    };
  }
  if (availability.status === "AVAILABLE_LOCAL") {
    const qty = toNumber(availability.local_option?.available_qty || item.available_qty || item.estoque || 0);
    return {
      status: availability.status,
      summary: `Disponível ${saleStoreText.in || "na loja atual"} - ${qty} un.`,
      detail: "Venda normal com estoque da loja atual.",
      button_label: "Adicionar",
      can_add_directly: true,
      requires_resolution: false,
      requires_logistics_review: false,
      is_unavailable: false
    };
  }
  if (availability.status === "OUT_OF_STOCK_LOCAL") {
    return {
      status: availability.status,
      summary: `Sem estoque ${saleStoreText.in || "na loja atual"}`,
      detail: "Contagem fisica confirmada: 0 un. disponiveis.",
      button_label: "Indisponivel",
      can_add_directly: false,
      requires_resolution: false,
      requires_logistics_review: false,
      is_unavailable: true
    };
  }
  if (availability.status === "AVAILABLE_ADJACENT_STORE") {
    const adjacentLabel = normalizeText(availability.adjacent_option?.store_name || "loja vizinha");
    const adjacentText = getStoreDisplayText(availability.adjacent_option?.store_id || adjacentLabel);
    const qty = toNumber(availability.adjacent_option?.available_qty || 0);
    return {
      status: availability.status,
      summary: `Não disponível ${saleStoreText.in || "na loja atual"}`,
      detail: `Disponível ${adjacentText.in || `em ${adjacentLabel}`} - ${qty} un. para consulta/transferência.`,
      button_label: `Consultar ${adjacentText.name || adjacentLabel}`,
      can_add_directly: true,
      requires_resolution: false,
      requires_logistics_review: false,
      is_unavailable: false
    };
  }
  if (availability.status === "AVAILABLE_SAME_CITY") {
    const originOption = availability.same_city_options?.[0] || {};
    const originLabel = normalizeText(originOption.store_name || "outra loja da cidade");
    const originText = getStoreDisplayText(originOption.store_id || originLabel);
    const qty = toNumber(availability.same_city_options?.[0]?.available_qty || 0);
    return {
      status: availability.status,
      summary: `Não disponível ${saleStoreText.in || "na loja atual"}`,
      detail: `Disponível ${originText.in || `em ${originLabel}`} - ${qty} un. para consulta/transferência.`,
      button_label: `Consultar ${originText.name || originLabel}`,
      can_add_directly: false,
      requires_resolution: true,
      requires_logistics_review: false,
      is_unavailable: false
    };
  }
  if (availability.status === "PENDING_LOCAL_CONFIRMATION" || availability.status === "PROVISIONAL_DIVERGENT_LOCAL") {
    const localLabel = normalizeText(availability.local_option?.store_name || saleStoreLabel || "loja atual");
    const localText = getStoreDisplayText(availability.local_option?.store_id || saleStoreId || localLabel);
    return {
      status: availability.status,
      summary: availability.status === "PROVISIONAL_DIVERGENT_LOCAL"
        ? "Estoque em conferência"
        : `Pendente de conferência ${localText.in || `na ${localLabel}`}`,
      detail: "Estoque em inventário. Confirme fisicamente a peça antes de vender.",
      button_label: "Confirmar fisicamente",
      can_add_directly: false,
      requires_resolution: true,
      requires_logistics_review: false,
      is_unavailable: false
    };
  }
  if (availability.status === "PENDING_OTHER_STORE_CONFIRMATION") {
    const origin = availability.pending_other_store_options?.[0] || availability.source_options?.[0] || {};
    const originLabel = normalizeText(origin.store_name || "outra loja");
    const originText = getStoreDisplayText(origin.store_id || originLabel);
    const divergent = Boolean(origin.is_divergent);
    return {
      status: availability.status,
      summary: `Consultar ${originText.name || originLabel}`,
      detail: divergent
        ? `Estoque em conferência ${originText.in || `em ${originLabel}`} - confirmar fisicamente.`
        : `${originText.name || originLabel} sem saldo confirmado - consultar e confirmar fisicamente.`,
      button_label: `Consultar ${originText.name || originLabel}`,
      can_add_directly: false,
      requires_resolution: true,
      requires_logistics_review: false,
      is_unavailable: false
    };
  }
  if (availability.status === "LOGISTICS_REVIEW_REQUIRED") {
    const originOption = availability.other_region_options?.[0] || {};
    const originLabel = normalizeText(originOption.store_name || "outra loja");
    const originText = getStoreDisplayText(originOption.store_id || originLabel);
    return {
      status: availability.status,
      summary: `Disponível ${originText.in || `em ${originLabel}`}`,
      detail: "Requer análise logística antes da conclusão.",
      button_label: "Enviar para análise",
      can_add_directly: false,
      requires_resolution: false,
      requires_logistics_review: true,
      is_unavailable: false
    };
  }
  return {
    status: "NO_KNOWN_STOCK",
    summary: "Sem saldo conhecido",
    detail: "Produto cadastrado no catálogo global - conferir fisicamente antes de vender.",
    button_label: "Conferir",
    can_add_directly: false,
    requires_resolution: true,
    requires_logistics_review: false,
    is_unavailable: false
  };
}

function enrichProductOperationalAvailability(item = {}, saleStoreId = "") {
  const normalizedSaleStore = normalizeStoreKey(saleStoreId || item.sale_store_id || item.loja || item.store_id || "");
  let availability = null;
  try {
    const { getProductOperationalAvailability, FULFILLMENT_MODES, FULFILLMENT_STATUS } = require("../inventory/pdvInventoryService");
    availability = getProductOperationalAvailability({
      ...item,
      // Na busca/listagem do PDV precisamos calcular a disponibilidade do produto
      // em todo o mapa multiloja. Se prendermos ao inventory_id do primeiro match,
      // o item pode parecer indisponível mesmo existindo saldo em outra origem válida.
      inventory_id: "",
      selected_inventory_id: ""
    }, normalizedSaleStore);
    const presentation = buildOperationalProductSummary(item, availability, normalizedSaleStore);
    const preferredSource = cloneOperationalSourceOption(availability.preferred_option);
    const adjacentSource = cloneOperationalSourceOption(availability.adjacent_option);
    const localSource = cloneOperationalSourceOption(availability.local_option);
    let fulfillmentType = "";
    let fulfillmentMode = "";
    let fulfillmentStatus = "";
    let stockSource = preferredSource;
    if (availability.status === "AVAILABLE_LOCAL") {
      fulfillmentType = "LOCAL_STOCK";
      fulfillmentMode = FULFILLMENT_MODES.NORMAL;
      fulfillmentStatus = FULFILLMENT_STATUS.CONFIRMED;
      stockSource = localSource || preferredSource;
    } else if (availability.status === "AVAILABLE_ADJACENT_STORE") {
      fulfillmentType = "ADJACENT_STORE_STOCK";
      fulfillmentMode = FULFILLMENT_MODES.ADJACENT_STORE;
      fulfillmentStatus = FULFILLMENT_STATUS.CONFIRMED;
      stockSource = adjacentSource || preferredSource;
    } else if (availability.status === "LOGISTICS_REVIEW_REQUIRED") {
      fulfillmentType = "LOGISTICS_REVIEW";
      fulfillmentMode = FULFILLMENT_MODES.LOGISTICS_REVIEW;
      fulfillmentStatus = FULFILLMENT_STATUS.PENDING_ANALYSIS;
    }
    return {
      ...item,
      sale_store_id: normalizedSaleStore,
      sale_store_name: formatStoreLabel(normalizedSaleStore),
      stock_source_store_id: normalizeStoreKey(stockSource?.store_id || ""),
      stock_source_store_name: normalizeText(stockSource?.store_name || ""),
      resolved_inventory_id: normalizeText(stockSource?.inventory_id || item.inventory_id || ""),
      resolved_product_id: normalizeText(stockSource?.product_id || item.product_id || ""),
      same_city_options: (availability.same_city_options || []).map((option) => cloneOperationalSourceOption(option)).filter(Boolean),
      other_region_options: (availability.other_region_options || []).map((option) => cloneOperationalSourceOption(option)).filter(Boolean),
      pending_other_store_options: (availability.pending_other_store_options || []).map((option) => cloneOperationalSourceOption(option)).filter(Boolean),
      source_options: (availability.source_options || []).map((option) => cloneOperationalSourceOption(option)).filter(Boolean),
      operational_stock_status: presentation.status,
      operational_summary: presentation.summary,
      operational_detail: presentation.detail,
      action_label: presentation.button_label,
      can_add_directly: presentation.can_add_directly,
      requires_resolution: presentation.requires_resolution,
      requires_logistics_review: presentation.requires_logistics_review,
      is_unavailable: presentation.is_unavailable,
      fulfillment_type: fulfillmentType,
      fulfillment_mode: fulfillmentMode,
      fulfillment_status: fulfillmentStatus,
      is_adjacent_store: availability.status === "AVAILABLE_ADJACENT_STORE",
      available_in_sale_store_qty: toNumber(availability.local_option?.available_qty || 0),
      adjacent_store_name: normalizeText(adjacentSource?.store_name || ""),
      adjacent_available_qty: toNumber(adjacentSource?.available_qty || 0)
    };
  } catch (error) {
    return {
      ...item,
      sale_store_id: normalizedSaleStore,
      sale_store_name: formatStoreLabel(normalizedSaleStore)
    };
  }
}

function filterUnifiedProducts(items = [], { storeId = "", status = "", pendingOnly = false } = {}) {
  const normalizedStoreId = normalizeStoreKey(storeId || "");
  const normalizedStatus = normalizeUnifiedProductStatusValue(status || "");
  return (Array.isArray(items) ? items : []).filter((item) => {
    const itemStatus = normalizeUnifiedProductStatusValue(item.status || "", item.available_qty || item.estoque || 0);
    const itemStore = normalizeStoreKey(item.store_id || "");
    if (normalizedStoreId && itemStore && itemStore !== "loja_geral" && !storesMatch(itemStore, normalizedStoreId)) {
      return false;
    }
    if (pendingOnly && itemStatus !== "pending_review") {
      return false;
    }
    if (!normalizedStatus || normalizedStatus === "all") {
      return true;
    }
    return itemStatus === normalizedStatus;
  });
}

async function searchProductsDetailed(query = "", { storeId = "", page = 1, limit = 24 } = {}) {
  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = normalizeSearchLimit(limit, 24, 100);
  if (!canRunPdvProductSearch(query)) {
    return {
      sources_consulted: [],
      results_by_source: {
        inventory: [],
        pdv_dataset: [],
        crm_catalog: []
      },
      discarded: [],
      unified: [],
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: 0,
        totalPages: 1,
        total_pages: 1,
        has_more: false
      }
    };
  }
  const normalizedQuery = normalizeLookup(query);
  const searchTokens = tokenizeProductSearchQuery(query);
  const strictCodeSearch = isStrictProductCodeSearch(query);
  const resultsBySource = {
    inventory: [],
    pdv_dataset: [],
    crm_catalog: []
  };
  const discarded = [];
  let inventoryPagination = null;

  try {
    const { listInventoryProducts } = require("../inventory/pdvInventoryService");
    const inventoryPayload = listInventoryProducts({ q: query, storeId, page: safePage, limit: safeLimit });
    inventoryPagination = inventoryPayload.pagination || null;
    resultsBySource.inventory = (inventoryPayload.items || [])
      .filter((item) => (
        item.sale_enabled !== false
        && !["bloqueado_para_venda", "inativo", "deleted", "hidden"].includes(normalizeLookup(item.product_status || ""))
      ))
      .map((item) => ({
        ...item,
        id: normalizeText(item.id || item.product_id || item.sku || item.codigo || ""),
        estoque: toNumber(item.available_qty ?? item.estoque ?? 0),
        origin: "PDV_ESTOQUE",
        origin_label: "PDV + estoque operacional",
        origins: ["PDV + estoque operacional"],
        cashback_blocked_for_redemption: Boolean(item.cashback_blocked_for_redemption)
      }));
  } catch (error) {
    resultsBySource.inventory = [];
  }

  const datasetProducts = loadProductsDataset();
  resultsBySource.pdv_dataset = datasetProducts
    .filter((product) => {
      if (!normalizedQuery) return true;
      if (strictCodeSearch) return productMatchesExactIdentifier(product, query);
      return productMatchesTokenSearch(product, query, searchTokens);
    })
    .slice((safePage - 1) * safeLimit, safePage * safeLimit)
    .map((product) => ({
      id: normalizeText(product.product_id || product.sku || product.codigo || product.nome || buildId("PRD")),
      product_id: normalizeText(product.product_id || ""),
      codigo: normalizeText(product.codigo || ""),
      sku: normalizeText(product.sku || product.codigo || ""),
      codigo_tiny: normalizeText(product.codigo_tiny || ""),
      codigo_etiqueta: normalizeText(product.codigo_etiqueta || ""),
      ean: normalizeDigits(product.ean || product.codigo_barras || ""),
      codigo_barras: normalizeDigits(product.codigo_barras || product.ean || ""),
      codigo_interno: normalizeText(product.codigo_interno || ""),
      nome: normalizeText(product.nome || ""),
      marca: normalizeText(product.marca || ""),
      categoria: normalizeText(product.categoria || ""),
      linha_genero: normalizeText(product.linha_genero || ""),
      tipo: normalizeText(product.tipo || ""),
      cor: normalizeText(product.cor || ""),
      tamanho: normalizeText(product.tamanho || ""),
      descricao: normalizeText(product.descricao || ""),
      preco_venda: toNumber(product.preco_venda || product.price || 0),
      estoque: toNumber(product.estoque),
      available_qty: toNumber(product.estoque),
      reserved_qty: 0,
      unavailable_qty: 0,
      store_id: normalizeStoreKey(product.store_id || storeId || "LOJA_GERAL"),
      image: "",
      origin: "PDV_IMPORT",
      origin_label: "PDV importado",
      origins: ["PDV importado"],
      cashback_blocked_for_redemption: Boolean(product.cashback_blocked_for_redemption),
      tags: [normalizeText(product.marca || ""), normalizeText(product.categoria || ""), normalizeText(product.tipo || "")].filter(Boolean)
    }));

  if (normalizedQuery) {
    try {
      const effectiveTokens = searchTokens.length ? searchTokens : [normalizedQuery];
      const codeLookup = `%${normalizeCodeLookup(query)}%`;
      const digitLookup = `%${normalizeDigits(query)}%`;
      const tokenClauses = effectiveTokens.map(() => `(
             lower(COALESCE(name, '')) LIKE ?
             OR lower(COALESCE(commercial_name, '')) LIKE ?
             OR lower(COALESCE(marca, '')) LIKE ?
             OR lower(COALESCE(category, '')) LIKE ?
             OR lower(COALESCE(color, '')) LIKE ?
             OR lower(COALESCE(sizes, '')) LIKE ?
             OR COALESCE(sku, '') LIKE ?
             OR COALESCE(codigo, '') LIKE ?
             OR COALESCE(gtin_ean, '') LIKE ?
           )`).join(" AND ");
      const tokenParams = effectiveTokens.flatMap((token) => {
        const tokenLookup = `%${token}%`;
        return [tokenLookup, tokenLookup, tokenLookup, tokenLookup, tokenLookup, tokenLookup, tokenLookup, tokenLookup, tokenLookup];
      });
      const crmCatalogRows = await all(
        `SELECT id, name, commercial_name, sku, codigo, gtin_ean, marca, category, color, sizes, price, promotional_price, cost_price, store, short_description, estoque_total, size_stock_json, source, status, main_media_id
         FROM ai_products
         WHERE COALESCE(deleted_at, '') = ''
           AND ${strictCodeSearch
             ? "(lower(COALESCE(sku, '')) LIKE ? OR lower(COALESCE(codigo, '')) LIKE ? OR COALESCE(gtin_ean, '') LIKE ?)"
             : tokenClauses}
         ORDER BY updated_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [
          ...(strictCodeSearch ? [codeLookup, codeLookup, digitLookup] : tokenParams),
          ...(strictCodeSearch ? [safeLimit * 3, 0] : [safeLimit, (safePage - 1) * safeLimit])
        ]
      );
      resultsBySource.crm_catalog = crmCatalogRows
        .filter((product) => normalizeLookup(product.status || "ativo") === "ativo")
        .filter((product) => strictCodeSearch
          ? productMatchesExactIdentifier(product, query)
          : productMatchesTokenSearch(product, query, searchTokens))
        .flatMap((product) => {
          const sizeStock = normalizeLookup(product.source || "") === "manual"
            ? normalizeManualProductSizeStockEntries(product.size_stock_json || [])
            : [];
          const variants = sizeStock.length
            ? sizeStock
            : [{ size: normalizeText(product.sizes || ""), quantity: toNumber(product.estoque_total || 0) }];
          return variants.map((variant) => {
            const variantIdentity = sizeStock.length
              ? buildManualProductSizeVariantIdentity(product, variant.size)
              : null;
            const baseCode = normalizeText(product.sku || product.codigo || "");
            return {
              id: normalizeText(variantIdentity?.sku || baseCode || `AI_${product.id}`),
              product_id: normalizeText(variantIdentity?.productId || `AI_${product.id}`),
              codigo: normalizeText(variantIdentity?.sku || product.codigo || ""),
              sku: normalizeText(variantIdentity?.sku || baseCode),
              codigo_tiny: "",
              codigo_etiqueta: sizeStock.length ? baseCode : "",
              ean: normalizeDigits(product.gtin_ean || ""),
              codigo_barras: normalizeDigits(product.gtin_ean || ""),
              codigo_interno: baseCode,
              parent_sku: sizeStock.length ? baseCode : "",
              manual_parent_product_id: sizeStock.length ? variantIdentity.parentProductId : "",
              manual_size_key: sizeStock.length ? variantIdentity.sizeKey : "",
              stock_count_confirmed: sizeStock.length,
              nome: normalizeText(product.name || product.commercial_name || ""),
              marca: normalizeText(product.marca || ""),
              categoria: normalizeText(product.category || ""),
              tipo: "",
              cor: normalizeText(product.color || ""),
              tamanho: normalizeText(variant.size || product.sizes || ""),
              grade: normalizeText(product.sizes || ""),
              descricao: normalizeText(product.short_description || ""),
              preco_venda: hasValidPromotionalPrice(product.price, product.promotional_price) ? toNumber(product.promotional_price || 0) : toNumber(product.price || 0),
              original_price: toNumber(product.price || 0) || null,
              compare_at_price: toNumber(product.price || 0) || null,
              promotional_price: toNumber(product.promotional_price || 0) || null,
              promotionalPrice: toNumber(product.promotional_price || 0) || null,
              used_promotional_price: hasValidPromotionalPrice(product.price, product.promotional_price),
              estoque: toNumber(variant.quantity || 0),
              available_qty: toNumber(variant.quantity || 0),
              reserved_qty: 0,
              unavailable_qty: 0,
              store_id: normalizeStoreKey(product.store || storeId || "CRM"),
              image: product.main_media_id ? `/api/uploads/media/${Number(product.main_media_id)}/preview` : "",
              photo_preview_url: product.main_media_id ? `/api/uploads/media/${Number(product.main_media_id)}/preview` : "",
              media_id: Number(product.main_media_id || 0) || null,
              origin: "CRM_CATALOG",
              origin_label: "CRM/Tiny/Vitrine",
              origins: ["CRM/Tiny/Vitrine"],
              cashback_blocked_for_redemption: normalizeLookup(product.category || "").includes("perfume"),
              tags: [normalizeText(product.marca || ""), normalizeText(product.category || "")].filter(Boolean)
            };
          });
        });
    } catch (error) {
      resultsBySource.crm_catalog = [];
    }
  }

  const mergedMap = new Map();
  Object.entries(resultsBySource).forEach(([sourceName, rows]) => {
    rows.forEach((row) => {
      const key = buildProductMatchKey(row);
      if (!key) {
        discarded.push({ source: sourceName, reason: "missing-key", row });
        return;
      }
      if (mergedMap.has(key)) {
        mergedMap.set(key, mergeUnifiedProductRow(mergedMap.get(key), row));
        discarded.push({ source: sourceName, reason: "merged-duplicate", key, row });
        return;
      }
      mergedMap.set(key, mergeUnifiedProductRow({}, row));
    });
  });

  const pricedUnified = await applyCatalogPromotionalPriceOverrides(Array.from(mergedMap.values()));
  const unified = pricedUnified
    .map((item) => enrichProductOperationalAvailability(item, storeId))
    .filter((item) => strictCodeSearch
      ? productMatchesExactIdentifier(item, query)
      : productMatchesTokenSearch(item, query, searchTokens))
    .sort((left, right) => {
      const exactDelta = Number(productMatchesExactIdentifier(right, query)) - Number(productMatchesExactIdentifier(left, query));
      if (exactDelta !== 0) {
        return exactDelta;
      }
      const matchDelta = scoreProductSearchMatch(right, query) - scoreProductSearchMatch(left, query);
      if (matchDelta !== 0) {
        return matchDelta;
      }
      const availabilityDelta = toNumber(right.available_qty || right.estoque || 0) - toNumber(left.available_qty || left.estoque || 0);
      if (availabilityDelta !== 0) {
        return availabilityDelta;
      }
      return toNumber(right.preco_venda || 0) - toNumber(left.preco_venda || 0);
    })
    .slice(0, safeLimit);
  const inventoryTotal = Number(inventoryPagination?.total || 0);
  const dedupedVisibleTotal = (safePage - 1) * safeLimit + unified.length;
  const total = strictCodeSearch
    ? dedupedVisibleTotal
    : Math.max(inventoryTotal, dedupedVisibleTotal);
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  return {
    sources_consulted: ["inventory", "pdv_dataset", "crm_catalog"],
    results_by_source: resultsBySource,
    discarded,
    unified,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages,
      total_pages: totalPages,
      has_more: safePage < totalPages
    }
  };
}

function buildCustomerSignals(customer = {}) {
  const normalizedPhoneValue = normalizePhone(customer.phone || "");
  const normalizedDocumentValue = normalizeDigits(customer.document || "");
  const normalizedNameValue = normalizeLookup(customer.name || "");
  return {
    masterId: normalizeText(customer.master_customer_id || ""),
    phone: normalizedPhoneValue,
    phoneTail: normalizedPhoneValue.slice(-9),
    document: normalizedDocumentValue,
    name: normalizedNameValue
  };
}

function matchesBehaviorCustomer(customer = {}, signals = {}) {
  const phone = normalizePhone(customer.phone || customer.mobile || customer.customer_phone || customer.buyer_phone || "");
  const document = normalizeDigits(customer.document || customer.customer_document || "");
  const name = normalizeLookup(customer.name || customer.customer_name || customer.buyer_name || "");
  return Boolean(
    (signals.masterId && normalizeText(customer.master_customer_id || "") === signals.masterId)
    || (signals.document && document && document === signals.document)
    || (signals.phone && phone && phone === signals.phone)
    || (signals.phoneTail && phone && phone.endsWith(signals.phoneTail))
    || (signals.name && name && (name === signals.name || name.includes(signals.name) || signals.name.includes(name)))
  );
}

async function searchCustomersDetailed(query = "", { limit = 15 } = {}) {
  const safeLimit = normalizeSearchLimit(limit, 15, 15);
  if (!canRunPdvCustomerSearch(query)) {
    return {
      sources_consulted: [],
      results_by_source: {
        pdv_consolidated: [],
        pdv_quick: [],
        crm_contacts: [],
        crm_legacy: []
      },
      discarded: [],
      unified: []
    };
  }
  const normalizedQuery = normalizeLookup(query);
  const normalizedPhoneQuery = normalizePhoneLookup(query);
  const consolidated = loadConsolidatedCustomers();
  const quickCustomers = loadQuickCustomers();
  const resultsBySource = {
    pdv_consolidated: [],
    pdv_quick: [],
    crm_contacts: [],
    crm_legacy: []
  };
  resultsBySource.pdv_consolidated = consolidated
    .filter((customer) => matchesCustomerSearch(customer, normalizedQuery, normalizedPhoneQuery))
    .slice(0, safeLimit)
    .map((customer) => ({
      ...customer,
      origin: "PDV",
      origin_label: "Cliente PDV",
      cashback_legado: 0,
      cashback_legacy_origin: "",
      crm_contact_id: null,
      legacy_contact_id: null
    }));

  resultsBySource.pdv_quick = quickCustomers
    .filter((customer) => matchesCustomerSearch(customer, normalizedQuery, normalizedPhoneQuery))
    .slice(0, safeLimit)
    .map((item) => ({
      master_customer_id: item.id,
      name: item.name,
      phone: item.phone,
      document: "",
      total_comprado: 0,
      ticket_medio: 0,
      ultima_compra: "",
      classe_abc: "",
      saldo_cashback: 0,
      consolidation_score: "BAIXO",
      quick_register: true,
      origin: "PDV",
      origin_label: "Cadastro rÃ¡pido PDV",
      cashback_legado: 0,
      cashback_legacy_origin: "",
      crm_contact_id: null,
      legacy_contact_id: null
    }));
  resultsBySource.pdv_quick = quickCustomers
    .filter((customer) => matchesCustomerSearch(customer, normalizedQuery, normalizedPhoneQuery))
    .slice(0, safeLimit)
    .map((item) => mapQuickCustomerToUnified(item));

  let crmMatches = [];
  let crmLegacyMatches = [];
  if (normalizedQuery || normalizedPhoneQuery) {
    const lookup = `%${normalizedQuery}%`;
    const lookupDigits = normalizedPhoneQuery ? `%${normalizedPhoneQuery}%` : "";
    try {
      const crmPhoneClauses = normalizedPhoneQuery
        ? `OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(mobile, phone, ''), '+', ''), '(', ''), ')', ''), '-', ''), ' ', '') LIKE ?
           OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone, mobile, ''), '+', ''), '(', ''), ')', ''), '-', ''), ' ', '') LIKE ?
           OR COALESCE(document, '') LIKE ?`
        : "";
      const crmParams = normalizedPhoneQuery
        ? [lookup, lookup, lookup, lookup, lookup, lookup, lookupDigits, lookupDigits, lookupDigits]
        : [lookup, lookup, lookup, lookup, lookup, lookup];
      crmMatches = await all(
        `SELECT id, name, mobile, phone, document, email, city, state, seller_name, contact_notes
         FROM crm_contacts
         WHERE lower(name) LIKE ?
            OR lower(fantasy_name) LIKE ?
            OR lower(email) LIKE ?
            OR lower(city) LIKE ?
            OR lower(state) LIKE ?
            OR lower(seller_name) LIKE ?
            ${crmPhoneClauses}
         LIMIT ?`,
        [...crmParams, safeLimit]
      );
    } catch (error) {
      crmMatches = [];
    }
    try {
      const legacyPhoneClause = normalizedPhoneQuery
        ? `OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(c.phone, ''), '+', ''), '(', ''), ')', ''), '-', ''), ' ', '') LIKE ?
           OR REPLACE(REPLACE(REPLACE(COALESCE(c.document, ''), '.', ''), '-', ''), '/', '') LIKE ?`
        : "";
      const legacyParams = normalizedPhoneQuery ? [lookup, lookupDigits, lookupDigits] : [lookup];
      crmLegacyMatches = await all(
        `SELECT c.id, c.name, c.phone, c.document, c.email, c.city, c.state, c.zipcode, c.neighborhood, c.top_size, c.bottom_size, c.shoe_size, c.gender, c.store, c.seller_name, c.cashback, c.validity, c.status, c.notes, c.created_at, c.updated_at
         FROM contacts c
         WHERE lower(COALESCE(c.name, '')) LIKE ?
            ${legacyPhoneClause}
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT ?`,
        [...legacyParams, safeLimit]
      );
    } catch (error) {
      crmLegacyMatches = [];
    }
  }

  const legacyMap = new Map();
  crmLegacyMatches.forEach((item) => {
    const key = normalizePhone(item.phone || "") || normalizeLookup(item.name || "");
    if (key && !legacyMap.has(key)) {
      legacyMap.set(key, item);
    }
  });

  resultsBySource.crm_contacts = crmMatches.map((item) => {
    const phone = normalizePhone(item.mobile || item.phone || "");
    const legacy = legacyMap.get(phone) || null;
    return {
      master_customer_id: `CRM_${item.id}`,
      name: item.name,
      phone,
      document: normalizeDigits(item.document || ""),
      email: item.email || "",
      city: item.city || "",
      state: item.state || "",
      notes: normalizeText(item.contact_notes || ""),
      top_size: normalizeText(legacy?.top_size || ""),
      bottom_size: normalizeText(legacy?.bottom_size || ""),
      shoe_size: normalizeText(legacy?.shoe_size || ""),
      total_comprado: 0,
      ticket_medio: 0,
      ultima_compra: "",
      classe_abc: "",
      saldo_cashback: 0,
      consolidation_score: "MEDIO",
      crm_contact_id: item.id,
      legacy_contact_id: legacy?.id || null,
      cashback_legado: toNumber(legacy?.cashback || 0),
      cashback_legacy_origin: legacy ? "CRM_LEGADO" : "",
      origin: "CRM",
      origin_label: "Contato encontrado no CRM"
    };
  });

  resultsBySource.crm_legacy = crmLegacyMatches.map((item) => ({
    master_customer_id: `CRM_LEGACY_${item.id}`,
    name: item.name,
    phone: normalizePhone(item.phone || ""),
    document: normalizeDigits(item.document || ""),
    email: item.email || "",
    city: item.city || "",
    state: item.state || "",
    notes: normalizeText(item.notes || ""),
    top_size: normalizeText(item.top_size || ""),
    bottom_size: normalizeText(item.bottom_size || ""),
    shoe_size: normalizeText(item.shoe_size || ""),
    total_comprado: 0,
    ticket_medio: 0,
    ultima_compra: item.updated_at || item.created_at || "",
    classe_abc: "",
    saldo_cashback: 0,
    consolidation_score: "MEDIO",
    crm_contact_id: null,
    legacy_contact_id: item.id,
    cashback_legado: toNumber(item.cashback || 0),
    cashback_legacy_origin: "CRM_BONUS",
    origin: "CRM",
    origin_label: "Contato encontrado no CRM"
  }));

  const mergedMap = new Map();
  const discarded = [];
  [
    ...resultsBySource.pdv_consolidated,
    ...resultsBySource.pdv_quick,
    ...resultsBySource.crm_contacts,
    ...resultsBySource.crm_legacy
  ].forEach((customer) => {
    const key = findMergedCustomerKey(mergedMap, customer);
    if (!key) {
      discarded.push({ source: customer.origin || "unknown", reason: "missing-key", customer });
      return;
    }
    if (mergedMap.has(key)) {
      mergedMap.set(key, mergeCustomerSearchRow(mergedMap.get(key), customer));
      discarded.push({ source: customer.origin || "unknown", reason: "merged-duplicate", key, customer });
      return;
    }
    mergedMap.set(key, mergeCustomerSearchRow({}, customer));
  });

  return {
    sources_consulted: ["pdv_consolidated", "pdv_quick", "crm_contacts", "crm_legacy"],
    results_by_source: resultsBySource,
    discarded,
    unified: Array.from(mergedMap.values())
      .sort((left, right) => {
        const matchDelta = scoreCustomerSearchMatch(right, query) - scoreCustomerSearchMatch(left, query);
        if (matchDelta !== 0) {
          return matchDelta;
        }
        return getCustomerCompletenessScore(right) - getCustomerCompletenessScore(left);
      })
      .slice(0, safeLimit)
  };
}

function resolveUnifiedCustomerStoreId(customer = {}) {
  return normalizeStoreKey(
    customer.store_id
    || customer.loja
    || customer.store
    || customer.loja_favorita
    || customer.store_origin
    || customer.favorite_store
    || ""
  );
}

function normalizeUnifiedCustomerStatusValue(customer = {}) {
  if (customer.quick_register) {
    return "quick_register";
  }
  if (toNumber(customer.cashback_pendente || 0) > 0) {
    return "cashback_pending";
  }
  if (toNumber(customer.cashback_legado || 0) > 0 || toNumber(customer.saldo_cashback || 0) > 0) {
    return "cashback_active";
  }
  return "active";
}

function getUnifiedCustomerStatusLabel(customer = {}) {
  const status = normalizeUnifiedCustomerStatusValue(customer);
  if (status === "quick_register") {
    return "Cadastro rapido";
  }
  if (status === "cashback_pending") {
    return "Cashback pendente";
  }
  if (status === "cashback_active") {
    return "Cashback ativo";
  }
  return "Ativo";
}

function filterUnifiedCustomers(items = [], { storeId = "", origin = "", phoneQuery = "", nameQuery = "" } = {}) {
  const normalizedStoreId = normalizeStoreKey(storeId || "");
  const normalizedOrigin = normalizeLookup(origin || "");
  const normalizedNameQuery = normalizeLookup(nameQuery || "");
  const normalizedPhoneQuery = normalizePhoneLookup(phoneQuery || "");
  return (Array.isArray(items) ? items : []).filter((item) => {
    const itemStore = resolveUnifiedCustomerStoreId(item);
    if (normalizedStoreId) {
      if (!itemStore) {
        return false;
      }
      if (!storesMatch(itemStore, normalizedStoreId)) {
        return false;
      }
    }
    if (normalizedOrigin && !normalizeLookup(item.origin || item.origin_label || "").includes(normalizedOrigin)) {
      return false;
    }
    return matchesCustomerSearch(item, normalizedNameQuery, normalizedPhoneQuery);
  });
}

async function listCustomersCatalog({ query = "", phoneQuery = "", storeId = "", limit = 60, origin = "" } = {}) {
  const safeLimit = normalizeSearchLimit(limit, 60, 80);
  const normalizedQuery = normalizeText(query || "");
  const normalizedPhone = normalizePhone(phoneQuery || "");
  const hasSearch = Boolean(normalizedQuery || normalizedPhone);
  let baseRows = [];
  let sourcesConsulted = [];

  if (hasSearch) {
    const detailed = await searchCustomersDetailed(normalizedQuery || normalizedPhone, { limit: safeLimit });
    baseRows = Array.isArray(detailed?.unified) ? detailed.unified : [];
    sourcesConsulted = Array.isArray(detailed?.sources_consulted) ? detailed.sources_consulted : [];
  } else {
    const consolidated = loadConsolidatedCustomers()
      .map((customer) => ({
        ...customer,
        origin: "PDV",
        origin_label: "Cliente PDV",
        cashback_legado: toNumber(customer.cashback_legado || 0),
        cashback_legacy_origin: normalizeText(customer.cashback_legacy_origin || ""),
        crm_contact_id: null,
        legacy_contact_id: null
      }))
      .sort((left, right) => {
        const lastSaleDelta = new Date(right.ultima_compra || 0).getTime() - new Date(left.ultima_compra || 0).getTime();
        if (Number.isFinite(lastSaleDelta) && lastSaleDelta !== 0) {
          return lastSaleDelta;
        }
        return toNumber(right.total_comprado || 0) - toNumber(left.total_comprado || 0);
      });
    const quickCustomers = loadQuickCustomers().map((item) => ({
      master_customer_id: item.id,
      name: item.name,
      phone: item.phone,
      document: "",
      email: "",
      city: "",
      state: "",
      notes: "",
      total_comprado: 0,
      ticket_medio: 0,
      ultima_compra: "",
      classe_abc: "",
      saldo_cashback: 0,
      consolidation_score: "BAIXO",
      quick_register: true,
      origin: "PDV",
      origin_label: "Cadastro rapido PDV",
      cashback_legado: 0,
      cashback_legacy_origin: "",
      crm_contact_id: null,
      legacy_contact_id: null
    }));
    baseRows = [...consolidated, ...loadQuickCustomers().map((item) => mapQuickCustomerToUnified(item))];
    sourcesConsulted = ["pdv_consolidated", "pdv_quick"];
  }

  const filteredItems = filterUnifiedCustomers(baseRows, {
    storeId,
    origin,
    phoneQuery,
    nameQuery: normalizedQuery
  })
    .map((item) => {
      const store_id = resolveUnifiedCustomerStoreId(item);
      const cashbackAvailable = Math.max(
        toNumber(item.cashback_operacional || 0),
        toNumber(item.saldo_cashback || 0),
        toNumber(item.cashback_legado || 0)
      );
      return {
        ...item,
        store_id,
        status: normalizeUnifiedCustomerStatusValue(item),
        status_label: getUnifiedCustomerStatusLabel(item),
        cashback_available: cashbackAvailable
      };
    })
    .slice(0, safeLimit);

  return {
    items: filteredItems,
    sources_consulted: sourcesConsulted,
    summary: {
      total: filteredItems.length,
      with_phone: filteredItems.filter((item) => normalizePhone(item.phone || "")).length,
      cashback_active: filteredItems.filter((item) => toNumber(item.cashback_available || 0) > 0).length,
      with_last_sale: filteredItems.filter((item) => normalizeText(item.ultima_compra || "")).length
    }
  };
}

async function buildCustomerBehaviorSnapshot(customer = {}) {
  const signals = buildCustomerSignals(customer);
  const consolidated = loadConsolidatedCustomers().find((item) => matchesBehaviorCustomer(item, signals)) || null;
  const sales = loadPdvSales().filter((item) => matchesBehaviorCustomer(item.customer || {}, signals));
  const exchanges = loadPdvExchanges().filter((item) => matchesBehaviorCustomer(item, signals));
  const reservations = loadReservations().filter((item) => matchesBehaviorCustomer(item.session_snapshot?.customer || {}, signals));
  const giftCards = loadPdvGiftCards().filter((item) => matchesBehaviorCustomer(item, signals) || matchesBehaviorCustomer({
    name: item.recipient_name,
    phone: item.recipient_phone
  }, signals));
  const cashbackEntries = await loadCashbackLedgerEntriesForCustomer(customer, signals);
  let profile = null;
  try {
    if (signals.document) {
      profile = await get(`SELECT * FROM commercial_customer_profile WHERE customer_key = ?`, [`document:${signals.document}`]);
    }
    if (!profile && signals.name) {
      profile = await get(
        `SELECT * FROM commercial_customer_profile
         WHERE lower(COALESCE(customer_name, '')) LIKE ?
            OR customer_key = ?
         ORDER BY last_updated_at DESC
         LIMIT 1`,
        [`%${signals.name}%`, `name:${signals.name}`]
      );
    }
  } catch (error) {
    profile = null;
  }

  const saleDates = sales.map((item) => item.created_at || item.data_hora || item.date || "").filter(Boolean);
  const categoryPool = [];
  const brandPool = [];
  const productPool = [];
  sales.forEach((sale) => {
    (sale.items || []).forEach((item) => {
      if (item.categoria) categoryPool.push(item.categoria);
      if (item.marca) brandPool.push(item.marca);
      if (item.nome) productPool.push(item.nome);
    });
  });
  const categoriesFromProfile = parseJsonArray(profile?.favorite_categories_suggested);
  const brandsFromProfile = parseJsonArray(profile?.favorite_brands_suggested);
  const recentProducts = uniqueStrings(productPool).slice(0, 4);
  const legacyCashbackExpiresIn = daysUntil(customer.validade || "");
  const hasCashbackLedger = cashbackEntries.length > 0;
  const operationalCashbackFromLedger = Number(cashbackEntries
    .filter((entry) => entry.type === "operational" && entry.status === "available")
    .reduce((sum, entry) => sum + toNumber(entry.amount || 0), 0)
    .toFixed(2));
  const legacyCashbackFromLedger = Number(cashbackEntries
    .filter((entry) => entry.type === "legacy")
    .reduce((sum, entry) => sum + toNumber(entry.amount || 0), 0)
    .toFixed(2));
  const pendingCashbackFromLedger = Number(cashbackEntries
    .filter((entry) => entry.status === "pending")
    .reduce((sum, entry) => sum + toNumber(entry.amount || 0), 0)
    .toFixed(2));
  const expiringCashbackFromLedger = Number(cashbackEntries
    .filter((entry) => {
      if (entry.status !== "available" || !entry.validade) {
        return false;
      }
      const expiresIn = daysUntil(entry.validade);
      return expiresIn !== null && expiresIn >= 0 && expiresIn <= 7;
    })
    .reduce((sum, entry) => sum + toNumber(entry.amount || 0), 0)
    .toFixed(2));

  return {
    total_comprado: Math.max(
      toNumber(customer.total_comprado || 0),
      toNumber(consolidated?.total_comprado || 0),
      toNumber(profile?.total_spent || 0),
      sales.reduce((sum, item) => sum + toNumber(item.total || item.total_final || 0), 0)
    ),
    ticket_medio: Math.max(
      toNumber(customer.ticket_medio || 0),
      toNumber(consolidated?.ticket_medio || 0),
      toNumber(profile?.average_ticket || 0)
    ),
    total_vendas: Math.max(toNumber(consolidated?.quantidade_compras || 0), sales.length),
    ultima_compra: customer.ultima_compra || consolidated?.ultima_compra || profile?.last_seen_at || saleDates.sort().slice(-1)[0] || "",
    classe_abc: customer.classe_abc || consolidated?.classe_abc || consolidated?.abc_class || profile?.abc_class || "",
    recorrencia_media: Math.max(toNumber(customer.recorrencia_media || 0), toNumber(consolidated?.recorrencia_media || 0), averageDaysBetweenDates(saleDates)),
    loja_favorita: customer.loja_favorita || consolidated?.loja_favorita || pickMostFrequentValue(sales.map((item) => item.loja)),
    vendedor_favorito: customer.vendedor_favorito || consolidated?.vendedor_favorito || pickMostFrequentValue(sales.map((item) => item.vendedor)),
    cashback_operacional: hasCashbackLedger
      ? operationalCashbackFromLedger
      : Math.max(toNumber(customer.cashback || 0), toNumber(customer.saldo_cashback || 0), toNumber(consolidated?.saldo_cashback || 0)),
    cashback_legado: hasCashbackLedger
      ? legacyCashbackFromLedger
      : Math.max(toNumber(customer.cashback_legado || 0), toNumber(consolidated?.cashback_legado || 0)),
    cashback_pendente: hasCashbackLedger
      ? pendingCashbackFromLedger
      : Math.max(toNumber(customer.cashback_pendente || 0), toNumber(consolidated?.cashback_pendente || 0)),
    cashback_vencendo: hasCashbackLedger
      ? expiringCashbackFromLedger
      : (legacyCashbackExpiresIn !== null && legacyCashbackExpiresIn >= 0 && legacyCashbackExpiresIn <= 7 ? Math.max(toNumber(customer.cashback_legado || 0), toNumber(consolidated?.cashback_legado || 0)) : 0),
    cashback_entries: cashbackEntries,
    categorias_favoritas: uniqueStrings([...(consolidated?.categorias_favoritas || []), ...categoriesFromProfile, ...categoryPool]).slice(0, 4),
    marcas_favoritas: uniqueStrings([...(consolidated?.marcas_favoritas || []), ...brandsFromProfile, ...brandPool]).slice(0, 4),
    produtos_recentes: recentProducts,
    usa_cashback: sales.some((item) => toNumber(item.cashback_usado || 0) > 0),
    compra_presente: giftCards.some((item) => normalizeText(item.recipient_name || item.recipient_phone || "")),
    trocas_recentes: exchanges.length,
    reservas_recentes: reservations.length,
    sem_historico_suficiente: !(sales.length || consolidated || profile),
    top_size: normalizeText(customer.top_size || customer.topSize || ""),
    bottom_size: normalizeText(customer.bottom_size || customer.bottomSize || ""),
    shoe_size: normalizeText(customer.shoe_size || customer.shoeSize || ""),
    notes: normalizeText(customer.notes || ""),
    sources: uniqueStrings([
      consolidated ? "PDV consolidado" : "",
      sales.length ? "Vendas PDV" : "",
      exchanges.length ? "Trocas PDV" : "",
      reservations.length ? "Reservas PDV" : "",
      giftCards.length ? "Vale presente PDV" : "",
      profile ? "Perfil comercial CRM" : "",
      hasCashbackLedger ? "Ledger operacional de cashback" : "",
      toNumber(customer.cashback_legado || 0) > 0 ? "Cashback legado CRM" : ""
    ])
  };
}

async function debugUnifiedSearch(query = "", type = "all", { storeId = "" } = {}) {
  const normalizedType = normalizeLookup(type || "all") || "all";
  const customerSearch = ["all", "customers", "behavior"].includes(normalizedType) ? await searchCustomersDetailed(query) : null;
  const productSearch = ["all", "products"].includes(normalizedType) ? await searchProductsDetailed(query, { storeId }) : null;
  let behavior = null;
  if (["all", "behavior"].includes(normalizedType)) {
    const behaviorTargets = (customerSearch?.unified || []).slice(0, 5);
    behavior = [];
    for (const customer of behaviorTargets) {
      const snapshot = await buildCustomerBehaviorSnapshot(customer);
      behavior.push({
        customer: {
          master_customer_id: customer.master_customer_id,
          name: customer.name,
          phone: customer.phone,
          origin: customer.origin,
          origin_label: customer.origin_label
        },
        behavior: snapshot
      });
    }
  }
  return {
    query: normalizeText(query || ""),
    type: normalizedType,
    sources_consulted: {
      customers: customerSearch?.sources_consulted || [],
      products: productSearch?.sources_consulted || [],
      behavior: behavior?.length ? ["pdv_consolidated", "pdv_sales", "pdv_exchanges", "pdv_reservations", "pdv_gift_cards", "crm_profile"] : []
    },
    customers: customerSearch,
    products: productSearch,
    behavior
  };
}

async function searchProducts(query = "", { storeId = "", page = 1, limit = 24 } = {}) {
  const result = await searchProductsDetailed(query, { storeId, page, limit });
  return result.unified;
}

async function listProductsCatalog({ query = "", storeId = "", limit = 60, status = "", pendingOnly = false } = {}) {
  const safeLimit = normalizeSearchLimit(limit, 60, 120);
  const normalizedQuery = normalizeText(query || "");
  let unified = [];
  let sourcesConsulted = [];

  if (canRunPdvProductSearch(normalizedQuery)) {
    const result = await searchProductsDetailed(normalizedQuery, { storeId, limit: safeLimit });
    unified = Array.isArray(result.unified) ? result.unified : [];
    sourcesConsulted = Array.isArray(result.sources_consulted) ? result.sources_consulted : [];
  } else {
    sourcesConsulted = ["inventory", "pdv_dataset"];
    const resultsBySource = {
      inventory: [],
      pdv_dataset: []
    };

    try {
      const { searchInventoryProducts } = require("../inventory/pdvInventoryService");
      resultsBySource.inventory = searchInventoryProducts("", { storeId }).map((item) => ({
        ...item,
        origin: "PDV_ESTOQUE",
        origin_label: "PDV + estoque operacional",
        origins: ["PDV + estoque operacional"],
        status: normalizeText(item.status || item.availability_label || ""),
        status_label: getUnifiedProductStatusLabel(item.status || item.availability_label || ""),
        cashback_blocked_for_redemption: Boolean(item.cashback_blocked_for_redemption)
      }));
    } catch (error) {
      resultsBySource.inventory = [];
    }

    const datasetProducts = loadProductsDataset();
    resultsBySource.pdv_dataset = datasetProducts
      .filter((product) => {
        if (!normalizedQuery) {
          return true;
        }
        return buildUnifiedProductSearchText(product).includes(normalizeLookup(normalizedQuery));
      })
      .filter((product) => {
        if (!storeId) {
          return true;
        }
        const productStore = normalizeStoreKey(product.store_id || "");
        return !productStore || productStore === "loja_geral" || storesMatch(productStore, storeId);
      })
      .slice(0, safeLimit)
      .map((product) => ({
        id: normalizeText(product.product_id || product.sku || product.codigo || product.nome || buildId("PRD")),
        product_id: normalizeText(product.product_id || ""),
        codigo: normalizeText(product.codigo || ""),
        sku: normalizeText(product.sku || product.codigo || ""),
        codigo_tiny: normalizeText(product.codigo_tiny || ""),
        codigo_etiqueta: normalizeText(product.codigo_etiqueta || ""),
        ean: normalizeDigits(product.ean || product.codigo_barras || ""),
        codigo_barras: normalizeDigits(product.codigo_barras || product.ean || ""),
        codigo_interno: normalizeText(product.codigo_interno || ""),
        nome: normalizeText(product.nome || ""),
        marca: normalizeText(product.marca || ""),
        categoria: normalizeText(product.categoria || ""),
        linha_genero: normalizeText(product.linha_genero || ""),
        tipo: normalizeText(product.tipo || ""),
        cor: normalizeText(product.cor || ""),
        tamanho: normalizeText(product.tamanho || ""),
        descricao: normalizeText(product.descricao || ""),
        preco_venda: toNumber(product.preco_venda || product.price || 0),
        estoque: toNumber(product.estoque),
        available_qty: toNumber(product.estoque),
        reserved_qty: 0,
        unavailable_qty: 0,
        store_id: normalizeStoreKey(product.store_id || storeId || "LOJA_GERAL"),
        image: normalizeText(product.photo_preview_url || product.preview_url || product.foto || ""),
        photo_preview_url: normalizeText(product.photo_preview_url || product.preview_url || ""),
        media_url: normalizeText(product.media_url || ""),
        foto: normalizeText(product.foto || product.photo_preview_url || product.preview_url || ""),
        media_id: Number(product.media_id || 0) || null,
        observacao: normalizeText(product.observacao || ""),
        origin: "PDV_IMPORT",
        origin_label: "PDV importado",
        origins: ["PDV importado"],
        cashback_blocked_for_redemption: Boolean(product.cashback_blocked_for_redemption),
        status: normalizeText(product.status || ""),
        status_label: getUnifiedProductStatusLabel(product.status || ""),
        tags: [normalizeText(product.marca || ""), normalizeText(product.categoria || ""), normalizeText(product.tipo || "")].filter(Boolean)
      }));

    const mergedMap = new Map();
    Object.values(resultsBySource).forEach((rows) => {
      rows.forEach((row) => {
        const key = buildProductMatchKey(row);
        if (!key) {
          return;
        }
        if (mergedMap.has(key)) {
          mergedMap.set(key, mergeUnifiedProductRow(mergedMap.get(key), row));
          return;
        }
        mergedMap.set(key, mergeUnifiedProductRow({}, row));
      });
    });
    unified = Array.from(mergedMap.values())
      .sort((left, right) => {
        const availabilityDelta = toNumber(right.available_qty || right.estoque || 0) - toNumber(left.available_qty || left.estoque || 0);
        if (availabilityDelta !== 0) {
          return availabilityDelta;
        }
        return toNumber(right.preco_venda || 0) - toNumber(left.preco_venda || 0);
      });
  }

  const filteredItems = filterUnifiedProducts(
    unified.map((item) => enrichProductOperationalAvailability(item, storeId)),
    { storeId, status, pendingOnly }
  ).slice(0, safeLimit);
  return {
    items: filteredItems,
    sources_consulted: sourcesConsulted,
    summary: {
      total: filteredItems.length,
      with_stock: filteredItems.filter((item) => toNumber(item.available_qty || item.estoque || 0) > 0).length,
      pending_review: filteredItems.filter((item) => normalizeUnifiedProductStatusValue(item.status || "", item.available_qty || item.estoque || 0) === "pending_review").length,
      active: filteredItems.filter((item) => normalizeUnifiedProductStatusValue(item.status || "", item.available_qty || item.estoque || 0) === "active").length
    }
  };
}

async function searchCustomers(query = "", { limit = 15 } = {}) {
  const result = await searchCustomersDetailed(query, { limit });
  return result.unified;
}

function createQuickCustomer(payload = {}, user = {}) {
  const name = normalizeText(payload.name || payload.nome || "");
  const phone = normalizePhone(payload.phone || payload.telefone || "");
  if (!name || !phone) {
    throw new Error("Informe nome e telefone para o cadastro rÃ¡pido do cliente.");
  }
  const quickCustomers = loadQuickCustomers();
  const existing = quickCustomers.find((item) => normalizePhone(item.phone || "") === phone);
  if (existing) {
    return existing;
  }
  const customer = {
    id: buildId("QCK"),
    name,
    phone,
    created_at: nowIso(),
    created_by: user?.name || user?.email || "sistema"
  };
  quickCustomers.unshift(customer);
  writeJson(operationalFiles.quickCustomers, quickCustomers);
  appendEvent("CUSTOMER_IDENTIFIED", { origem: "quick_register" }, { customer }, user);
  return customer;
}

function createQuickCustomer(payload = {}, user = {}) {
  const name = normalizeText(payload.name || payload.nome || "");
  const phone = normalizePhone(payload.phone || payload.telefone || "");
  const document = normalizeDigits(payload.document || payload.cpf || "");
  const email = normalizeText(payload.email || "").toLowerCase();
  const notes = normalizeText(payload.notes || payload.observacao || "");
  const storeId = resolveQuickCustomerStoreId(payload, user);
  if (!name || !phone) {
    throw buildOperationalError("Informe nome e telefone para o cadastro rapido do cliente.", 400);
  }
  if (phone.length < 10) {
    throw buildOperationalError("Informe um WhatsApp com DDD valido para o cadastro rapido.", 400);
  }
  const quickCustomers = loadQuickCustomers();
  const existing = quickCustomers.find((item) => normalizePhone(item.phone || "") === phone);
  if (existing) {
    throw buildOperationalError("Ja existe cliente com este WhatsApp.", 409, {
      existing_customer: mapQuickCustomerToUnified(existing)
    });
  }
  const customer = {
    id: buildId("QCK"),
    name,
    phone,
    document,
    email,
    notes,
    observacao: notes,
    store_id: storeId,
    store_origin: storeId,
    loja_favorita: storeId,
    origin: "pdv_quick_create",
    origin_label: "Cadastro rapido PDV",
    status: "quick_register",
    created_at: nowIso(),
    created_by: user?.name || user?.email || "sistema"
  };
  quickCustomers.unshift(customer);
  writeJson(operationalFiles.quickCustomers, quickCustomers);
  appendEvent("CUSTOMER_IDENTIFIED", { origem: "quick_register" }, { customer }, user);
  return mapQuickCustomerToUnified(customer);
}

function buildEmptySession(user = {}) {
  return applySessionDiscountPolicy({
    session_id: buildId("SES"),
    status: SESSION_STATUS.OPEN,
    created_at: nowIso(),
    updated_at: nowIso(),
    seller: user?.name || user?.email || "sistema",
    loja: "",
    customer: null,
    cart_items: [],
    cart_notes: "",
    desconto_extra: 0,
    discount_amount: 0,
    discount_percent: 0,
    discount_mode: "percent",
    discount_reason: "",
    authorization_required: false,
    discount_authorization_required: false,
    payment_plan: {
      methods: PDV_PAYMENT_METHODS.map((method) => ({ method, amount: 0, installments: method === "credito_ate_10x" ? 1 : 1 }))
    },
    cashback_application: null,
    coupon_prep: {
      mode: "normal",
      with_price: true,
      whatsapp_ready: false,
      qr_ready: false
    }
  });
}

function resetSessionCheckoutResidue(session = null) {
  if (!session || typeof session !== "object") {
    return session;
  }
  session.desconto_extra = 0;
  session.extra_discount = 0;
  session.discount_amount = 0;
  session.discount_percent = 0;
  session.discount_mode = "percent";
  session.discount_reason = "";
  session.authorization_required = false;
  session.discount_authorization_required = false;
  session.discount_policy = null;
  session.cashback_application = null;
  session.payment_plan = { methods: [] };
  return session;
}

function getSessionById(sessionId) {
  const session = loadSessions().find((item) => item.session_id === String(sessionId || "").trim()) || null;
  return session ? applySessionDiscountPolicy(session) : null;
}

function openCustomerSession({ sessionId = "", seller = "", loja = "", force_new = false, reset_checkout = false } = {}, user = {}) {
  const sessions = loadSessions();
  const shouldForceNew = Boolean(force_new || reset_checkout);
  let session = shouldForceNew ? null : sessions.find((item) => item.session_id === String(sessionId || "").trim());
  if (session && session.status && session.status !== SESSION_STATUS.OPEN) {
    session = null;
  }
  if (!session) {
    session = buildEmptySession(user);
    session.seller = normalizeText(seller || session.seller);
    session.loja = normalizeStoreKey(loja || "");
    sessions.unshift(session);
    saveSessions(sessions);
  } else if (reset_checkout) {
    resetSessionCheckoutResidue(session);
    session.updated_at = nowIso();
    saveSession(session);
  }
  return session;
}

function saveSession(session) {
  const sessions = loadSessions();
  const index = sessions.findIndex((item) => item.session_id === session.session_id);
  if (index >= 0) {
    sessions[index] = session;
  } else {
    sessions.unshift(session);
  }
  saveSessions(sessions);
  return session;
}

function buildCartItemFulfillmentSnapshot(payload = {}, session = {}) {
  const saleStoreId = normalizeStoreKey(payload.loja || payload.store_id || session.loja || session.loja_venda || "");
  if (!saleStoreId) {
    throw buildOperationalError("Nao foi possivel identificar a loja ativa da venda.", 400);
  }
  const requestedFulfillment = normalizeText(payload.fulfillment_type || payload.fulfillment_mode || "");
  const requestedSourceStore = normalizeStoreKey(payload.stock_source_store_id || payload.loja_origem_estoque || "");
  const { getProductOperationalAvailability, FULFILLMENT_MODES, FULFILLMENT_STATUS } = require("../inventory/pdvInventoryService");
  if (
    Boolean(payload.physical_confirmation_done)
    || requestedFulfillment === "PHYSICAL_CONFIRMATION"
    || requestedFulfillment === "venda_confirmada_fisicamente"
  ) {
    return {
      sale_store_id: saleStoreId,
      sale_store_name: formatStoreLabel(saleStoreId),
      stock_source_store_id: saleStoreId,
      stock_source_store_name: formatStoreLabel(saleStoreId),
      inventory_id: normalizeText(payload.inventory_id || payload.selected_inventory_id || ""),
      product_id: normalizeText(payload.product_id || payload.selected_product_id || payload.sku || payload.codigo || ""),
      fulfillment_type: "PHYSICAL_CONFIRMATION",
      fulfillment_mode: "venda_confirmada_fisicamente",
      fulfillment_status: FULFILLMENT_STATUS.CONFIRMED,
      logistics_group_origin: "conferencia_fisica",
      logistics_group_destination: "conferencia_fisica",
      requires_logistics_review: false,
      is_adjacent_store: false,
      operational_stock_status: normalizeText(payload.operational_stock_status || "NO_KNOWN_STOCK"),
      destination_store_id: saleStoreId,
      destination_store_name: formatStoreLabel(saleStoreId),
      fulfillment_options: []
    };
  }
  const availability = getProductOperationalAvailability(payload, saleStoreId, {
    preferredOriginStore: requestedSourceStore
  });
  const localSource = availability.local_option || null;
  const adjacentSource = availability.adjacent_option || null;
  const sameCitySource = availability.same_city_options.find((option) => option.store_id === requestedSourceStore)
    || availability.same_city_options[0]
    || null;
  const otherRegionSource = availability.other_region_options.find((option) => option.store_id === requestedSourceStore)
    || availability.other_region_options[0]
    || null;

  if (availability.status === "AVAILABLE_LOCAL" && localSource) {
    return {
      sale_store_id: saleStoreId,
      sale_store_name: formatStoreLabel(saleStoreId),
      stock_source_store_id: localSource.store_id,
      stock_source_store_name: localSource.store_name,
      inventory_id: localSource.inventory_id || normalizeText(payload.inventory_id || payload.selected_inventory_id || ""),
      product_id: localSource.product_id || normalizeText(payload.product_id || payload.selected_product_id || payload.sku || payload.codigo || ""),
      fulfillment_type: "LOCAL_STOCK",
      fulfillment_mode: FULFILLMENT_MODES.NORMAL,
      fulfillment_status: FULFILLMENT_STATUS.CONFIRMED,
      logistics_group_origin: normalizeText(localSource.logistics_group || ""),
      logistics_group_destination: "ribeirao_preto",
      requires_logistics_review: false,
      is_adjacent_store: false,
      operational_stock_status: "AVAILABLE_LOCAL",
      fulfillment_options: []
    };
  }

  if (availability.status === "AVAILABLE_ADJACENT_STORE" && adjacentSource) {
    return {
      sale_store_id: saleStoreId,
      sale_store_name: formatStoreLabel(saleStoreId),
      stock_source_store_id: adjacentSource.store_id,
      stock_source_store_name: adjacentSource.store_name,
      inventory_id: adjacentSource.inventory_id || normalizeText(payload.inventory_id || payload.selected_inventory_id || ""),
      product_id: adjacentSource.product_id || normalizeText(payload.product_id || payload.selected_product_id || payload.sku || payload.codigo || ""),
      fulfillment_type: "ADJACENT_STORE_STOCK",
      fulfillment_mode: FULFILLMENT_MODES.ADJACENT_STORE,
      fulfillment_status: FULFILLMENT_STATUS.CONFIRMED,
      logistics_group_origin: normalizeText(adjacentSource.logistics_group || ""),
      logistics_group_destination: "ribeirao_preto",
      requires_logistics_review: false,
      is_adjacent_store: true,
      operational_stock_status: "AVAILABLE_ADJACENT_STORE",
      fulfillment_options: []
    };
  }

  if (availability.status === "AVAILABLE_SAME_CITY") {
    if (!sameCitySource) {
      throw buildOperationalError("Nao foi possivel identificar a loja de origem para este produto.", 400);
    }
    if (!["INTERNAL_TRANSFER", "DIRECT_DELIVERY", FULFILLMENT_MODES.INTERNAL_TRANSFER, FULFILLMENT_MODES.DIRECT_ORIGIN].includes(requestedFulfillment)) {
      throw buildOperationalError("Defina transferência ou entrega direta antes de adicionar este produto.", 400);
    }
    const isDirectDelivery = requestedFulfillment === "DIRECT_DELIVERY" || requestedFulfillment === FULFILLMENT_MODES.DIRECT_ORIGIN;
    return {
      sale_store_id: saleStoreId,
      sale_store_name: formatStoreLabel(saleStoreId),
      stock_source_store_id: sameCitySource.store_id,
      stock_source_store_name: sameCitySource.store_name,
      inventory_id: sameCitySource.inventory_id || normalizeText(payload.inventory_id || payload.selected_inventory_id || ""),
      product_id: sameCitySource.product_id || normalizeText(payload.product_id || payload.selected_product_id || payload.sku || payload.codigo || ""),
      fulfillment_type: isDirectDelivery ? "DIRECT_DELIVERY" : "INTERNAL_TRANSFER",
      fulfillment_mode: isDirectDelivery ? FULFILLMENT_MODES.DIRECT_ORIGIN : FULFILLMENT_MODES.INTERNAL_TRANSFER,
      fulfillment_status: isDirectDelivery ? FULFILLMENT_STATUS.PENDING_DELIVERY : FULFILLMENT_STATUS.PENDING_TRANSFER,
      logistics_group_origin: normalizeText(sameCitySource.logistics_group || ""),
      logistics_group_destination: "ribeirao_preto",
      requires_logistics_review: false,
      is_adjacent_store: false,
      operational_stock_status: "AVAILABLE_SAME_CITY",
      destination_store_id: isDirectDelivery ? "cliente" : saleStoreId,
      destination_store_name: isDirectDelivery ? "Cliente" : formatStoreLabel(saleStoreId),
      fulfillment_options: availability.same_city_options
    };
  }

  if (availability.status === "LOGISTICS_REVIEW_REQUIRED") {
    if (!otherRegionSource) {
      throw buildOperationalError("Não foi possível identificar a loja de origem para a análise logística.", 400);
    }
    if (!["LOGISTICS_REVIEW", FULFILLMENT_MODES.LOGISTICS_REVIEW].includes(requestedFulfillment)) {
      throw buildOperationalError("Produto disponível em outro estado. Envie para análise logística antes de continuar.", 400);
    }
    return {
      sale_store_id: saleStoreId,
      sale_store_name: formatStoreLabel(saleStoreId),
      stock_source_store_id: otherRegionSource.store_id,
      stock_source_store_name: otherRegionSource.store_name,
      inventory_id: otherRegionSource.inventory_id || normalizeText(payload.inventory_id || payload.selected_inventory_id || ""),
      product_id: otherRegionSource.product_id || normalizeText(payload.product_id || payload.selected_product_id || payload.sku || payload.codigo || ""),
      fulfillment_type: "LOGISTICS_REVIEW",
      fulfillment_mode: FULFILLMENT_MODES.LOGISTICS_REVIEW,
      fulfillment_status: FULFILLMENT_STATUS.PENDING_ANALYSIS,
      logistics_group_origin: normalizeText(otherRegionSource.logistics_group || ""),
      logistics_group_destination: "ribeirao_preto",
      requires_logistics_review: true,
      is_adjacent_store: false,
      operational_stock_status: "LOGISTICS_REVIEW_REQUIRED",
      destination_store_id: saleStoreId,
      destination_store_name: formatStoreLabel(saleStoreId),
      fulfillment_options: availability.other_region_options
    };
  }

  throw buildOperationalError("Produto indisponível em todas as lojas.", 400);
}

function addProductToCart(sessionId, payload = {}, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("Sessao do atendimento nao encontrada.");
  }
  const fulfillment = buildCartItemFulfillmentSnapshot(payload, session || {});
  const normalizedInventoryId = normalizeText(fulfillment.inventory_id || payload.inventory_id || payload.selected_inventory_id || "");
  const normalizedProductId = normalizeText(fulfillment.product_id || payload.product_id || payload.selected_product_id || payload.sku || payload.codigo || "");
  const normalizedStoreId = normalizeStoreKey(payload.store_id || payload.selected_loja || payload.loja || session?.loja || "");
  const pricing = applyProductEffectivePricing(payload);
  const effectiveUnitPrice = toNumber(pricing.preco_venda || pricing.price || payload.preco_referencia || payload.preco_venda || 0);
  const item = {
    item_id: buildId("ITEM"),
    inventory_id: normalizedInventoryId,
    product_id: normalizedProductId,
    codigo: normalizeText(payload.codigo || ""),
    sku: normalizeText(payload.sku || payload.codigo || ""),
    codigo_tiny: normalizeText(payload.codigo_tiny || ""),
    codigo_etiqueta: normalizeText(payload.codigo_etiqueta || ""),
    ean: normalizeDigits(payload.ean || payload.codigo_barras || ""),
    codigo_barras: normalizeDigits(payload.codigo_barras || payload.ean || ""),
    codigo_interno: normalizeText(payload.codigo_interno || ""),
    nome: normalizeText(payload.nome || ""),
    marca: normalizeText(payload.marca || ""),
    categoria: normalizeText(payload.categoria || ""),
    tipo: normalizeText(payload.tipo || ""),
    cor: normalizeText(payload.cor || ""),
    tamanho: normalizeText(payload.tamanho || ""),
    descricao: normalizeText(payload.descricao || ""),
    store_id: normalizedStoreId,
    selected_product_id: normalizedProductId,
    selected_inventory_id: normalizedInventoryId,
    selected_sku: normalizeText(payload.sku || payload.codigo || ""),
    selected_codigo: normalizeText(payload.codigo || ""),
    selected_codigo_tiny: normalizeText(payload.codigo_tiny || ""),
    selected_codigo_etiqueta: normalizeText(payload.codigo_etiqueta || ""),
    selected_ean: normalizeDigits(payload.ean || payload.codigo_barras || ""),
    selected_codigo_interno: normalizeText(payload.codigo_interno || ""),
    selected_nome: normalizeText(payload.nome || ""),
    selected_loja: normalizedStoreId,
    selected_variation_key: normalizeText(payload.selected_variation_key || [payload.cor, payload.tamanho].filter(Boolean).join("::")),
    quantidade: Math.max(1, Math.round(toNumber(payload.quantidade || 1))),
    observacao: normalizeText(payload.observacao || ""),
    preco_referencia: effectiveUnitPrice,
    unit_price: effectiveUnitPrice,
    price: effectiveUnitPrice,
    original_price: toNumber(pricing.original_price || payload.original_price || payload.compare_at_price || 0) || null,
    compare_at_price: toNumber(pricing.compare_at_price || pricing.original_price || payload.compare_at_price || 0) || null,
    promotional_price: toNumber(pricing.promotional_price || payload.promotional_price || 0) || null,
    used_promotional_price: Boolean(pricing.used_promotional_price),
    estoque_visual: normalizeText(payload.availability_label || payload.estoque_visual || ""),
    loja_venda: fulfillment.sale_store_id,
    loja_origem_estoque: fulfillment.stock_source_store_id,
    loja_entrega_retirada: normalizeStoreKey(fulfillment.destination_store_id || payload.loja_entrega_retirada || fulfillment.sale_store_id),
    sale_store_id: fulfillment.sale_store_id,
    sale_store_name: fulfillment.sale_store_name,
    stock_source_store_id: fulfillment.stock_source_store_id,
    stock_source_store_name: fulfillment.stock_source_store_name,
    fulfillment_type: fulfillment.fulfillment_type,
    fulfillment_mode: fulfillment.fulfillment_mode,
    fulfillment_status: fulfillment.fulfillment_status,
    logistics_group_origin: fulfillment.logistics_group_origin,
    logistics_group_destination: fulfillment.logistics_group_destination,
    requires_logistics_review: Boolean(fulfillment.requires_logistics_review),
    is_adjacent_store: Boolean(fulfillment.is_adjacent_store),
    operational_stock_status: fulfillment.operational_stock_status,
    destination_store_id: normalizeStoreKey(fulfillment.destination_store_id || payload.loja_entrega_retirada || fulfillment.sale_store_id),
    destination_store_name: normalizeText(fulfillment.destination_store_name || formatStoreLabel(fulfillment.sale_store_id)),
    fulfillment_options: Array.isArray(fulfillment.fulfillment_options) ? fulfillment.fulfillment_options : [],
    physical_confirmation_required: Boolean(payload.physical_confirmation_required),
    physical_confirmation_done: Boolean(payload.physical_confirmation_done),
    physical_confirmation_by: normalizeText(payload.physical_confirmation_by || user?.name || user?.email || ""),
    physical_confirmation_user_id: normalizeText(payload.physical_confirmation_user_id || user?.id || user?.user_id || ""),
    physical_confirmation_store_id: normalizeStoreKey(payload.physical_confirmation_store_id || fulfillment.sale_store_id || normalizedStoreId),
    physical_confirmation_at: normalizeText(payload.physical_confirmation_at || (payload.physical_confirmation_done ? nowIso() : "")),
    physical_confirmation_reason: normalizeText(payload.physical_confirmation_reason || ""),
    physical_confirmation_note: normalizeText(payload.physical_confirmation_note || "")
  };
  item.item_discount = null;
  session.cart_items.push(item);
  session.updated_at = nowIso();
  saveSession(session);
  if (item.physical_confirmation_done) {
    appendEvent("SALE_ITEM_PHYSICAL_CONFIRMATION", { session_id: sessionId, loja: session.loja }, {
      item_id: item.item_id,
      product_id: item.product_id,
      sku: item.sku,
      codigo: item.codigo,
      store_id: item.physical_confirmation_store_id,
      confirmed_at: item.physical_confirmation_at,
      reason: item.physical_confirmation_reason
    }, user);
  }
  appendEvent("PRODUCT_ADDED", { session_id: sessionId, loja: session.loja }, { item, customer: session.customer }, user);
  return session;
}

function updateCartItem(sessionId, itemId, payload = {}, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("SessÃ£o do atendimento nÃ£o encontrada.");
  }
  const item = session.cart_items.find((row) => row.item_id === String(itemId || "").trim());
  if (!item) {
    throw new Error("Item do carrinho nÃ£o encontrado.");
  }
  if (payload.quantidade !== undefined) {
    item.quantidade = Math.max(1, Math.round(toNumber(payload.quantidade)));
    if (item.item_discount) {
      item.item_discount = normalizeCartItemDiscount(item);
    }
  }
  if (payload.observacao !== undefined) item.observacao = normalizeText(payload.observacao);
  if (payload.cor !== undefined) item.cor = normalizeText(payload.cor);
  if (payload.tamanho !== undefined) item.tamanho = normalizeText(payload.tamanho);
  if (payload.fulfillment_type !== undefined || payload.fulfillment_mode !== undefined || payload.stock_source_store_id !== undefined || payload.physical_confirmation_done !== undefined) {
    const fulfillment = buildCartItemFulfillmentSnapshot({
      ...item,
      ...payload
    }, session);
    item.inventory_id = normalizeText(fulfillment.inventory_id || item.inventory_id || "");
    item.product_id = normalizeText(fulfillment.product_id || item.product_id || "");
    item.loja_venda = fulfillment.sale_store_id;
    item.loja_origem_estoque = fulfillment.stock_source_store_id;
    item.loja_entrega_retirada = normalizeStoreKey(fulfillment.destination_store_id || item.loja_entrega_retirada || fulfillment.sale_store_id);
    item.sale_store_id = fulfillment.sale_store_id;
    item.sale_store_name = fulfillment.sale_store_name;
    item.stock_source_store_id = fulfillment.stock_source_store_id;
    item.stock_source_store_name = fulfillment.stock_source_store_name;
    item.fulfillment_type = fulfillment.fulfillment_type;
    item.fulfillment_mode = fulfillment.fulfillment_mode;
    item.fulfillment_status = fulfillment.fulfillment_status;
    item.logistics_group_origin = fulfillment.logistics_group_origin;
    item.logistics_group_destination = fulfillment.logistics_group_destination;
    item.requires_logistics_review = Boolean(fulfillment.requires_logistics_review);
    item.is_adjacent_store = Boolean(fulfillment.is_adjacent_store);
    item.operational_stock_status = fulfillment.operational_stock_status;
    item.destination_store_id = normalizeStoreKey(fulfillment.destination_store_id || item.destination_store_id || fulfillment.sale_store_id);
    item.destination_store_name = normalizeText(fulfillment.destination_store_name || item.destination_store_name || formatStoreLabel(fulfillment.sale_store_id));
    item.fulfillment_options = Array.isArray(fulfillment.fulfillment_options) ? fulfillment.fulfillment_options : [];
  }
  if (payload.physical_confirmation_done !== undefined) {
    item.physical_confirmation_required = Boolean(payload.physical_confirmation_required || item.physical_confirmation_required);
    item.physical_confirmation_done = Boolean(payload.physical_confirmation_done);
    item.physical_confirmation_by = normalizeText(payload.physical_confirmation_by || user?.name || user?.email || item.physical_confirmation_by || "");
    item.physical_confirmation_user_id = normalizeText(payload.physical_confirmation_user_id || user?.id || user?.user_id || item.physical_confirmation_user_id || "");
    item.physical_confirmation_store_id = normalizeStoreKey(payload.physical_confirmation_store_id || item.physical_confirmation_store_id || item.loja_venda || session.loja);
    item.physical_confirmation_at = normalizeText(payload.physical_confirmation_at || item.physical_confirmation_at || nowIso());
    item.physical_confirmation_reason = normalizeText(payload.physical_confirmation_reason || item.physical_confirmation_reason || "sale_item_confirmed_in_store");
    item.physical_confirmation_note = normalizeText(payload.physical_confirmation_note || item.physical_confirmation_note || "");
    appendEvent("SALE_ITEM_PHYSICAL_CONFIRMATION", { session_id: sessionId, item_id: item.item_id, loja: session.loja }, {
      item_id: item.item_id,
      product_id: item.product_id,
      sku: item.sku,
      codigo: item.codigo,
      store_id: item.physical_confirmation_store_id,
      confirmed_at: item.physical_confirmation_at,
      reason: item.physical_confirmation_reason
    }, user);
  }
  session.updated_at = nowIso();
  saveSession(session);
  return session;
}

function updateCartItemDiscount(sessionId, itemId, payload = {}, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("Sessão do atendimento não encontrada.");
  }
  const item = session.cart_items.find((row) => row.item_id === String(itemId || "").trim());
  if (!item) {
    throw new Error("Item do carrinho não encontrado.");
  }
  const removeDiscount = Boolean(payload.remove || payload.clear || payload.amount === 0 || payload.value === 0);
  if (removeDiscount) {
    item.item_discount = null;
  } else {
    const mode = normalizeText(payload.mode || payload.discount_mode || "amount").toLowerCase() === "percent" ? "percent" : "amount";
    const value = Number(Math.max(0, parseFlexibleNumber(payload.value ?? payload.amount ?? payload.percent ?? 0)).toFixed(2));
    if (value <= 0) {
      throw new Error("Informe um desconto válido para o item.");
    }
    const gross = Number((getCartItemUnitPrice(item) * getCartItemQuantity(item)).toFixed(2));
    const discountAmount = mode === "percent"
      ? Number(((gross * value) / 100).toFixed(2))
      : value;
    if (mode === "percent" && value > 100) {
      throw new Error("O desconto percentual do item não pode passar de 100%.");
    }
    if (discountAmount > gross + 0.009) {
      throw new Error("O desconto do item não pode superar o subtotal do item.");
    }
    item.item_discount = {
      mode,
      value,
      reason: normalizeText(payload.reason || ""),
      applied_by: user?.name || user?.email || "sistema",
      applied_at: nowIso()
    };
    item.item_discount = normalizeCartItemDiscount(item);
  }
  applySessionDiscountPolicy(session);
  session.updated_at = nowIso();
  saveSession(session);
  appendEvent("CART_ITEM_DISCOUNT_UPDATED", { session_id: sessionId, item_id: itemId, loja: session.loja }, {
    item_id: item.item_id,
    item_discount: item.item_discount,
    product_name: item.nome
  }, user);
  return session;
}

function removeCartItem(sessionId, itemId) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("SessÃ£o do atendimento nÃ£o encontrada.");
  }
  session.cart_items = session.cart_items.filter((row) => row.item_id !== String(itemId || "").trim());
  if (!session.cart_items.length) {
    session.desconto_extra = 0;
    session.extra_discount = 0;
    session.discount_amount = 0;
    session.discount_percent = 0;
    session.discount_policy = null;
    session.cashback_application = null;
    session.payment_plan = { methods: [] };
  }
  session.updated_at = nowIso();
  saveSession(session);
  return session;
}

async function attachCustomerToSession(sessionId, payload = {}, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("SessÃ£o do atendimento nÃ£o encontrada.");
  }
  const baseCustomer = {
    master_customer_id: normalizeText(payload.master_customer_id || payload.id || payload.crm_contact_id || ""),
    name: normalizeText(payload.name || ""),
    phone: normalizePhone(payload.phone || ""),
    document: normalizeDigits(payload.document || ""),
    email: normalizeText(payload.email || ""),
    status: normalizeText(payload.status || ""),
    city: normalizeText(payload.city || ""),
    state: normalizeText(payload.state || ""),
    notes: normalizeText(payload.notes || ""),
    top_size: normalizeText(payload.top_size || payload.topSize || ""),
    bottom_size: normalizeText(payload.bottom_size || payload.bottomSize || ""),
    shoe_size: normalizeText(payload.shoe_size || payload.shoeSize || ""),
    cashback: toNumber(payload.saldo_cashback || payload.cashback || 0),
    cashback_legado: toNumber(payload.cashback_legado || payload.legacy_cashback || 0),
    cashback_legacy_origin: normalizeText(payload.cashback_legacy_origin || payload.legacy_cashback_origin || ""),
    total_comprado: toNumber(payload.total_comprado || 0),
    ticket_medio: toNumber(payload.ticket_medio || 0),
    ultima_compra: normalizeText(payload.ultima_compra || ""),
    classe_abc: normalizeText(payload.classe_abc || ""),
    recorrencia_media: toNumber(payload.recorrencia_media || 0),
    vendedor_favorito: normalizeText(payload.vendedor_favorito || ""),
    loja_favorita: normalizeText(payload.loja_favorita || ""),
    origin: normalizeText(payload.origin || "PDV"),
    origin_label: normalizeText(payload.origin_label || ""),
    crm_contact_id: normalizeText(payload.crm_contact_id || ""),
    legacy_contact_id: normalizeText(payload.legacy_contact_id || "")
  };
  baseCustomer.behavior = await buildCustomerBehaviorSnapshot({
    ...baseCustomer,
    cashback_pendente: payload.cashback_pendente,
    validade: payload.validade
  });
  let liveCashbackSnapshot = null;
  try {
    const salesService = require("../sales/pdvSalesService");
    if (typeof salesService?.getCustomerCashbackSnapshot === "function") {
      liveCashbackSnapshot = salesService.getCustomerCashbackSnapshot(baseCustomer.phone || "");
    }
  } catch (error) {
    liveCashbackSnapshot = null;
  }
  const canonicalOperationalCashback = toNumber(
    liveCashbackSnapshot?.available
    ?? baseCustomer.behavior?.cashback_operacional
    ?? 0
  );
  const canonicalPendingCashback = toNumber(
    liveCashbackSnapshot?.pending
    ?? baseCustomer.behavior?.cashback_pendente
    ?? 0
  );
  const canonicalExpiringCashback = toNumber(
    liveCashbackSnapshot?.expiring
    ?? baseCustomer.behavior?.cashback_vencendo
    ?? 0
  );
  baseCustomer.cashback = canonicalOperationalCashback;
  baseCustomer.cashback_available = canonicalOperationalCashback;
  baseCustomer.cashback_operacional = canonicalOperationalCashback;
  baseCustomer.saldo_cashback = canonicalOperationalCashback;
  baseCustomer.cashback_legado = toNumber(baseCustomer.behavior?.cashback_legado || baseCustomer.cashback_legado || 0);
  baseCustomer.cashback_pendente = canonicalPendingCashback;
  baseCustomer.cashback_vencendo = canonicalExpiringCashback;
  const currentCashbackApplication = normalizeCashbackApplication(session.cashback_application);
  session.customer = baseCustomer;
  session.cashback_application = currentCashbackApplication
    && normalizePhone(currentCashbackApplication.customer_phone || "") === normalizePhone(baseCustomer.phone || "")
    ? currentCashbackApplication
    : null;
  session.updated_at = nowIso();
  saveSession(session);
  appendEvent("CUSTOMER_IDENTIFIED", { session_id: sessionId, loja: session.loja }, { customer: session.customer }, user);
  return session;
}

function detachCustomerFromSession(sessionId, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("SessÃ£o do atendimento nÃ£o encontrada.");
  }
  session.customer = null;
  session.cashback_application = null;
  session.exchange_credit_application = null;
  session.payment_plan = {
    methods: (session.payment_plan?.methods || []).filter((item) => item.method !== "credito_troca")
  };
  session.updated_at = nowIso();
  saveSession(session);
  appendEvent("CUSTOMER_IDENTIFIED", { session_id: sessionId, loja: session.loja }, { customer: null, action: "removed" }, user);
  return session;
}

function completeSession(sessionId, { saleId = "" } = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    return null;
  }
  session.status = SESSION_STATUS.COMPLETED;
  session.completed_sale_id = normalizeText(saleId || "");
  session.closed_at = nowIso();
  session.customer = null;
  session.cart_items = [];
  session.cart_notes = "";
  session.cashback_application = null;
  session.payment_plan = {
    methods: (session.payment_plan?.methods || []).map((item) => ({
      ...item,
      amount: 0,
      installments: Math.max(1, Math.round(toNumber(item.installments || 1)))
    }))
  };
  session.coupon_prep = {
    mode: "normal",
    with_price: true,
    whatsapp_ready: false,
    qr_ready: false
  };
  session.updated_at = nowIso();
  saveSession(session);
  return session;
}

function saveCartDraft(sessionId, payload = {}, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("SessÃ£o do atendimento nÃ£o encontrada.");
  }
  const drafts = loadDrafts();
  const itemCount = Array.isArray(session.cart_items) ? session.cart_items.length : 0;
  const grossAmount = getCartItemsGrossSubtotal(session.cart_items || []);
  const itemDiscountAmount = getCartItemsDiscountTotal(session.cart_items || []);
  const netItemsAmount = getCartItemsNetSubtotal(session.cart_items || []);
  const totalAmount = Number(Math.max(0, netItemsAmount - toNumber(session.desconto_extra || session.discount_amount || 0)).toFixed(2));
  const draft = {
    draft_id: buildId("DRF"),
    session_id: sessionId,
    customer: cloneSerializable(session.customer),
    cart_items: cloneSerializable(session.cart_items),
    cart_notes: normalizeText(payload.cart_notes || session.cart_notes || ""),
    loja: normalizeStoreKey(payload.loja || session.loja || ""),
    seller: normalizeText(payload.vendedor || session.seller || ""),
    item_count: itemCount,
    gross_amount: grossAmount,
    item_discount_amount: itemDiscountAmount,
    subtotal_after_item_discount: netItemsAmount,
    total_amount: totalAmount,
    desconto_extra: Number(toNumber(session.desconto_extra || session.discount_amount || 0).toFixed(2)),
    discount_percent: Number(toNumber(session.discount_percent || 0).toFixed(2)),
    discount_mode: normalizeText(session.discount_mode || "percent"),
    discount_reason: normalizeText(session.discount_reason || ""),
    authorization_required: Boolean(session.authorization_required || session.discount_authorization_required),
    saved_at: nowIso(),
    saved_by: user?.name || user?.email || "sistema"
  };
  drafts.unshift(draft);
  saveDrafts(drafts);
  session.cart_notes = draft.cart_notes;
  session.updated_at = nowIso();
  saveSession(session);
  return draft;
}

function listCartDrafts({ loja = "" } = {}) {
  const normalizedStore = normalizeStoreKey(loja || "");
  return loadDrafts()
    .filter((draft) => !normalizedStore || normalizeStoreKey(draft.loja || "") === normalizedStore)
    .map((draft) => ({
      ...draft,
      customer: cloneSerializable(draft.customer),
      cart_items: cloneSerializable(draft.cart_items),
      item_count: Number(draft.item_count || 0),
      total_amount: Number(toNumber(draft.total_amount || 0).toFixed(2)),
      is_open: Boolean(getSessionById(draft.session_id))
    }));
}

function deleteCartDraft(draftId = "") {
  const drafts = loadDrafts();
  const index = drafts.findIndex((item) => normalizeText(item.draft_id || "") === normalizeText(draftId || ""));
  if (index < 0) {
    throw new Error("Rascunho do PDV nÃ£o encontrado.");
  }
  const [removed] = drafts.splice(index, 1);
  saveDrafts(drafts);
  return removed;
}

function restoreCartDraft(draftId = "", user = {}) {
  const draft = loadDrafts().find((item) => normalizeText(item.draft_id || "") === normalizeText(draftId || ""));
  if (!draft) {
    throw new Error("Rascunho do PDV nÃ£o encontrado.");
  }
  const restoredSession = buildEmptySession(user);
  restoredSession.seller = normalizeText(draft.seller || restoredSession.seller);
  restoredSession.loja = normalizeStoreKey(draft.loja || restoredSession.loja || "");
  restoredSession.customer = cloneSerializable(draft.customer) || null;
  restoredSession.cart_items = cloneSerializable(draft.cart_items) || [];
  restoredSession.cart_notes = normalizeText(draft.cart_notes || "");
  restoredSession.desconto_extra = toNumber(draft.desconto_extra || 0);
  restoredSession.discount_amount = toNumber(draft.desconto_extra || 0);
  restoredSession.discount_percent = toNumber(draft.discount_percent || 0);
  restoredSession.discount_mode = normalizeText(draft.discount_mode || "percent");
  restoredSession.discount_reason = normalizeText(draft.discount_reason || "");
  restoredSession.authorization_required = Boolean(draft.authorization_required);
  restoredSession.discount_authorization_required = Boolean(draft.authorization_required);
  restoredSession.updated_at = nowIso();
  saveSession(restoredSession);
  appendEvent("MESSAGE_SCHEDULED", { session_id: restoredSession.session_id, loja: restoredSession.loja }, { draft_id: draft.draft_id, restored_from_draft: true }, user);
  return {
    draft,
    session: restoredSession
  };
}

function updatePaymentPlan(sessionId, methods = []) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("SessÃ£o do atendimento nÃ£o encontrada.");
  }
  const normalizedMethods = (methods || []).map((item) => ({
    method: PDV_PAYMENT_METHODS.includes(item.method) ? item.method : "dinheiro",
    amount: toNumber(item.amount),
    installments: Math.max(1, Math.min(10, Math.round(toNumber(item.installments || 1)))),
    installment_amount: Number((toNumber(item.amount) / Math.max(1, Math.min(10, Math.round(toNumber(item.installments || 1))))).toFixed(2)),
    credit_id: normalizeText(item.credit_id || item.exchange_credit_id || ""),
    customer_id: normalizeText(item.customer_id || "")
  }));
  session.payment_plan = {
    methods: normalizedMethods
  };
  const exchangeCreditMethod = normalizedMethods.find((item) => item.method === "credito_troca" && toNumber(item.amount) > 0);
  if (exchangeCreditMethod) {
    session.exchange_credit_application = {
      ...(session.exchange_credit_application || {}),
      credit_id: exchangeCreditMethod.credit_id || session.exchange_credit_application?.credit_id || "",
      customer_id: exchangeCreditMethod.customer_id || session.exchange_credit_application?.customer_id || "",
      amount: toNumber(exchangeCreditMethod.amount)
    };
  } else {
    session.exchange_credit_application = null;
  }
  applySessionDiscountPolicy(session);
  session.updated_at = nowIso();
  saveSession(session);
  return session;
}

function updateSessionDiscount(sessionId, payload = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("Sessao do atendimento nao encontrada.");
  }
  const discountUpdate = computeSessionDiscountUpdate(session, payload);
  if (discountUpdate.rawValue > 0) {
    const blockingMethods = getGeneralDiscountBlockingPaymentMethods(session);
    if (blockingMethods.length) {
      const labels = [...new Set(blockingMethods.map((item) => getPaymentMethodPolicyLabel(item.method)).filter(Boolean))];
      throw new Error(`Desconto geral permitido somente para Pix ou Dinheiro. ${labels.length ? `Esta venda possui pagamento em ${labels.join(" + ")}. ` : ""}Remova ou ajuste os pagamentos lancados antes de aplicar este desconto.`);
    }
  }
  assignSessionGeneralDiscount(session, discountUpdate);
  session.updated_at = nowIso();
  saveSession(session);
  return session;
}

function buildSessionAuthorizationTotals(session = {}) {
  const cartItems = Array.isArray(session.cart_items) ? session.cart_items : [];
  const subtotal = getCartItemsGrossSubtotal(cartItems);
  const itemDiscountAmount = getCartItemsDiscountTotal(cartItems);
  const subtotalAfterItemDiscount = getCartItemsNetSubtotal(cartItems);
  const paymentMethods = (Array.isArray(session.payment_plan?.methods) ? session.payment_plan.methods : [])
    .map((item) => ({
      method: normalizeText(item?.method || "").toLowerCase(),
      amount: Number(Math.max(0, toNumber(item?.amount || 0)).toFixed(2)),
      installments: Math.max(1, Math.min(10, Math.round(toNumber(item?.installments || 1)))),
      installment_amount: Number(Math.max(0, toNumber(item?.installment_amount || 0)).toFixed(2)),
      credit_id: normalizeText(item?.credit_id || item?.exchange_credit_id || ""),
      customer_id: normalizeText(item?.customer_id || "")
    }))
    .filter((item) => item.method && item.amount > 0);
  const cashbackUsed = toNumber(session?.cashback_application?.amount || 0);
  const giftCardUsed = Number(paymentMethods.filter((item) => item.method === "vale_presente").reduce((sum, item) => sum + item.amount, 0).toFixed(2));
  const exchangeCredit = Number(paymentMethods.filter((item) => item.method === "credito_troca").reduce((sum, item) => sum + item.amount, 0).toFixed(2))
    || toNumber(session?.exchange_credit_application?.amount || 0);
  const permutaAmount = Number(paymentMethods.filter((item) => item.method === "permuta").reduce((sum, item) => sum + item.amount, 0).toFixed(2));
  const paidAmount = Number(paymentMethods
    .filter((item) => !["cashback", "credito_troca", "permuta", "vale_presente"].includes(item.method))
    .reduce((sum, item) => sum + item.amount, 0).toFixed(2));
  const extraDiscount = toNumber(session.desconto_extra || session.extra_discount || session.discount_amount || 0);
  const totalFinal = Number(Math.max(0, subtotalAfterItemDiscount - extraDiscount - giftCardUsed - exchangeCredit - permutaAmount - cashbackUsed).toFixed(2));
  const generalDiscountBase = getSessionGeneralDiscountBase(session);
  return {
    subtotal,
    itemDiscountAmount,
    subtotalAfterItemDiscount,
    extraDiscount,
    totalDiscountAmount: Number((itemDiscountAmount + extraDiscount).toFixed(2)),
    generalDiscountBase,
    generalDiscountPercent: toNumber(session.discount_percent || 0),
    cashbackUsed,
    giftCardUsed,
    exchangeCredit,
    permutaAmount,
    totalFinal,
    paidAmount,
    paymentMethods
  };
}

function buildPendingDiscountSession(session = {}, payload = {}) {
  const pendingSession = cloneSerializable(session);
  const discountUpdate = computeSessionDiscountUpdate(pendingSession, payload);
  assignSessionGeneralDiscount(pendingSession, discountUpdate);
  normalizePendingDiscountPaymentPlan(pendingSession);
  return { pendingSession, discountUpdate };
}

const PENDING_DISCOUNT_AUTO_ADJUST_PAYMENT_METHODS = new Set([
  "pix",
  "dinheiro",
  "debito",
  "credito_ate_10x",
  "link_pagamento"
]);

function normalizePendingDiscountPaymentPlan(session = {}) {
  const totals = buildSessionAuthorizationTotals(session);
  const excess = Number(Math.max(0, totals.paidAmount - totals.totalFinal).toFixed(2));
  if (excess <= 0.01) {
    return session;
  }
  const methods = Array.isArray(session.payment_plan?.methods)
    ? session.payment_plan.methods.map((item) => ({ ...item }))
    : [];
  const candidates = methods
    .map((item, index) => ({
      item,
      index,
      method: normalizeText(item.method || "")
    }))
    .filter(({ item, method }) =>
      PENDING_DISCOUNT_AUTO_ADJUST_PAYMENT_METHODS.has(method)
      && toNumber(item.amount || 0) > 0
    );
  const target = candidates[candidates.length - 1] || null;
  if (!target || toNumber(target.item.amount || 0) + 0.01 < excess) {
    return session;
  }
  const installments = Math.max(1, Math.min(10, Math.round(toNumber(target.item.installments || 1))));
  const nextAmount = Number(Math.max(0, toNumber(target.item.amount || 0) - excess).toFixed(2));
  session.payment_plan = {
    methods: methods
      .map((item, index) => index === target.index
        ? {
            ...item,
            amount: nextAmount,
            installments,
            installment_amount: Number((nextAmount / installments).toFixed(2))
          }
        : item)
      .filter((item) =>
        toNumber(item.amount || 0) > 0.01
        || !PENDING_DISCOUNT_AUTO_ADJUST_PAYMENT_METHODS.has(normalizeText(item.method || ""))
      )
  };
  applySessionDiscountPolicy(session);
  return session;
}

function buildDiscountAuthorizationContext(session = {}) {
  const totals = buildSessionAuthorizationTotals(session);
  const policy = session.discount_policy || getSessionDiscountPolicy(session);
  return {
    session_id: normalizeText(session.session_id || ""),
    loja: normalizeStoreKey(session.loja || session.store_id || ""),
    subtotal: totals.subtotal,
    item_discount_amount: totals.itemDiscountAmount,
    general_discount_amount: totals.extraDiscount,
    general_exception_amount: policy.generalExceptionAmount || 0,
    discount_amount: totals.totalDiscountAmount,
    discount_percent: policy.authorizationPercent || totals.generalDiscountPercent,
    total_final: totals.totalFinal,
    paid_amount: totals.paidAmount,
    cashback_applied: totals.cashbackUsed,
    exchange_credit: totals.exchangeCredit,
    excess_balance_before_discount: policy.excessBalanceBeforeDiscount || policy.policyBase || totals.generalDiscountBase || 0,
    excess_balance_after_discount: policy.excessBalanceAfterDiscount || 0,
    payment_methods: totals.paymentMethods,
    items: Array.isArray(session.cart_items) ? session.cart_items : [],
    customer_id: normalizeText(session.customer?.id || session.customer_id || ""),
    pix_money_policy_base: policy.policyBase || totals.generalDiscountBase || 0,
    pix_money_policy_limit: policy.automaticLimitAmount || 0
  };
}

function getDiscountAuthorizationContextKey(context = {}) {
  return buildDiscountAuthorizationFingerprint(context || {});
}

function getDiscountAuthorizationContextPayload(context = {}) {
  return buildDiscountAuthorizationFingerprintPayload(context || {});
}

function getDiscountAuthorizationContextDivergences(originalContext = {}, currentContext = {}) {
  const originalPayload = getDiscountAuthorizationContextPayload(originalContext);
  const currentPayload = getDiscountAuthorizationContextPayload(currentContext);
  const keys = new Set([
    ...Object.keys(originalPayload || {}),
    ...Object.keys(currentPayload || {})
  ]);
  return Array.from(keys).filter((key) =>
    JSON.stringify(originalPayload?.[key] ?? null) !== JSON.stringify(currentPayload?.[key] ?? null)
  );
}

function assertPendingDiscountAuthorizationContextMatches(originalContext = {}, currentContext = {}) {
  if (!originalContext || typeof originalContext !== "object" || !Object.keys(originalContext).length) {
    throw new Error("Contexto original da autorizacao nao informado. Solicite uma nova autorizacao.");
  }
  const originalSessionId = normalizeText(originalContext.session_id || originalContext.sale_session_id || "");
  const currentSessionId = normalizeText(currentContext.session_id || currentContext.sale_session_id || "");
  if (originalSessionId && currentSessionId && originalSessionId !== currentSessionId) {
    throw new Error("A venda foi alterada depois da solicitacao de autorizacao. Solicite uma nova autorizacao.");
  }
  const originalKey = getDiscountAuthorizationContextKey(originalContext);
  const currentKey = getDiscountAuthorizationContextKey(currentContext);
  if (originalKey !== currentKey) {
    const error = new Error("A venda foi alterada depois da solicitacao de autorizacao. Solicite uma nova autorizacao.");
    error.code = "DISCOUNT_AUTHORIZATION_CONTEXT_CHANGED";
    error.divergent_fields = getDiscountAuthorizationContextDivergences(originalContext, currentContext);
    throw error;
  }
}

function requestPendingSessionDiscountAuthorization(sessionId, payload = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("Sessao do atendimento nao encontrada.");
  }
  if (!Array.isArray(session.cart_items) || !session.cart_items.length) {
    throw new Error("Adicione itens ao carrinho antes de solicitar autorizacao de desconto.");
  }
  const { pendingSession, discountUpdate } = buildPendingDiscountSession(session, payload);
  const policy = pendingSession.discount_policy || getSessionDiscountPolicy(pendingSession);
  if (discountUpdate.discountAmount <= 0) {
    throw new Error("Informe um desconto valido para solicitar autorizacao.");
  }
  if (!policy.requiresAuthorization) {
    throw new Error("Este desconto nao exige autorizacao gerencial.");
  }
  if (!Array.isArray(policy.invalidMethods) || !policy.invalidMethods.length) {
    throw new Error("Use o fluxo normal de desconto para esta condicao.");
  }
  const authorizationContext = buildDiscountAuthorizationContext(pendingSession);
  return {
    authorization_required: true,
    reason: policy.reason,
    pending_discount: {
      mode: discountUpdate.mode,
      value: discountUpdate.rawValue,
      amount: discountUpdate.discountAmount,
      percent: discountUpdate.discountPercent,
      reason: discountUpdate.reason
    },
    discount_policy: policy,
    authorization_context: authorizationContext,
    authorization_context_key: getDiscountAuthorizationContextKey(authorizationContext),
    preview_session: buildSessionSnapshot(pendingSession)
  };
}

function applyAuthorizedPendingSessionDiscount(sessionId, payload = {}, authorization = {}, options = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("Sessao do atendimento nao encontrada.");
  }
  const { pendingSession, discountUpdate } = buildPendingDiscountSession(session, payload);
  const policy = pendingSession.discount_policy || getSessionDiscountPolicy(pendingSession);
  if (discountUpdate.discountAmount <= 0) {
    throw new Error("Informe um desconto valido para aplicar.");
  }
  if (!policy.requiresAuthorization || !Array.isArray(policy.invalidMethods) || !policy.invalidMethods.length) {
    throw new Error("Este desconto deve ser aplicado pelo fluxo normal.");
  }
  const authorizationId = normalizeText(authorization.authorization_id || authorization.authorizationId || "");
  if (!authorizationId) {
    throw new Error("Autorizacao gerencial obrigatoria para aplicar este desconto.");
  }
  const currentAuthorizationContext = buildDiscountAuthorizationContext(pendingSession);
  const originalAuthorizationContext = options.authorizationContext && typeof options.authorizationContext === "object"
    ? options.authorizationContext
    : currentAuthorizationContext;
  assertPendingDiscountAuthorizationContextMatches(originalAuthorizationContext, currentAuthorizationContext);
  assignSessionGeneralDiscount(session, discountUpdate);
  session.payment_plan = cloneSerializable(pendingSession.payment_plan) || { methods: [] };
  applySessionDiscountPolicy(session);
  session.discount_authorization_id = authorizationId;
  session.discount_authorization_context_key = getDiscountAuthorizationContextKey(originalAuthorizationContext);
  session.discount_authorization_context = cloneSerializable(originalAuthorizationContext);
  session.authorization_required = true;
  session.discount_authorization_required = true;
  session.updated_at = nowIso();
  saveSession(session);
  return {
    session,
    authorization_id: authorizationId,
    discount_policy: session.discount_policy,
    authorization_context: cloneSerializable(originalAuthorizationContext),
    authorization_context_key: session.discount_authorization_context_key
  };
}

function buildSessionSnapshot(session) {
  return {
    session_id: session.session_id,
    status: session.status,
    seller: session.seller,
    loja: session.loja,
    customer: session.customer,
    cart_items: session.cart_items,
    cart_notes: session.cart_notes,
    desconto_extra: toNumber(session.desconto_extra || session.discount_amount || 0),
    discount_amount: toNumber(session.desconto_extra || session.discount_amount || 0),
    discount_percent: toNumber(session.discount_percent || 0),
    discount_mode: normalizeText(session.discount_mode || "percent"),
    discount_reason: normalizeText(session.discount_reason || ""),
    discount_policy: session.discount_policy || getSessionDiscountPolicy(session),
    authorization_required: Boolean(session.authorization_required || session.discount_authorization_required),
    discount_authorization_required: Boolean(session.discount_authorization_required),
    payment_plan: session.payment_plan,
    cashback_application: normalizeCashbackApplication(session.cashback_application),
    coupon_prep: session.coupon_prep,
    created_at: session.created_at,
    updated_at: session.updated_at
  };
}

function createQuoteFromSession(sessionId, payload = {}, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("SessÃ£o do atendimento nÃ£o encontrada.");
  }
  const quotes = loadQuotes();
  const quote = {
    quote_id: buildId("QTE"),
    status: SESSION_STATUS.QUOTE,
    validade: normalizeText(payload.validade || ""),
    observacoes: normalizeText(payload.observacoes || session.cart_notes || ""),
    seller: normalizeText(payload.vendedor || session.seller),
    loja: normalizeStoreKey(payload.loja || session.loja),
    session_snapshot: buildSessionSnapshot(session),
    created_at: nowIso(),
    created_by: user?.name || user?.email || "sistema"
  };
  quotes.unshift(quote);
  saveQuotes(quotes);
  session.status = SESSION_STATUS.QUOTE;
  session.updated_at = nowIso();
  saveSession(session);
  appendEvent("QUOTE_CREATED", { session_id: sessionId, loja: quote.loja }, { quote_id: quote.quote_id, customer: session.customer }, user);
  return quote;
}

function createReservationFromSession(sessionId, payload = {}, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("SessÃ£o do atendimento nÃ£o encontrada.");
  }
  const reservations = loadReservations();
  const reservation = {
    reservation_id: buildId("RSV"),
    status: SESSION_STATUS.RESERVED,
    validade: normalizeText(payload.validade || ""),
    observacoes: normalizeText(payload.observacoes || session.cart_notes || ""),
    seller: normalizeText(payload.vendedor || session.seller),
    loja: normalizeStoreKey(payload.loja || session.loja),
    session_snapshot: buildSessionSnapshot(session),
    created_at: nowIso(),
    created_by: user?.name || user?.email || "sistema"
  };
  const { holdReservationInventory } = require("../inventory/pdvInventoryService");
  holdReservationInventory(reservation, user);
  reservations.unshift(reservation);
  saveReservations(reservations);
  session.status = SESSION_STATUS.RESERVED;
  session.updated_at = nowIso();
  saveSession(session);
  appendEvent("RESERVATION_CREATED", { session_id: sessionId, loja: reservation.loja }, { reservation_id: reservation.reservation_id, customer: session.customer }, user);
  return reservation;
}

function createInternalConsumption(payload = {}, user = {}) {
  const entry = {
    consumption_id: buildId("CNS"),
    produto: normalizeText(payload.produto || payload.nome || ""),
    sku: normalizeText(payload.sku || payload.codigo || ""),
    quantidade: Math.max(1, Math.round(toNumber(payload.quantidade || 1))),
    destino: normalizeText(payload.destino || ""),
    motivo: normalizeText(payload.motivo || ""),
    observacao: normalizeText(payload.observacao || ""),
    responsavel: normalizeText(payload.responsavel || user?.name || user?.email || ""),
    loja: normalizeStoreKey(payload.loja || ""),
    created_at: nowIso(),
    created_by: user?.name || user?.email || "sistema"
  };
  const { applyInternalConsumptionInventory } = require("../inventory/pdvInventoryService");
  applyInternalConsumptionInventory(entry, user);
  const rows = loadInternalConsumption();
  rows.unshift(entry);
  saveInternalConsumption(rows);
  appendEvent("INTERNAL_CONSUMPTION_CREATED", { loja: entry.loja }, entry, user);
  return entry;
}

function prepareCoupon(sessionId, payload = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("SessÃ£o do atendimento nÃ£o encontrada.");
  }
  session.coupon_prep = {
    mode: normalizeText(payload.mode || "normal"),
    with_price: payload.with_price !== false,
    whatsapp_ready: Boolean(payload.whatsapp_ready),
    qr_ready: Boolean(payload.qr_ready)
  };
  session.updated_at = nowIso();
  saveSession(session);
  return session;
}

function getOperationalDashboard() {
  const sessions = loadSessions();
  const quotes = loadQuotes();
  const reservations = loadReservations();
  const consumptions = loadInternalConsumption();
  const events = loadEvents();
  return {
    sessions_open: sessions.filter((item) => item.status === SESSION_STATUS.OPEN).length,
    quotes_open: quotes.length,
    reservations_open: reservations.length,
    internal_consumption_count: consumptions.length,
    events_logged: events.length,
    last_events: events.slice(0, 20)
  };
}

module.exports = {
  ensureOperationalDirs,
  getPdvOperationalManifest,
  searchProducts,
  searchCustomers,
  createQuickCustomer,
  openCustomerSession,
  getSessionById,
  saveSession,
  addProductToCart,
  updateCartItem,
  removeCartItem,
  updateCartItemDiscount,
  attachCustomerToSession,
  detachCustomerFromSession,
  completeSession,
  saveCartDraft,
  listCartDrafts,
  deleteCartDraft,
  restoreCartDraft,
  updatePaymentPlan,
  updateSessionDiscount,
  requestPendingSessionDiscountAuthorization,
  applyAuthorizedPendingSessionDiscount,
  assertPendingDiscountAuthorizationContextMatches,
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
  searchProductsDetailed,
  searchCustomersDetailed,
  buildCustomerBehaviorSnapshot,
  debugUnifiedSearch,
  appendEvent,
  EVENT_TYPES,
  SESSION_STATUS
};
