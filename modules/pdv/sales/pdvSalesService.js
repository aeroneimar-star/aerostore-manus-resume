"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  getSessionById,
  saveSession,
  completeSession,
  appendEvent,
  loadEvents,
  EVENT_TYPES
} = require("../services/pdvOperationalService");
const {
  getOpenCashRegisterByStore,
  registerCashMovement,
  validateSaleControls,
  appendAuditLog,
  getPdvUserRole
} = require("../services/pdvControlService");
const { registerGiftExperienceFromSale } = require("../services/pdvExperienceService");
const {
  validateStockAvailability,
  applySaleInventory,
  restoreSaleInventory,
  applyExchangeInboundFromSale,
  convertReservationInventory,
  resolveSaleFulfillmentPlan,
  FULFILLMENT_MODES,
  FULFILLMENT_STATUS
} = require("../inventory/pdvInventoryService");
const { normalizeStoreKey, formatStoreLabel, storesMatch } = require("../utils/pdvStoreUtils");
const { getStorePublicContext } = require("../../../services/storeSettingsService");
const { PagBankError, createPagBankCheckout, getPagBankCheckout } = require("../../../services/pagbankService");
const { get, run } = require("../../../db");
const { getNotificationService, getNotificationDryRunDefault } = require("../../../src/notification/NotificationService");
const {
  listActiveExchangeCreditsForCustomer,
  getExchangeCreditById,
  consumeExchangeCreditForSale
} = require("../exchanges/pdvExchangeCreditService");

const salesRootDir = path.join(process.cwd(), "data", "pdv", "sales");
const salesFiles = {
  sales: path.join(salesRootDir, "sales.json"),
  cashback: path.join(salesRootDir, "cashback-ledger.json"),
  giftCards: path.join(salesRootDir, "gift-cards.json"),
  commissions: path.join(salesRootDir, "commissions.json"),
  exchanges: path.join(salesRootDir, "exchanges.json"),
  coupons: path.join(salesRootDir, "coupons.json"),
  logs: path.join(salesRootDir, "logs.json")
};

const CASHBACK_RATE = 0.12;
const CASHBACK_VALIDITY_DAYS = 30;
const CASHBACK_REDEMPTION_LIMIT_RATE = 0.5;
const CASHBACK_TIMEZONE = process.env.AEROSTORE_CASHBACK_TIMEZONE || "America/Sao_Paulo";
const reservationsFilePath = path.join(process.cwd(), "data", "pdv", "operational", "reservations.json");
const PAYMENT_LINK_INTERNAL_STATUSES = new Set(["pending_generation", "generated", "sent", "paid", "error"]);
const PAYMENT_LINK_PAID_PROVIDER_STATUSES = new Set(["PAID", "AUTHORIZED", "COMPLETED", "SUCCEEDED"]);
const PAYMENT_LINK_DECLINED_PROVIDER_STATUSES = new Set(["DECLINED", "DENIED", "FAILED", "NOT_PAID", "REFUSED"]);
const PAYMENT_LINK_CANCELED_PROVIDER_STATUSES = new Set(["CANCELED", "CANCELLED", "VOIDED"]);
const PAYMENT_LINK_EXPIRED_PROVIDER_STATUSES = new Set(["EXPIRED"]);
const PAYMENT_LINK_AWAITING_PROVIDER_STATUSES = new Set([
  "ACTIVE",
  "AVAILABLE",
  "CREATED",
  "PENDING",
  "PENDING_PAYMENT",
  "WAITING",
  "WAITING_PAYMENT",
  "IN_ANALYSIS",
  "UNDER_REVIEW",
  "PROCESSING"
]);

function ensureSalesDirs() {
  fs.mkdirSync(salesRootDir, { recursive: true });
  Object.values(salesFiles).forEach((filePath) => {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "[]", "utf8");
    }
  });
}

function readJson(filePath, fallback = []) {
  ensureSalesDirs();
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureSalesDirs();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function uniqueTextList(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [values])
    .map((value) => normalizeText(value || ""))
    .filter((value) => {
      if (!value) return false;
      const key = value.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizePhone(value = "") {
  let digits = normalizeDigits(value);
  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }
  return digits;
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nowIso() {
  return new Date().toISOString();
}

function addDays(date, days) {
  const parsed = new Date(date);
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString();
}

function parseDateInput(value) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value || nowIso());
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getDatePartsInTimeZone(dateValue = new Date(), timeZone = CASHBACK_TIMEZONE) {
  const parsed = parseDateInput(dateValue);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(parsed)
      .filter((item) => item.type !== "literal")
      .map((item) => [item.type, item.value])
  );
  return {
    year: Number(parts.year || 0),
    month: Number(parts.month || 0),
    day: Number(parts.day || 0),
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
    second: Number(parts.second || 0)
  };
}

function addCalendarDays(parts = {}, days = 0) {
  const base = new Date(Date.UTC(
    Number(parts.year || 0),
    Math.max(0, Number(parts.month || 1) - 1),
    Math.max(1, Number(parts.day || 1))
  ));
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate()
  };
}

function getTimeZoneOffsetMs(dateValue = new Date(), timeZone = CASHBACK_TIMEZONE) {
  const parsed = parseDateInput(dateValue);
  const parts = getDatePartsInTimeZone(parsed, timeZone);
  const asUtc = Date.UTC(parts.year, Math.max(0, parts.month - 1), parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - parsed.getTime();
}

function getTimeZoneInstant(parts = {}, timeZone = CASHBACK_TIMEZONE) {
  const utcGuess = new Date(Date.UTC(
    Number(parts.year || 0),
    Math.max(0, Number(parts.month || 1) - 1),
    Math.max(1, Number(parts.day || 1)),
    Number(parts.hour || 0),
    Number(parts.minute || 0),
    Number(parts.second || 0)
  ));
  const offset = getTimeZoneOffsetMs(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offset);
}

function formatDateTimeInTimeZoneBR(dateValue = "", timeZone = CASHBACK_TIMEZONE) {
  if (!dateValue) return "-";
  const parsed = parseDateInput(dateValue);
  return parsed.toLocaleString("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getCashbackValidFrom(saleDate = nowIso(), timeZone = CASHBACK_TIMEZONE) {
  const saleParts = getDatePartsInTimeZone(saleDate, timeZone);
  const nextDay = addCalendarDays(saleParts, 1);
  return getTimeZoneInstant({
    ...nextDay,
    hour: 0,
    minute: 0,
    second: 0
  }, timeZone).toISOString();
}

function getCashbackExpiresAt(validFrom = nowIso(), timeZone = CASHBACK_TIMEZONE, validityDays = CASHBACK_VALIDITY_DAYS) {
  const validParts = getDatePartsInTimeZone(validFrom, timeZone);
  const lastValidDay = addCalendarDays(validParts, Math.max(0, Number(validityDays || 0) - 1));
  return getTimeZoneInstant({
    ...lastValidDay,
    hour: 23,
    minute: 59,
    second: 59
  }, timeZone).toISOString();
}

function getCashbackAvailabilityDate(entry = {}) {
  return normalizeText(entry.valid_from || entry.available_at || "");
}

function getNextPendingCashbackAvailability(entries = []) {
  return (entries || [])
    .filter((entry) => normalizeText(entry.status || "").toUpperCase() === "PENDING")
    .map((entry) => getCashbackAvailabilityDate(entry))
    .filter(Boolean)
    .sort()[0] || "";
}

function refreshCashbackLedgerLifecycle(ledger = []) {
  const now = new Date();
  let dirty = false;
  (ledger || []).forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const createdAt = normalizeText(entry.generated_at || entry.created_at || "");
    const isOperationalSaleEntry = normalizeText(entry.source || "") === "PDV_AEROSTORE"
      && normalizeText(entry.origin || "") === "SALE"
      && createdAt;
    if (isOperationalSaleEntry) {
      const expectedValidFrom = getCashbackValidFrom(createdAt);
      const expectedExpiresAt = getCashbackExpiresAt(expectedValidFrom);
      if (entry.valid_from !== expectedValidFrom || entry.available_at !== expectedValidFrom) {
        entry.valid_from = expectedValidFrom;
        entry.available_at = expectedValidFrom;
        dirty = true;
      }
      if (entry.expires_at !== expectedExpiresAt) {
        entry.expires_at = expectedExpiresAt;
        dirty = true;
      }
      if (!Number.isFinite(Number(entry.remaining_amount))) {
        entry.remaining_amount = roundMoney(entry.amount || 0);
        dirty = true;
      }
      if (!entry.generated_at) {
        entry.generated_at = createdAt;
        dirty = true;
      }
    }
    const availableAt = getCashbackAvailabilityDate(entry);
    if (entry.status === "PENDING" && availableAt && new Date(availableAt) <= now) {
      entry.status = "AVAILABLE";
      entry.remaining_amount = roundMoney(entry.remaining_amount ?? entry.amount);
      dirty = true;
    }
    if (entry.status === "AVAILABLE" && entry.expires_at && new Date(entry.expires_at) < now) {
      entry.status = "EXPIRED";
      dirty = true;
    }
  });
  return { ledger, dirty };
}

function buildId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(2));
}

function formatCurrencyBR(value = 0) {
  return `R$ ${roundMoney(value).toFixed(2).replace(".", ",")}`;
}

function loadSales() {
  return readJson(salesFiles.sales, []);
}

function saveSales(rows) {
  writeJson(salesFiles.sales, rows);
}

function isLinkPaymentMethod(method = "") {
  return normalizeText(method).toLowerCase() === "link_pagamento";
}

function getSalePaymentLinkUrl(sale = {}) {
  return normalizeText(
    sale.payment_link_url
    || sale.payment_link?.url
    || sale.pagbank?.payment_url
    || sale.checkout_url
    || ""
  );
}

function getSalePaymentLinkCheckoutId(sale = {}) {
  return normalizeText(
    sale.payment_link_checkout_id
    || sale.payment_link?.checkout_id
    || sale.pagbank?.checkout_id
    || ""
  );
}

function getSalePaymentLinkStatus(sale = {}) {
  const normalized = normalizeText(
    sale.payment_link_status
    || sale.payment_link?.status
    || sale.pagbank?.status
    || ""
  ).toLowerCase();
  if (normalized) {
    return normalized;
  }
  return getSalePaymentLinkUrl(sale) ? "generated" : "pending_generation";
}

function normalizePaymentLinkLifecycleStatus(value = "", sale = {}, snapshot = {}) {
  const normalized = normalizeText(value || "").toLowerCase();
  if (PAYMENT_LINK_INTERNAL_STATUSES.has(normalized)) {
    return normalized;
  }
  const hasError = Boolean(normalizeText(snapshot.payment_link_last_error || sale.payment_link_last_error || ""));
  const hasLink = Boolean(
    normalizeText(snapshot.payment_link_url || snapshot.payment_url || sale.payment_link_url || "")
    || normalizeText(snapshot.payment_link_checkout_id || snapshot.checkout_id || sale.payment_link_checkout_id || "")
  );
  const sentAt = normalizeText(snapshot.payment_link_sent_at || sale.payment_link_sent_at || "");
  if (hasError && !hasLink) {
    return "error";
  }
  if (hasLink) {
    return sentAt ? "sent" : "generated";
  }
  return "pending_generation";
}

function normalizeProviderStatusKey(value = "") {
  return normalizeText(value || "").toUpperCase().replace(/[\s-]+/g, "_");
}

function getPagBankProviderStatusCandidates(providerPayload = {}, sale = {}) {
  const raw = providerPayload?.raw && typeof providerPayload.raw === "object"
    ? providerPayload.raw
    : (providerPayload && typeof providerPayload === "object" ? providerPayload : {});
  const orderStatuses = [];
  if (Array.isArray(raw.orders)) {
    for (const order of raw.orders) {
      orderStatuses.push(order?.status);
      if (Array.isArray(order?.charges)) {
        for (const charge of order.charges) {
          orderStatuses.push(charge?.status);
        }
      }
      if (Array.isArray(order?.payments)) {
        for (const payment of order.payments) {
          orderStatuses.push(payment?.status);
        }
      }
    }
  }
  return uniqueTextList([
    providerPayload.payment_link_provider_status,
    providerPayload.provider_status,
    providerPayload.payment_status,
    providerPayload.status,
    raw.status,
    raw.payment_status,
    raw.charge_status,
    raw.payment?.status,
    raw.payment_response?.status,
    raw.charge?.status,
    Array.isArray(raw.charges) ? raw.charges[0]?.status : "",
    Array.isArray(raw.transactions) ? raw.transactions[0]?.status : "",
    Array.isArray(raw.payments) ? raw.payments[0]?.status : "",
    Array.isArray(raw.orders) ? raw.orders[0]?.status : "",
    Array.isArray(raw.orders?.[0]?.charges) ? raw.orders[0].charges[0]?.status : "",
    Array.isArray(raw.orders?.[0]?.payments) ? raw.orders[0].payments[0]?.status : "",
    ...orderStatuses,
    sale.payment_link_provider_status
  ]);
}

function getPagBankProviderPaidAt(providerPayload = {}, sale = {}) {
  const raw = providerPayload?.raw && typeof providerPayload.raw === "object"
    ? providerPayload.raw
    : (providerPayload && typeof providerPayload === "object" ? providerPayload : {});
  const orderPaidAtCandidates = [];
  if (Array.isArray(raw.orders)) {
    for (const order of raw.orders) {
      if (Array.isArray(order?.charges)) {
        for (const charge of order.charges) {
          orderPaidAtCandidates.push(charge?.paid_at, charge?.paidAt);
        }
      }
      if (Array.isArray(order?.payments)) {
        for (const payment of order.payments) {
          orderPaidAtCandidates.push(payment?.paid_at, payment?.paidAt);
        }
      }
    }
  }
  return uniqueTextList([
    providerPayload.payment_link_paid_at,
    providerPayload.paid_at,
    providerPayload.paidAt,
    raw.paid_at,
    raw.paidAt,
    raw.payment_date,
    raw.paymentDate,
    raw.payment?.paid_at,
    raw.payment?.paidAt,
    raw.payment_response?.paid_at,
    raw.payment_response?.paidAt,
    raw.charge?.paid_at,
    raw.charge?.paidAt,
    Array.isArray(raw.charges) ? raw.charges[0]?.paid_at : "",
    Array.isArray(raw.charges) ? raw.charges[0]?.paidAt : "",
    Array.isArray(raw.transactions) ? raw.transactions[0]?.paid_at : "",
    Array.isArray(raw.transactions) ? raw.transactions[0]?.paidAt : "",
    Array.isArray(raw.orders?.[0]?.charges) ? raw.orders[0].charges[0]?.paid_at : "",
    Array.isArray(raw.orders?.[0]?.charges) ? raw.orders[0].charges[0]?.paidAt : "",
    ...orderPaidAtCandidates
  ])[0] || "";
}

function normalizePagBankPaymentLinkStatus(providerPayload = {}, sale = {}) {
  const lifecycleStatus = normalizePaymentLinkLifecycleStatus(
    providerPayload.payment_link_status || sale.payment_link_status || "",
    sale,
    providerPayload
  );
  const statusCandidates = getPagBankProviderStatusCandidates(providerPayload, sale);
  const statusKeys = statusCandidates.map(normalizeProviderStatusKey).filter(Boolean);
  if (statusKeys.some((key) => PAYMENT_LINK_PAID_PROVIDER_STATUSES.has(key))) return "paid";
  if (statusKeys.some((key) => PAYMENT_LINK_DECLINED_PROVIDER_STATUSES.has(key))) return "declined";
  if (statusKeys.some((key) => PAYMENT_LINK_CANCELED_PROVIDER_STATUSES.has(key))) return "canceled";
  if (statusKeys.some((key) => PAYMENT_LINK_EXPIRED_PROVIDER_STATUSES.has(key))) return "expired";
  if (statusKeys.some((key) => PAYMENT_LINK_AWAITING_PROVIDER_STATUSES.has(key))) return "awaiting_payment";
  if (lifecycleStatus === "pending_generation") {
    return "pending_generation";
  }
  if (["generated", "sent", "paid"].includes(lifecycleStatus)) {
    return lifecycleStatus === "paid" ? "paid" : "awaiting_payment";
  }
  return "unknown";
}

function getPaymentLinkReleaseDecision(status = "") {
  const normalized = normalizeText(status || "").toLowerCase();
  if (normalized === "paid") {
    return {
      status: "release_allowed",
      can_release_goods: true,
      label: "Liberar mercadoria",
      severity: "success",
      reason: "Pagamento confirmado pelo PagBank."
    };
  }
  if (normalized === "awaiting_payment" || normalized === "generated" || normalized === "sent" || normalized === "pending_generation") {
    return {
      status: "awaiting_payment",
      can_release_goods: false,
      label: "Aguardando pagamento",
      severity: "warning",
      reason: "Nao libere a mercadoria ate o pagamento ser confirmado."
    };
  }
  if (normalized === "declined") {
    return {
      status: "do_not_release",
      can_release_goods: false,
      label: "Nao liberar mercadoria",
      severity: "danger",
      reason: "Pagamento recusado pelo PagBank."
    };
  }
  if (normalized === "canceled") {
    return {
      status: "do_not_release",
      can_release_goods: false,
      label: "Nao liberar mercadoria",
      severity: "danger",
      reason: "Pagamento cancelado. Verifique com a cliente antes de liberar."
    };
  }
  if (normalized === "expired") {
    return {
      status: "do_not_release",
      can_release_goods: false,
      label: "Nao liberar mercadoria",
      severity: "danger",
      reason: "O link de pagamento expirou."
    };
  }
  return {
    status: "do_not_release",
    can_release_goods: false,
    label: "Nao liberar mercadoria",
    severity: "neutral",
    reason: "Status desconhecido. Atualize o PagBank antes de liberar."
  };
}

function saleUsesPaymentLink(sale = {}) {
  return (sale?.pagamentos || []).some((item) => isLinkPaymentMethod(item?.method || ""));
}

function normalizeSalePaymentLinkState(sale = {}) {
  if (!sale || typeof sale !== "object") {
    return sale;
  }
  if (!saleUsesPaymentLink(sale) && !getSalePaymentLinkUrl(sale) && !getSalePaymentLinkCheckoutId(sale)) {
    return sale;
  }
  const lifecycleStatus = normalizePaymentLinkLifecycleStatus(
    sale.payment_link_status || sale.payment_link?.status || sale.pagbank?.status || "",
    sale,
    sale
  );
  const paymentStatus = normalizeText(sale.payment_link_payment_status || sale.payment_link?.payment_status || "").toLowerCase()
    || normalizePagBankPaymentLinkStatus({
      payment_link_status: lifecycleStatus,
      payment_link_provider_status: normalizeText(sale.payment_link_provider_status || sale.payment_link?.provider_status || ""),
      payment_link_url: getSalePaymentLinkUrl(sale),
      payment_link_checkout_id: getSalePaymentLinkCheckoutId(sale)
    }, sale);
  const releaseDecision = getPaymentLinkReleaseDecision(paymentStatus);
  return {
    ...sale,
    payment_link_provider: normalizeText(sale.payment_link_provider || sale.payment_link?.provider || sale.pagbank?.provider || "pagbank"),
    payment_link_url: getSalePaymentLinkUrl(sale),
    payment_link_checkout_id: getSalePaymentLinkCheckoutId(sale),
    payment_link_status: lifecycleStatus,
    payment_link_created_at: normalizeText(sale.payment_link_created_at || sale.payment_link?.created_at || sale.pagbank?.created_at || ""),
    payment_link_sent_at: normalizeText(sale.payment_link_sent_at || sale.payment_link?.sent_at || ""),
    payment_link_last_error: normalizeText(sale.payment_link_last_error || sale.payment_link?.last_error || ""),
    payment_link_last_checked_at: normalizeText(sale.payment_link_last_checked_at || sale.payment_link?.last_checked_at || ""),
    payment_link_paid_at: normalizeText(sale.payment_link_paid_at || sale.payment_link?.paid_at || ""),
    payment_link_payment_status: paymentStatus,
    payment_link_provider_status: normalizeText(sale.payment_link_provider_status || sale.payment_link?.provider_status || ""),
    payment_link_release_status: normalizeText(sale.payment_link_release_status || sale.payment_link?.release_status || releaseDecision.status),
    payment_link_reference_id: normalizeText(sale.payment_link_reference_id || sale.payment_link?.reference_id || ""),
    payment_link_warnings: Array.isArray(sale.payment_link_warnings) ? sale.payment_link_warnings : (Array.isArray(sale.payment_link?.warnings) ? sale.payment_link.warnings : []),
    payment_link_requires_manual_review: Boolean(
      sale.payment_link_requires_manual_review
      || sale.payment_link?.requires_manual_review
    ),
    payment_link_can_release_goods: Boolean(sale.payment_link_can_release_goods || sale.payment_link?.can_release_goods || releaseDecision.can_release_goods)
  };
}

function updateSaleRecord(saleId = "", updater = null) {
  const normalizedSaleId = normalizeText(saleId || "");
  if (!normalizedSaleId || typeof updater !== "function") {
    return null;
  }
  const sales = loadSales();
  const index = sales.findIndex((item) => normalizeText(item?.sale_id || "") === normalizedSaleId);
  if (index < 0) {
    return null;
  }
  const updated = updater(sales[index], sales, index);
  if (!updated) {
    return null;
  }
  sales[index] = updated;
  saveSales(sales);
  return normalizeSalePaymentLinkState(normalizeLegacySaleFulfillment(updated));
}

function loadCashbackLedger() {
  return readJson(salesFiles.cashback, []);
}

function saveCashbackLedger(rows) {
  writeJson(salesFiles.cashback, rows);
}

function loadGiftCards() {
  return readJson(salesFiles.giftCards, []);
}

function saveGiftCards(rows) {
  writeJson(salesFiles.giftCards, rows);
}

function loadCommissions() {
  return readJson(salesFiles.commissions, []);
}

function saveCommissions(rows) {
  writeJson(salesFiles.commissions, rows);
}

function loadExchanges() {
  return readJson(salesFiles.exchanges, []);
}

function saveExchanges(rows) {
  writeJson(salesFiles.exchanges, rows);
}

function loadCoupons() {
  return readJson(salesFiles.coupons, []);
}

function saveCoupons(rows) {
  writeJson(salesFiles.coupons, rows);
}

function loadSalesLogs() {
  return readJson(salesFiles.logs, []);
}

function appendSalesLog(entry) {
  const logs = loadSalesLogs();
  logs.unshift(entry);
  writeJson(salesFiles.logs, logs.slice(0, 5000));
}

function inferRedemptionBlocked(item) {
  const haystack = normalizeText([item.nome, item.categoria, item.tipo, item.marca].join(" ")).toLowerCase();
  return haystack.includes("perfume") || haystack.includes("perfumes");
}

function getSaleCartItemUnitPrice(item = {}) {
  return toNumber(item.preco_referencia || item.preco_venda || item.price || 0);
}

function getSaleCartItemQuantity(item = {}) {
  return Math.max(1, Math.round(toNumber(item.quantidade || 1)));
}

function normalizeSaleCartItemDiscount(item = {}) {
  const gross = roundMoney(getSaleCartItemUnitPrice(item) * getSaleCartItemQuantity(item));
  const source = item.item_discount && typeof item.item_discount === "object"
    ? item.item_discount
    : {};
  const mode = normalizeText(source.mode || source.discount_mode || "amount").toLowerCase() === "percent" ? "percent" : "amount";
  const value = roundMoney(Math.max(0, toNumber(source.value ?? source.percent ?? source.amount ?? 0)));
  let amount = mode === "percent"
    ? roundMoney((gross * value) / 100)
    : value;
  amount = roundMoney(Math.min(gross, Math.max(0, amount)));
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

function getSaleItemDiscountTotal(cartItems = []) {
  return roundMoney((cartItems || []).reduce((sum, item) => {
    return sum + roundMoney(normalizeSaleCartItemDiscount(item)?.amount || 0);
  }, 0));
}

function getSaleItemsNetSubtotal(cartItems = []) {
  return roundMoney(Math.max(0, getSaleSubtotal(cartItems) - getSaleItemDiscountTotal(cartItems)));
}

function getSaleSubtotal(cartItems = []) {
  return roundMoney((cartItems || []).reduce((sum, item) => {
    return sum + (getSaleCartItemUnitPrice(item) * getSaleCartItemQuantity(item));
  }, 0));
}

function sumPaymentMethods(methods = [], accepted = []) {
  return roundMoney((methods || [])
    .filter((item) => !accepted.length || accepted.includes(item.method))
    .reduce((sum, item) => sum + toNumber(item.amount), 0));
}

function normalizeCashbackApplication(entry = null) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const amount = roundMoney(entry.amount || 0);
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

function resolveCashbackApplication(session = {}, payload = {}, paymentMethods = []) {
  const fromPayload = normalizeCashbackApplication(payload.cashback_application);
  if (fromPayload) {
    return fromPayload;
  }
  const fromSession = normalizeCashbackApplication(session.cashback_application);
  if (fromSession) {
    return fromSession;
  }
  const legacyCashbackAmount = sumPaymentMethods(paymentMethods, ["cashback"]);
  if (legacyCashbackAmount <= 0) {
    return null;
  }
  return normalizeCashbackApplication({
    amount: legacyCashbackAmount,
    customer_phone: session.customer?.phone || "",
    customer_name: session.customer?.name || "",
    customer_id: session.customer?.master_customer_id || ""
  });
}

function getCustomerCashbackSnapshot(phone = "") {
  const customerPhone = normalizePhone(phone);
  if (!customerPhone) {
    return {
      available: 0,
      pending: 0,
      expiring: 0,
      entries: []
    };
  }
  const now = new Date();
  const refreshResult = refreshCashbackLedgerLifecycle(loadCashbackLedger());
  const ledger = refreshResult.ledger;
  let dirty = refreshResult.dirty;
  const entries = [];
  let available = 0;
  let pending = 0;
  let expiring = 0;
  ledger.forEach((entry) => {
    if (normalizePhone(entry.customer_phone || "") !== customerPhone) {
      return;
    }
    const normalizedAmount = roundMoney(entry.remaining_amount ?? entry.amount);
    if (entry.status === "AVAILABLE") {
      available = roundMoney(available + normalizedAmount);
      const expiresAt = entry.expires_at ? new Date(entry.expires_at) : null;
      if (expiresAt && !Number.isNaN(expiresAt.getTime())) {
        const expiresInMs = expiresAt.getTime() - now.getTime();
        const expiresInDays = expiresInMs / (1000 * 60 * 60 * 24);
        if (expiresInDays >= 0 && expiresInDays <= 7) {
          expiring = roundMoney(expiring + normalizedAmount);
        }
      }
    } else if (entry.status === "PENDING") {
      pending = roundMoney(pending + roundMoney(entry.amount || 0));
    }
    entries.push({
      cashback_id: entry.cashback_id,
      status: entry.status,
      amount: roundMoney(entry.amount || 0),
      remaining_amount: normalizedAmount,
      valid_from: getCashbackAvailabilityDate(entry),
      available_at: getCashbackAvailabilityDate(entry),
      expires_at: entry.expires_at || "",
      created_at: entry.created_at || "",
      generated_at: entry.generated_at || entry.created_at || "",
      source: normalizeText(entry.source || ""),
      origin: normalizeText(entry.origin || "")
    });
  });
  if (dirty) {
    saveCashbackLedger(ledger);
  }
  return {
    available: roundMoney(available),
    pending: roundMoney(pending),
    expiring: roundMoney(expiring),
    entries: entries.slice(0, 20)
  };
}

function computeIncrementalBase({ subtotal, itemDiscountAmount = 0, extraDiscount, paymentMethods, cashbackUsed = 0 }) {
  const netItemsSubtotal = roundMoney(Math.max(0, subtotal - roundMoney(itemDiscountAmount)));
  const discount = roundMoney(extraDiscount);
  const giftCardUsed = sumPaymentMethods(paymentMethods, ["vale_presente"]);
  const exchangeCredit = sumPaymentMethods(paymentMethods, ["credito_troca"]);
  const permuta = sumPaymentMethods(paymentMethods, ["permuta"]);
  const incremental = netItemsSubtotal - discount - roundMoney(cashbackUsed) - giftCardUsed - exchangeCredit - permuta;
  return roundMoney(Math.max(0, incremental));
}

function buildNormalizedPaymentMethods(methods = []) {
  return (methods || []).map((item) => ({
    method: normalizeText(item.method || ""),
    amount: roundMoney(item.amount || 0),
    installments: Math.max(1, Math.min(10, Math.round(toNumber(item.installments || 1)))),
    installment_amount: roundMoney(item.installment_amount || (toNumber(item.amount || 0) / Math.max(1, Math.min(10, Math.round(toNumber(item.installments || 1)))))),
    brand: normalizeText(item.brand || ""),
    nsu: normalizeText(item.nsu || ""),
    credit_id: normalizeText(item.credit_id || item.exchange_credit_id || ""),
    customer_id: normalizeText(item.customer_id || "")
  })).filter((item) => item.method);
}

function isRealPaymentMethod(method = "") {
  return !["cashback", "credito_troca", "vale_presente", "permuta"].includes(normalizeText(method || ""));
}

function getCashbackRedemptionContext(session = {}, payload = {}, paymentMethodsSource = null) {
  const paymentMethods = Array.isArray(paymentMethodsSource)
    ? paymentMethodsSource
    : buildNormalizedPaymentMethods(payload.paymentMethods || session.payment_plan?.methods || []);
  const financialPaymentMethods = paymentMethods.filter((item) => item.method !== "cashback");
  const subtotal = getSaleSubtotal(session.cart_items || []);
  const itemDiscountAmount = getSaleItemDiscountTotal(session.cart_items || []);
  const subtotalAfterItemDiscount = roundMoney(Math.max(0, subtotal - itemDiscountAmount));
  const extraDiscount = roundMoney(
    payload.desconto_extra
    ?? payload.extra_discount
    ?? payload.discount_amount
    ?? session.desconto_extra
    ?? session.extra_discount
    ?? session.discount_amount
    ?? 0
  );
  const giftCardUsed = sumPaymentMethods(financialPaymentMethods, ["vale_presente"]);
  const exchangeCredit = sumPaymentMethods(financialPaymentMethods, ["credito_troca"]);
  const permutaAmount = sumPaymentMethods(financialPaymentMethods, ["permuta"]);
  const eligibleBase = roundMoney(Math.max(0, subtotalAfterItemDiscount - extraDiscount - giftCardUsed - permutaAmount));
  const remainingBeforeCashback = roundMoney(Math.max(0, eligibleBase - exchangeCredit));
  const maxCashbackUsable = roundMoney(Math.min(
    eligibleBase * CASHBACK_REDEMPTION_LIMIT_RATE,
    remainingBeforeCashback
  ));
  const requestedApplication = resolveCashbackApplication(session, payload, paymentMethods);
  const requestedAmount = roundMoney(requestedApplication?.amount || payload.amount || payload.cashback_amount || 0);
  const customerPhone = normalizePhone(session.customer?.phone || "");
  const snapshot = customerPhone
    ? getCustomerCashbackSnapshot(customerPhone)
    : { available: 0, pending: 0, expiring: 0, entries: [] };
  const availableOperational = roundMoney(snapshot.available || 0);
  const idealPurchaseToUseEverything = roundMoney(availableOperational * 2);
  const applicableNow = roundMoney(Math.min(availableOperational, maxCashbackUsable));
  const nonUsableInThisSale = roundMoney(Math.max(0, availableOperational - applicableNow));
  const blockedForRedemption = (session.cart_items || []).some(inferRedemptionBlocked);
  return {
    subtotal,
    itemDiscountAmount,
    subtotalAfterItemDiscount,
    extraDiscount,
    giftCardUsed,
    exchangeCredit,
    permutaAmount,
    eligibleBase,
    remainingBeforeCashback,
    maxCashbackUsable,
    requestedAmount,
    requestedApplication,
    availableOperational,
    snapshot,
    idealPurchaseToUseEverything,
    applicableNow,
    nonUsableInThisSale,
    blockedForRedemption
  };
}

function validateCashbackRedemption(session = {}, payload = {}, paymentMethodsSource = null) {
  const context = getCashbackRedemptionContext(session, payload, paymentMethodsSource);
  if (context.requestedAmount <= 0) {
    return context;
  }
  if (!session.customer?.phone) {
    throw new Error("Selecione um cliente antes de usar cashback na venda.");
  }
  if (context.blockedForRedemption) {
    throw new Error("Perfumes podem gerar cashback, mas nÃ£o aceitam resgate de cashback nesta venda.");
  }
  if (context.permutaAmount > 0) {
    throw new Error("Permuta nÃ£o aceita cashback.");
  }
  if (context.availableOperational <= 0) {
    if (context.snapshot.pending > 0) {
      const nextRelease = getNextPendingCashbackAvailability(context.snapshot.entries);
      const suffix = nextRelease
        ? ` Ele podera ser usado a partir de ${formatDateTimeInTimeZoneBR(nextRelease)}.`
        : "";
      throw new Error(`Este cashback ainda nao esta disponivel para uso.${suffix}`);
    }
    throw new Error("O cliente nÃ£o possui cashback operacional disponÃ­vel para uso.");
  }
  if (context.eligibleBase <= 0 || context.maxCashbackUsable <= 0) {
    throw new Error("NÃ£o hÃ¡ valor elegÃ­vel para abatimento com cashback nesta venda.");
  }
  if (context.requestedAmount > context.availableOperational) {
    throw new Error(`O cashback aplicado nÃ£o pode ser maior que o saldo disponÃ­vel (${formatCurrencyBR(context.availableOperational)}).`);
  }
  if (context.requestedAmount > context.maxCashbackUsable) {
    throw new Error(`Cashback acima do limite permitido. MÃ¡ximo permitido: ${formatCurrencyBR(context.maxCashbackUsable)}.`);
  }
  return context;
}

function computeSaleTotals(session, payload = {}) {
  const cartItems = session.cart_items || [];
  const subtotal = getSaleSubtotal(cartItems);
  const itemDiscountAmount = getSaleItemDiscountTotal(cartItems);
  const subtotalAfterItemDiscount = getSaleItemsNetSubtotal(cartItems);
  if (!cartItems.length || subtotal <= 0) {
    return {
      subtotal: 0,
      itemDiscountAmount: 0,
      subtotalAfterItemDiscount: 0,
      extraDiscount: 0,
      totalDiscountAmount: 0,
      totalAfterDiscount: 0,
      cashbackUsed: 0,
      giftCardUsed: 0,
      exchangeCredit: 0,
      permutaAmount: 0,
      totalFinal: 0,
      paidAmount: 0,
      incrementalBase: 0,
      paymentMethods: [],
      cashbackApplication: null,
      cashbackContext: getCashbackRedemptionContext(session, payload, []),
      blockedForRedemption: false
    };
  }
  const extraDiscount = roundMoney(
    payload.desconto_extra
    ?? payload.extra_discount
    ?? payload.discount_amount
    ?? session.desconto_extra
    ?? session.extra_discount
    ?? session.discount_amount
    ?? 0
  );
  const rawPaymentMethods = buildNormalizedPaymentMethods(payload.paymentMethods || session.payment_plan?.methods || []);
  const cashbackApplication = resolveCashbackApplication(session, payload, rawPaymentMethods);
  const cashbackUsed = roundMoney(cashbackApplication?.amount || 0);
  const paymentMethods = rawPaymentMethods.filter((item) => item.method !== "cashback");
  const giftCardUsed = sumPaymentMethods(paymentMethods, ["vale_presente"]);
  const exchangeCredit = sumPaymentMethods(paymentMethods, ["credito_troca"]);
  const permutaAmount = sumPaymentMethods(paymentMethods, ["permuta"]);
  const paidAmount = roundMoney(paymentMethods.filter((item) => isRealPaymentMethod(item.method)).reduce((sum, item) => sum + toNumber(item.amount), 0));
  const safeExtraDiscount = roundMoney(Math.min(extraDiscount, subtotalAfterItemDiscount));
  const totalDiscountAmount = roundMoney(itemDiscountAmount + safeExtraDiscount);
  const totalAfterDiscount = roundMoney(Math.max(0, subtotalAfterItemDiscount - safeExtraDiscount - giftCardUsed - exchangeCredit - permutaAmount));
  const totalFinal = roundMoney(Math.max(0, totalAfterDiscount - cashbackUsed));
  const incrementalBase = computeIncrementalBase({ subtotal, itemDiscountAmount, extraDiscount: safeExtraDiscount, paymentMethods, cashbackUsed });
  const blockedForRedemption = cartItems.some(inferRedemptionBlocked);
  return {
    subtotal,
    itemDiscountAmount,
    subtotalAfterItemDiscount,
    extraDiscount: safeExtraDiscount,
    totalDiscountAmount,
    totalAfterDiscount,
    cashbackUsed,
    giftCardUsed,
    exchangeCredit,
    permutaAmount,
    totalFinal,
    paidAmount,
    paymentMethods,
    cashbackApplication,
    cashbackContext: getCashbackRedemptionContext(session, payload, rawPaymentMethods),
    incrementalBase,
    blockedForRedemption
  };
}

function createCashbackEntry({ sale, customer, generatedAmount, user }) {
  const createdAt = normalizeText(sale?.created_at || nowIso()) || nowIso();
  const validFrom = getCashbackValidFrom(createdAt);
  const expiresAt = getCashbackExpiresAt(validFrom);
  const entry = {
    cashback_id: buildId("CBK"),
    sale_id: sale.sale_id,
    customer_phone: normalizePhone(customer?.phone || ""),
    customer_name: normalizeText(customer?.name || ""),
    source: "PDV_AEROSTORE",
    origin: "SALE",
    status: "AVAILABLE",
    amount: roundMoney(generatedAmount),
    remaining_amount: roundMoney(generatedAmount),
    valid_from: validFrom,
    available_at: validFrom,
    expires_at: expiresAt,
    created_at: createdAt,
    generated_at: createdAt,
    created_by: user?.name || user?.email || "sistema",
    notes: "Cashback oficial AEROSTORE gerado sobre valor liquido incremental da venda."
  };
  const ledger = loadCashbackLedger();
  ledger.unshift(entry);
  saveCashbackLedger(ledger);
  return entry;
}

function removeCashbackEntryFromJsonLedger(cashbackId = "") {
  const normalizedId = normalizeText(cashbackId || "");
  if (!normalizedId) return false;
  const ledger = loadCashbackLedger();
  const nextLedger = ledger.filter((entry) => normalizeText(entry.cashback_id || "") !== normalizedId);
  if (nextLedger.length === ledger.length) {
    return false;
  }
  saveCashbackLedger(nextLedger);
  return true;
}

async function resolveOperationalCashbackContact(customer = {}) {
  const numericCandidates = [
    customer.contact_id,
    customer.cashback_contact_id,
    customer.legacy_contact_id,
    customer.master_customer_id,
    customer.id
  ]
    .map((value) => Number(value || 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  for (const id of numericCandidates) {
    const row = await get("SELECT * FROM contacts WHERE id = ? LIMIT 1", [id]).catch(() => null);
    if (row?.id) {
      return row;
    }
  }

  const phone = normalizePhone(customer.phone || customer.mobile || customer.customer_phone || "");
  const document = normalizeDigits(customer.document || customer.cpf_cnpj || "");
  const email = normalizeText(customer.email || "").toLowerCase();

  if (phone) {
    const row = await get(
      `SELECT * FROM contacts
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone, ''), '(', ''), ')', ''), '-', ''), ' ', ''), '+', '') IN (?, ?)
       ORDER BY id DESC
       LIMIT 1`,
      [phone, `55${phone}`]
    ).catch(() => null);
    if (row?.id) {
      return row;
    }
  }

  if (document) {
    const row = await get(
      `SELECT * FROM contacts
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(document, ''), '.', ''), '-', ''), '/', ''), ' ', '') = ?
       ORDER BY id DESC
       LIMIT 1`,
      [document]
    ).catch(() => null);
    if (row?.id) {
      return row;
    }
  }

  if (email) {
    const row = await get(
      "SELECT * FROM contacts WHERE lower(COALESCE(email, '')) = ? ORDER BY id DESC LIMIT 1",
      [email]
    ).catch(() => null);
    if (row?.id) {
      return row;
    }
  }

  return null;
}

function buildOperationalCashbackDbPayload({ sale, cashbackEntry, contact, generatedAmount, user }) {
  const customer = sale.customer || {};
  const createdAt = normalizeText(sale.created_at || cashbackEntry.created_at || nowIso()) || nowIso();
  const generated = roundMoney(generatedAmount || cashbackEntry.amount || 0);
  return {
    contact_id: Number(contact?.id || 0),
    customer_name: normalizeText(contact?.name || customer.name || cashbackEntry.customer_name || "Cliente"),
    customer_phone: normalizePhone(contact?.phone || customer.phone || cashbackEntry.customer_phone || ""),
    store: normalizeStoreKey(sale.loja || ""),
    seller_id: Number(user?.seller_id || 0) || null,
    seller_name: normalizeText(sale.vendedor || user?.name || user?.email || ""),
    purchase_value: roundMoney(sale.total_final || sale.paid_amount || sale.net_amount || 0),
    percentage: CASHBACK_RATE * 100,
    generated_value: generated,
    available_balance: generated,
    used_value: 0,
    lost_value: 0,
    minimum_purchase: roundMoney(generated / CASHBACK_REDEMPTION_LIMIT_RATE),
    status: "disponivel",
    origin: "pdv_sale",
    valid_from: cashbackEntry.valid_from || cashbackEntry.available_at || createdAt,
    expires_at: cashbackEntry.expires_at || getCashbackExpiresAt(cashbackEntry.valid_from || createdAt),
    created_at: createdAt,
    updated_at: createdAt,
    created_by: user?.name || user?.email || "sistema",
    sale_id: sale.sale_id,
    source_type: "pdv_sale",
    source_reference: sale.sale_id
  };
}

async function upsertCustomerCashbackLedgerForSale({ sale, cashbackRow, cashbackEntry, contact, payload }) {
  const existing = await get(
    `SELECT id FROM customer_cashback_ledger
     WHERE external_event_id = ?
       AND origin = 'pdv_sale'
     LIMIT 1`,
    [sale.sale_id]
  ).catch(() => null);
  if (existing?.id) {
    return existing;
  }
  const createdAt = normalizeText(payload.created_at || nowIso()) || nowIso();
  const result = await run(
    `INSERT INTO customer_cashback_ledger
      (customer_id, contact_id, source_system, source_import_id, source_file, source_row_number,
       external_event_id, external_customer_key, customer_name_snapshot, customer_phone_snapshot,
       customer_document_snapshot, customer_email_snapshot, ledger_type, status, origin, store, seller,
       purchase_date, purchase_amount, amount, balance_amount, used_amount, valid_from, valid_until,
       match_method, match_confidence, import_ready, notes, raw_json, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')`,
    [
      payload.contact_id,
      payload.contact_id,
      "pdv_sale",
      sale.sale_id,
      sale.sale_id,
      Number(cashbackRow?.id || 0),
      sale.sale_id,
      String(payload.contact_id || ""),
      payload.customer_name,
      payload.customer_phone,
      normalizeDigits(contact?.document || sale.customer?.document || ""),
      normalizeText(contact?.email || sale.customer?.email || ""),
      "earned",
      "available",
      "pdv_sale",
      payload.store,
      payload.seller_name,
      sale.data_hora || payload.created_at,
      payload.purchase_value,
      payload.generated_value,
      payload.available_balance,
      0,
      payload.valid_from,
      payload.expires_at,
      contact?.id ? "contact_id" : "sale_customer",
      contact?.id ? "high" : "low",
      1,
      `Cashback PDV gerado pela venda ${sale.sale_id}.`,
      JSON.stringify({
        sale_id: sale.sale_id,
        cashback_id: cashbackRow?.id || "",
        json_cashback_id: cashbackEntry?.cashback_id || "",
        source: "pdv_sale"
      }),
      createdAt,
      createdAt
    ]
  );
  return { id: result.lastID };
}

async function persistOperationalCashbackForSale({ sale, cashbackEntry, generatedAmount, user }) {
  const contact = await resolveOperationalCashbackContact(sale.customer || {});
  if (!contact?.id) {
    return {
      persisted: false,
      reason: "contact_not_found",
      contact: null,
      cashback: null
    };
  }

  const existing = await get(
    `SELECT * FROM cashbacks
     WHERE sale_id = ?
       AND contact_id = ?
       AND origin = 'pdv_sale'
     LIMIT 1`,
    [sale.sale_id, contact.id]
  ).catch(() => null);
  const payload = buildOperationalCashbackDbPayload({ sale, cashbackEntry, contact, generatedAmount, user });
  let cashbackRow = existing;
  if (!cashbackRow?.id) {
    const result = await run(
      `INSERT INTO cashbacks
        (contact_id, customer_name, customer_phone, store, seller_id, seller_name, seller,
         purchase_value, percentage, generated_value, available_balance, used_value, lost_value,
         minimum_purchase, status, origin, valid_from, expires_at, created_at, updated_at, created_by,
         sale_id, source_type, source_reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.contact_id,
        payload.customer_name,
        payload.customer_phone,
        payload.store,
        payload.seller_id,
        payload.seller_name,
        payload.seller_name,
        payload.purchase_value,
        payload.percentage,
        payload.generated_value,
        payload.available_balance,
        payload.used_value,
        payload.lost_value,
        payload.minimum_purchase,
        payload.status,
        payload.origin,
        payload.valid_from,
        payload.expires_at,
        payload.created_at,
        payload.updated_at,
        payload.created_by,
        payload.sale_id,
        payload.source_type,
        payload.source_reference
      ]
    );
    cashbackRow = await get("SELECT * FROM cashbacks WHERE id = ?", [result.lastID]);
  }

  const ledgerRow = await upsertCustomerCashbackLedgerForSale({
    sale,
    cashbackRow,
    cashbackEntry,
    contact,
    payload
  });

  return {
    persisted: true,
    deduped: Boolean(existing?.id),
    contact,
    cashback: cashbackRow,
    ledger: ledgerRow
  };
}

async function notifyCashbackEarnedForSale(cashbackRow = {}) {
  try {
    if (!cashbackRow?.id) {
      return { success: false, status: "skipped_missing_cashback" };
    }
    return await getNotificationService().sendCashbackNotification(cashbackRow, {
      dryRun: getNotificationDryRunDefault()
    });
  } catch (error) {
    try {
      await getNotificationService().createLog({
        templateName: process.env.WHATSAPP_TEMPLATE_CASHBACK || "cashback_notificacao",
        cashbackId: cashbackRow?.id || "",
        customerId: cashbackRow?.contact_id || "",
        reminderType: "CREDITED",
        eventType: "cashback_earned",
        status: "failed",
        dryRun: getNotificationDryRunDefault(),
        errorCode: "notification_exception",
        errorMessage: error.message || "Falha ao registrar notificacao de cashback."
      });
    } catch (_) {
      // A venda e o cashback nao podem depender da disponibilidade da notificacao.
    }
    return { success: false, status: "failed", errorCode: "notification_exception" };
  }
}

function consumeCashbackEntries(customerPhone, amount, saleId, user) {
  let remaining = roundMoney(amount);
  if (remaining <= 0) return [];
  const ledger = loadCashbackLedger();
  const consumed = [];
  const now = nowIso();
  ledger.forEach((entry) => {
    if (remaining <= 0) return;
    if (normalizePhone(entry.customer_phone || "") !== normalizePhone(customerPhone || "")) return;
    if (entry.status !== "AVAILABLE") return;
    const availableAmount = roundMoney(entry.remaining_amount ?? entry.amount);
    if (availableAmount <= 0) return;
    const useAmount = Math.min(availableAmount, remaining);
    entry.remaining_amount = roundMoney(availableAmount - useAmount);
    entry.used_amount = roundMoney((entry.used_amount || 0) + useAmount);
    entry.status = entry.remaining_amount <= 0 ? "USED" : "AVAILABLE";
    entry.last_used_at = now;
    consumed.push({
      cashback_id: entry.cashback_id,
      amount: useAmount
    });
    remaining = roundMoney(remaining - useAmount);
  });
  if (consumed.length) {
    saveCashbackLedger(ledger);
    consumed.forEach((item) => {
      appendEvent("CASHBACK_USED", { sale_id: saleId }, item, user);
    });
  }
  return consumed;
}

function getCustomerCashbackBalance(phone = "") {
  return getCustomerCashbackSnapshot(phone).available;
}

function applyCashbackToSession(sessionId, payload = {}, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("SessÃ£o operacional do PDV nÃ£o encontrada.");
  }
  if (session.completed_sale_id || session.status === "COMPLETED") {
    throw new Error("NÃ£o Ã© possÃ­vel aplicar cashback em uma venda jÃ¡ finalizada.");
  }
  if (!(session.cart_items || []).length) {
    throw new Error("Adicione itens ao carrinho antes de aplicar cashback.");
  }
  if (!session.customer?.phone) {
    throw new Error("Selecione um cliente antes de aplicar cashback.");
  }
  const amount = roundMoney(payload.amount || payload.cashback_amount || 0);
  if (amount <= 0) {
    throw new Error("Informe um valor de cashback vÃ¡lido para aplicar.");
  }
  const previewSession = {
    ...session,
    cashback_application: null
  };
  const previewTotals = computeSaleTotals(previewSession, {});
  if (previewTotals.blockedForRedemption) {
    throw new Error("Perfumes podem gerar cashback, mas nÃ£o aceitam resgate de cashback nesta venda.");
  }
  if (previewTotals.permutaAmount > 0) {
    throw new Error("Permuta nÃ£o aceita cashback.");
  }
  const snapshot = getCustomerCashbackSnapshot(session.customer.phone);
  if (snapshot.available <= 0) {
    throw new Error("O cliente nÃ£o possui cashback disponÃ­vel para uso.");
  }
  const saleCeiling = roundMoney(Math.max(0, previewTotals.subtotalAfterItemDiscount - previewTotals.extraDiscount - previewTotals.giftCardUsed - previewTotals.exchangeCredit - previewTotals.permutaAmount));
  if (saleCeiling <= 0) {
    throw new Error("NÃ£o hÃ¡ valor elegÃ­vel para abatimento com cashback nesta venda.");
  }
  if (amount > snapshot.available) {
    throw new Error(`O cashback aplicado nÃ£o pode ser maior que o saldo disponÃ­vel (${snapshot.available.toFixed(2)}).`);
  }
  if (amount > saleCeiling) {
    throw new Error(`O cashback aplicado nÃ£o pode ser maior que o total elegÃ­vel da venda (${saleCeiling.toFixed(2)}).`);
  }
  session.cashback_application = normalizeCashbackApplication({
    amount,
    customer_phone: session.customer.phone,
    customer_name: session.customer.name,
    customer_id: session.customer.master_customer_id,
    applied_at: nowIso(),
    applied_by: user?.name || user?.email || "sistema"
  });
  session.updated_at = nowIso();
  saveSession(session);
  appendEvent("CASHBACK_USED", { session_id: session.session_id, loja: session.loja }, {
    action: "PREPARED_FOR_SALE",
    cashback_amount: amount,
    customer_phone: session.customer.phone
  }, user);
  return {
    session,
    cashback: snapshot,
    applied: session.cashback_application
  };
}

function removeCashbackFromSession(sessionId, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("SessÃ£o operacional do PDV nÃ£o encontrada.");
  }
  if (session.completed_sale_id || session.status === "COMPLETED") {
    throw new Error("NÃ£o Ã© possÃ­vel remover cashback de uma venda jÃ¡ finalizada.");
  }
  session.cashback_application = null;
  session.updated_at = nowIso();
  saveSession(session);
  appendEvent("CASHBACK_USED", { session_id: session.session_id, loja: session.loja }, {
    action: "REMOVED_FROM_SALE",
    customer_phone: session.customer?.phone || ""
  }, user);
  return session;
}

function issueGiftCard(payload = {}, user = {}) {
  const amount = roundMoney(payload.amount || payload.valor || 0);
  if (amount <= 0) {
    throw new Error("O vale presente precisa ter valor maior que zero.");
  }
  const giftCards = loadGiftCards();
  const giftCard = {
    gift_card_id: buildId("GFT"),
    code: `AERO-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    status: "ISSUED",
    issued_amount: amount,
    remaining_amount: amount,
    issued_to: normalizeText(payload.issued_to || payload.destinatario || ""),
    buyer_name: normalizeText(payload.buyer_name || payload.comprador || ""),
    buyer_phone: normalizePhone(payload.buyer_phone || payload.telefone || ""),
    message: normalizeText(payload.message || ""),
    validade: normalizeText(payload.validade || ""),
    created_at: nowIso(),
    created_by: user?.name || user?.email || "sistema",
    usage_history: []
  };
  giftCards.unshift(giftCard);
  saveGiftCards(giftCards);
  appendEvent("GIFT_CARD_ISSUED", { gift_card_id: giftCard.gift_card_id }, giftCard, user);
  return giftCard;
}

function applyGiftCard(code, amount, saleId, user = {}) {
  const normalizedCode = normalizeText(code).toUpperCase();
  if (!normalizedCode || toNumber(amount) <= 0) return null;
  const giftCards = loadGiftCards();
  const giftCard = giftCards.find((item) => normalizeText(item.code).toUpperCase() === normalizedCode);
  if (!giftCard) {
    throw new Error("Vale presente nÃ£o encontrado.");
  }
  if (!["ISSUED", "USED"].includes(giftCard.status)) {
    throw new Error("Vale presente indisponÃ­vel para uso.");
  }
  const useAmount = Math.min(roundMoney(amount), roundMoney(giftCard.remaining_amount));
  if (useAmount <= 0) {
    throw new Error("Vale presente sem saldo disponÃ­vel.");
  }
  giftCard.remaining_amount = roundMoney(giftCard.remaining_amount - useAmount);
  giftCard.status = giftCard.remaining_amount <= 0 ? "USED" : "ISSUED";
  giftCard.usage_history.unshift({
    sale_id: saleId,
    amount: useAmount,
    used_at: nowIso(),
    used_by: user?.name || user?.email || "sistema"
  });
  saveGiftCards(giftCards);
  appendEvent("GIFT_CARD_USED", { sale_id: saleId, code: giftCard.code }, { amount: useAmount, gift_card_id: giftCard.gift_card_id }, user);
  return {
    gift_card_id: giftCard.gift_card_id,
    code: giftCard.code,
    amount: useAmount,
    remaining_amount: giftCard.remaining_amount
  };
}

function buildCouponPayload(sale) {
  const giftMode = Boolean(sale.gift_sale?.enabled);
  return {
    coupon_id: buildId("CPN"),
    sale_id: sale.sale_id,
    type: giftMode ? "gift" : "normal",
    show_prices: !giftMode,
    show_values: !giftMode,
    qr_code_value: sale.sale_id,
    exchange_policy: "Trocas conforme politica interna da AEROSTORE.",
    whatsapp_ready: Boolean(sale.coupon?.whatsapp_ready),
    printable: true,
    pdf_ready: true,
    created_at: nowIso(),
    lines: (sale.items || []).map((item) => ({
      name: item.nome,
      color: item.cor,
      size: item.tamanho,
      quantity: item.quantidade,
      unit_price: giftMode ? null : item.preco_referencia,
      item_discount: giftMode ? null : normalizeSaleCartItemDiscount(item),
      line_total: giftMode ? null : roundMoney(
        Math.max(0, (getSaleCartItemUnitPrice(item) * getSaleCartItemQuantity(item)) - (normalizeSaleCartItemDiscount(item)?.amount || 0))
      )
    })),
    summary: giftMode ? {
      message: sale.gift_sale?.message || "",
      gifted_to: sale.gift_sale?.gifted_to || ""
    } : {
      subtotal: sale.subtotal,
      extra_discount: sale.desconto_extra,
      cashback_used: sale.cashback_usado,
      gift_card_used: sale.vale_presente_usado,
      total_final: sale.total_final,
      cashback_generated: sale.cashback_generated?.amount || 0
    }
  };
}

function buildSalePaymentLinkCheckoutInput(sale = {}) {
  const items = (sale.items || []).map((item, index) => ({
    sku: normalizeText(item.sku || item.codigo || item.product_id || `ITEM-${index + 1}`),
    name: normalizeText(item.nome || item.sku || item.codigo || `Item ${index + 1}`),
    quantity: Math.max(1, Math.round(toNumber(item.quantidade || 1))),
    unitPrice: roundMoney(item.preco_referencia || item.preco_venda || 0)
  })).filter((item) => item.unitPrice > 0);
  const discountAmount = roundMoney(
    toNumber(sale.discount_amount || sale.desconto_extra || 0)
    + toNumber(sale.cashback_used_amount || sale.cashback_usado || 0)
    + toNumber(sale.vale_presente_usado || 0)
    + toNumber(sale.credito_troca_usado || 0)
    + toNumber(sale.permuta_usada || 0)
  );
  return {
    source: "pdv_sale",
    items,
    customer: {
      name: normalizeText(sale.customer?.name || "Cliente AEROSTORE"),
      email: normalizeText(sale.customer?.email || ""),
      phone: normalizePhone(sale.customer?.phone || sale.customer?.whatsapp || "")
    },
    discountAmount,
    additionalAmount: 0,
    shippingAmount: 0,
    paymentMethods: ["CREDIT_CARD", "PIX", "BOLETO"]
  };
}

function applyPaymentLinkSnapshotToSale(sale = {}, snapshot = {}, options = {}) {
  const nextLifecycleStatus = normalizePaymentLinkLifecycleStatus(
    options.status || snapshot.payment_link_status || snapshot.status || "",
    sale,
    snapshot
  );
  const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
  const nextProviderStatus = normalizeText(snapshot.payment_link_provider_status || snapshot.provider_status || sale.payment_link_provider_status || "");
  const paymentStatus = normalizeText(snapshot.payment_link_payment_status || "").toLowerCase()
    || normalizePagBankPaymentLinkStatus({
      ...snapshot,
      payment_link_status: nextLifecycleStatus,
      payment_link_provider_status: nextProviderStatus
    }, sale);
  const releaseDecision = getPaymentLinkReleaseDecision(paymentStatus);
  const paidAt = normalizeText(snapshot.payment_link_paid_at || getPagBankProviderPaidAt(snapshot, sale) || "");
  const shouldMarkChecked = Boolean(snapshot.raw || snapshot.provider_status || snapshot.payment_link_provider_status || snapshot.checkout_id || snapshot.payment_link_checkout_id);
  const hasProviderPaymentSignal = getPagBankProviderStatusCandidates(snapshot, {}).length > 0
    || Boolean(normalizeText(snapshot.payment_link_payment_status || ""));
  return {
    ...sale,
    payment_link_provider: normalizeText(snapshot.payment_link_provider || sale.payment_link_provider || "pagbank"),
    payment_link_url: normalizeText(snapshot.payment_link_url || snapshot.payment_url || sale.payment_link_url || ""),
    payment_link_checkout_id: normalizeText(snapshot.payment_link_checkout_id || snapshot.checkout_id || sale.payment_link_checkout_id || ""),
    payment_link_status: nextLifecycleStatus,
    payment_link_created_at: normalizeText(snapshot.payment_link_created_at || sale.payment_link_created_at || nowIso()),
    payment_link_sent_at: normalizeText(snapshot.payment_link_sent_at || sale.payment_link_sent_at || ""),
    payment_link_last_error: normalizeText(snapshot.payment_link_last_error || ""),
    payment_link_last_error_at: normalizeText(
      snapshot.payment_link_last_error
        ? (snapshot.payment_link_last_error_at || nowIso())
        : (sale.payment_link_last_error_at || "")
    ),
    payment_link_last_checked_at: normalizeText(
      snapshot.payment_link_last_checked_at
      || (shouldMarkChecked ? nowIso() : sale.payment_link_last_checked_at || "")
    ),
    payment_link_paid_at: paymentStatus === "paid"
      ? (paidAt || normalizeText(sale.payment_link_paid_at || nowIso()))
      : normalizeText(hasProviderPaymentSignal ? (snapshot.payment_link_paid_at || "") : (snapshot.payment_link_paid_at || sale.payment_link_paid_at || "")),
    payment_link_payment_status: paymentStatus,
    payment_link_provider_status: nextProviderStatus,
    payment_link_release_status: normalizeText(snapshot.payment_link_release_status || releaseDecision.status),
    payment_link_can_release_goods: releaseDecision.can_release_goods,
    payment_link_reference_id: normalizeText(snapshot.payment_link_reference_id || snapshot.reference_id || sale.payment_link_reference_id || ""),
    payment_link_warnings: warnings.length ? warnings : (Array.isArray(sale.payment_link_warnings) ? sale.payment_link_warnings : []),
    payment_link_requires_manual_review: Boolean(
      snapshot.payment_link_requires_manual_review
      || snapshot.requiresManualReview
      || sale.payment_link_requires_manual_review
    )
  };
}

async function ensureSalePaymentLink(sale = {}, user = {}, options = {}) {
  if (!saleUsesPaymentLink(sale)) {
    return normalizeSalePaymentLinkState(sale);
  }

  const forceRefresh = Boolean(options.forceRefresh);
  const forceGenerate = Boolean(options.forceGenerate);
  const existingUrl = getSalePaymentLinkUrl(sale);
  const existingCheckoutId = getSalePaymentLinkCheckoutId(sale);

  if (existingUrl && !forceRefresh && !forceGenerate) {
    return normalizeSalePaymentLinkState(sale);
  }

  try {
    if (existingCheckoutId && !forceGenerate) {
      const checkout = await getPagBankCheckout(existingCheckoutId);
      const refreshedSale = applyPaymentLinkSnapshotToSale(sale, {
        payment_link_provider: "pagbank",
        payment_link_url: checkout.payment_url,
        payment_link_checkout_id: checkout.checkout_id,
        payment_link_status: sale.payment_link_sent_at ? "sent" : "generated",
        payment_link_payment_status: normalizePagBankPaymentLinkStatus({ raw: checkout.raw, provider_status: checkout.raw?.status || checkout.raw?.payment_status || "" }, sale),
        payment_link_provider_status: normalizeText(checkout.raw?.status || checkout.raw?.payment_status || ""),
        payment_link_reference_id: checkout.reference_id,
        payment_link_last_checked_at: nowIso(),
        payment_link_paid_at: getPagBankProviderPaidAt({ raw: checkout.raw }, sale),
        raw: checkout.raw
      });
      return updateSaleRecord(sale.sale_id, () => refreshedSale) || normalizeSalePaymentLinkState(refreshedSale);
    }

    const checkout = await createPagBankCheckout(buildSalePaymentLinkCheckoutInput(sale));
    const linkedSale = applyPaymentLinkSnapshotToSale(sale, {
      payment_link_provider: "pagbank",
      payment_link_url: checkout.payment_url,
      payment_link_checkout_id: checkout.checkout_id,
      payment_link_status: sale.payment_link_sent_at ? "sent" : "generated",
      payment_link_payment_status: "awaiting_payment",
      payment_link_provider_status: normalizeText(checkout.raw?.status || checkout.raw?.payment_status || ""),
      payment_link_reference_id: checkout.reference_id,
      payment_link_requires_manual_review: Boolean(checkout.requiresManualReview),
      payment_link_last_checked_at: nowIso(),
      payment_link_paid_at: getPagBankProviderPaidAt({ raw: checkout.raw }, sale),
      warnings: checkout.warnings || [],
      raw: checkout.raw
    });
    return updateSaleRecord(sale.sale_id, () => linkedSale) || normalizeSalePaymentLinkState(linkedSale);
  } catch (error) {
    const friendlyError = error instanceof PagBankError
      ? error.message
      : "Nao foi possivel gerar o link de pagamento agora.";
    const failedSale = applyPaymentLinkSnapshotToSale(sale, {
      payment_link_provider: "pagbank",
      payment_link_status: existingUrl ? getSalePaymentLinkStatus(sale) : "pending_generation",
      payment_link_url: existingUrl || "",
      payment_link_checkout_id: existingCheckoutId || "",
      payment_link_payment_status: normalizeText(sale.payment_link_payment_status || "") || normalizePagBankPaymentLinkStatus({}, sale),
      payment_link_last_error: friendlyError,
      payment_link_last_error_at: nowIso(),
      payment_link_provider_status: normalizeText(error?.details?.providerStatus || "")
    });
    return updateSaleRecord(sale.sale_id, () => failedSale) || normalizeSalePaymentLinkState(failedSale);
  }
}

function createCommissionEntry(sale) {
  return {
    commission_id: buildId("COM"),
    sale_id: sale.sale_id,
    seller: normalizeText(sale.vendedor || ""),
    gross_amount: roundMoney(sale.subtotal || 0),
    extra_discount: roundMoney(sale.desconto_extra || 0),
    cashback_used: roundMoney(sale.cashback_usado || 0),
    commission_base: roundMoney(sale.subtotal || 0),
    commission_rate: 0,
    calculated_at: nowIso()
  };
}

function restoreGiftCardUsage(sale) {
  if (!sale?.gift_card_usage?.gift_card_id || !toNumber(sale?.gift_card_usage?.amount)) {
    return null;
  }
  const giftCards = loadGiftCards();
  const giftCard = giftCards.find((item) => item.gift_card_id === sale.gift_card_usage.gift_card_id);
  if (!giftCard) {
    return null;
  }
  giftCard.remaining_amount = roundMoney(toNumber(giftCard.remaining_amount) + toNumber(sale.gift_card_usage.amount));
  giftCard.status = "ISSUED";
  giftCard.usage_history = (giftCard.usage_history || []).filter((item) => item.sale_id !== sale.sale_id);
  saveGiftCards(giftCards);
  return giftCard;
}

function restoreConsumedCashback(sale, user = {}) {
  const consumed = sale?.cashback_consumed || [];
  if (!consumed.length) {
    return [];
  }
  const ledger = loadCashbackLedger();
  const restored = [];
  consumed.forEach((item) => {
    const entry = ledger.find((row) => row.cashback_id === item.cashback_id);
    if (!entry) {
      return;
    }
    entry.used_amount = roundMoney(Math.max(0, toNumber(entry.used_amount) - toNumber(item.amount)));
    entry.remaining_amount = roundMoney(toNumber(entry.remaining_amount ?? entry.amount) + toNumber(item.amount));
    entry.status = "AVAILABLE";
    entry.last_restored_at = nowIso();
    restored.push({
      cashback_id: entry.cashback_id,
      amount: roundMoney(item.amount)
    });
    appendEvent("CASHBACK_USED", { sale_id: sale.sale_id, action: "RESTORE_ON_CANCEL" }, { cashback_id: entry.cashback_id, amount: roundMoney(item.amount) }, user);
  });
  if (restored.length) {
    saveCashbackLedger(ledger);
  }
  return restored;
}

function summarizeFulfillmentMode(items = []) {
  const uniqueModes = Array.from(new Set((items || []).map((item) => normalizeText(item.fulfillment_mode || "")).filter(Boolean)));
  if (!uniqueModes.length) {
    return FULFILLMENT_MODES.NORMAL;
  }
  if (uniqueModes.length === 1) {
    return uniqueModes[0];
  }
  return uniqueModes.find((item) => item !== FULFILLMENT_MODES.NORMAL) || uniqueModes[0];
}

function summarizeFulfillmentStatus(items = []) {
  const uniqueStatuses = Array.from(new Set((items || []).map((item) => normalizeText(item.fulfillment_status || "")).filter(Boolean)));
  if (!uniqueStatuses.length) {
    return FULFILLMENT_STATUS.CONFIRMED;
  }
  if (uniqueStatuses.length === 1) {
    return uniqueStatuses[0];
  }
  return uniqueStatuses.find((item) => item !== FULFILLMENT_STATUS.CONFIRMED) || uniqueStatuses[0];
}

function deriveLegacyFulfillmentItem(item = {}, sale = {}) {
  const saleStore = normalizeStoreKey(sale.loja_venda || sale.loja || item.loja_venda || item.loja || item.selected_loja || item.store_id || "");
  const originStore = normalizeStoreKey(item.loja_origem_estoque || sale.loja_origem_estoque || item.selected_loja || item.store_id || saleStore);
  const deliveryStore = normalizeStoreKey(item.loja_entrega_retirada || sale.loja_entrega_retirada || saleStore);
  const quantity = getSaleCartItemQuantity(item);
  const unitPrice = getSaleCartItemUnitPrice(item);
  const grossTotal = roundMoney(unitPrice * quantity);
  const itemDiscount = normalizeSaleCartItemDiscount(item);
  const discountAmount = roundMoney(itemDiscount?.amount || 0);
  return {
    ...item,
    loja_venda: saleStore,
    loja_origem_estoque: originStore || saleStore,
    loja_entrega_retirada: deliveryStore || saleStore,
    stock_source_store_id: normalizeStoreKey(item.stock_source_store_id || originStore || saleStore),
    stock_source_store_name: normalizeText(item.stock_source_store_name || ""),
    fulfillment_type: normalizeText(item.fulfillment_type || ""),
    fulfillment_mode: normalizeText(item.fulfillment_mode || sale.fulfillment_mode || FULFILLMENT_MODES.NORMAL),
    fulfillment_status: normalizeText(item.fulfillment_status || sale.fulfillment_status || FULFILLMENT_STATUS.CONFIRMED),
    destination_store_id: normalizeStoreKey(item.destination_store_id || deliveryStore || saleStore),
    destination_store_name: normalizeText(item.destination_store_name || ""),
    requires_logistics_review: Boolean(item.requires_logistics_review),
    item_discount: itemDiscount,
    item_discount_amount: discountAmount,
    item_discount_percent: roundMoney(itemDiscount?.percent || 0),
    item_discount_reason: normalizeText(itemDiscount?.reason || ""),
    item_gross_total: grossTotal,
    item_net_total: roundMoney(Math.max(0, grossTotal - discountAmount))
  };
}

function normalizeLegacySaleFulfillment(sale = {}) {
  if (!sale || typeof sale !== "object") {
    return sale;
  }
  const lojaVenda = normalizeStoreKey(sale.loja_venda || sale.loja || "");
  const normalizedItems = (sale.items || sale.cart_items || []).map((item) => deriveLegacyFulfillmentItem(item, sale));
  const uniqueOrigins = Array.from(new Set(normalizedItems.map((item) => item.loja_origem_estoque).filter(Boolean)));
  return {
    ...sale,
    loja: normalizeStoreKey(sale.loja || lojaVenda || ""),
    loja_venda: lojaVenda,
    loja_origem_estoque: normalizeStoreKey(sale.loja_origem_estoque || (uniqueOrigins.length === 1 ? uniqueOrigins[0] : "")),
    loja_entrega_retirada: normalizeStoreKey(sale.loja_entrega_retirada || lojaVenda || ""),
    fulfillment_mode: normalizeText(sale.fulfillment_mode || summarizeFulfillmentMode(normalizedItems)),
    fulfillment_status: normalizeText(sale.fulfillment_status || summarizeFulfillmentStatus(normalizedItems)),
    items: normalizedItems
  };
}

function persistSessionFulfillmentPreview(session, fulfillments = [], saleStoreKey = "", deliveryStoreKey = "") {
  if (!session || !Array.isArray(session.cart_items)) {
    return session;
  }
  const fulfillmentMap = new Map(
    (fulfillments || []).map((item) => [normalizeText(item.item_id || item.product_id || item.sku || ""), item])
  );
  session.loja = normalizeStoreKey(saleStoreKey || session.loja || "");
  session.loja_venda = normalizeStoreKey(saleStoreKey || session.loja_venda || session.loja || "");
  session.loja_entrega_retirada = normalizeStoreKey(deliveryStoreKey || session.loja_entrega_retirada || session.loja_venda || session.loja || "");
  session.cart_items = session.cart_items.map((item) => {
    const key = normalizeText(item.item_id || item.product_id || item.sku || "");
    const fulfillment = fulfillmentMap.get(key);
    if (!fulfillment) {
      return deriveLegacyFulfillmentItem(item, session);
    }
    return {
      ...item,
      loja_venda: fulfillment.loja_venda,
      loja_origem_estoque: fulfillment.loja_origem_estoque,
      loja_entrega_retirada: fulfillment.loja_entrega_retirada,
      fulfillment_mode: fulfillment.fulfillment_mode,
      fulfillment_status: fulfillment.fulfillment_status,
      fulfillment_message: fulfillment.message || ""
    };
  });
  session.fulfillment_preview = {
    loja_venda: session.loja_venda,
    loja_entrega_retirada: session.loja_entrega_retirada,
    generated_at: nowIso(),
    items: session.cart_items.map((item) => ({
      item_id: item.item_id,
      nome: item.nome,
      loja_venda: item.loja_venda,
      loja_origem_estoque: item.loja_origem_estoque,
      loja_entrega_retirada: item.loja_entrega_retirada,
      fulfillment_mode: item.fulfillment_mode,
      fulfillment_status: item.fulfillment_status,
      fulfillment_message: item.fulfillment_message || ""
    }))
  };
  session.updated_at = nowIso();
  saveSession(session);
  return session;
}

async function finalizeSaleFromSession(sessionId, payload = {}, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("SessÃ£o operacional do PDV nÃ£o encontrada.");
  }
  if (session.completed_sale_id || session.status === "COMPLETED") {
    return getSaleById(session.completed_sale_id || "") || {
      sale_id: session.completed_sale_id || "",
      status: "COMPLETED"
    };
  }
  if (!(session.cart_items || []).length) {
    throw new Error("Adicione itens no carrinho antes de finalizar a venda.");
  }
  const saleId = buildId("SAL");
  const totals = computeSaleTotals(session, payload);
  const exchangeCreditApplication = totals.exchangeCredit > 0
    ? validateExchangeCreditForSession(session, {
      credit_id: getSessionExchangeCreditApplication(session)?.credit_id,
      amount: totals.exchangeCredit
    })
    : null;
  if (totals.cashbackUsed > 0) {
    validateCashbackRedemption(session, payload);
  }
  if (totals.cashbackUsed > totals.totalAfterDiscount + 0.01) {
    throw new Error("O cashback aplicado nao pode ser maior que o total liquido da venda.");
  }
  const saleStoreKey = normalizeStoreKey(payload.loja || session.loja || "");
  const deliveryStoreKey = normalizeStoreKey(payload.loja_entrega_retirada || payload.delivery_store || session.loja_entrega_retirada || saleStoreKey);
  const cashRegister = getOpenCashRegisterByStore(saleStoreKey);
  if (!cashRegister) {
    const error = new Error("Caixa fechado. Abra o caixa da loja antes de finalizar vendas.");
    error.statusCode = 409;
    error.code = "CASH_REGISTER_REQUIRED";
    error.store_id = saleStoreKey;
    throw error;
  }
  const controlValidation = validateSaleControls({
    saleContext: {
      saleId,
      saleSessionId: session.session_id,
      subtotal: totals.subtotal,
      extraDiscount: totals.extraDiscount,
      itemDiscountAmount: totals.itemDiscountAmount,
      discountBase: roundMoney(Math.max(0, totals.subtotalAfterItemDiscount - totals.cashbackUsed - totals.exchangeCredit)),
      cashbackUsed: totals.cashbackUsed,
      exchangeCredit: totals.exchangeCredit,
      totalFinal: totals.totalFinal,
      paidAmount: totals.paidAmount,
      items: session.cart_items,
      customerId: session.customer?.id || session.customer_id || "",
      permutaAmount: totals.permutaAmount,
      loja: saleStoreKey,
      paymentMethods: totals.paymentMethods
    },
    authorization: {
      discountAuthorizationId: payload.discount_authorization_id,
      permutaPin: payload.permuta_pin,
      permutaReason: payload.permuta_reason
    }
  }, user);
  if (totals.blockedForRedemption && totals.cashbackUsed > 0) {
    throw new Error("Perfumes podem gerar cashback, mas nÃ£o aceitam resgate de cashback nesta venda.");
  }
  if (totals.permutaAmount > 0 && totals.cashbackUsed > 0) {
    throw new Error("Permuta nÃ£o aceita cashback.");
  }
  if (totals.cashbackUsed > 0) {
    if (!session.customer?.phone) {
      throw new Error("Selecione um cliente antes de usar cashback na venda.");
    }
    const liveCashback = getCustomerCashbackSnapshot(session.customer.phone);
    if (totals.cashbackUsed > liveCashback.available) {
      throw new Error("O saldo de cashback disponÃƒÂ­vel mudou. Revise o valor aplicado antes de finalizar.");
    }
  }
  if (totals.giftCardUsed > 0 && !normalizeText(payload.gift_card_code || "")) {
    throw new Error("Informe o cÃ³digo do vale presente para usar saldo na venda.");
  }
  if (totals.paidAmount < totals.totalFinal) {
    throw new Error("O total pago precisa cobrir o valor final da venda.");
  }
  if (totals.paidAmount > totals.totalFinal + 0.01) {
    throw new Error("O total pago excede o valor final da venda. Revise os pagamentos lancados antes de finalizar.");
  }
  const reservations = readJson(reservationsFilePath, []);
  const matchedReservation = reservations.find((item) => item.session_snapshot?.session_id === session.session_id && item.inventory_status === "HELD");
  const fulfillmentPlan = resolveSaleFulfillmentPlan(session.cart_items || [], saleStoreKey, {
    deliveryStoreId: deliveryStoreKey
  });
  persistSessionFulfillmentPreview(session, fulfillmentPlan.fulfillments, saleStoreKey, deliveryStoreKey);
  if (!matchedReservation && !fulfillmentPlan.can_finalize) {
    const fulfillmentItems = fulfillmentPlan.blocked || [];
    const noStockItems = fulfillmentItems.filter((item) => item.fulfillment_mode === FULFILLMENT_MODES.NO_STOCK);
    const sulAuditItems = fulfillmentItems.filter((item) => item.fulfillment_mode === FULFILLMENT_MODES.SUL_AUDIT_PENDING);
    const strategyRequiredItems = fulfillmentItems.filter((item) => item.fulfillment_mode === FULFILLMENT_MODES.STRATEGY_REQUIRED || !normalizeText(item.loja_origem_estoque || ""));
    const transferAnalysisItems = fulfillmentItems.filter((item) => item.fulfillment_mode === FULFILLMENT_MODES.TRANSFER_ANALYSIS || item.fulfillment_mode === FULFILLMENT_MODES.LOGISTICS_REVIEW);
    const crossStoreItems = fulfillmentItems.filter((item) => item.fulfillment_mode === FULFILLMENT_MODES.INTERNAL_TRANSFER || item.fulfillment_mode === FULFILLMENT_MODES.DIRECT_ORIGIN);
    if (noStockItems.length) {
      const labels = Array.from(new Set(noStockItems.map((item) => normalizeText(item.nome || item.sku || item.product_id || "Produto")).filter(Boolean)));
      if (labels.length === 1) {
        throw new Error(`Produto sem saldo disponÃ­vel em nenhuma loja cadastrada no sistema: ${labels[0]}.`);
      }
      throw new Error(`Produtos sem saldo disponÃ­vel em nenhuma loja cadastrada no sistema: ${labels.join(", ")}.`);
    }
    if (strategyRequiredItems.length) {
      const labels = Array.from(new Set(strategyRequiredItems.map((item) => normalizeText(item.nome || item.sku || item.product_id || "Produto")).filter(Boolean)));
      throw new Error(`Origem do item nao definida. Escolha transferencia ou entrega direta para concluir: ${labels.join(", ")}.`);
    }
    if (sulAuditItems.length) {
      throw new Error("O estoque fÃ­sico da loja Sul ainda estÃ¡ em implantaÃ§Ã£o no sistema. Confirme o saldo antes de concluir vendas que dependam do estoque da Sul.");
    }
    if (transferAnalysisItems.length) {
      const originLabels = Array.from(new Set(transferAnalysisItems.map((item) => formatStoreLabel(item.loja_origem_estoque || "")).filter(Boolean)));
      const originSuffix = originLabels.length ? ` Origem sugerida: ${originLabels.join(", ")}.` : "";
      throw new Error(`Item requer analise logistica antes da conclusao da venda.${originSuffix}`);
    }
    if (crossStoreItems.length) {
      const originLabels = Array.from(new Set(crossStoreItems.map((item) => formatStoreLabel(item.loja_origem_estoque || "")).filter(Boolean)));
      const originSuffix = originLabels.length ? ` Origem sugerida: ${originLabels.join(", ")}.` : "";
      throw new Error(`Produto disponÃ­vel em outra loja. SerÃ¡ necessÃ¡rio definir entrega direta ou transferÃªncia antes de concluir a venda.${originSuffix}`);
    }
  }
  const stockValidation = validateStockAvailability(session.cart_items || [], saleStoreKey);
  if (!matchedReservation && !stockValidation.ok) {
    const saleStore = formatStoreLabel(saleStoreKey || "");
    const missingProducts = Array.from(new Set(
      stockValidation.errors
        .map((item) => normalizeText(item.nome || item.sku || item.product_id || "Produto"))
        .filter(Boolean)
    ));
    const reason = stockValidation.errors
      .map((item) => normalizeText(item.reason || ""))
      .find(Boolean);
    if (missingProducts.length) {
      const intro = missingProducts.length === 1
        ? `NÃ£o foi possÃ­vel finalizar: o produto '${missingProducts[0]}' nÃ£o possui estoque disponÃ­vel na loja ${saleStore || "selecionada"}.`
        : `Produtos sem estoque na loja ${saleStore || "selecionada"}: ${missingProducts.join(", ")}.`;
      throw new Error(reason ? `${intro} ${reason}` : intro);
    }
    throw new Error("NÃ£o foi possÃ­vel finalizar por inconsistÃªncia de estoque operacional na loja selecionada.");
  }

  const giftCardCode = normalizeText(payload.gift_card_code || "");
  let giftCardUsage = null;
  if (giftCardCode && totals.giftCardUsed > 0) {
    giftCardUsage = applyGiftCard(giftCardCode, totals.giftCardUsed, saleId, user);
  }

  const saleItems = (session.cart_items || []).map((item) => deriveLegacyFulfillmentItem(item, {
    loja_venda: saleStoreKey,
    loja_origem_estoque: item.loja_origem_estoque || saleStoreKey,
    loja_entrega_retirada: deliveryStoreKey,
    fulfillment_mode: item.fulfillment_mode || FULFILLMENT_MODES.NORMAL,
    fulfillment_status: item.fulfillment_status || FULFILLMENT_STATUS.CONFIRMED
  }));
  const uniqueOrigins = Array.from(new Set(saleItems.map((item) => item.loja_origem_estoque).filter(Boolean)));

  let sale = {
    sale_id: saleId,
    session_id: session.session_id,
    status: payload.exchange_mode ? "EXCHANGE" : "COMPLETED",
    customer: session.customer,
    vendedor: normalizeText(payload.vendedor || session.seller || ""),
    loja: saleStoreKey,
    loja_venda: saleStoreKey,
    loja_origem_estoque: normalizeStoreKey(uniqueOrigins.length === 1 ? uniqueOrigins[0] : ""),
    loja_entrega_retirada: deliveryStoreKey || saleStoreKey,
    fulfillment_mode: summarizeFulfillmentMode(saleItems),
    fulfillment_status: summarizeFulfillmentStatus(saleItems),
    items: saleItems,
    subtotal: totals.subtotal,
    gross_amount: totals.subtotal,
    item_discount_amount: totals.itemDiscountAmount,
    subtotal_after_item_discount: totals.subtotalAfterItemDiscount,
    general_discount_amount: totals.extraDiscount,
    desconto_extra: totals.totalDiscountAmount,
    discount_amount: totals.totalDiscountAmount,
    discount_percent: controlValidation.discount_percent,
    discount_policy: controlValidation.discount_policy || null,
    discount_authorization_id: normalizeText(payload.discount_authorization_id || ""),
    cashback_usado: totals.cashbackUsed,
    cashback_used_amount: totals.cashbackUsed,
    vale_presente_usado: totals.giftCardUsed,
    credito_troca_usado: totals.exchangeCredit,
    exchange_credit_application: session.exchange_credit_application || null,
    permuta_usada: totals.permutaAmount,
    total_final: totals.totalFinal,
    net_amount: totals.totalFinal,
    paid_amount: totals.paidAmount,
    pagamentos: totals.paymentMethods,
    observacoes: normalizeText(payload.observacoes || session.cart_notes || ""),
    data_hora: nowIso(),
    gift_sale: {
      enabled: Boolean(payload.gift_mode),
      gifted_to: normalizeText(payload.gifted_to || ""),
      gifted_phone: normalizePhone(payload.gifted_phone || ""),
      message: normalizeText(payload.gift_message || ""),
      send_mode: normalizeText(payload.gift_send_mode || "manual"),
      send_status: normalizeText(payload.gift_send_status || "pending"),
      scheduled_for: normalizeText(payload.gift_scheduled_for || "")
    },
    coupon: {
      mode: session.coupon_prep?.mode || "normal",
      whatsapp_ready: Boolean(session.coupon_prep?.whatsapp_ready),
      qr_ready: Boolean(session.coupon_prep?.qr_ready)
    },
    created_by: user?.name || user?.email || "sistema",
    created_at: nowIso(),
    cashback_application: totals.cashbackApplication,
    cashback_generated: null,
    gift_card_usage: giftCardUsage,
    blocked_cashback_redemption: totals.blockedForRedemption,
    exchange_origin_sale_id: normalizeText(payload.exchange_origin_sale_id || ""),
    exchange_mode: Boolean(payload.exchange_mode),
    cash_register_id: cashRegister.cash_register_id,
    cash_register_store: cashRegister.loja,
    control_validation: controlValidation
  };

  const generatedCashbackAmount = roundMoney(totals.incrementalBase * CASHBACK_RATE);
  const canGenerateCashback = totals.permutaAmount <= 0 && generatedCashbackAmount > 0;
  if (canGenerateCashback) {
    sale.cashback_generated = createCashbackEntry({
      sale,
      customer: session.customer,
      generatedAmount: generatedCashbackAmount,
      user
    });
    try {
      const persistence = await persistOperationalCashbackForSale({
        sale,
        cashbackEntry: sale.cashback_generated,
        generatedAmount: generatedCashbackAmount,
        user
      });
      sale.cashback_generated.persistence_status = persistence.persisted ? "persisted" : "skipped";
      sale.cashback_generated.db_cashback_id = persistence.cashback?.id || null;
      sale.cashback_generated.db_ledger_id = persistence.ledger?.id || null;
      sale.cashback_generated.contact_id = persistence.contact?.id || null;
      sale.cashback_generated.deduped = Boolean(persistence.deduped);
      if (persistence.persisted && persistence.cashback?.id) {
        sale.cashback_notification = await notifyCashbackEarnedForSale(persistence.cashback);
      } else {
        sale.cashback_notification = {
          success: false,
          status: "skipped_missing_contact",
          reason: persistence.reason || "contact_not_found"
        };
        await getNotificationService().createLog({
          templateName: process.env.WHATSAPP_TEMPLATE_CASHBACK || "cashback_notificacao",
          cashbackId: sale.cashback_generated.cashback_id,
          customerId: "",
          reminderType: "CREDITED",
          eventType: "cashback_earned",
          status: "failed",
          dryRun: getNotificationDryRunDefault(),
          errorCode: "contact_not_found",
          errorMessage: "Cliente da venda sem contact_id operacional para gravar cashback em cashbacks."
        }).catch(() => null);
      }
    } catch (error) {
      sale.cashback_generated.persistence_status = "failed";
      sale.cashback_generated.persistence_error = String(error.message || "Falha ao persistir cashback operacional.").slice(0, 180);
      removeCashbackEntryFromJsonLedger(sale.cashback_generated.cashback_id);
      throw error;
    }
    appendEvent("CASHBACK_GRANTED", { sale_id: sale.sale_id, loja: sale.loja }, sale.cashback_generated, user);
  }

  if (session.customer?.phone && totals.cashbackUsed > 0) {
    sale.cashback_consumed = consumeCashbackEntries(session.customer.phone, totals.cashbackUsed, sale.sale_id, user);
  } else {
    sale.cashback_consumed = [];
  }

  if (exchangeCreditApplication) {
    const consumption = consumeExchangeCreditForSale({
      creditId: exchangeCreditApplication.creditId,
      amount: exchangeCreditApplication.amount,
      saleId: sale.sale_id,
      customer: session.customer,
      user
    });
    sale.exchange_credit_usage = {
      credit_id: consumption.credit.credit_id,
      customer_id: consumption.credit.customer_id,
      amount: exchangeCreditApplication.amount,
      balance_before: consumption.movement.before,
      balance_after: consumption.movement.after,
      movement_id: consumption.movement.movement_id
    };
    sale.exchange_credit_application = {
      ...(sale.exchange_credit_application || {}),
      ...sale.exchange_credit_usage
    };
  } else {
    sale.exchange_credit_usage = null;
  }

  const sales = loadSales();
  sales.unshift(sale);
  saveSales(sales);

  const commission = createCommissionEntry(sale);
  const commissions = loadCommissions();
  commissions.unshift(commission);
  saveCommissions(commissions);
  sale.commission = commission;

  const coupon = buildCouponPayload(sale);
  const coupons = loadCoupons();
  coupons.unshift(coupon);
  saveCoupons(coupons);
  sale.coupon_payload = coupon;

  if (sale.gift_sale?.enabled) {
    sale.gift_experience = registerGiftExperienceFromSale(sale, user);
    saveSales(sales);
  }

  appendSalesLog({
    log_id: buildId("LOG"),
    sale_id: sale.sale_id,
    action: "SALE_COMPLETED",
    created_at: nowIso(),
    created_by: user?.name || user?.email || "sistema",
    before: {
      session_id: session.session_id,
      status: session.status
    },
    after: sale
  });

  appendEvent("SALE_COMPLETED", { sale_id: sale.sale_id, loja: sale.loja }, {
    total_final: sale.total_final,
    customer: sale.customer,
    pagamentos: sale.pagamentos
  }, user);

  const physicalConfirmedItems = (sale.items || []).filter((item) => Boolean(item.physical_confirmation_done));
  physicalConfirmedItems.forEach((item) => {
    const payloadSummary = {
      sale_id: sale.sale_id,
      item_id: item.item_id || "",
      product_id: item.product_id || item.selected_product_id || "",
      sku: item.sku || item.codigo || "",
      codigo: item.codigo || "",
      store_id: item.physical_confirmation_store_id || item.loja_venda || sale.loja,
      confirmed_at: item.physical_confirmation_at || "",
      reason: item.physical_confirmation_reason || "sale_item_confirmed_in_store"
    };
    appendEvent("SALE_ITEM_PHYSICAL_CONFIRMATION", { sale_id: sale.sale_id, loja: sale.loja }, payloadSummary, user);
    appendAuditLog({
      audit_id: buildId("AUD"),
      action: "PRODUCT_SOLD_AFTER_PHYSICAL_CONFIRMATION",
      created_at: nowIso(),
      actor: user?.name || user?.email || "sistema",
      actor_role: getPdvUserRole(user),
      loja: sale.loja,
      reason: "Item vendido apos conferencia fisica.",
      before: {
        item_id: item.item_id || "",
        stock_status: item.operational_stock_status || ""
      },
      after: payloadSummary
    });
  });

  if (matchedReservation) {
    sale.inventory_movements = convertReservationInventory(matchedReservation, sale, user).map((item) => item.movement_id);
    matchedReservation.inventory_status = "CONVERTED";
    matchedReservation.converted_at = nowIso();
    matchedReservation.converted_sale_id = sale.sale_id;
    writeJson(reservationsFilePath, reservations);
  } else {
    sale.inventory_movements = applySaleInventory(sale, user).map((item) => item.movement_id);
  }
  saveSales(sales);

  registerCashMovement({
    cashRegisterId: cashRegister.cash_register_id,
    type: "SALE",
    value: sale.total_final,
    reason: "Venda operacional concluÃ­da",
    observation: sale.observacoes,
    payload: {
      sale_id: sale.sale_id,
      subtotal: sale.subtotal,
      desconto_extra: sale.desconto_extra,
      money_amount: sale.pagamentos.filter((item) => item.method === "dinheiro").reduce((sum, item) => sum + toNumber(item.amount), 0),
      pix_amount: sale.pagamentos.filter((item) => item.method === "pix").reduce((sum, item) => sum + toNumber(item.amount), 0),
      debito_amount: sale.pagamentos.filter((item) => item.method === "debito").reduce((sum, item) => sum + toNumber(item.amount), 0),
      credito_amount: sale.pagamentos.filter((item) => item.method === "credito" || item.method === "credito_ate_10x").reduce((sum, item) => sum + toNumber(item.amount), 0),
      link_pagamento_amount: sale.pagamentos.filter((item) => item.method === "link_pagamento").reduce((sum, item) => sum + toNumber(item.amount), 0),
      cashback_amount: sale.cashback_usado,
      vale_presente_amount: sale.vale_presente_usado,
      credito_troca_amount: sale.credito_troca_usado,
      permuta_amount: sale.permuta_usada
    }
  }, user);

  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "SALE_COMPLETED",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: sale.loja,
    reason: sale.observacoes,
    before: { session_id: session.session_id, status: session.status },
    after: {
      sale_id: sale.sale_id,
      status: sale.status,
      total_final: sale.total_final,
      cash_register_id: sale.cash_register_id,
      control_validation: sale.control_validation
    }
  });

  completeSession(session.session_id, { saleId: sale.sale_id });

  if (saleUsesPaymentLink(sale)) {
    sale = await ensureSalePaymentLink(sale, user);
  }

  return sale;
}

function cancelSale(saleId, user = {}, options = {}) {
  const sales = loadSales();
  const sale = sales.find((item) => item.sale_id === String(saleId || "").trim());
  if (sale) {
    Object.assign(sale, normalizeLegacySaleFulfillment(sale));
  }
  if (!sale) {
    throw new Error("Venda do PDV nÃ£o encontrada.");
  }
  if (sale.status === "CANCELLED") {
    return sale;
  }
  sale.status = "CANCELLED";
  sale.fulfillment_status = FULFILLMENT_STATUS.CANCELLED;
  sale.cancelled_at = nowIso();
  sale.cancelled_by = user?.name || user?.email || "sistema";
  sale.cancel_reason = normalizeText(options.reason || "");
  sale.cancel_authorization = options.authorization || null;
  if (sale.cashback_generated?.cashback_id) {
    const ledger = loadCashbackLedger();
    const entry = ledger.find((item) => item.cashback_id === sale.cashback_generated.cashback_id);
    if (entry) {
      entry.status = "CANCELLED";
      entry.cancelled_at = nowIso();
    }
    saveCashbackLedger(ledger);
  }
  sale.restored_cashback = restoreConsumedCashback(sale, user);
  sale.restored_gift_card = restoreGiftCardUsage(sale);
  sale.inventory_return_movements = restoreSaleInventory(sale, user).map((item) => item.movement_id);
  saveSales(sales);
  appendSalesLog({
    log_id: buildId("LOG"),
    sale_id: sale.sale_id,
    action: "SALE_CANCELLED",
    created_at: nowIso(),
    created_by: user?.name || user?.email || "sistema",
    before: { status: "COMPLETED" },
    after: {
      status: "CANCELLED",
      reason: sale.cancel_reason,
      restored_cashback: sale.restored_cashback,
      restored_gift_card: sale.restored_gift_card ? {
        gift_card_id: sale.restored_gift_card.gift_card_id,
        remaining_amount: sale.restored_gift_card.remaining_amount
      } : null
    }
  });
  appendEvent("SALE_CANCELLED", { sale_id: sale.sale_id, loja: sale.loja }, { status: sale.status }, user);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "SALE_CANCELLED",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: sale.loja,
    reason: sale.cancel_reason || "Cancelamento da venda do PDV",
    before: { status: "COMPLETED" },
    after: {
      status: "CANCELLED",
      sale_id: sale.sale_id,
      authorization: sale.cancel_authorization,
      restored_cashback: sale.restored_cashback,
      restored_gift_card: sale.restored_gift_card ? {
        gift_card_id: sale.restored_gift_card.gift_card_id,
        remaining_amount: sale.restored_gift_card.remaining_amount
      } : null
    }
  });
  return sale;
}

function createExchange(payload = {}, user = {}) {
  const originSale = normalizeText(payload.origin_sale_id || "") ? getSaleById(payload.origin_sale_id) : null;
  const exchange = {
    exchange_id: buildId("EXC"),
    origin_sale_id: normalizeText(payload.origin_sale_id || ""),
    customer: payload.customer || null,
    type: normalizeText(payload.type || (toNumber(payload.incremental_value) > 0 ? "incremental" : "simple")),
    incremental_value: roundMoney(payload.incremental_value || 0),
    credit_value: roundMoney(payload.credit_value || 0),
    cashback_generated_amount: roundMoney(Math.max(0, toNumber(payload.incremental_value || 0)) * CASHBACK_RATE),
    created_at: nowIso(),
    created_by: user?.name || user?.email || "sistema",
    notes: normalizeText(payload.notes || "")
  };
  exchange.origin_store = normalizeStoreKey(payload.loja || originSale?.loja || "");
  exchange.inventory_in_movements = originSale ? applyExchangeInboundFromSale(originSale, exchange, user).map((item) => item.movement_id) : [];
  const exchanges = loadExchanges();
  exchanges.unshift(exchange);
  saveExchanges(exchanges);
  appendEvent("EXCHANGE_CREATED", { exchange_id: exchange.exchange_id }, exchange, user);
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "EXCHANGE_CREATED",
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: "",
    reason: exchange.notes,
    before: null,
    after: exchange
  });
  return exchange;
}

function getSalesSummary() {
  const sales = loadSales().map((item) => normalizeLegacySaleFulfillment(item));
  const refreshResult = refreshCashbackLedgerLifecycle(loadCashbackLedger());
  const cashback = refreshResult.ledger;
  if (refreshResult.dirty) {
    saveCashbackLedger(cashback);
  }
  const giftCards = loadGiftCards();
  const commissions = loadCommissions();
  const exchanges = loadExchanges();
  return {
    metrics: {
      total_sales: sales.length,
      completed_sales: sales.filter((item) => item.status === "COMPLETED" || item.status === "EXCHANGE").length,
      cancelled_sales: sales.filter((item) => item.status === "CANCELLED").length,
      gross_revenue: roundMoney(sales.filter((item) => item.status !== "CANCELLED").reduce((sum, item) => sum + toNumber(item.total_final), 0)),
      cashback_pending: roundMoney(cashback.filter((item) => item.status === "PENDING").reduce((sum, item) => sum + toNumber(item.amount), 0)),
      cashback_available: roundMoney(cashback.filter((item) => item.status === "AVAILABLE").reduce((sum, item) => sum + toNumber(item.remaining_amount ?? item.amount), 0)),
      gift_cards_open: giftCards.filter((item) => item.remaining_amount > 0).length,
      exchanges: exchanges.length,
      commissions: commissions.length
    },
    sales: sales.slice(0, 120),
    cashback: cashback.slice(0, 120),
    giftCards: giftCards.slice(0, 120),
    commissions: commissions.slice(0, 120),
    exchanges: exchanges.slice(0, 120),
    coupons: loadCoupons().slice(0, 120),
    events: loadEvents().slice(0, 120)
  };
}

function buildSalePaymentLinkPayload(sale = null) {
  const normalizedSale = normalizeSalePaymentLinkState(normalizeLegacySaleFulfillment(sale || {}));
  if (!normalizedSale?.sale_id) {
    return null;
  }
  return {
    sale_id: normalizedSale.sale_id,
    uses_payment_link: saleUsesPaymentLink(normalizedSale),
    provider: normalizeText(normalizedSale.payment_link_provider || ""),
    url: normalizeText(normalizedSale.payment_link_url || ""),
    checkout_id: normalizeText(normalizedSale.payment_link_checkout_id || ""),
    status: normalizeText(normalizedSale.payment_link_status || ""),
    payment_status: normalizeText(normalizedSale.payment_link_payment_status || ""),
    created_at: normalizeText(normalizedSale.payment_link_created_at || ""),
    sent_at: normalizeText(normalizedSale.payment_link_sent_at || ""),
    paid_at: normalizeText(normalizedSale.payment_link_paid_at || ""),
    last_checked_at: normalizeText(normalizedSale.payment_link_last_checked_at || ""),
    last_error: normalizeText(normalizedSale.payment_link_last_error || ""),
    provider_status: normalizeText(normalizedSale.payment_link_provider_status || ""),
    release_status: normalizeText(normalizedSale.payment_link_release_status || ""),
    release_decision: getPaymentLinkReleaseDecision(normalizedSale.payment_link_payment_status || ""),
    reference_id: normalizeText(normalizedSale.payment_link_reference_id || ""),
    warnings: Array.isArray(normalizedSale.payment_link_warnings) ? normalizedSale.payment_link_warnings : [],
    requires_manual_review: Boolean(normalizedSale.payment_link_requires_manual_review)
  };
}

function getPendingPaymentLinkStoreScope(user = {}) {
  const role = String(getPdvUserRole(user) || "").toUpperCase();
  if (role === "ADMIN" || Boolean(user?.permissions?.can_view_all_stores)) {
    return null;
  }
  const allowedStores = Array.isArray(user?.allowed_stores)
    ? user.allowed_stores.map((item) => normalizeStoreKey(item || "")).filter(Boolean)
    : [];
  const ownedStore = normalizeStoreKey(user?.store_id || user?.store || user?.loja || "");
  return uniqueTextList([
    ...allowedStores,
    ownedStore
  ].filter(Boolean));
}

function getSaleAccessStoreId(sale = {}) {
  return normalizeStoreKey(
    sale?.loja
    || sale?.loja_venda
    || sale?.store_id
    || ""
  );
}

function canAccessSale(sale = {}, user = {}) {
  const scopedStores = getPendingPaymentLinkStoreScope(user);
  if (scopedStores === null) {
    return true;
  }
  if (!scopedStores.length) {
    return false;
  }
  const saleStore = getSaleAccessStoreId(sale);
  if (!saleStore) {
    return false;
  }
  return scopedStores.some((storeId) => storesMatch(storeId, saleStore));
}

function createSaleAccessError() {
  const error = new Error("Você não tem permissão para acessar esta venda.");
  error.statusCode = 403;
  return error;
}

function canViewPendingPaymentLinkSale(sale = {}, user = {}) {
  return canAccessSale(sale, user);
}

function isPendingPaymentLinkSale(sale = {}) {
  const normalizedSale = normalizeSalePaymentLinkState(normalizeLegacySaleFulfillment(sale || {}));
  if (!normalizedSale?.sale_id) {
    return false;
  }
  if (!saleUsesPaymentLink(normalizedSale)) {
    return false;
  }
  if (String(normalizedSale.status || "").toUpperCase() === "CANCELLED") {
    return false;
  }
  const lifecycleStatus = normalizeText(normalizedSale.payment_link_status || "").toLowerCase();
  const paymentStatus = normalizeText(normalizedSale.payment_link_payment_status || "").toLowerCase();
  if (Boolean(normalizedSale.payment_link_can_release_goods) || paymentStatus === "paid") {
    return false;
  }
  if (["awaiting_payment", "unknown", "pending_generation"].includes(paymentStatus)) {
    return true;
  }
  return ["pending_generation", "generated", "sent"].includes(lifecycleStatus);
}

function buildPendingPaymentLinkSaleRow(sale = {}) {
  const normalizedSale = normalizeSalePaymentLinkState(normalizeLegacySaleFulfillment(sale || {}));
  if (!normalizedSale?.sale_id) {
    return null;
  }
  const storeContext = getStorePublicContext(
    normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || "",
    {
      store_id: normalizeStoreKey(normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || ""),
      display_name: formatStoreLabel(normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || "")
    }
  );
  return {
    sale_id: normalizedSale.sale_id,
    customer_name: normalizeText(normalizedSale.customer?.name || normalizedSale.customer_name || "Venda balcão"),
    customer_phone: normalizePhone(
      normalizedSale.customer?.phone
      || normalizedSale.customer?.whatsapp
      || normalizedSale.customer_phone
      || ""
    ),
    store_id: storeContext.store_id || normalizeStoreKey(normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || ""),
    store_label: storeContext.display_name || formatStoreLabel(normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || ""),
    store_context: storeContext,
    seller_name: normalizeText(normalizedSale.vendedor || normalizedSale.seller_name || normalizedSale.operator_name || ""),
    total: roundMoney(normalizedSale.total_final || normalizedSale.total || 0),
    created_at: normalizeText(normalizedSale.created_at || normalizedSale.criado_em || normalizedSale.updated_at || ""),
    payment_link_status: normalizeText(normalizedSale.payment_link_status || ""),
    payment_link_payment_status: normalizeText(normalizedSale.payment_link_payment_status || ""),
    payment_link_provider_status: normalizeText(normalizedSale.payment_link_provider_status || ""),
    payment_link_release_status: normalizeText(normalizedSale.payment_link_release_status || ""),
    can_release_goods: Boolean(normalizedSale.payment_link_can_release_goods),
    payment_link_url: normalizeText(normalizedSale.payment_link_url || ""),
    payment_link_checkout_id: normalizeText(normalizedSale.payment_link_checkout_id || ""),
    payment_link_sent_at: normalizeText(normalizedSale.payment_link_sent_at || ""),
    payment_link_last_checked_at: normalizeText(normalizedSale.payment_link_last_checked_at || ""),
    payment_link_last_error: normalizeText(normalizedSale.payment_link_last_error || "")
  };
}

function listPendingPaymentLinkSales(user = {}) {
  const rows = loadSales()
    .map((item) => normalizeSalePaymentLinkState(normalizeLegacySaleFulfillment(item)))
    .filter((sale) => isPendingPaymentLinkSale(sale) && canViewPendingPaymentLinkSale(sale, user))
    .sort((left, right) => {
      const leftDate = new Date(left?.created_at || left?.updated_at || 0).getTime();
      const rightDate = new Date(right?.created_at || right?.updated_at || 0).getTime();
      return rightDate - leftDate;
    })
    .map((sale) => buildPendingPaymentLinkSaleRow(sale))
    .filter(Boolean);
  return {
    items: rows,
    total: rows.length
  };
}

function getSalePrimaryPaymentMethods(sale = {}) {
  return (sale?.pagamentos || sale?.payment_plan?.methods || [])
    .map((item) => ({
      method: normalizeText(item?.method || item?.type || "").toLowerCase(),
      label: normalizeText(item?.label || item?.name || item?.method || item?.type || ""),
      amount: roundMoney(item?.amount || item?.value || 0)
    }))
    .filter((item) => item.method || item.amount > 0);
}

function getSaleCashbackGeneratedAmount(sale = {}) {
  return roundMoney(
    sale?.cashback_generated?.amount
    ?? sale?.cashback_generated_amount
    ?? sale?.coupon_payload?.summary?.cashback_generated
    ?? 0
  );
}

function getSaleDiscountAmount(sale = {}) {
  return roundMoney(
    sale?.discount_amount
    ?? sale?.desconto_extra
    ?? sale?.discount_total
    ?? sale?.coupon_payload?.summary?.extra_discount
    ?? 0
  );
}

function getSaleCashbackUsedAmount(sale = {}) {
  return roundMoney(
    sale?.cashback_used_amount
    ?? sale?.cashback_usado
    ?? sale?.coupon_payload?.summary?.cashback_used
    ?? 0
  );
}

function getSaleOperationalStatus(sale = {}) {
  const status = normalizeText(sale?.status || "").toUpperCase();
  if (status === "CANCELLED" || status === "CANCELED") {
    return "cancelled";
  }
  if (saleUsesPaymentLink(sale) || getSalePaymentLinkUrl(sale) || getSalePaymentLinkCheckoutId(sale)) {
    const paymentStatus = normalizeText(sale?.payment_link_payment_status || "").toLowerCase()
      || normalizePagBankPaymentLinkStatus({
        payment_link_status: sale?.payment_link_status || "",
        payment_link_provider_status: sale?.payment_link_provider_status || "",
        payment_link_url: getSalePaymentLinkUrl(sale),
        payment_link_checkout_id: getSalePaymentLinkCheckoutId(sale)
      }, sale);
    if (paymentStatus === "paid" || Boolean(sale?.payment_link_can_release_goods)) {
      return "payment_confirmed";
    }
    return "awaiting_payment";
  }
  if (status === "COMPLETED" || status === "EXCHANGE") {
    return "completed";
  }
  return status ? status.toLowerCase() : "completed";
}

function buildPdvSalesOrderRow(sale = {}) {
  const normalizedSale = normalizeSalePaymentLinkState(normalizeLegacySaleFulfillment(sale || {}));
  if (!normalizedSale?.sale_id) {
    return null;
  }
  const storeContext = getStorePublicContext(
    normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || "",
    {
      store_id: normalizeStoreKey(normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || ""),
      display_name: formatStoreLabel(normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || "")
    }
  );
  const paymentLink = buildSalePaymentLinkPayload(normalizedSale);
  const paymentMethods = getSalePrimaryPaymentMethods(normalizedSale);
  const paymentStatus = normalizeText(normalizedSale.payment_link_payment_status || paymentLink?.payment_status || "").toLowerCase();
  const releaseDecision = paymentLink?.release_decision || getPaymentLinkReleaseDecision(paymentStatus || "");
  return {
    sale_id: normalizedSale.sale_id,
    status: normalizeText(normalizedSale.status || ""),
    operational_status: getSaleOperationalStatus(normalizedSale),
    created_at: normalizeText(normalizedSale.created_at || normalizedSale.data_hora || normalizedSale.updated_at || ""),
    customer_name: normalizeText(normalizedSale.customer?.name || normalizedSale.customer_name || "Venda balcão"),
    customer_phone: normalizePhone(normalizedSale.customer?.phone || normalizedSale.customer?.whatsapp || normalizedSale.customer_phone || ""),
    customer_document: normalizeText(normalizedSale.customer?.document || normalizedSale.customer_document || ""),
    store_id: storeContext.store_id || normalizeStoreKey(normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || ""),
    store_label: storeContext.display_name || normalizedSale.store_label || formatStoreLabel(normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || ""),
    store_context: storeContext,
    seller_name: normalizeText(normalizedSale.vendedor || normalizedSale.seller_name || normalizedSale.operator_name || normalizedSale.created_by || ""),
    subtotal: roundMoney(normalizedSale.subtotal || normalizedSale.gross_amount || 0),
    total: roundMoney(normalizedSale.total_final || normalizedSale.net_amount || normalizedSale.total || 0),
    paid_amount: roundMoney(normalizedSale.paid_amount || 0),
    discount_amount: getSaleDiscountAmount(normalizedSale),
    discount_percent: roundMoney(normalizedSale.discount_percent || 0),
    cashback_applied: getSaleCashbackUsedAmount(normalizedSale),
    cashback_generated: getSaleCashbackGeneratedAmount(normalizedSale),
    payment_methods: paymentMethods,
    payment_method_label: paymentMethods.map((item) => item.label || item.method).filter(Boolean).join(" + ") || "-",
    uses_payment_link: Boolean(paymentLink?.uses_payment_link),
    payment_link: paymentLink,
    payment_link_status: normalizeText(paymentLink?.status || ""),
    payment_link_payment_status: normalizeText(paymentLink?.payment_status || ""),
    payment_link_provider_status: normalizeText(paymentLink?.provider_status || ""),
    payment_link_release_status: normalizeText(paymentLink?.release_status || releaseDecision?.status || ""),
    can_release_goods: Boolean(normalizedSale.payment_link_can_release_goods || releaseDecision?.can_release_goods),
    payment_link_url: normalizeText(paymentLink?.url || ""),
    payment_link_checkout_id: normalizeText(paymentLink?.checkout_id || ""),
    coupon_available: Boolean(normalizedSale.coupon_payload?.coupon_id || normalizedSale.coupon?.mode),
    coupon_id: normalizeText(normalizedSale.coupon_payload?.coupon_id || ""),
    discount_authorization_id: normalizeText(normalizedSale.discount_authorization_id || normalizedSale.control_validation?.authorization_id || ""),
    has_authorization: Boolean(normalizedSale.discount_authorization_id || normalizedSale.control_validation?.authorization_id),
    has_discount: getSaleDiscountAmount(normalizedSale) > 0,
    has_cashback: getSaleCashbackUsedAmount(normalizedSale) > 0 || getSaleCashbackGeneratedAmount(normalizedSale) > 0
  };
}

function saleMatchesOrdersSearch(row = {}, sale = {}, search = "") {
  const normalizedSearch = normalizeText(search || "").toLowerCase();
  if (!normalizedSearch) {
    return true;
  }
  const digits = normalizeDigits(search || "");
  const haystack = [
    row.sale_id,
    row.customer_name,
    row.customer_phone,
    row.customer_document,
    row.seller_name,
    row.store_label,
    row.payment_method_label,
    ...(sale.items || []).flatMap((item) => [
      item?.sku,
      item?.codigo,
      item?.codigo_interno,
      item?.codigo_barras,
      item?.nome,
      item?.marca
    ])
  ].map((value) => normalizeText(value || "").toLowerCase()).join(" ");
  if (haystack.includes(normalizedSearch)) {
    return true;
  }
  return Boolean(digits && normalizeDigits(haystack).includes(digits));
}

function saleMatchesOrdersStatus(row = {}, status = "") {
  const normalizedStatus = normalizeText(status || "").toLowerCase();
  if (!normalizedStatus || normalizedStatus === "all" || normalizedStatus === "todos") {
    return true;
  }
  if (normalizedStatus === "link_payment") return row.uses_payment_link;
  if (normalizedStatus === "with_cashback") return row.has_cashback;
  if (normalizedStatus === "with_discount") return row.has_discount;
  if (normalizedStatus === "with_authorization") return row.has_authorization;
  if (normalizedStatus === "release_goods") return Boolean(row.can_release_goods);
  if (normalizedStatus === "do_not_release") return row.uses_payment_link && !row.can_release_goods;
  return row.operational_status === normalizedStatus || normalizeText(row.status || "").toLowerCase() === normalizedStatus;
}

function getPdvSalesOrderFilterDateRange(query = {}) {
  const preset = normalizeText(query.period || "").toLowerCase();
  const todayDate = new Date();
  const end = query.date_to ? new Date(`${query.date_to}T23:59:59.999`) : null;
  const start = query.date_from ? new Date(`${query.date_from}T00:00:00.000`) : null;
  if (start || end) {
    return { start, end };
  }
  if (preset === "today" || preset === "hoje") {
    return {
      start: new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate(), 0, 0, 0, 0),
      end: new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate(), 23, 59, 59, 999)
    };
  }
  if (preset === "7d" || preset === "7") {
    const startDate = new Date(todayDate);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);
    return { start: startDate, end: null };
  }
  if (preset === "30d" || preset === "30") {
    const startDate = new Date(todayDate);
    startDate.setDate(startDate.getDate() - 29);
    startDate.setHours(0, 0, 0, 0);
    return { start: startDate, end: null };
  }
  return { start: null, end: null };
}

function filterPdvSalesOrders(rows = [], query = {}) {
  const { start, end } = getPdvSalesOrderFilterDateRange(query);
  const storeId = normalizeText(query.store_id || "");
  const sellerId = normalizeText(query.seller_id || query.seller || "").toLowerCase();
  const paymentMethod = normalizeText(query.payment_method || "").toLowerCase();
  const paymentStatus = normalizeText(query.payment_status || "").toLowerCase();
  const search = normalizeText(query.search || query.q || "");
  const status = normalizeText(query.status || "");
  return rows.filter(({ row, sale }) => {
    if (!saleMatchesOrdersSearch(row, sale, search)) return false;
    if (!saleMatchesOrdersStatus(row, status)) return false;
    if (storeId && !storesMatch(row.store_id, storeId)) return false;
    if (sellerId && !normalizeText(row.seller_name || "").toLowerCase().includes(sellerId)) return false;
    if (paymentMethod && paymentMethod !== "all" && !row.payment_methods.some((item) => item.method === paymentMethod)) return false;
    if (paymentStatus && paymentStatus !== "all" && row.payment_link_payment_status !== paymentStatus && row.operational_status !== paymentStatus) return false;
    if (start || end) {
      const createdAt = new Date(row.created_at || 0);
      if (Number.isNaN(createdAt.getTime())) return false;
      if (start && createdAt < start) return false;
      if (end && createdAt > end) return false;
    }
    return true;
  });
}

function buildPdvSalesOrdersSummary(rows = []) {
  const totalOrders = rows.length;
  const totalSold = roundMoney(rows.filter((row) => row.operational_status !== "cancelled").reduce((sum, row) => sum + toNumber(row.total), 0));
  const awaitingRows = rows.filter((row) => row.operational_status === "awaiting_payment");
  const linkPendingRows = rows.filter((row) => row.uses_payment_link && !row.can_release_goods);
  const discountTotal = roundMoney(rows.reduce((sum, row) => sum + toNumber(row.discount_amount), 0));
  const subtotalTotal = roundMoney(rows.reduce((sum, row) => sum + toNumber(row.subtotal || row.total), 0));
  return {
    total_orders: totalOrders,
    total_sold: totalSold,
    average_ticket: totalOrders ? roundMoney(totalSold / totalOrders) : 0,
    awaiting_payment_count: awaitingRows.length,
    awaiting_payment_amount: roundMoney(awaitingRows.reduce((sum, row) => sum + toNumber(row.total), 0)),
    cashback_used: roundMoney(rows.reduce((sum, row) => sum + toNumber(row.cashback_applied), 0)),
    cashback_generated: roundMoney(rows.reduce((sum, row) => sum + toNumber(row.cashback_generated), 0)),
    discounts_total: discountTotal,
    discounts_average_percent: subtotalTotal > 0 ? roundMoney((discountTotal / subtotalTotal) * 100) : 0,
    payment_link_pending_count: linkPendingRows.length
  };
}

function buildPdvSalesOrdersTabs(rows = []) {
  return {
    all: rows.length,
    today: filterPdvSalesOrders(rows.map((row) => ({ row, sale: row.__sale || {} })), { period: "today" }).length,
    awaiting_payment: rows.filter((row) => row.operational_status === "awaiting_payment").length,
    payment_confirmed: rows.filter((row) => row.operational_status === "payment_confirmed" || row.can_release_goods).length,
    link_payment: rows.filter((row) => row.uses_payment_link).length,
    with_cashback: rows.filter((row) => row.has_cashback).length,
    with_discount: rows.filter((row) => row.has_discount).length,
    with_authorization: rows.filter((row) => row.has_authorization).length,
    cancelled: rows.filter((row) => row.operational_status === "cancelled").length
  };
}

function listPdvSalesOrders(query = {}, user = {}) {
  const pageSize = Math.min(100, Math.max(1, Number(query.page_size || query.pageSize || 25)));
  const page = Math.max(1, Number(query.page || 1));
  const scopedPairs = loadSales()
    .map((sale) => normalizeSalePaymentLinkState(normalizeLegacySaleFulfillment(sale)))
    .filter((sale) => canAccessSale(sale, user))
    .map((sale) => ({ sale, row: buildPdvSalesOrderRow(sale) }))
    .filter((item) => item.row);
  const filteredPairs = filterPdvSalesOrders(scopedPairs, query);
  const sortedPairs = filteredPairs.sort((left, right) => {
    const leftDate = new Date(left.row.created_at || 0).getTime();
    const rightDate = new Date(right.row.created_at || 0).getTime();
    return rightDate - leftDate;
  });
  const filteredRows = sortedPairs.map((item) => item.row);
  const total = filteredRows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const rows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const scopedRows = scopedPairs.map((item) => ({ ...item.row, __sale: item.sale }));
  return {
    rows,
    summary: buildPdvSalesOrdersSummary(filteredRows),
    tabs: buildPdvSalesOrdersTabs(scopedRows),
    pagination: {
      page: safePage,
      page_size: pageSize,
      total,
      page_count: pageCount
    },
    filters: {
      search: normalizeText(query.search || query.q || ""),
      status: normalizeText(query.status || "all"),
      period: normalizeText(query.period || ""),
      store_id: normalizeText(query.store_id || ""),
      seller_id: normalizeText(query.seller_id || query.seller || ""),
      payment_method: normalizeText(query.payment_method || ""),
      payment_status: normalizeText(query.payment_status || "")
    }
  };
}

function getPdvSalesOrderDetail(saleId = "", user = {}) {
  const sale = getSaleById(saleId);
  if (!sale) {
    return null;
  }
  if (!canAccessSale(sale, user)) {
    throw createSaleAccessError();
  }
  return {
    sale,
    row: buildPdvSalesOrderRow(sale),
    payment_link: buildSalePaymentLinkPayload(sale)
  };
}

async function bulkRefreshPdvSalesOrdersPaymentLinks(saleIds = [], user = {}) {
  const uniqueSaleIds = uniqueTextList((Array.isArray(saleIds) ? saleIds : []).map((value) => normalizeText(value || ""))).slice(0, 50);
  const updated = [];
  const skipped = [];
  const errors = [];
  for (const saleId of uniqueSaleIds) {
    const sale = getSaleById(saleId);
    if (!sale) {
      skipped.push({ sale_id: saleId, reason: "Venda nao encontrada." });
      continue;
    }
    if (!canAccessSale(sale, user)) {
      errors.push({ sale_id: saleId, error: "Sem permissao para acessar esta venda." });
      continue;
    }
    if (!saleUsesPaymentLink(sale) && !getSalePaymentLinkCheckoutId(sale) && !getSalePaymentLinkUrl(sale)) {
      skipped.push({ sale_id: saleId, reason: "Venda sem Link pagamento." });
      continue;
    }
    try {
      const refreshedSale = await refreshSalePaymentLinkStatus(saleId, user);
      updated.push({
        sale_id: saleId,
        row: buildPdvSalesOrderRow(refreshedSale),
        sale: refreshedSale,
        payment_link: buildSalePaymentLinkPayload(refreshedSale)
      });
    } catch (error) {
      errors.push({ sale_id: saleId, error: error.message || "Falha ao atualizar PagBank." });
    }
  }
  return {
    ok: errors.length === 0,
    updated,
    skipped,
    errors
  };
}

function getSaleById(saleId) {
  const sale = loadSales().find((item) => item.sale_id === String(saleId || "").trim()) || null;
  if (!sale) {
    return null;
  }
  const normalizedSale = normalizeSalePaymentLinkState(normalizeLegacySaleFulfillment(sale));
  const storeContext = getStorePublicContext(
    normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || "",
    {
      store_id: normalizeStoreKey(normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || ""),
      display_name: formatStoreLabel(normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || "")
    }
  );
  return {
    ...normalizedSale,
    store_context: storeContext,
    store_label: storeContext.display_name || normalizedSale.store_label || formatStoreLabel(normalizedSale.loja || normalizedSale.loja_venda || normalizedSale.store_id || "")
  };
}

async function generateSalePaymentLink(saleId, user = {}, options = {}) {
  const sale = getSaleById(saleId);
  if (!sale) {
    throw new Error("Venda do PDV nao encontrada para gerar o link de pagamento.");
  }
  if (!canAccessSale(sale, user)) {
    throw createSaleAccessError();
  }
  if (!saleUsesPaymentLink(sale)) {
    throw new Error("Esta venda nao foi fechada com o metodo Link pagamento.");
  }
  return ensureSalePaymentLink(sale, user, {
    forceGenerate: Boolean(options.forceGenerate),
    forceRefresh: Boolean(options.forceRefresh)
  });
}

async function refreshSalePaymentLinkStatus(saleId, user = {}) {
  const sale = getSaleById(saleId);
  if (!sale) {
    throw new Error("Venda do PDV nao encontrada para atualizar o link de pagamento.");
  }
  if (!canAccessSale(sale, user)) {
    throw createSaleAccessError();
  }
  if (!saleUsesPaymentLink(sale) && !getSalePaymentLinkCheckoutId(sale)) {
    throw new Error("Esta venda ainda nao possui checkout de Link pagamento para consultar.");
  }
  return ensureSalePaymentLink(sale, user, { forceRefresh: true });
}

function markSalePaymentLinkSent(saleId, metadata = {}) {
  return updateSaleRecord(saleId, (sale) => {
    const normalizedSale = normalizeSalePaymentLinkState(normalizeLegacySaleFulfillment(sale));
    if (!normalizedSale?.sale_id) {
      return sale;
    }
    return {
      ...normalizedSale,
      payment_link_status: normalizeText(normalizedSale.payment_link_status || "") === "paid" ? "paid" : "sent",
      payment_link_sent_at: normalizeText(metadata.sentAt || nowIso()),
      payment_link_last_error: ""
    };
  });
}

function findSaleByPaymentLinkIdentifiers({ saleId = "", checkoutId = "", referenceId = "" } = {}) {
  const normalizedSaleId = normalizeText(saleId || "");
  const normalizedCheckoutId = normalizeText(checkoutId || "");
  const normalizedReferenceId = normalizeText(referenceId || "");
  const sales = loadSales();
  return sales.find((sale) => {
    const normalizedSale = normalizeSalePaymentLinkState(normalizeLegacySaleFulfillment(sale || {}));
    if (normalizedSaleId && normalizeText(normalizedSale.sale_id || "") === normalizedSaleId) {
      return true;
    }
    if (normalizedCheckoutId && normalizeText(normalizedSale.payment_link_checkout_id || "") === normalizedCheckoutId) {
      return true;
    }
    if (normalizedReferenceId && normalizeText(normalizedSale.payment_link_reference_id || "") === normalizedReferenceId) {
      return true;
    }
    return false;
  }) || null;
}

function extractSaleIdFromPagBankReference(referenceId = "") {
  const match = String(referenceId || "").match(/SAL_[A-Za-z0-9]+/);
  return match ? normalizeText(match[0]) : "";
}

function applyPagBankWebhookToSale(payload = {}, options = {}) {
  const body = payload && typeof payload === "object" ? payload : {};
  const nested = body.data && typeof body.data === "object" ? body.data : {};
  const checkoutId = normalizeText(
    body.checkout_id
    || body.checkoutId
    || body.id
    || nested.checkout_id
    || nested.checkoutId
    || nested.id
    || body.resource?.id
    || ""
  );
  const referenceId = normalizeText(
    body.reference_id
    || body.referenceId
    || nested.reference_id
    || nested.referenceId
    || body.resource?.reference_id
    || ""
  );
  const saleId = normalizeText(
    body.sale_id
    || nested.sale_id
    || extractSaleIdFromPagBankReference(referenceId)
  );
  const sale = findSaleByPaymentLinkIdentifiers({ saleId, checkoutId, referenceId });
  if (!sale) {
    return {
      matched: false,
      checkout_id: checkoutId,
      reference_id: referenceId,
      payment_status: normalizePagBankPaymentLinkStatus(body, {})
    };
  }
  const updatedSale = updateSaleRecord(sale.sale_id, (currentSale) => applyPaymentLinkSnapshotToSale(currentSale, {
    payment_link_provider: "pagbank",
    payment_link_checkout_id: checkoutId || currentSale.payment_link_checkout_id || "",
    payment_link_reference_id: referenceId || currentSale.payment_link_reference_id || "",
    payment_link_provider_status: uniqueTextList(getPagBankProviderStatusCandidates(body, currentSale))[0] || currentSale.payment_link_provider_status || "",
    payment_link_payment_status: normalizePagBankPaymentLinkStatus(body, currentSale),
    payment_link_paid_at: getPagBankProviderPaidAt(body, currentSale),
    payment_link_last_checked_at: nowIso(),
    raw: body
  }, options)) || getSaleById(sale.sale_id);
  return {
    matched: true,
    sale: updatedSale,
    payment_link: buildSalePaymentLinkPayload(updatedSale)
  };
}

function getGiftCardByCode(code) {
  return loadGiftCards().find((item) => normalizeText(item.code).toUpperCase() === normalizeText(code).toUpperCase()) || null;
}

function applyCashbackToSession(sessionId, payload = {}, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("SessÃ£o operacional do PDV nÃ£o encontrada.");
  }
  if (session.completed_sale_id || session.status === "COMPLETED") {
    throw new Error("NÃ£o Ã© possÃ­vel aplicar cashback em uma venda jÃ¡ finalizada.");
  }
  if (!(session.cart_items || []).length) {
    throw new Error("Adicione itens ao carrinho antes de aplicar cashback.");
  }
  if (!session.customer?.phone) {
    throw new Error("Selecione um cliente antes de aplicar cashback.");
  }
  const amount = roundMoney(payload.amount || payload.cashback_amount || 0);
  if (amount <= 0) {
    throw new Error("Informe um valor de cashback vÃ¡lido para aplicar.");
  }
  const validation = validateCashbackRedemption({
    ...session,
    cashback_application: null
  }, { amount });
  session.cashback_application = normalizeCashbackApplication({
    amount: validation.requestedAmount,
    customer_phone: session.customer.phone,
    customer_name: session.customer.name,
    customer_id: session.customer.master_customer_id,
    applied_at: nowIso(),
    applied_by: user?.name || user?.email || "sistema"
  });
  session.updated_at = nowIso();
  saveSession(session);
  appendEvent("CASHBACK_USED", { session_id: session.session_id, loja: session.loja }, {
    action: "PREPARED_FOR_SALE",
    cashback_amount: validation.requestedAmount,
    customer_phone: session.customer.phone
  }, user);
  return {
    session,
    cashback: validation.snapshot,
    applied: session.cashback_application
  };
}

function getCustomerExchangeCreditSnapshot(payload = {}) {
  return listActiveExchangeCreditsForCustomer({
    customer_id: payload.customer_id || payload.customerId || payload.master_customer_id || payload.id || "",
    phone: payload.phone || payload.telefone || "",
    name: payload.name || payload.nome || ""
  });
}

function getSessionExchangeCreditApplication(session = {}) {
  const methods = buildNormalizedPaymentMethods(session.payment_plan?.methods || []);
  return methods.find((item) => item.method === "credito_troca" && roundMoney(item.amount) > 0) || null;
}

function validateExchangeCreditForSession(session = {}, payload = {}) {
  if (!session.customer) {
    throw new Error("Selecione um cliente antes de usar Credito de Troca.");
  }
  const amount = roundMoney(payload.amount || payload.credit_amount || 0);
  if (amount <= 0) {
    throw new Error("Informe um valor valido de Credito de Troca.");
  }
  const creditId = normalizeText(payload.credit_id || payload.exchange_credit_id || "");
  if (!creditId) {
    throw new Error("Selecione o Credito de Troca que sera usado.");
  }
  const credit = getExchangeCreditById(creditId);
  if (!credit) {
    throw new Error("Credito de Troca nao encontrado.");
  }
  if (normalizeText(credit.status || "").toLowerCase() !== "ativo") {
    throw new Error("Este Credito de Troca nao esta ativo.");
  }
  const sessionCustomerId = normalizeText(session.customer.master_customer_id || session.customer.customer_id || session.customer.id || "");
  const sessionPhone = normalizePhone(session.customer.phone || "");
  const creditCustomerId = normalizeText(credit.customer_id || "");
  const creditPhone = normalizePhone(credit.customer_phone || "");
  if (sessionCustomerId && creditCustomerId && sessionCustomerId !== creditCustomerId) {
    throw new Error("Este Credito de Troca pertence a outro cliente.");
  }
  if (sessionPhone && creditPhone && sessionPhone !== creditPhone) {
    throw new Error("Este Credito de Troca pertence a outro telefone.");
  }
  const available = roundMoney(credit.remaining_amount || 0);
  if (amount > available + 0.009) {
    throw new Error("O valor usado e maior que o saldo do Credito de Troca.");
  }
  const previewMethods = buildNormalizedPaymentMethods(session.payment_plan?.methods || [])
    .filter((item) => item.method !== "credito_troca");
  const previewSession = {
    ...session,
    payment_plan: {
      methods: [...previewMethods, {
        method: "credito_troca",
        amount,
        credit_id: creditId,
        customer_id: credit.customer_id
      }]
    }
  };
  const totals = computeSaleTotals(previewSession, {});
  const maxUsable = roundMoney(totals.subtotalAfterItemDiscount - totals.extraDiscount - totals.giftCardUsed - totals.permutaAmount);
  if (amount > maxUsable + 0.009) {
    throw new Error("O Credito de Troca nao pode ser maior que o total da venda.");
  }
  return { credit, amount, creditId, totals };
}

function applyExchangeCreditToSession(sessionId, payload = {}, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("Sessao operacional do PDV nao encontrada.");
  }
  if (session.completed_sale_id || session.status === "COMPLETED") {
    throw new Error("Nao e possivel aplicar Credito de Troca em uma venda ja finalizada.");
  }
  if (!(session.cart_items || []).length) {
    throw new Error("Adicione itens ao carrinho antes de aplicar Credito de Troca.");
  }
  const validation = validateExchangeCreditForSession(session, payload);
  const currentMethods = buildNormalizedPaymentMethods(session.payment_plan?.methods || [])
    .filter((item) => item.method !== "credito_troca");
  session.payment_plan = {
    methods: [...currentMethods, {
      method: "credito_troca",
      amount: validation.amount,
      installments: 1,
      installment_amount: validation.amount,
      credit_id: validation.creditId,
      customer_id: validation.credit.customer_id
    }]
  };
  session.exchange_credit_application = {
    credit_id: validation.creditId,
    customer_id: validation.credit.customer_id,
    amount: validation.amount,
    balance_before: roundMoney(validation.credit.remaining_amount || 0),
    balance_after_preview: roundMoney((validation.credit.remaining_amount || 0) - validation.amount),
    applied_at: nowIso(),
    applied_by: user?.name || user?.email || "sistema"
  };
  session.updated_at = nowIso();
  saveSession(session);
  return {
    session,
    credit: validation.credit,
    applied: session.exchange_credit_application,
    credits: getCustomerExchangeCreditSnapshot(session.customer || {})
  };
}

function removeExchangeCreditFromSession(sessionId, user = {}) {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error("Sessao operacional do PDV nao encontrada.");
  }
  if (session.completed_sale_id || session.status === "COMPLETED") {
    throw new Error("Nao e possivel remover Credito de Troca de uma venda ja finalizada.");
  }
  const currentMethods = buildNormalizedPaymentMethods(session.payment_plan?.methods || [])
    .filter((item) => item.method !== "credito_troca");
  session.payment_plan = { methods: currentMethods };
  session.exchange_credit_application = null;
  session.updated_at = nowIso();
  saveSession(session);
  return session;
}

module.exports = {
  CASHBACK_RATE,
  CASHBACK_VALIDITY_DAYS,
  getCustomerCashbackBalance,
  getCustomerCashbackSnapshot,
  getCustomerExchangeCreditSnapshot,
  applyCashbackToSession,
  removeCashbackFromSession,
  applyExchangeCreditToSession,
  removeExchangeCreditFromSession,
  getCashbackValidFrom,
  getCashbackExpiresAt,
  finalizeSaleFromSession,
  cancelSale,
  issueGiftCard,
  applyGiftCard,
  createExchange,
  getSalesSummary,
  listPendingPaymentLinkSales,
  listPdvSalesOrders,
  getPdvSalesOrderDetail,
  bulkRefreshPdvSalesOrdersPaymentLinks,
  getSaleById,
  canAccessSale,
  buildSalePaymentLinkPayload,
  normalizePagBankPaymentLinkStatus,
  getPaymentLinkReleaseDecision,
  generateSalePaymentLink,
  refreshSalePaymentLinkStatus,
  applyPagBankWebhookToSale,
  markSalePaymentLinkSent,
  getGiftCardByCode
};
