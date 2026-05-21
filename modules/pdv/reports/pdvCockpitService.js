"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "..", "data", "pdv");
const SALES_FILE = path.join(DATA_DIR, "sales", "sales.json");
const INVENTORY_FILE = path.join(DATA_DIR, "inventory", "inventory.json");

const DEFAULT_PERIOD = "30d";
const DAY_MS = 24 * 60 * 60 * 1000;
const COMPLETED_STATUSES = new Set(["COMPLETED", "CONCLUIDA", "CONCLUIDO", "EFETIVADA", "EFETIVADO"]);

function readJson(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && Array.isArray(value.items)) {
    return value.items;
  }
  if (value && Array.isArray(value.data)) {
    return value.data;
  }
  return [];
}

function toNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, "").replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function roundMoney(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

function safeDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  const value = safeDate(date) || new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date) {
  const value = safeDate(date) || new Date();
  value.setHours(23, 59, 59, 999);
  return value;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeLookup(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function isMeaningfulValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function pickFirst(...values) {
  for (const value of values) {
    if (isMeaningfulValue(value)) {
      return value;
    }
  }
  return "";
}

function formatDateOnly(date) {
  const value = safeDate(date);
  if (!value) {
    return "";
  }
  return value.toISOString().slice(0, 10);
}

function subtractDays(date, days) {
  const value = safeDate(date) || new Date();
  return new Date(value.getTime() - (days * DAY_MS));
}

function getCurrentPeriod(period, startDate, endDate) {
  const now = new Date();
  switch (period) {
    case "7d":
      return { start: startOfDay(subtractDays(now, 6)), end: endOfDay(now) };
    case "90d":
      return { start: startOfDay(subtractDays(now, 89)), end: endOfDay(now) };
    case "custom": {
      const start = startOfDay(startDate);
      const end = endOfDay(endDate);
      return { start, end };
    }
    case "30d":
    default:
      return { start: startOfDay(subtractDays(now, 29)), end: endOfDay(now) };
  }
}

function getPreviousPeriodRange(currentStart, currentEnd) {
  const start = safeDate(currentStart);
  const end = safeDate(currentEnd);
  if (!start || !end) {
    return { start: null, end: null };
  }
  const spanMs = Math.max(end.getTime() - start.getTime(), 0) + 1;
  return {
    start: new Date(start.getTime() - spanMs),
    end: new Date(end.getTime() - spanMs)
  };
}

function normalizeCockpitFilters(query = {}) {
  const period = String(query.period || DEFAULT_PERIOD).trim().toLowerCase() || DEFAULT_PERIOD;
  const storeId = String(query.store_id || "").trim();
  const brand = String(query.brand || "").trim();
  const category = String(query.category || "").trim();
  const vendorId = String(query.vendor_id || "").trim();
  const productSearch = String(query.product_search || "").trim();
  const startDate = safeDate(query.start_date || "");
  const endDate = safeDate(query.end_date || "");
  if (period === "custom" && (!startDate || !endDate)) {
    throw new Error("Periodo custom exige start_date e end_date.");
  }
  const current = getCurrentPeriod(period, startDate, endDate);
  const previous = getPreviousPeriodRange(current.start, current.end);
  return {
    period: ["7d", "30d", "90d", "custom"].includes(period) ? period : DEFAULT_PERIOD,
    store_id: storeId,
    brand,
    category,
    vendor_id: vendorId,
    product_search: productSearch,
    start_date: formatDateOnly(current.start),
    end_date: formatDateOnly(current.end),
    start: current.start,
    end: current.end,
    previous_start_date: formatDateOnly(previous.start),
    previous_end_date: formatDateOnly(previous.end),
    previousStart: previous.start,
    previousEnd: previous.end
  };
}

function isCompletedSale(sale) {
  const status = normalizeText(sale?.status || "").toUpperCase();
  return COMPLETED_STATUSES.has(status);
}

function matchesDateRange(date, start, end) {
  const value = safeDate(date);
  if (!value) {
    return false;
  }
  if (start && value < start) {
    return false;
  }
  if (end && value > end) {
    return false;
  }
  return true;
}

function normalizeStoreId(value) {
  return normalizeText(value).replace(/\s+/g, "_");
}

function normalizeSalePaymentMethods(sale) {
  return toArray(sale?.pagamentos || sale?.payment_methods).map((payment) => ({
    method: pickFirst(payment?.method, payment?.type, payment?.name),
    amount: roundMoney(payment?.amount || payment?.value || 0)
  }));
}

function normalizeSaleTotals(sale) {
  const subtotal = roundMoney(
    sale?.subtotal
    || sale?.gross_amount
    || sale?.totals?.subtotal
    || 0
  );
  const discounts = roundMoney(
    sale?.discount_amount
    || sale?.desconto_extra
    || sale?.discount_total
    || 0
  );
  const cashbackUsed = roundMoney(
    sale?.cashback_used_amount
    || sale?.cashback_usado
    || sale?.cashback_used
    || 0
  );
  const netRevenue = roundMoney(
    sale?.net_amount
    || sale?.total_final
    || sale?.paid_amount
    || subtotal - discounts - cashbackUsed
  );
  return { subtotal, discounts, cashbackUsed, netRevenue };
}

function normalizeSaleIdentity(sale) {
  const customer = sale?.customer || {};
  return {
    sale_id: sale?.sale_id || "",
    sale_date: safeDate(sale?.data_hora || sale?.created_at || sale?.updated_at || sale?.date),
    store_id: pickFirst(sale?.loja_venda, sale?.loja, sale?.store_id),
    store_name: pickFirst(sale?.loja_venda, sale?.loja, sale?.store_name),
    vendor_id: pickFirst(sale?.vendor_id, sale?.seller_id, sale?.created_by),
    vendor_name: pickFirst(sale?.vendedor, sale?.seller, sale?.created_by),
    customer_id: pickFirst(customer?.master_customer_id, customer?.crm_contact_id, customer?.customer_id),
    customer_name: pickFirst(customer?.name, sale?.customer_name)
  };
}

function normalizeInventoryRecord(record) {
  return {
    inventory_id: record?.inventory_id || "",
    product_id: record?.product_id || "",
    sku: pickFirst(record?.sku, record?.codigo_etiqueta, record?.codigo),
    codigo: pickFirst(record?.codigo, record?.codigo_interno, record?.codigo_etiqueta),
    name: pickFirst(record?.nome, record?.name),
    brand: pickFirst(record?.marca, record?.brand),
    category: pickFirst(record?.categoria, record?.category),
    color: pickFirst(record?.cor, record?.color),
    size: pickFirst(record?.tamanho, record?.size),
    store_id: pickFirst(record?.store_id, record?.loja, record?.store),
    stock_qty: roundMoney(record?.available_qty || record?.qty || 0),
    cost_price: isMeaningfulValue(record?.preco_custo) ? roundMoney(record.preco_custo) : null,
    sale_price: isMeaningfulValue(record?.preco_venda) ? roundMoney(record.preco_venda) : null,
    status: pickFirst(record?.status, "ACTIVE")
  };
}

function normalizeSaleItem(rawItem, sale) {
  const identity = normalizeSaleIdentity(sale);
  const quantity = roundMoney(rawItem?.quantidade || rawItem?.quantity || 0);
  const unitPrice = roundMoney(
    rawItem?.preco_unitario
    || rawItem?.unit_price
    || rawItem?.preco_venda
    || rawItem?.preco_referencia
    || 0
  );
  const lineGross = roundMoney(
    rawItem?.line_total
    || rawItem?.subtotal
    || rawItem?.total
    || unitPrice * quantity
  );
  const discountAmount = roundMoney(
    rawItem?.discount_amount
    || rawItem?.desconto
    || rawItem?.desconto_valor
    || 0
  );
  const netLineTotal = roundMoney(Math.max(lineGross - discountAmount, 0));
  const costPrice = isMeaningfulValue(rawItem?.preco_custo) ? roundMoney(rawItem.preco_custo) : null;
  return {
    sale_id: identity.sale_id,
    sale_date: identity.sale_date,
    store_id: pickFirst(rawItem?.sale_store_id, identity.store_id),
    store_name: pickFirst(rawItem?.sale_store_name, identity.store_name),
    stock_source_store_id: pickFirst(rawItem?.stock_source_store_id, rawItem?.store_id, identity.store_id),
    stock_source_store_name: pickFirst(rawItem?.stock_source_store_name, rawItem?.selected_loja, identity.store_name),
    vendor_id: identity.vendor_id,
    vendor_name: identity.vendor_name,
    customer_id: identity.customer_id,
    customer_name: identity.customer_name,
    product_id: pickFirst(rawItem?.selected_product_id, rawItem?.product_id),
    inventory_id: pickFirst(rawItem?.selected_inventory_id, rawItem?.inventory_id),
    sku: pickFirst(rawItem?.selected_sku, rawItem?.sku, rawItem?.codigo_etiqueta),
    codigo: pickFirst(rawItem?.selected_codigo, rawItem?.codigo, rawItem?.codigo_interno),
    product_name: pickFirst(rawItem?.selected_nome, rawItem?.nome, rawItem?.name),
    brand: pickFirst(rawItem?.marca, rawItem?.brand),
    category: pickFirst(rawItem?.categoria, rawItem?.category),
    size: pickFirst(rawItem?.tamanho, rawItem?.size),
    color: pickFirst(rawItem?.cor, rawItem?.color),
    quantity,
    unit_price: unitPrice,
    line_total: lineGross,
    discount_amount: discountAmount,
    net_line_total: netLineTotal,
    cost_price: costPrice,
    stock_qty_current: null
  };
}

function loadCockpitDatasets() {
  return {
    sales: toArray(readJson(SALES_FILE, [])),
    inventory: toArray(readJson(INVENTORY_FILE, []))
  };
}

function buildInventoryIndexes(records = []) {
  const normalized = toArray(records).map(normalizeInventoryRecord);
  const byInventoryId = new Map();
  const byProductId = new Map();
  const bySku = new Map();
  normalized.forEach((record) => {
    if (record.inventory_id) {
      byInventoryId.set(record.inventory_id, record);
    }
    if (record.product_id) {
      const bucket = byProductId.get(record.product_id) || [];
      bucket.push(record);
      byProductId.set(record.product_id, bucket);
    }
    if (record.sku) {
      const bucket = bySku.get(record.sku) || [];
      bucket.push(record);
      bySku.set(record.sku, bucket);
    }
  });
  return { normalized, byInventoryId, byProductId, bySku };
}

function getInventoryMatches(item, inventoryIndexes) {
  const direct = item.inventory_id ? inventoryIndexes.byInventoryId.get(item.inventory_id) : null;
  if (direct) {
    return [direct];
  }
  if (item.product_id && inventoryIndexes.byProductId.has(item.product_id)) {
    return inventoryIndexes.byProductId.get(item.product_id);
  }
  if (item.sku && inventoryIndexes.bySku.has(item.sku)) {
    return inventoryIndexes.bySku.get(item.sku);
  }
  return [];
}

function getCurrentStockForItem(item, inventoryIndexes, storeFilter = "") {
  const matches = getInventoryMatches(item, inventoryIndexes);
  return roundMoney(matches.reduce((total, record) => {
    if (storeFilter && normalizeStoreId(record.store_id) !== normalizeStoreId(storeFilter)) {
      return total;
    }
    return total + toNumber(record.stock_qty, 0);
  }, 0));
}

function enrichItemWithInventory(item, inventoryIndexes, storeFilter, warnings) {
  const matches = getInventoryMatches(item, inventoryIndexes);
  const costCandidates = matches.map((entry) => entry.cost_price).filter((value) => value !== null);
  const costPrice = item.cost_price !== null ? item.cost_price : (costCandidates.length ? costCandidates[0] : null);
  if (item.cost_price === null && costPrice === null) {
    warnings.missingCostCount += 1;
  }
  if (!matches.length) {
    warnings.missingInventoryCount += 1;
  }
  return {
    ...item,
    cost_price: costPrice,
    stock_qty_current: getCurrentStockForItem(item, inventoryIndexes, storeFilter)
  };
}

function matchesSaleScope(identity, filters) {
  if (filters.store_id && normalizeStoreId(identity.store_id) !== normalizeStoreId(filters.store_id)) {
    return false;
  }
  if (filters.vendor_id) {
    const vendorLookup = normalizeLookup(`${identity.vendor_id} ${identity.vendor_name}`);
    if (!vendorLookup.includes(normalizeLookup(filters.vendor_id))) {
      return false;
    }
  }
  return true;
}

function matchesItemScope(item, filters) {
  if (filters.brand && normalizeLookup(item.brand) !== normalizeLookup(filters.brand)) {
    return false;
  }
  if (filters.category && normalizeLookup(item.category) !== normalizeLookup(filters.category)) {
    return false;
  }
  if (filters.product_search) {
    const haystack = normalizeLookup([
      item.sku,
      item.codigo,
      item.product_name,
      item.brand,
      item.category,
      item.size,
      item.color
    ].join(" "));
    if (!haystack.includes(normalizeLookup(filters.product_search))) {
      return false;
    }
  }
  return true;
}

function hasItemScopedFilters(filters) {
  return Boolean(filters.brand || filters.category || filters.product_search);
}

function buildPeriodDataset(allSales, filters, start, end, inventoryIndexes) {
  const warnings = {
    missingCostCount: 0,
    missingInventoryCount: 0
  };
  const itemScoped = hasItemScopedFilters(filters);
  const sales = [];
  const items = [];
  allSales.filter(isCompletedSale).forEach((sale) => {
    const identity = normalizeSaleIdentity(sale);
    if (!matchesDateRange(identity.sale_date, start, end)) {
      return;
    }
    if (!matchesSaleScope(identity, filters)) {
      return;
    }
    const saleItems = toArray(sale?.items).map((entry) => normalizeSaleItem(entry, sale));
    const enrichedItems = saleItems.map((entry) => enrichItemWithInventory(entry, inventoryIndexes, filters.store_id, warnings));
    const matchedItems = enrichedItems.filter((entry) => matchesItemScope(entry, filters));
    if (!matchedItems.length) {
      return;
    }
    const totals = normalizeSaleTotals(sale);
    const matchedGross = roundMoney(matchedItems.reduce((sum, item) => sum + item.line_total, 0));
    const fullGross = roundMoney(enrichedItems.reduce((sum, item) => sum + item.line_total, 0)) || totals.subtotal || matchedGross;
    const share = fullGross > 0 ? Math.min(Math.max(matchedGross / fullGross, 0), 1) : 1;
    const effectiveDiscount = roundMoney(totals.discounts * share);
    const effectiveCashback = roundMoney(totals.cashbackUsed * share);
    const effectiveNetRevenue = itemScoped
      ? roundMoney(Math.max(matchedGross - effectiveDiscount - effectiveCashback, 0))
      : totals.netRevenue;
    const record = {
      identity,
      raw: sale,
      sale_id: identity.sale_id,
      sale_date: identity.sale_date,
      store_id: identity.store_id,
      store_name: identity.store_name,
      vendor_id: identity.vendor_id,
      vendor_name: identity.vendor_name,
      customer_id: identity.customer_id,
      customer_name: identity.customer_name,
      subtotal: itemScoped ? matchedGross : totals.subtotal,
      gross_revenue: itemScoped ? matchedGross : totals.subtotal,
      discounts_total: itemScoped ? effectiveDiscount : totals.discounts,
      cashback_used: itemScoped ? effectiveCashback : totals.cashbackUsed,
      net_revenue: effectiveNetRevenue,
      items_sold: roundMoney(matchedItems.reduce((sum, item) => sum + item.quantity, 0)),
      payment_methods: normalizeSalePaymentMethods(sale),
      matched_items: matchedItems,
      all_items: enrichedItems
    };
    sales.push(record);
    items.push(...matchedItems.map((entry) => {
      const lineShare = matchedGross > 0 ? Math.min(Math.max(entry.line_total / matchedGross, 0), 1) : 0;
      const allocatedDiscountAmount = roundMoney(effectiveDiscount * lineShare);
      const allocatedCashbackUsed = roundMoney(effectiveCashback * lineShare);
      return {
        ...entry,
        allocated_discount_amount: allocatedDiscountAmount,
        allocated_cashback_used: allocatedCashbackUsed,
        allocated_net_revenue: roundMoney(Math.max(entry.line_total - allocatedDiscountAmount - allocatedCashbackUsed, 0))
      };
    }));
  });
  return { sales, items, warnings };
}

function calculateDelta(current, previous) {
  const currentValue = toNumber(current, 0);
  const previousValue = toNumber(previous, 0);
  const deltaValue = roundMoney(currentValue - previousValue);
  let deltaPercent = null;
  if (previousValue !== 0) {
    deltaPercent = roundMoney((deltaValue / previousValue) * 100);
  } else if (currentValue !== 0) {
    deltaPercent = 100;
  } else {
    deltaPercent = 0;
  }
  const trend = deltaPercent > 2 ? "up" : (deltaPercent < -2 ? "down" : "stable");
  return {
    current: roundMoney(currentValue),
    previous: roundMoney(previousValue),
    delta_value: deltaValue,
    delta_percent: deltaPercent,
    trend
  };
}

function aggregateSalesMetrics(periodData) {
  const grossRevenue = roundMoney(periodData.sales.reduce((sum, sale) => sum + sale.gross_revenue, 0));
  const netRevenue = roundMoney(periodData.sales.reduce((sum, sale) => sum + sale.net_revenue, 0));
  const discountsTotal = roundMoney(periodData.sales.reduce((sum, sale) => sum + sale.discounts_total, 0));
  const cashbackUsed = roundMoney(periodData.sales.reduce((sum, sale) => sum + sale.cashback_used, 0));
  const itemsSold = roundMoney(periodData.items.reduce((sum, item) => sum + item.quantity, 0));
  const ordersCount = periodData.sales.length;
  const averageTicket = ordersCount > 0 ? roundMoney(netRevenue / ordersCount) : 0;
  let estimatedCost = 0;
  let hasCostData = false;
  periodData.items.forEach((item) => {
    if (item.cost_price !== null) {
      estimatedCost += item.cost_price * item.quantity;
      hasCostData = true;
    }
  });
  const marginValue = hasCostData ? roundMoney(netRevenue - estimatedCost) : null;
  const marginPercent = hasCostData && netRevenue > 0 ? roundMoney((marginValue / netRevenue) * 100) : null;
  return {
    gross_revenue: grossRevenue,
    net_revenue: netRevenue,
    discounts_total: discountsTotal,
    cashback_used: cashbackUsed,
    items_sold: itemsSold,
    orders_count: ordersCount,
    average_ticket: averageTicket,
    estimated_cost: hasCostData ? roundMoney(estimatedCost) : null,
    estimated_gross_margin: marginValue,
    estimated_margin_percent: marginPercent
  };
}

function buildWarnings(commonWarnings, currentData, previousData) {
  const warnings = [];
  const missingCostCount = currentData.warnings.missingCostCount + previousData.warnings.missingCostCount;
  const missingInventoryCount = currentData.warnings.missingInventoryCount + previousData.warnings.missingInventoryCount;
  if (missingCostCount > 0) {
    warnings.push(`${missingCostCount} item(ns) sem custo; margem estimada parcial.`);
  }
  if (missingInventoryCount > 0) {
    warnings.push(`${missingInventoryCount} item(ns) sem estoque atual localizado no inventario.`);
  }
  if (!previousData.sales.length) {
    warnings.push("Periodo anterior sem vendas suficientes para comparacao completa.");
  }
  return warnings.concat(commonWarnings);
}

function buildProductKey(item) {
  return pickFirst(item.inventory_id, item.sku, item.product_id, `${item.product_name}::${item.size}::${item.color}`);
}

function buildProductAggregates(periodData, filters) {
  const map = new Map();
  periodData.items.forEach((item) => {
    const key = buildProductKey(item);
    if (!map.has(key)) {
      map.set(key, {
        product_id: item.product_id,
        inventory_id: item.inventory_id,
        sku: item.sku,
        codigo: item.codigo,
        name: item.product_name,
        brand: item.brand,
        category: item.category,
        size: item.size,
        color: item.color,
        total_revenue: 0,
        total_quantity: 0,
        discounts_total: 0,
        cashback_used: 0,
        estimated_cost: 0,
        has_cost: false,
        stock_current: item.stock_qty_current,
        last_sale_date: item.sale_date,
        first_sale_date: item.sale_date,
        order_count: 0,
        sale_ids: new Set(),
        stores: new Set(),
        sale_dates: []
      });
    }
    const aggregate = map.get(key);
    aggregate.total_revenue += item.allocated_net_revenue;
    aggregate.total_quantity += item.quantity;
    aggregate.discounts_total += item.allocated_discount_amount;
    aggregate.cashback_used += item.allocated_cashback_used;
    if (item.cost_price !== null) {
      aggregate.estimated_cost += item.cost_price * item.quantity;
      aggregate.has_cost = true;
    }
    if (aggregate.stock_current === null || aggregate.stock_current === undefined) {
      aggregate.stock_current = item.stock_qty_current;
    } else if (!filters.store_id) {
      aggregate.stock_current = Math.max(aggregate.stock_current, item.stock_qty_current);
    }
    if (!aggregate.last_sale_date || (item.sale_date && item.sale_date > aggregate.last_sale_date)) {
      aggregate.last_sale_date = item.sale_date;
    }
    if (!aggregate.first_sale_date || (item.sale_date && item.sale_date < aggregate.first_sale_date)) {
      aggregate.first_sale_date = item.sale_date;
    }
    aggregate.sale_ids.add(item.sale_id);
    aggregate.stores.add(item.store_id);
    aggregate.sale_dates.push(item.sale_date);
  });
  return Array.from(map.values()).map((entry) => ({
    product_id: entry.product_id,
    inventory_id: entry.inventory_id,
    sku: entry.sku,
    codigo: entry.codigo,
    name: entry.name,
    brand: entry.brand,
    category: entry.category,
    size: entry.size,
    color: entry.color,
    total_revenue: roundMoney(entry.total_revenue),
    total_quantity: roundMoney(entry.total_quantity),
    discounts_total: roundMoney(entry.discounts_total),
    cashback_used: roundMoney(entry.cashback_used),
    estimated_cost: entry.has_cost ? roundMoney(entry.estimated_cost) : null,
    gross_margin_value: entry.has_cost ? roundMoney(entry.total_revenue - entry.estimated_cost) : null,
    gross_margin_percent: entry.has_cost && entry.total_revenue > 0
      ? roundMoney(((entry.total_revenue - entry.estimated_cost) / entry.total_revenue) * 100)
      : null,
    average_ticket_item: entry.total_quantity > 0 ? roundMoney(entry.total_revenue / entry.total_quantity) : 0,
    order_count: entry.sale_ids.size,
    stock_current: entry.stock_current,
    last_sale_date: entry.last_sale_date ? entry.last_sale_date.toISOString() : "",
    first_sale_date: entry.first_sale_date ? entry.first_sale_date.toISOString() : ""
  }));
}

function getPercentileMap(items, field) {
  const sorted = [...items].sort((a, b) => toNumber(b[field], 0) - toNumber(a[field], 0));
  const total = sorted.length;
  const map = new Map();
  sorted.forEach((item, index) => {
    const percentile = total <= 1 ? 1 : roundMoney(1 - (index / (total - 1)));
    map.set(item.sku || item.product_id || item.inventory_id || index, percentile);
  });
  return map;
}

function chooseSuggestedAction(curve) {
  switch (curve) {
    case "CURVA_A":
      return "Repor";
    case "CURVA_ISCA":
      return "Revisar margem";
    case "CURVA_LUXO":
      return "Segurar preco";
    case "CURVA_B":
      return "Ativar campanha";
    case "CURVA_PROBLEMA":
      return "Liquidar com cuidado";
    default:
      return "Monitorar";
  }
}

function classifyCurve(entry, globalContext, warnings) {
  const revenueTop20 = entry.revenue_rank_percentile >= 0.8;
  const volumeTop30 = entry.volume_rank_percentile >= 0.7;
  const marginPercent = entry.gross_margin_percent;
  const turnover = entry.estimated_days_to_turnover;
  const daysWithoutSale = entry.days_since_last_sale;
  const stockCurrent = toNumber(entry.stock_current, 0);
  const itemTicket = entry.average_ticket_item;
  const highTicket = itemTicket > (globalContext.general_item_ticket * 2);
  const mediumRevenue = entry.revenue_rank_percentile >= 0.35 && entry.revenue_rank_percentile < 0.8;
  const mediumOrLowVolume = entry.volume_rank_percentile <= 0.7;

  if (daysWithoutSale !== null && daysWithoutSale > 60 && stockCurrent > 5) {
    return {
      curve: "CURVA_PROBLEMA",
      curve_label: "Risco de encalhe",
      suggested_action: chooseSuggestedAction("CURVA_PROBLEMA"),
      reason: daysWithoutSale > 90
        ? "Produto parado ha mais de 90 dias com estoque acima de 5 unidades."
        : "Produto sem venda ha mais de 60 dias e estoque relevante."
    };
  }

  if (marginPercent !== null && volumeTop30 && marginPercent < 15) {
    return {
      curve: "CURVA_ISCA",
      curve_label: "Volume sem lucro",
      suggested_action: chooseSuggestedAction("CURVA_ISCA"),
      reason: "Alto volume no periodo com margem abaixo de 15%."
    };
  }

  if (marginPercent === null && volumeTop30) {
    warnings.push(`Produto ${entry.sku || entry.name} ficou sem teste de curva Isca por falta de margem.`);
  }

  if (revenueTop20) {
    if (marginPercent !== null && marginPercent <= 30) {
      warnings.push(`Produto ${entry.sku || entry.name} top faturamento sem margem acima de 30% para Curva A.`);
    }
    if ((marginPercent === null || marginPercent > 30) && (turnover === null || turnover < 45)) {
      return {
        curve: "CURVA_A",
        curve_label: "Sustenta o caixa",
        suggested_action: chooseSuggestedAction("CURVA_A"),
        reason: turnover === null
          ? "Top 20% de faturamento no periodo. Classificacao sem giro por falta de dados."
          : "Top 20% de faturamento com giro estimado abaixo de 45 dias."
      };
    }
  }

  if (highTicket && mediumOrLowVolume) {
    if (marginPercent !== null && marginPercent > 40) {
      return {
        curve: "CURVA_LUXO",
        curve_label: "Alto valor",
        suggested_action: chooseSuggestedAction("CURVA_LUXO"),
        reason: "Ticket do item acima de 2x a media e margem acima de 40%."
      };
    }
    if (marginPercent === null) {
      warnings.push(`Produto ${entry.sku || entry.name} tem alto ticket, mas sem margem para Curva Luxo plena.`);
    }
  }

  if (
    (marginPercent !== null && marginPercent > 25 && turnover !== null && turnover >= 45 && turnover <= 90)
    || (mediumRevenue && stockCurrent > 5)
  ) {
    return {
      curve: "CURVA_B",
      curve_label: "Potencial oculto",
      suggested_action: chooseSuggestedAction("CURVA_B"),
      reason: turnover !== null && marginPercent !== null
        ? "Margem acima de 25% com giro intermediario."
        : "Faturamento medio com estoque relevante para ativacao."
    };
  }

  return {
    curve: "CURVA_C",
    curve_label: "Neutros / observacao",
    suggested_action: chooseSuggestedAction("CURVA_C"),
    reason: "Produto sem sinal forte de caixa, risco ou oportunidade no periodo."
  };
}

function getDaysSince(date, now = new Date()) {
  const value = safeDate(date);
  if (!value) {
    return null;
  }
  return Math.max(0, Math.floor((startOfDay(now).getTime() - startOfDay(value).getTime()) / DAY_MS));
}

function buildCurveDataset(currentData, filters) {
  const warnings = [];
  const products = buildProductAggregates(currentData, filters);
  const totalQty = currentData.items.reduce((sum, item) => sum + item.quantity, 0);
  const generalItemTicket = totalQty > 0
    ? roundMoney(currentData.items.reduce((sum, item) => sum + item.allocated_net_revenue, 0) / totalQty)
    : 0;
  const revenuePercentiles = getPercentileMap(products, "total_revenue");
  const volumePercentiles = getPercentileMap(products, "total_quantity");
  const periodDays = Math.max(Math.round((filters.end.getTime() - filters.start.getTime()) / DAY_MS) + 1, 1);
  const rows = products.map((entry) => {
    const revenueRank = revenuePercentiles.get(entry.sku || entry.product_id || entry.inventory_id) || 0;
    const volumeRank = volumePercentiles.get(entry.sku || entry.product_id || entry.inventory_id) || 0;
    const dailyVelocity = periodDays > 0 ? entry.total_quantity / periodDays : 0;
    const estimatedDaysToTurnover = dailyVelocity > 0 && toNumber(entry.stock_current, 0) > 0
      ? roundMoney(toNumber(entry.stock_current, 0) / dailyVelocity)
      : null;
    const base = {
      ...entry,
      stock_current: entry.stock_current === null || entry.stock_current === undefined ? null : roundMoney(entry.stock_current),
      days_since_last_sale: getDaysSince(entry.last_sale_date),
      estimated_days_to_turnover: estimatedDaysToTurnover,
      revenue_rank_percentile: revenueRank,
      volume_rank_percentile: volumeRank
    };
    const curveInfo = classifyCurve(base, { general_item_ticket: generalItemTicket }, warnings);
    return {
      ...base,
      ...curveInfo
    };
  }).sort((a, b) => b.total_revenue - a.total_revenue);
  return { items: rows, warnings };
}

function groupMetrics(rows, keyGetter) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyGetter(row);
    if (!key) {
      return;
    }
    if (!map.has(key)) {
      map.set(key, {
        key,
        gross_revenue: 0,
        net_revenue: 0,
        discounts_total: 0,
        cashback_used: 0,
        estimated_cost: 0,
        has_cost: false,
        orders: new Set(),
        items_sold: 0
      });
    }
    const aggregate = map.get(key);
    aggregate.gross_revenue += row.line_total;
    aggregate.net_revenue += row.allocated_net_revenue;
    aggregate.discounts_total += row.allocated_discount_amount;
    aggregate.cashback_used += row.allocated_cashback_used;
    aggregate.items_sold += row.quantity;
    aggregate.orders.add(row.sale_id);
    if (row.cost_price !== null) {
      aggregate.estimated_cost += row.cost_price * row.quantity;
      aggregate.has_cost = true;
    }
  });
  return Array.from(map.values()).map((entry) => {
    const averageTicket = entry.orders.size > 0 ? roundMoney(entry.net_revenue / entry.orders.size) : 0;
    const marginValue = entry.has_cost ? roundMoney(entry.net_revenue - entry.estimated_cost) : null;
    const marginPercent = entry.has_cost && entry.net_revenue > 0 ? roundMoney((marginValue / entry.net_revenue) * 100) : null;
    return {
      key: entry.key,
      gross_revenue: roundMoney(entry.gross_revenue),
      net_revenue: roundMoney(entry.net_revenue),
      discounts_total: roundMoney(entry.discounts_total),
      cashback_used: roundMoney(entry.cashback_used),
      estimated_cost: entry.has_cost ? roundMoney(entry.estimated_cost) : null,
      estimated_margin_value: marginValue,
      estimated_margin_percent: marginPercent,
      orders_count: entry.orders.size,
      items_sold: roundMoney(entry.items_sold),
      average_ticket: averageTicket
    };
  });
}

function buildMarginDataset(currentData, previousData) {
  const currentByStore = groupMetrics(currentData.items, (item) => item.store_name || item.store_id || "Loja nao informada");
  const currentByBrand = groupMetrics(currentData.items, (item) => item.brand || "Marca nao informada");
  const currentByCategory = groupMetrics(currentData.items, (item) => item.category || "Categoria nao informada");
  const currentByVendor = groupMetrics(currentData.items, (item) => item.vendor_name || item.vendor_id || "Vendedor nao informado");

  const previousStore = new Map(groupMetrics(previousData.items, (item) => item.store_name || item.store_id || "Loja nao informada").map((row) => [row.key, row]));
  const previousBrand = new Map(groupMetrics(previousData.items, (item) => item.brand || "Marca nao informada").map((row) => [row.key, row]));
  const previousCategory = new Map(groupMetrics(previousData.items, (item) => item.category || "Categoria nao informada").map((row) => [row.key, row]));
  const previousVendor = new Map(groupMetrics(previousData.items, (item) => item.vendor_name || item.vendor_id || "Vendedor nao informado").map((row) => [row.key, row]));

  function attachDelta(rows, previousMap) {
    return rows.map((row) => ({
      ...row,
      delta_vs_previous_period: calculateDelta(row.net_revenue, previousMap.get(row.key)?.net_revenue || 0)
    })).sort((a, b) => b.net_revenue - a.net_revenue);
  }

  const stores = attachDelta(currentByStore, previousStore);
  const brands = attachDelta(currentByBrand, previousBrand);
  const categories = attachDelta(currentByCategory, previousCategory);
  const vendors = attachDelta(currentByVendor, previousVendor);

  const highlights = {
    loja_maior_margem: stores.filter((row) => row.estimated_margin_percent !== null).sort((a, b) => b.estimated_margin_percent - a.estimated_margin_percent)[0] || null,
    loja_menor_margem: stores.filter((row) => row.estimated_margin_percent !== null).sort((a, b) => a.estimated_margin_percent - b.estimated_margin_percent)[0] || null,
    marca_maior_faturamento: brands[0] || null,
    marca_margem_em_queda: brands.filter((row) => row.delta_vs_previous_period.delta_percent < -10)[0] || null,
    vendedor_maior_desconto_concedido: vendors.sort((a, b) => b.discounts_total - a.discounts_total)[0] || null,
    categoria_maior_cashback_usado: categories.sort((a, b) => b.cashback_used - a.cashback_used)[0] || null
  };

  return { stores, brands, categories, vendors, highlights };
}

function buildDecisionMap(curveData) {
  const groups = {
    comprar_mais: curveData.items.filter((item) => item.curve === "CURVA_A" && toNumber(item.stock_current, 0) < 5),
    vender_agora: curveData.items.filter((item) => item.curve === "CURVA_B" && toNumber(item.stock_current, 0) > 8),
    segurar_preco: curveData.items.filter((item) => item.curve === "CURVA_LUXO"),
    liquidar_com_cuidado: curveData.items.filter((item) => item.curve === "CURVA_PROBLEMA" && toNumber(item.stock_current, 0) > 5 && toNumber(item.days_since_last_sale, 0) > 90)
  };
  return {
    comprar_mais: {
      items: groups.comprar_mais.map(compactDecisionItem),
      empty_state: groups.comprar_mais.length ? "" : "Nao ha produtos neste grupo para o periodo selecionado."
    },
    vender_agora: {
      items: groups.vender_agora.map(compactDecisionItem),
      empty_state: groups.vender_agora.length ? "" : "Nao ha produtos neste grupo para o periodo selecionado."
    },
    segurar_preco: {
      items: groups.segurar_preco.map(compactDecisionItem),
      empty_state: groups.segurar_preco.length ? "" : "Nao ha produtos neste grupo para o periodo selecionado."
    },
    liquidar_com_cuidado: {
      items: groups.liquidar_com_cuidado.map(compactDecisionItem),
      empty_state: groups.liquidar_com_cuidado.length ? "" : "Nao ha produtos neste grupo para o periodo selecionado."
    }
  };
}

function compactDecisionItem(item) {
  return {
    product_id: item.product_id,
    sku: item.sku,
    name: item.name,
    brand: item.brand,
    category: item.category,
    stock_current: item.stock_current,
    curve: item.curve,
    reason: item.reason,
    suggested_action: item.suggested_action
  };
}

function buildTrendsDataset(currentData, previousData) {
  const currentProducts = buildProductAggregates(currentData, currentData.filters || {});
  const previousProducts = buildProductAggregates(previousData, previousData.filters || {});
  const previousMap = new Map(previousProducts.map((item) => [buildProductKey(item), item]));
  const currentMap = new Map(currentProducts.map((item) => [buildProductKey(item), item]));
  const keys = new Set([...currentMap.keys(), ...previousMap.keys()]);
  const items = [];
  keys.forEach((key) => {
    const current = currentMap.get(key) || null;
    const previous = previousMap.get(key) || null;
    const currentRevenue = roundMoney(current?.total_revenue || 0);
    const previousRevenue = roundMoney(previous?.total_revenue || 0);
    const currentQuantity = roundMoney(current?.total_quantity || 0);
    const previousQuantity = roundMoney(previous?.total_quantity || 0);
    const deltaRevenue = previousRevenue > 0 ? roundMoney(((currentRevenue - previousRevenue) / previousRevenue) * 100) : (currentRevenue > 0 ? 100 : 0);
    const deltaQuantity = previousQuantity > 0 ? roundMoney(((currentQuantity - previousQuantity) / previousQuantity) * 100) : (currentQuantity > 0 ? 100 : 0);
    let trend = "stable";
    if (previousRevenue <= 5 && currentRevenue >= 20) {
      trend = "recovering";
    } else if (deltaRevenue > 15) {
      trend = "rising";
    } else if (deltaRevenue < -40) {
      trend = "accelerated_drop";
    } else if (deltaRevenue <= -15) {
      trend = "falling";
    } else if (!previous && !current) {
      trend = "insufficient_data";
    }
    const base = current || previous;
    items.push({
      product_id: base?.product_id || "",
      sku: base?.sku || "",
      name: base?.name || "",
      current_revenue: currentRevenue,
      previous_revenue: previousRevenue,
      current_quantity: currentQuantity,
      previous_quantity: previousQuantity,
      delta_revenue_percent: deltaRevenue,
      delta_quantity_percent: deltaQuantity,
      trend
    });
  });
  const byCategory = summarizeTrendDimension(items, currentProducts, previousProducts, "category");
  const byBrand = summarizeTrendDimension(items, currentProducts, previousProducts, "brand");
  return {
    items: items.sort((a, b) => b.current_revenue - a.current_revenue),
    alerts: {
      produtos_em_queda_acelerada: items.filter((item) => item.trend === "accelerated_drop").slice(0, 10),
      produtos_subindo: items.filter((item) => item.trend === "rising").slice(0, 10),
      produtos_recuperando: items.filter((item) => item.trend === "recovering").slice(0, 10),
      categorias_em_alta: byCategory.filter((item) => item.delta_percent > 15).slice(0, 10),
      marcas_em_queda: byBrand.filter((item) => item.delta_percent < -15).slice(0, 10)
    }
  };
}

function summarizeTrendDimension(itemTrends, currentProducts, previousProducts, field) {
  const currentMap = new Map();
  const previousMap = new Map();
  currentProducts.forEach((product) => {
    const key = product[field] || `${field} nao informado`;
    currentMap.set(key, roundMoney((currentMap.get(key) || 0) + product.total_revenue));
  });
  previousProducts.forEach((product) => {
    const key = product[field] || `${field} nao informado`;
    previousMap.set(key, roundMoney((previousMap.get(key) || 0) + product.total_revenue));
  });
  return Array.from(new Set([...currentMap.keys(), ...previousMap.keys()])).map((key) => {
    const current = currentMap.get(key) || 0;
    const previous = previousMap.get(key) || 0;
    const delta = previous > 0 ? roundMoney(((current - previous) / previous) * 100) : (current > 0 ? 100 : 0);
    return {
      key,
      current_revenue: current,
      previous_revenue: previous,
      delta_percent: delta
    };
  }).sort((a, b) => b.delta_percent - a.delta_percent);
}

function buildCockpitContext(filtersInput = {}) {
  const filters = filtersInput.start ? filtersInput : normalizeCockpitFilters(filtersInput);
  const datasets = loadCockpitDatasets();
  const inventoryIndexes = buildInventoryIndexes(datasets.inventory);
  const currentData = buildPeriodDataset(datasets.sales, filters, filters.start, filters.end, inventoryIndexes);
  const previousData = buildPeriodDataset(datasets.sales, filters, filters.previousStart, filters.previousEnd, inventoryIndexes);
  currentData.filters = filters;
  previousData.filters = filters;
  const warnings = buildWarnings([], currentData, previousData);
  return { filters, datasets, inventoryIndexes, currentData, previousData, warnings };
}

function buildCockpitSummary(filtersInput = {}) {
  const context = buildCockpitContext(filtersInput);
  const current = aggregateSalesMetrics(context.currentData);
  const previous = aggregateSalesMetrics(context.previousData);
  return {
    filters: serializeFilters(context.filters),
    warnings: uniqueWarnings(context.warnings),
    metrics: {
      gross_revenue: calculateDelta(current.gross_revenue, previous.gross_revenue),
      net_revenue: calculateDelta(current.net_revenue, previous.net_revenue),
      discounts_total: calculateDelta(current.discounts_total, previous.discounts_total),
      cashback_used: calculateDelta(current.cashback_used, previous.cashback_used),
      items_sold: calculateDelta(current.items_sold, previous.items_sold),
      orders_count: calculateDelta(current.orders_count, previous.orders_count),
      average_ticket: calculateDelta(current.average_ticket, previous.average_ticket),
      estimated_gross_margin: current.estimated_gross_margin === null && previous.estimated_gross_margin === null
        ? null
        : calculateDelta(current.estimated_gross_margin || 0, previous.estimated_gross_margin || 0),
      estimated_margin_percent: current.estimated_margin_percent === null && previous.estimated_margin_percent === null
        ? null
        : calculateDelta(current.estimated_margin_percent || 0, previous.estimated_margin_percent || 0)
    }
  };
}

function buildCockpitCurve(filtersInput = {}) {
  const context = buildCockpitContext(filtersInput);
  const curveData = buildCurveDataset(context.currentData, context.filters);
  return {
    filters: serializeFilters(context.filters),
    warnings: uniqueWarnings(context.warnings.concat(curveData.warnings)),
    items: curveData.items
  };
}

function buildCockpitMargin(filtersInput = {}) {
  const context = buildCockpitContext(filtersInput);
  const payload = buildMarginDataset(context.currentData, context.previousData);
  if (!context.currentData.items.some((item) => item.cost_price !== null)) {
    context.warnings.push("Custo ausente para calculo real de margem.");
  }
  return {
    filters: serializeFilters(context.filters),
    warnings: uniqueWarnings(context.warnings),
    ...payload
  };
}

function buildCockpitDecisionMap(filtersInput = {}) {
  const context = buildCockpitContext(filtersInput);
  const curveData = buildCurveDataset(context.currentData, context.filters);
  return {
    filters: serializeFilters(context.filters),
    warnings: uniqueWarnings(context.warnings.concat(curveData.warnings)),
    groups: buildDecisionMap(curveData)
  };
}

function buildCockpitTrends(filtersInput = {}) {
  const context = buildCockpitContext(filtersInput);
  const payload = buildTrendsDataset(context.currentData, context.previousData);
  return {
    filters: serializeFilters(context.filters),
    warnings: uniqueWarnings(context.warnings),
    ...payload
  };
}

function buildCockpitAiContext(filtersInput = {}) {
  const filters = filtersInput.start ? filtersInput : normalizeCockpitFilters(filtersInput);
  const summary = buildCockpitSummary(filters);
  const curve = buildCockpitCurve(filters);
  const margin = buildCockpitMargin(filters);
  const decisionMap = buildCockpitDecisionMap(filters);
  const trends = buildCockpitTrends(filters);
  return {
    filters_applied: serializeFilters(filters),
    summary,
    top_curves: {
      curva_a: curve.items.filter((item) => item.curve === "CURVA_A").slice(0, 10),
      curva_isca: curve.items.filter((item) => item.curve === "CURVA_ISCA").slice(0, 10),
      curva_luxo: curve.items.filter((item) => item.curve === "CURVA_LUXO").slice(0, 10),
      curva_b: curve.items.filter((item) => item.curve === "CURVA_B").slice(0, 10),
      curva_problema: curve.items.filter((item) => item.curve === "CURVA_PROBLEMA").slice(0, 10)
    },
    margin_highlights: margin.highlights,
    decision_map: decisionMap.groups,
    trends: trends.alerts,
    warnings: uniqueWarnings([
      ...(summary.warnings || []),
      ...(curve.warnings || []),
      ...(margin.warnings || []),
      ...(decisionMap.warnings || []),
      ...(trends.warnings || [])
    ])
  };
}

function serializeFilters(filters) {
  return {
    period: filters.period,
    start_date: filters.start_date,
    end_date: filters.end_date,
    previous_start_date: filters.previous_start_date,
    previous_end_date: filters.previous_end_date,
    store_id: filters.store_id,
    brand: filters.brand,
    category: filters.category,
    vendor_id: filters.vendor_id,
    product_search: filters.product_search
  };
}

function uniqueWarnings(list = []) {
  return Array.from(new Set(list.filter(Boolean)));
}

module.exports = {
  DEFAULT_PERIOD,
  normalizeCockpitFilters,
  buildCockpitSummary,
  buildCockpitCurve,
  buildCockpitMargin,
  buildCockpitDecisionMap,
  buildCockpitTrends,
  buildCockpitAiContext
};
