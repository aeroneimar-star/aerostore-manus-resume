"use strict";

const fs = require("fs");
const path = require("path");
const { appendEvent } = require("../services/pdvOperationalService");
const { appendAuditLog } = require("../services/pdvControlService");
const { getInventoryAlerts } = require("../inventory/pdvInventoryService");
const { normalizeStoreKey, formatStoreLabel } = require("../utils/pdvStoreUtils");

const dataRootDir = path.join(process.cwd(), "data");
const pdvRootDir = path.join(dataRootDir, "pdv");
const importsRootDir = path.join(dataRootDir, "imports", "pdv");

const reportFiles = {
  sales: path.join(pdvRootDir, "sales", "sales.json"),
  cashback: path.join(pdvRootDir, "sales", "cashback-ledger.json"),
  giftCards: path.join(pdvRootDir, "sales", "gift-cards.json"),
  commissions: path.join(pdvRootDir, "sales", "commissions.json"),
  exchanges: path.join(pdvRootDir, "sales", "exchanges.json"),
  coupons: path.join(pdvRootDir, "sales", "coupons.json"),
  salesLogs: path.join(pdvRootDir, "sales", "logs.json"),
  cashRegisters: path.join(pdvRootDir, "control", "cash-registers.json"),
  auditLogs: path.join(pdvRootDir, "control", "audit-logs.json"),
  authorizations: path.join(pdvRootDir, "control", "authorization-pins.json"),
  inventory: path.join(pdvRootDir, "inventory", "inventory.json"),
  inventoryMovements: path.join(pdvRootDir, "inventory", "movements.json"),
  transfers: path.join(pdvRootDir, "inventory", "transfers.json"),
  sessions: path.join(pdvRootDir, "operational", "sessions.json"),
  quotes: path.join(pdvRootDir, "operational", "quotes.json"),
  reservations: path.join(pdvRootDir, "operational", "reservations.json"),
  internalConsumption: path.join(pdvRootDir, "operational", "internal-consumption.json"),
  operationalEvents: path.join(pdvRootDir, "operational", "events.json"),
  messageQueue: path.join(pdvRootDir, "experience", "message-queue.json"),
  welcomeBonuses: path.join(pdvRootDir, "experience", "welcome-bonuses.json"),
  masterCustomers: path.join(importsRootDir, "consolidation", "master-customers.json"),
  consolidationSummary: path.join(importsRootDir, "consolidation", "summary.json")
};

const QUICK_PERIODS = {
  hoje: "today",
  ontem: "yesterday",
  ultimos_7_dias: "last7",
  ultimos_60_dias: "last60",
  mes_atual: "month",
  mes_anterior: "lastMonth",
  personalizado: "custom"
};

function readJson(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
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

function normalizeLookup(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(2));
}

function roundValue(value, digits = 2) {
  return Number(toNumber(value).toFixed(digits));
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function toArray(value, nestedKey = "items") {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && Array.isArray(value[nestedKey])) {
    return value[nestedKey];
  }
  if (value && Array.isArray(value.data)) {
    return value.data;
  }
  if (value && Array.isArray(value.alerts)) {
    return value.alerts;
  }
  return [];
}

function safeDate(value = "") {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatIsoDateOnly(date) {
  const parsed = safeDate(date);
  if (!parsed) return "";
  return parsed.toISOString().slice(0, 10);
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getDateRangeFromPreset(preset = "") {
  const now = new Date();
  const today = startOfDay(now);
  if (preset === "yesterday") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
  }
  if (preset === "last7") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start, end: endOfDay(now) };
  }
  if (preset === "last60") {
    const start = new Date(today);
    start.setDate(start.getDate() - 59);
    return { start, end: endOfDay(now) };
  }
  if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: startOfDay(start), end: endOfDay(now) };
  }
  if (preset === "lastMonth") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: startOfDay(start), end: endOfDay(end) };
  }
  return { start: today, end: endOfDay(now) };
}

function parseFilters(query = {}) {
  const preset = normalizeText(query.period || query.preset || "last60") || "last60";
  const quickPeriod = Object.values(QUICK_PERIODS).includes(preset) ? preset : "last60";
  let { start, end } = getDateRangeFromPreset(quickPeriod);

  if (quickPeriod === "custom") {
    const customStart = safeDate(query.startDate || query.dataInicial || "");
    const customEnd = safeDate(query.endDate || query.dataFinal || "");
    start = customStart ? startOfDay(customStart) : null;
    end = customEnd ? endOfDay(customEnd) : null;
  }

  return {
    period: quickPeriod,
    start,
    end,
    store: normalizeStoreKey(query.store || query.loja || ""),
    seller: normalizeText(query.seller || query.vendedor || ""),
    customer: normalizeText(query.customer || query.cliente || ""),
    paymentMethod: normalizeText(query.paymentMethod || query.forma_pagamento || ""),
    category: normalizeText(query.category || query.categoria || ""),
    brand: normalizeText(query.brand || query.marca || ""),
    product: normalizeText(query.product || query.produto || ""),
    status: normalizeText(query.status || ""),
    format: normalizeText(query.export || query.format || "").toLowerCase()
  };
}

function loadReportDatasets() {
  return {
    sales: readJson(reportFiles.sales, []),
    cashback: readJson(reportFiles.cashback, []),
    giftCards: readJson(reportFiles.giftCards, []),
    commissions: readJson(reportFiles.commissions, []),
    exchanges: readJson(reportFiles.exchanges, []),
    coupons: readJson(reportFiles.coupons, []),
    salesLogs: readJson(reportFiles.salesLogs, []),
    cashRegisters: readJson(reportFiles.cashRegisters, []),
    auditLogs: readJson(reportFiles.auditLogs, []),
    authorizations: readJson(reportFiles.authorizations, []),
    inventory: readJson(reportFiles.inventory, []),
    inventoryMovements: readJson(reportFiles.inventoryMovements, []),
    transfers: readJson(reportFiles.transfers, []),
    sessions: readJson(reportFiles.sessions, []),
    quotes: readJson(reportFiles.quotes, []),
    reservations: readJson(reportFiles.reservations, []),
    internalConsumption: readJson(reportFiles.internalConsumption, []),
    operationalEvents: readJson(reportFiles.operationalEvents, []),
    messageQueue: readJson(reportFiles.messageQueue, []),
    welcomeBonuses: readJson(reportFiles.welcomeBonuses, []),
    masterCustomers: readJson(reportFiles.masterCustomers, []),
    consolidationSummary: readJson(reportFiles.consolidationSummary, {})
  };
}

function inRange(dateValue, filters) {
  const parsed = safeDate(dateValue);
  if (!parsed) return !filters.start && !filters.end;
  if (filters.start && parsed < filters.start) return false;
  if (filters.end && parsed > filters.end) return false;
  return true;
}

function matchesLookup(value, query) {
  if (!query) return true;
  return normalizeLookup(value).includes(normalizeLookup(query));
}

function saleMatchesFilters(sale, filters) {
  const cartItems = sale.cart_items || sale.items || [];
  const paymentMethods = sale.payment_methods || [];
  return inRange(sale.created_at || sale.completed_at || sale.updated_at, filters)
    && (!filters.store || normalizeStoreKey(sale.loja) === filters.store)
    && (!filters.seller || matchesLookup(sale.vendedor || sale.seller, filters.seller))
    && (!filters.customer || matchesLookup(sale.customer?.name || sale.customer_name, filters.customer) || matchesLookup(sale.customer?.phone || "", filters.customer))
    && (!filters.status || normalizeText(sale.status) === filters.status)
    && (!filters.paymentMethod || paymentMethods.some((item) => normalizeText(item.method) === filters.paymentMethod))
    && (!filters.product || cartItems.some((item) => matchesLookup(item.nome || item.product_name, filters.product) || matchesLookup(item.sku || item.codigo, filters.product)))
    && (!filters.brand || cartItems.some((item) => matchesLookup(item.marca, filters.brand)))
    && (!filters.category || cartItems.some((item) => matchesLookup(item.categoria || item.tipo, filters.category)));
}

function reservationMatchesFilters(reservation, filters) {
  return inRange(reservation.created_at || reservation.updated_at, filters)
    && (!filters.store || normalizeStoreKey(reservation.loja) === filters.store)
    && (!filters.seller || matchesLookup(reservation.seller || reservation.vendedor, filters.seller))
    && (!filters.customer || matchesLookup(reservation.customer?.name || reservation.customer_name, filters.customer));
}

function quoteMatchesFilters(quote, filters) {
  return inRange(quote.created_at || quote.updated_at, filters)
    && (!filters.store || normalizeStoreKey(quote.loja) === filters.store)
    && (!filters.seller || matchesLookup(quote.seller || quote.vendedor, filters.seller))
    && (!filters.customer || matchesLookup(quote.customer?.name || quote.customer_name, filters.customer));
}

function internalConsumptionMatchesFilters(entry, filters) {
  return inRange(entry.created_at || entry.updated_at, filters)
    && (!filters.store || normalizeStoreKey(entry.loja) === filters.store)
    && (!filters.seller || matchesLookup(entry.responsavel, filters.seller))
    && (!filters.product || matchesLookup(entry.produto || entry.nome, filters.product))
    && (!filters.category || matchesLookup(entry.destino || entry.motivo, filters.category));
}

function inventoryMatchesFilters(item, filters) {
  return (!filters.store || normalizeStoreKey(item.store_id) === filters.store)
    && (!filters.product || matchesLookup(item.nome || item.product_id, filters.product) || matchesLookup(item.sku || item.codigo, filters.product))
    && (!filters.brand || matchesLookup(item.marca, filters.brand))
    && (!filters.category || matchesLookup(item.categoria, filters.category))
    && (!filters.status || normalizeText(item.status) === filters.status);
}

function movementMatchesFilters(movement, filters) {
  return inRange(movement.created_at, filters)
    && (!filters.store || normalizeStoreKey(movement.store_id || movement.loja) === filters.store)
    && (!filters.product || matchesLookup(movement.nome || movement.product_id, filters.product) || matchesLookup(movement.sku || movement.codigo, filters.product))
    && (!filters.status || normalizeText(movement.type) === filters.status);
}

function paymentMethodBreakdown(sales = []) {
  const base = {
    dinheiro: 0,
    pix: 0,
    debito: 0,
    credito_1x: 0,
    credito_2x: 0,
    credito_3x: 0,
    credito_4x: 0,
    credito_5x: 0,
    credito_6x: 0,
    credito_7x: 0,
    credito_8x: 0,
    credito_9x: 0,
    credito_10x: 0,
    link_pagamento: 0,
    cashback: 0,
    vale_presente: 0,
    credito_troca: 0,
    permuta: 0
  };
  sales.forEach((sale) => {
    (sale.pagamentos || sale.payment_methods || []).forEach((item) => {
      const method = normalizeText(item.method);
      const amount = roundMoney(item.amount || 0);
      if (!amount) return;
      if (method === "credito") {
        const installments = Math.max(1, Math.min(10, Math.round(toNumber(item.installments || 1))));
        base[`credito_${installments}x`] = roundMoney((base[`credito_${installments}x`] || 0) + amount);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(base, method)) {
        base[method] = roundMoney(base[method] + amount);
      }
    });
  });
  return base;
}

function getCreditCardTotal(paymentTotals = {}) {
  return roundMoney(
    Object.entries(paymentTotals)
      .filter(([key]) => /^credito_\dx$/i.test(key))
      .reduce((sum, [, value]) => sum + toNumber(value), 0)
  );
}

function saleItemsFromSales(sales = []) {
  return sales.flatMap((sale) => (sale.items || sale.cart_items || []).map((item) => ({
    sale_id: sale.sale_id,
    loja: sale.loja || "",
    vendedor: sale.vendedor || sale.seller || "",
    cliente: sale.customer?.name || "",
    customer_phone: sale.customer?.phone || "",
    product_id: normalizeText(item.product_id || item.sku || item.codigo || ""),
    sku: normalizeText(item.sku || item.codigo || ""),
    codigo: normalizeText(item.codigo || ""),
    nome: normalizeText(item.nome || ""),
    marca: normalizeText(item.marca || ""),
    categoria: normalizeText(item.categoria || item.tipo || ""),
    quantidade: Math.max(1, toNumber(item.quantidade || 1)),
    preco: roundMoney(item.preco_referencia || 0),
    total: roundMoney(toNumber(item.preco_referencia || 0) * Math.max(1, toNumber(item.quantidade || 1))),
    created_at: sale.created_at
  })));
}

function buildTopList(map, valueField, extra = {}) {
  return Object.values(map)
    .sort((a, b) => toNumber(b[valueField]) - toNumber(a[valueField]))
    .slice(0, extra.limit || 12);
}

function getFilteredData(filters = {}) {
  const datasets = loadReportDatasets();
  const sales = datasets.sales.filter((sale) => saleMatchesFilters(sale, filters));
  const quotes = datasets.quotes.filter((item) => quoteMatchesFilters(item, filters));
  const reservations = datasets.reservations.filter((item) => reservationMatchesFilters(item, filters));
  const internalConsumption = datasets.internalConsumption.filter((item) => internalConsumptionMatchesFilters(item, filters));
  const inventory = datasets.inventory.filter((item) => inventoryMatchesFilters(item, filters));
  const inventoryMovements = datasets.inventoryMovements.filter((item) => movementMatchesFilters(item, filters));
  const exchanges = datasets.exchanges.filter((item) =>
    inRange(item.created_at, filters)
    && (!filters.store || normalizeText(item.loja || item.origin_store) === filters.store)
    && (!filters.seller || matchesLookup(item.created_by, filters.seller))
    && (!filters.customer || matchesLookup(item.customer_name || "", filters.customer))
  );
  const cashback = datasets.cashback.filter((item) =>
    inRange(item.created_at || item.available_at || item.expires_at, filters)
    && (!filters.store || normalizeText(item.loja || item.store_id || "") === filters.store)
    && (!filters.customer || matchesLookup(item.customer_name, filters.customer) || matchesLookup(item.customer_phone, filters.customer))
    && (!filters.status || normalizeText(item.status) === filters.status)
  );
  const giftCards = datasets.giftCards.filter((item) =>
    inRange(item.created_at || item.issued_at || item.updated_at, filters)
    && (!filters.store || normalizeText(item.loja || item.store_id || "") === filters.store)
    && (!filters.customer || matchesLookup(item.buyer_name || item.recipient_name, filters.customer))
    && (!filters.status || normalizeText(item.status) === filters.status)
  );
  return {
    ...datasets,
    sales,
    quotes,
    reservations,
    internalConsumption,
    inventory,
    inventoryMovements,
    exchanges,
    cashback,
    giftCards
  };
}

function buildSummaryReport(filters = {}) {
  const data = getFilteredData(filters);
  const completedSales = data.sales.filter((item) => item.status === "COMPLETED" || item.status === "EXCHANGE");
  const cancelledSales = data.sales.filter((item) => item.status === "CANCELLED");
  const grossSalesValue = roundMoney(completedSales.reduce((sum, item) => sum + toNumber(item.subtotal || item.total_final), 0));
  const netSalesValue = roundMoney(completedSales.reduce((sum, item) => sum + toNumber(item.total_final), 0));
  const discountTotal = roundMoney(completedSales.reduce((sum, item) => sum + toNumber(item.extra_discount || 0), 0));
  const cashbackGenerated = roundMoney(data.cashback.filter((item) => item.origin === "SALE").reduce((sum, item) => sum + toNumber(item.amount || 0), 0));
  const cashbackUsed = roundMoney(completedSales.reduce((sum, item) => sum + toNumber(item.cashback_used || 0), 0));
  const cashbackPending = roundMoney(data.cashback.filter((item) => item.status === "PENDING").reduce((sum, item) => sum + toNumber(item.amount || 0), 0));
  const cashbackExpired = roundMoney(data.cashback.filter((item) => item.status === "EXPIRED").reduce((sum, item) => sum + toNumber(item.remaining_amount ?? item.amount), 0));
  const permutaTotal = roundMoney(completedSales.reduce((sum, item) => sum + toNumber(item.permuta_amount || 0), 0));
  const giftCardsIssued = roundMoney(data.giftCards.reduce((sum, item) => sum + toNumber(item.original_amount || item.amount || 0), 0));
  const giftCardsUsed = roundMoney(data.giftCards.reduce((sum, item) => sum + toNumber(item.used_amount || 0), 0));
  const internalConsumptionValue = roundMoney(data.internalConsumption.reduce((sum, item) => sum + toNumber(item.valor_referencia || item.preco_venda || item.value_reference || 0), 0));
  const exchangeCount = data.exchanges.length;
  const averageTicket = completedSales.length ? roundMoney(netSalesValue / completedSales.length) : 0;
  const paymentTotals = paymentMethodBreakdown(completedSales);
  const closedRegisters = data.cashRegisters.filter((item) => item.status === "CLOSED" && inRange(item.closed_at || item.updated_at, filters));
  const cashDifference = roundMoney(closedRegisters.reduce((sum, item) => sum + toNumber(item.difference_amount || item.diferenca_final || 0), 0));
  const usageValue = internalConsumptionValue;

  return {
    filters,
    metrics: {
      venda_bruta: grossSalesValue,
      venda_liquida: netSalesValue,
      quantidade_vendas: completedSales.length,
      ticket_medio: averageTicket,
      desconto_total: discountTotal,
      desconto_medio: completedSales.length ? roundMoney(discountTotal / completedSales.length) : 0,
      cashback_gerado: cashbackGenerated,
      cashback_usado: cashbackUsed,
      cashback_pendente: cashbackPending,
      cashback_expirado: cashbackExpired,
      permuta_total: permutaTotal,
      vale_presente_emitido: giftCardsIssued,
      vale_presente_usado: giftCardsUsed,
      uso_consumo: usageValue,
      trocas: exchangeCount,
      vendas_canceladas: cancelledSales.length,
      diferenca_caixa: cashDifference,
      total_dinheiro: paymentTotals.dinheiro,
      total_pix: paymentTotals.pix,
      total_debito: paymentTotals.debito,
      total_credito: getCreditCardTotal(paymentTotals),
      total_link_pagamento: paymentTotals.link_pagamento
    },
    quickPeriods: QUICK_PERIODS
  };
}

function buildSalesReport(filters = {}) {
  const data = getFilteredData(filters);
  const sales = data.sales.map((sale) => ({
    sale_id: sale.sale_id,
    data: sale.created_at,
    loja: sale.loja || "",
    vendedor: sale.vendedor || sale.seller || "",
    cliente: sale.customer?.name || "",
    subtotal: roundMoney(sale.subtotal || 0),
    desconto_extra: roundMoney(sale.desconto_extra || sale.extra_discount || 0),
    cashback_usado: roundMoney(sale.cashback_usado || sale.cashback_used || 0),
    vale_presente_usado: roundMoney(sale.vale_presente_usado || sale.gift_card_used || 0),
    permuta: roundMoney(sale.permuta_usada || sale.permuta_amount || 0),
    total_final: roundMoney(sale.total_final || 0),
    formas_pagamento: (sale.pagamentos || sale.payment_methods || []).map((item) => item.method).join(", "),
    status: sale.status || "",
    itens: (sale.items || sale.cart_items || []).reduce((sum, item) => sum + Math.max(1, toNumber(item.quantidade || 1)), 0)
  }));
  const completed = sales.filter((item) => item.status === "COMPLETED" || item.status === "EXCHANGE");
  const totalVendido = roundMoney(completed.reduce((sum, item) => sum + toNumber(item.total_final), 0));
  return {
    filters,
    metrics: {
      total_vendido: totalVendido,
      ticket_medio: completed.length ? roundMoney(totalVendido / completed.length) : 0,
      numero_vendas: completed.length,
      itens_por_venda: completed.length ? roundValue(completed.reduce((sum, item) => sum + toNumber(item.itens), 0) / completed.length, 2) : 0,
      vendas_canceladas: sales.filter((item) => item.status === "CANCELLED").length,
      vendas_com_desconto: sales.filter((item) => toNumber(item.desconto_extra) > 0).length,
      vendas_com_cashback: sales.filter((item) => toNumber(item.cashback_usado) > 0).length
    },
    items: sales.slice(0, 500)
  };
}

function buildSellersReport(filters = {}) {
  const data = getFilteredData(filters);
  const sales = data.sales.filter((item) => item.status !== "CANCELLED");
  const rows = {};
  sales.forEach((sale) => {
    const seller = normalizeText(sale.vendedor || sale.seller || "Sem vendedor");
    if (!rows[seller]) {
      rows[seller] = {
        vendedor: seller,
        total_vendido: 0,
        quantidade_vendas: 0,
        desconto_total: 0,
        cashback_usado: 0,
        cashback_gerado: 0,
        permuta: 0,
        clientes: new Set(),
        cancelamentos: 0,
        vendas_ids: new Set()
      };
    }
    rows[seller].total_vendido += toNumber(sale.total_final || 0);
    rows[seller].quantidade_vendas += 1;
    rows[seller].desconto_total += toNumber(sale.extra_discount || 0);
    rows[seller].cashback_usado += toNumber(sale.cashback_used || 0);
    rows[seller].cashback_gerado += toNumber(sale.cashback_generated?.amount || 0);
    rows[seller].permuta += toNumber(sale.permuta_amount || 0);
    if (sale.customer?.name) rows[seller].clientes.add(normalizeText(sale.customer.name));
    rows[seller].vendas_ids.add(sale.sale_id);
  });

  data.sales.filter((item) => item.status === "CANCELLED").forEach((sale) => {
    const seller = normalizeText(sale.vendedor || sale.seller || "Sem vendedor");
    rows[seller] = rows[seller] || {
      vendedor: seller,
      total_vendido: 0,
      quantidade_vendas: 0,
      desconto_total: 0,
      cashback_usado: 0,
      cashback_gerado: 0,
      permuta: 0,
      clientes: new Set(),
      cancelamentos: 0,
      vendas_ids: new Set()
    };
    rows[seller].cancelamentos += 1;
  });

  data.quotes.forEach((quote) => {
    const seller = normalizeText(quote.seller || quote.vendedor || "Sem vendedor");
    rows[seller] = rows[seller] || { vendedor: seller, total_vendido: 0, quantidade_vendas: 0, desconto_total: 0, cashback_usado: 0, cashback_gerado: 0, permuta: 0, clientes: new Set(), cancelamentos: 0, vendas_ids: new Set() };
    rows[seller].orcamentos_criados = (rows[seller].orcamentos_criados || 0) + 1;
  });
  data.reservations.forEach((reservation) => {
    const seller = normalizeText(reservation.seller || reservation.vendedor || "Sem vendedor");
    rows[seller] = rows[seller] || { vendedor: seller, total_vendido: 0, quantidade_vendas: 0, desconto_total: 0, cashback_usado: 0, cashback_gerado: 0, permuta: 0, clientes: new Set(), cancelamentos: 0, vendas_ids: new Set() };
    rows[seller].reservas_criadas = (rows[seller].reservas_criadas || 0) + 1;
  });

  const clientsBySellerFromMaster = {};
  (data.masterCustomers || []).forEach((customer) => {
    const seller = normalizeText(customer.vendedor_favorito || "");
    if (!seller) return;
    clientsBySellerFromMaster[seller] = clientsBySellerFromMaster[seller] || { total: 0, recorrentes: 0 };
    clientsBySellerFromMaster[seller].total += 1;
    if (toNumber(customer.quantidade_compras || 0) > 1) {
      clientsBySellerFromMaster[seller].recorrentes += 1;
    }
  });

  const items = Object.values(rows).map((item) => {
    const sellerClients = clientsBySellerFromMaster[item.vendedor] || { total: 0, recorrentes: 0 };
    const descontoMedio = item.quantidade_vendas ? roundMoney(item.desconto_total / item.quantidade_vendas) : 0;
    const vendaMedia = item.quantidade_vendas ? roundMoney(item.total_vendido / item.quantidade_vendas) : 0;
    const descontoPercentualMedio = item.total_vendido > 0 ? roundValue((item.desconto_total / (item.total_vendido + item.desconto_total)) * 100, 2) : 0;
    return {
      vendedor: item.vendedor,
      total_vendido: roundMoney(item.total_vendido),
      quantidade_vendas: item.quantidade_vendas,
      ticket_medio: vendaMedia,
      desconto_total: roundMoney(item.desconto_total),
      desconto_medio: descontoMedio,
      desconto_percentual_medio: descontoPercentualMedio,
      cashback_usado: roundMoney(item.cashback_usado),
      cashback_gerado: roundMoney(item.cashback_gerado),
      permuta: roundMoney(item.permuta),
      comissao_estimada: roundMoney(item.total_vendido * 0.05),
      clientes_atendidos: item.clientes.size,
      clientes_novos_cadastrados: sellerClients.total,
      clientes_recorrentes: sellerClients.recorrentes,
      reservas_criadas: item.reservas_criadas || 0,
      orcamentos_criados: item.orcamentos_criados || 0,
      cancelamentos: item.cancelamentos || 0,
      alerta_desconto_alto: descontoPercentualMedio > 10
    };
  }).sort((a, b) => b.total_vendido - a.total_vendido);

  return {
    filters,
    limit_alert_discount_percent: 10,
    items,
    alerts: items.filter((item) => item.alerta_desconto_alto).map((item) => ({
      type: "VENDEDOR_COM_DESCONTO_ALTO",
      vendedor: item.vendedor,
      desconto_percentual_medio: item.desconto_percentual_medio
    }))
  };
}

function buildStoresReport(filters = {}) {
  const data = getFilteredData(filters);
  const rows = {};
  data.sales.forEach((sale) => {
    const store = normalizeStoreKey(sale.loja || "") || "sem_loja";
    rows[store] = rows[store] || {
      loja: store,
      venda_bruta: 0,
      venda_liquida: 0,
      numero_vendas: 0,
      cashback_gerado: 0,
      cashback_usado: 0,
      permutas: 0,
      trocas: 0,
      vale_presente: 0,
      uso_consumo: 0
    };
    if (sale.status !== "CANCELLED") {
      rows[store].venda_bruta += toNumber(sale.subtotal || sale.total_final || 0);
      rows[store].venda_liquida += toNumber(sale.total_final || 0);
      rows[store].numero_vendas += 1;
      rows[store].cashback_gerado += toNumber(sale.cashback_generated?.amount || 0);
      rows[store].cashback_usado += toNumber(sale.cashback_used || 0);
      rows[store].permutas += toNumber(sale.permuta_amount || 0);
      rows[store].vale_presente += toNumber(sale.gift_card_used || 0);
    }
  });
  data.exchanges.forEach((item) => {
    const store = normalizeStoreKey(item.loja || item.origin_store || "") || "sem_loja";
    rows[store] = rows[store] || { loja: store, venda_bruta: 0, venda_liquida: 0, numero_vendas: 0, cashback_gerado: 0, cashback_usado: 0, permutas: 0, trocas: 0, vale_presente: 0, uso_consumo: 0 };
    rows[store].trocas += 1;
  });
  data.internalConsumption.forEach((item) => {
    const store = normalizeStoreKey(item.loja || "") || "sem_loja";
    rows[store] = rows[store] || { loja: store, venda_bruta: 0, venda_liquida: 0, numero_vendas: 0, cashback_gerado: 0, cashback_usado: 0, permutas: 0, trocas: 0, vale_presente: 0, uso_consumo: 0 };
    rows[store].uso_consumo += toNumber(item.valor_referencia || item.value_reference || 0);
  });
  data.inventory.forEach((item) => {
    const store = normalizeStoreKey(item.store_id || "") || "sem_loja";
    rows[store] = rows[store] || { loja: store, venda_bruta: 0, venda_liquida: 0, numero_vendas: 0, cashback_gerado: 0, cashback_usado: 0, permutas: 0, trocas: 0, vale_presente: 0, uso_consumo: 0 };
    rows[store].estoque_disponivel = roundMoney((rows[store].estoque_disponivel || 0) + toNumber(item.available_qty || 0));
    if (toNumber(item.available_qty || 0) <= 0) {
      rows[store].itens_esgotados = (rows[store].itens_esgotados || 0) + 1;
    }
    if (!item.last_movement_at || (Date.now() - new Date(item.last_movement_at).getTime()) > (45 * 24 * 60 * 60 * 1000)) {
      rows[store].estoque_parado = (rows[store].estoque_parado || 0) + 1;
    }
  });
  const closedRegisters = data.cashRegisters.filter((item) => item.status === "CLOSED" && inRange(item.closed_at || item.updated_at, filters));
  closedRegisters.forEach((item) => {
    const store = normalizeStoreKey(item.loja || "") || "sem_loja";
    rows[store] = rows[store] || { loja: store, venda_bruta: 0, venda_liquida: 0, numero_vendas: 0, cashback_gerado: 0, cashback_usado: 0, permutas: 0, trocas: 0, vale_presente: 0, uso_consumo: 0 };
    rows[store].caixas_fechados = (rows[store].caixas_fechados || 0) + 1;
    rows[store].diferenca_caixa = roundMoney((rows[store].diferenca_caixa || 0) + toNumber(item.difference_amount || 0));
  });

  return {
    filters,
    items: Object.values(rows).map((item) => ({
      loja: formatStoreLabel(item.loja),
      venda_bruta: roundMoney(item.venda_bruta),
      venda_liquida: roundMoney(item.venda_liquida),
      ticket_medio: item.numero_vendas ? roundMoney(item.venda_liquida / item.numero_vendas) : 0,
      numero_vendas: item.numero_vendas || 0,
      caixa_aberto: data.cashRegisters.some((register) => normalizeStoreKey(register.loja) === item.loja && ["OPEN", "REOPENED"].includes(register.status)),
      caixas_fechados: item.caixas_fechados || 0,
      diferenca_caixa: roundMoney(item.diferenca_caixa || 0),
      cashback_gerado: roundMoney(item.cashback_gerado || 0),
      cashback_usado: roundMoney(item.cashback_usado || 0),
      estoque_disponivel: roundMoney(item.estoque_disponivel || 0),
      estoque_parado: item.estoque_parado || 0,
      uso_consumo: roundMoney(item.uso_consumo || 0),
      permutas: roundMoney(item.permutas || 0),
      trocas: item.trocas || 0,
      vale_presente: roundMoney(item.vale_presente || 0),
      itens_esgotados: item.itens_esgotados || 0
    })).sort((a, b) => b.venda_liquida - a.venda_liquida)
  };
}

function buildCashbackReport(filters = {}) {
  const data = getFilteredData(filters);
  const balanceByCustomer = {};
  data.cashback.forEach((entry) => {
    const key = normalizePhone(entry.customer_phone || "") || normalizeLookup(entry.customer_name || "");
    if (!key) return;
    balanceByCustomer[key] = balanceByCustomer[key] || {
      customer_name: normalizeText(entry.customer_name || "Cliente"),
      customer_phone: normalizePhone(entry.customer_phone || ""),
      saldo_disponivel: 0,
      saldo_pendente: 0,
      saldo_usado: 0,
      saldo_expirado: 0,
      cashback_gerado: 0
    };
    balanceByCustomer[key].cashback_gerado += toNumber(entry.amount || 0);
    if (entry.status === "AVAILABLE") {
      balanceByCustomer[key].saldo_disponivel += toNumber(entry.remaining_amount ?? entry.amount);
    } else if (entry.status === "PENDING") {
      balanceByCustomer[key].saldo_pendente += toNumber(entry.amount || 0);
    } else if (entry.status === "USED") {
      balanceByCustomer[key].saldo_usado += toNumber(entry.used_amount || entry.amount || 0);
    } else if (entry.status === "EXPIRED") {
      balanceByCustomer[key].saldo_expirado += toNumber(entry.remaining_amount ?? entry.amount);
    }
  });

  const expiringSoon = data.cashback.filter((entry) => {
    if (entry.status !== "AVAILABLE" || !entry.expires_at) return false;
    const expiresAt = safeDate(entry.expires_at);
    if (!expiresAt) return false;
    const diffDays = (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    return diffDays >= 0 && diffDays <= 5;
  });

  return {
    filters,
    policy: {
      rate: 0.12,
      release: "next_day",
      validity_days: 30
    },
    metrics: {
      saldo_total_disponivel: roundMoney(data.cashback.filter((item) => item.status === "AVAILABLE").reduce((sum, item) => sum + toNumber(item.remaining_amount ?? item.amount), 0)),
      saldo_pendente: roundMoney(data.cashback.filter((item) => item.status === "PENDING").reduce((sum, item) => sum + toNumber(item.amount || 0), 0)),
      saldo_usado: roundMoney(data.cashback.reduce((sum, item) => sum + toNumber(item.used_amount || 0), 0)),
      saldo_expirado: roundMoney(data.cashback.filter((item) => item.status === "EXPIRED").reduce((sum, item) => sum + toNumber(item.remaining_amount ?? item.amount), 0)),
      cashback_gerado_periodo: roundMoney(data.cashback.reduce((sum, item) => sum + toNumber(item.amount || 0), 0)),
      cashback_usado_periodo: roundMoney(data.cashback.reduce((sum, item) => sum + toNumber(item.used_amount || 0), 0))
    },
    items: Object.values(balanceByCustomer).map((item) => ({
      customer_name: item.customer_name,
      customer_phone: item.customer_phone,
      saldo_disponivel: roundMoney(item.saldo_disponivel),
      saldo_pendente: roundMoney(item.saldo_pendente),
      saldo_usado: roundMoney(item.saldo_usado),
      saldo_expirado: roundMoney(item.saldo_expirado),
      cashback_gerado: roundMoney(item.cashback_gerado)
    })).sort((a, b) => b.saldo_disponivel - a.saldo_disponivel),
    alerts: {
      cashback_proximo_de_expirar: expiringSoon.slice(0, 20),
      cliente_com_cashback_parado: Object.values(balanceByCustomer).filter((item) => item.saldo_disponivel > 0).slice(0, 20)
    }
  };
}

function buildPaymentsReport(filters = {}) {
  const data = getFilteredData(filters);
  const sales = data.sales.filter((item) => item.status !== "CANCELLED");
  const totals = paymentMethodBreakdown(sales);
  return {
    filters,
    metrics: totals,
    notes: {
      cashback_nao_e_dinheiro: true,
      permuta_nao_e_dinheiro: true,
      vale_presente_nao_e_dinheiro_novo: true,
      credito_troca_nao_e_dinheiro_novo: true
    },
    items: sales.map((sale) => ({
      sale_id: sale.sale_id,
      loja: sale.loja || "",
      vendedor: sale.vendedor || sale.seller || "",
      cliente: sale.customer?.name || "",
      status: sale.status || "",
      pagamentos: (sale.payment_methods || []).map((item) => ({
        method: item.method,
        amount: roundMoney(item.amount || 0),
        installments: item.installments || 1
      }))
    })).slice(0, 400)
  };
}

function buildInventoryReport(filters = {}) {
  const data = getFilteredData(filters);
  const movements = data.inventoryMovements;
  const productsByBrand = {};
  const productsByCategory = {};
  data.inventory.forEach((item) => {
    const brand = normalizeText(item.marca || "Sem marca");
    const category = normalizeText(item.categoria || "Sem categoria");
    productsByBrand[brand] = roundMoney((productsByBrand[brand] || 0) + toNumber(item.available_qty || 0));
    productsByCategory[category] = roundMoney((productsByCategory[category] || 0) + toNumber(item.available_qty || 0));
  });
  const movementCounts = {};
  movements.forEach((item) => {
    const key = normalizeText(item.product_id || item.sku || item.codigo || item.nome || "Produto");
    movementCounts[key] = movementCounts[key] || {
      product_id: key,
      nome: normalizeText(item.nome || "Produto"),
      movimentos: 0,
      quantidade_total: 0
    };
    movementCounts[key].movimentos += 1;
    movementCounts[key].quantidade_total += Math.abs(toNumber(item.quantity || 0));
  });
  const inventoryAlertsResponse = getInventoryAlerts({ storeId: filters.store || "", limit: 200 }) || [];
  const inventoryAlerts = toArray(inventoryAlertsResponse);
  const inventoryAlertCount = Number(
    inventoryAlertsResponse?.total
    || inventoryAlertsResponse?.alerts_count
    || inventoryAlertsResponse?.alertsCount
    || inventoryAlerts.length
    || 0
  );
  return {
    filters,
    metrics: {
      total_itens_disponiveis: roundMoney(data.inventory.reduce((sum, item) => sum + toNumber(item.available_qty || 0), 0)),
      itens_esgotados: data.inventory.filter((item) => toNumber(item.available_qty || 0) <= 0).length,
      ultimas_pecas: data.inventory.filter((item) => toNumber(item.available_qty || 0) === 1).length,
      transferencias: data.transfers.filter((item) => inRange(item.created_at, filters)).length,
      ajustes_manuais: movements.filter((item) => item.type === "MANUAL_ADJUSTMENT").length,
      perdas: movements.filter((item) => item.type === "LOSS_OUT").length,
      defeitos: movements.filter((item) => item.type === "DEFECT_OUT").length,
      uso_consumo: movements.filter((item) => item.type === "INTERNAL_CONSUMPTION_OUT").length
    },
    estoque_por_loja: buildTopList(data.inventory.reduce((acc, item) => {
      const key = normalizeStoreKey(item.store_id || "") || "sem_loja";
      acc[key] = acc[key] || { loja: formatStoreLabel(key), disponivel: 0, reservado: 0, indisponivel: 0 };
      acc[key].disponivel += toNumber(item.available_qty || 0);
      acc[key].reservado += toNumber(item.reserved_qty || 0);
      acc[key].indisponivel += toNumber(item.unavailable_qty || 0);
      return acc;
    }, {}), "disponivel", { limit: 20 }),
    estoque_por_categoria: Object.entries(productsByCategory).map(([categoria, disponivel]) => ({ categoria, disponivel })).sort((a, b) => b.disponivel - a.disponivel).slice(0, 20),
    estoque_por_marca: Object.entries(productsByBrand).map(([marca, disponivel]) => ({ marca, disponivel })).sort((a, b) => b.disponivel - a.disponivel).slice(0, 20),
    produtos_mais_movimentados: buildTopList(movementCounts, "quantidade_total", { limit: 20 }),
    alerts: inventoryAlerts,
    alerts_count: inventoryAlertCount,
    alertsCount: inventoryAlertCount
  };
}

function buildCustomersReport(filters = {}) {
  const data = getFilteredData(filters);
  const customerMap = {};
  const masterByPhone = {};
  (data.masterCustomers || []).forEach((customer) => {
    const key = normalizePhone(customer.phone || customer.telefone || "") || normalizeLookup(customer.name || customer.customer_name || "");
    masterByPhone[key] = customer;
  });
  const saleItems = saleItemsFromSales(data.sales.filter((item) => item.status !== "CANCELLED"));
  data.sales.forEach((sale) => {
    const phone = normalizePhone(sale.customer?.phone || "");
    const key = phone || normalizeLookup(sale.customer?.name || "sem nome");
    if (!customerMap[key]) {
      const master = masterByPhone[key] || {};
      customerMap[key] = {
        customer_name: normalizeText(sale.customer?.name || master.name || "Cliente"),
        customer_phone: phone,
        total_comprado: 0,
        quantidade_compras: 0,
        ultima_compra: "",
        cashback_disponivel: 0,
        classe_abc: normalizeText(master.abc_class || master.classe_abc || ""),
        loja_favorita: normalizeText(master.loja_favorita || ""),
        vendedor_favorito: normalizeText(master.vendedor_favorito || ""),
        categories: {},
        brands: {},
        uso_cashback: 0,
        compras_com_presente: 0,
        recebeu_presente: 0,
        indicou_presenteado: 0,
        descontos: 0
      };
    }
    customerMap[key].total_comprado += toNumber(sale.total_final || 0);
    customerMap[key].quantidade_compras += 1;
    customerMap[key].uso_cashback += toNumber(sale.cashback_used || 0);
    customerMap[key].descontos += toNumber(sale.extra_discount || 0);
    if (!customerMap[key].ultima_compra || new Date(sale.created_at) > new Date(customerMap[key].ultima_compra)) {
      customerMap[key].ultima_compra = sale.created_at;
    }
    if (sale.gift_sale?.enabled) {
      customerMap[key].compras_com_presente += 1;
      if (sale.gift_sale?.gifted_to_phone) {
        customerMap[key].indicou_presenteado += 1;
      }
    }
  });
  saleItems.forEach((item) => {
    const key = normalizePhone(item.customer_phone || "") || normalizeLookup(item.cliente || "");
    if (!customerMap[key]) return;
    if (item.categoria) {
      customerMap[key].categories[item.categoria] = (customerMap[key].categories[item.categoria] || 0) + toNumber(item.quantidade || 0);
    }
    if (item.marca) {
      customerMap[key].brands[item.marca] = (customerMap[key].brands[item.marca] || 0) + toNumber(item.quantidade || 0);
    }
  });
  data.cashback.forEach((item) => {
    const key = normalizePhone(item.customer_phone || "") || normalizeLookup(item.customer_name || "");
    if (!customerMap[key]) {
      customerMap[key] = {
        customer_name: normalizeText(item.customer_name || "Cliente"),
        customer_phone: normalizePhone(item.customer_phone || ""),
        total_comprado: 0,
        quantidade_compras: 0,
        ultima_compra: "",
        cashback_disponivel: 0,
        classe_abc: "",
        loja_favorita: "",
        vendedor_favorito: "",
        categories: {},
        brands: {},
        uso_cashback: 0,
        compras_com_presente: 0,
        recebeu_presente: 0,
        indicou_presenteado: 0,
        descontos: 0
      };
    }
    if (item.status === "AVAILABLE") {
      customerMap[key].cashback_disponivel += toNumber(item.remaining_amount ?? item.amount);
    }
  });
  data.welcomeBonuses.forEach((item) => {
    const key = normalizePhone(item.recipient_phone || "") || normalizeLookup(item.recipient_name || "");
    if (!customerMap[key]) {
      customerMap[key] = {
        customer_name: normalizeText(item.recipient_name || "Cliente"),
        customer_phone: normalizePhone(item.recipient_phone || ""),
        total_comprado: 0,
        quantidade_compras: 0,
        ultima_compra: "",
        cashback_disponivel: 0,
        classe_abc: "",
        loja_favorita: "",
        vendedor_favorito: "",
        categories: {},
        brands: {},
        uso_cashback: 0,
        compras_com_presente: 0,
        recebeu_presente: 0,
        indicou_presenteado: 0,
        descontos: 0
      };
    }
    customerMap[key].recebeu_presente += 1;
  });

  const items = Object.values(customerMap).map((item) => {
    const daysSinceLastPurchase = item.ultima_compra ? Math.max(0, Math.floor((Date.now() - new Date(item.ultima_compra).getTime()) / (24 * 60 * 60 * 1000))) : null;
    const favoriteCategories = Object.entries(item.categories).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key]) => key);
    const favoriteBrands = Object.entries(item.brands).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key]) => key);
    return {
      customer_name: item.customer_name,
      customer_phone: item.customer_phone,
      total_comprado: roundMoney(item.total_comprado),
      ticket_medio: item.quantidade_compras ? roundMoney(item.total_comprado / item.quantidade_compras) : 0,
      quantidade_compras: item.quantidade_compras,
      ultima_compra: item.ultima_compra,
      dias_desde_ultima_compra: daysSinceLastPurchase,
      recorrencia_media: item.quantidade_compras > 1 && daysSinceLastPurchase !== null ? roundValue(daysSinceLastPurchase / item.quantidade_compras, 2) : 0,
      cashback_disponivel: roundMoney(item.cashback_disponivel),
      classe_abc: item.classe_abc || "",
      loja_favorita: item.loja_favorita || "",
      vendedor_favorito: item.vendedor_favorito || "",
      categorias_favoritas: favoriteCategories,
      marcas_favoritas: favoriteBrands,
      uso_cashback: roundMoney(item.uso_cashback),
      compras_com_presente: item.compras_com_presente,
      recebeu_presente: item.recebeu_presente,
      indicou_presenteado: item.indicou_presenteado,
      segmento_vip: item.classe_abc === "A" || item.total_comprado >= 3000,
      segmento_sumido: daysSinceLastPurchase !== null && daysSinceLastPurchase >= 90,
      segmento_recorrente: item.quantidade_compras >= 3,
      segmento_novo: item.quantidade_compras === 1,
      segmento_cashback_vencendo: roundMoney(item.cashback_disponivel) > 0,
      segmento_so_desconto: item.total_comprado > 0 ? (item.descontos / item.total_comprado) > 0.1 : false,
      segmento_presenteador: item.compras_com_presente > 0,
      presenteado_convertido: item.recebeu_presente > 0 && item.quantidade_compras > 0
    };
  }).filter((item) => !filters.customer || matchesLookup(item.customer_name, filters.customer) || matchesLookup(item.customer_phone, filters.customer))
    .sort((a, b) => b.total_comprado - a.total_comprado);

  return {
    filters,
    items
  };
}

function buildExchangesReport(filters = {}) {
  const data = getFilteredData(filters);
  const items = data.exchanges.map((item) => ({
    troca_id: item.exchange_id,
    venda_original: item.origin_sale_id || "",
    cliente: item.customer_name || "",
    loja: item.loja || item.origin_store || "",
    vendedor: item.created_by || "",
    item_devolvido: item.origin_sale_id || "",
    item_novo: item.new_item || "",
    diferenca_incremental: roundMoney(item.incremental_value || 0),
    credito_troca: roundMoney(item.credit_value || 0),
    cashback_envolvido: roundMoney(item.cashback_generated_amount || 0),
    motivo: item.notes || "",
    tipo: item.type || ""
  }));
  const byReason = {};
  items.forEach((item) => {
    const reason = normalizeText(item.motivo || "Sem motivo");
    byReason[reason] = (byReason[reason] || 0) + 1;
  });
  return {
    filters,
    metrics: {
      total_trocas: items.length,
      motivo_mais_comum: Object.entries(byReason).sort((a, b) => b[1] - a[1])[0]?.[0] || "",
      lojas_com_mais_trocas: buildTopList(items.reduce((acc, item) => {
        acc[item.loja] = acc[item.loja] || { loja: item.loja, trocas: 0 };
        acc[item.loja].trocas += 1;
        return acc;
      }, {}), "trocas", { limit: 10 }).slice(0, 5)
    },
    items
  };
}

function buildGiftCardsReport(filters = {}) {
  const data = getFilteredData(filters);
  const items = data.giftCards.map((item) => ({
    code: item.code || "",
    buyer_name: item.buyer_name || "",
    recipient_name: item.recipient_name || "",
    valor_emitido: roundMoney(item.original_amount || item.amount || 0),
    valor_usado: roundMoney(item.used_amount || 0),
    saldo_aberto: roundMoney(item.remaining_amount ?? item.original_amount ?? item.amount ?? 0),
    status: item.status || "",
    created_at: item.created_at || item.issued_at || "",
    expires_at: item.expires_at || ""
  }));
  return {
    filters,
    metrics: {
      vales_emitidos: items.length,
      valor_emitido: roundMoney(items.reduce((sum, item) => sum + toNumber(item.valor_emitido), 0)),
      valor_usado: roundMoney(items.reduce((sum, item) => sum + toNumber(item.valor_usado), 0)),
      saldo_em_aberto: roundMoney(items.reduce((sum, item) => sum + toNumber(item.saldo_aberto), 0)),
      vales_expirados: items.filter((item) => item.status === "EXPIRED").length,
      vales_ativos: items.filter((item) => item.status === "ACTIVE" || item.status === "ISSUED").length
    },
    items
  };
}

function buildInternalConsumptionReport(filters = {}) {
  const data = getFilteredData(filters);
  const byReason = {};
  const byStore = {};
  const byResponsible = {};
  data.internalConsumption.forEach((item) => {
    const reason = normalizeText(item.destino || item.motivo || "OUTRO").toUpperCase();
    const store = normalizeText(item.loja || "Sem loja");
    const responsible = normalizeText(item.responsavel || "Sem responsavel");
    const valueReference = roundMoney(item.valor_referencia || item.value_reference || item.preco_venda || 0);
    byReason[reason] = roundMoney((byReason[reason] || 0) + valueReference);
    byStore[store] = roundMoney((byStore[store] || 0) + valueReference);
    byResponsible[responsible] = roundMoney((byResponsible[responsible] || 0) + valueReference);
  });
  return {
    filters,
    metrics: {
      total_valor_referencia: roundMoney(data.internalConsumption.reduce((sum, item) => sum + toNumber(item.valor_referencia || item.value_reference || item.preco_venda || 0), 0)),
      total_custo: roundMoney(data.internalConsumption.reduce((sum, item) => sum + toNumber(item.preco_custo || item.cost_reference || 0), 0))
    },
    por_motivo: Object.entries(byReason).map(([motivo, total]) => ({ motivo, total })).sort((a, b) => b.total - a.total),
    por_loja: Object.entries(byStore).map(([loja, total]) => ({ loja, total })).sort((a, b) => b.total - a.total),
    por_responsavel: Object.entries(byResponsible).map(([responsavel, total]) => ({ responsavel, total })).sort((a, b) => b.total - a.total),
    items: data.internalConsumption.slice(0, 400)
  };
}

function buildManagementAlerts(filters = {}) {
  const summary = buildSummaryReport(filters);
  const sellers = buildSellersReport(filters);
  const customers = buildCustomersReport(filters);
  const inventory = buildInventoryReport(filters);
  const cashback = buildCashbackReport(filters);
  const stores = buildStoresReport(filters);
  const alerts = [];

  toArray(sellers.alerts).forEach((item) => {
    alerts.push({
      type: "desconto_alto",
      severity: "warning",
      title: `Vendedor ${item.vendedor} com desconto médio alto`,
      description: `O desconto percentual médio está em ${item.desconto_percentual_medio}%.`,
      scope: item.vendedor
    });
  });

  stores.items.filter((item) => Math.abs(toNumber(item.diferenca_caixa)) > 0.009).forEach((item) => {
    alerts.push({
      type: "caixa_com_diferenca",
      severity: "warning",
      title: `Loja ${item.loja} fechou caixa com diferença`,
      description: `Diferença acumulada de ${roundMoney(item.diferenca_caixa)}.`,
      scope: item.loja
    });
  });

  toArray(inventory.alerts).slice(0, 25).forEach((item) => {
    alerts.push({
      type: item.type || "estoque",
      severity: item.type === "negative_stock" ? "error" : "info",
      title: `Alerta de estoque: ${item.type || "movimentação"}`,
      description: `${item.nome || item.product_name || item.product_id || "Produto"} em ${item.store_id || item.loja || "loja"}.`,
      scope: item.store_id || ""
    });
  });

  toArray(cashback.alerts?.cashback_proximo_de_expirar).forEach((item) => {
    alerts.push({
      type: "cashback_vencendo",
      severity: "info",
      title: `Cashback vencendo para ${item.customer_name || "cliente"}`,
      description: `Saldo disponível com vencimento em breve.`,
      scope: item.customer_phone || ""
    });
  });

  customers.items.filter((item) => item.segmento_vip && item.segmento_sumido).slice(0, 15).forEach((item) => {
    alerts.push({
      type: "cliente_vip_sumido",
      severity: "warning",
      title: `Cliente VIP sem retorno recente`,
      description: `${item.customer_name} está há ${item.dias_desde_ultima_compra} dias sem comprar.`,
      scope: item.customer_phone || item.customer_name
    });
  });

  summary.metrics.vendas_canceladas && alerts.push({
    type: "venda_cancelada",
    severity: "info",
    title: "Há vendas canceladas no período",
    description: `${summary.metrics.vendas_canceladas} venda(s) cancelada(s) no recorte atual.`,
    scope: "vendas"
  });

  if (summary.metrics.permuta_total > 0) {
    alerts.push({
      type: "permuta_alta",
      severity: "info",
      title: "Permutas registradas no período",
      description: `Total de permutas: ${summary.metrics.permuta_total}.`,
      scope: "vendas"
    });
  }

  const usageThreshold = summary.metrics.venda_liquida > 0 ? (summary.metrics.uso_consumo / summary.metrics.venda_liquida) : 0;
  if (usageThreshold > 0.08) {
    alerts.push({
      type: "uso_consumo_alto",
      severity: "warning",
      title: "Uso e consumo acima do normal",
      description: `Uso e consumo representa ${roundValue(usageThreshold * 100, 2)}% da venda líquida filtrada.`,
      scope: "consumo"
    });
  }

  sellers.items.filter((item) => item.cancelamentos >= 3).forEach((item) => {
    alerts.push({
      type: "vendedor_com_muitos_cancelamentos",
      severity: "warning",
      title: `Cancelamentos acima do esperado`,
      description: `${item.vendedor} acumulou ${item.cancelamentos} cancelamentos.`,
      scope: item.vendedor
    });
  });

  buildGiftCardsReport(filters).items.filter((item) => item.saldo_aberto >= 500).forEach((item) => {
    alerts.push({
      type: "vale_presente_em_aberto",
      severity: "info",
      title: "Vale presente com saldo alto em aberto",
      description: `${item.code} ainda possui ${item.saldo_aberto} em aberto.`,
      scope: item.code
    });
  });

  return {
    filters,
    items: alerts.slice(0, 80)
  };
}

function logReportAccess(reportType, filters = {}, user = {}, meta = {}) {
  appendEvent("REPORT_VIEWED", { origem: "pdv_reports", loja: filters.store || "" }, {
    report_type: reportType,
    period: filters.period,
    start: filters.start ? filters.start.toISOString() : "",
    end: filters.end ? filters.end.toISOString() : "",
    export: meta.export || "",
    format: meta.format || ""
  }, user);
  appendAuditLog({
    audit_id: `AUD_REPORT_${Date.now()}`,
    action: "PDV_REPORT_VIEWED",
    created_at: new Date().toISOString(),
    actor: user?.name || user?.email || "sistema",
    actor_role: user?.role || user?.perfil || "",
    loja: filters.store || "",
    reason: `Relatório ${reportType}`,
    before: null,
    after: {
      report_type: reportType,
      period: filters.period,
      start: filters.start ? filters.start.toISOString() : "",
      end: filters.end ? filters.end.toISOString() : "",
      export: meta.export || "",
      format: meta.format || ""
    }
  });
}

function toCsv(rows = []) {
  if (!Array.isArray(rows) || !rows.length) {
    return "";
  }
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  const lines = [
    headers.join(";"),
    ...rows.map((row) => headers.map((header) => {
      const value = row?.[header];
      const serialized = Array.isArray(value) ? value.join(", ") : (value && typeof value === "object" ? JSON.stringify(value) : String(value ?? ""));
      return `"${serialized.replace(/"/g, "\"\"")}"`;
    }).join(";"))
  ];
  return lines.join("\n");
}

module.exports = {
  QUICK_PERIODS,
  parseFilters,
  loadReportDatasets,
  buildSummaryReport,
  buildSalesReport,
  buildSellersReport,
  buildStoresReport,
  buildCashbackReport,
  buildPaymentsReport,
  buildInventoryReport,
  buildCustomersReport,
  buildExchangesReport,
  buildGiftCardsReport,
  buildInternalConsumptionReport,
  buildManagementAlerts,
  logReportAccess,
  toCsv
};
