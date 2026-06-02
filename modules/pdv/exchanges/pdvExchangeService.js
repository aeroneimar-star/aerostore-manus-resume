"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  createExchange,
  getSalesSummary,
  listPdvSalesOrders,
  getPdvSalesOrderDetail,
  getSaleById,
  canAccessSale
} = require("../sales/pdvSalesService");
const {
  validateStockAvailability,
  applySaleInventory,
  applyExchangeInboundItem
} = require("../inventory/pdvInventoryService");
const {
  getOpenCashRegisterByStore,
  registerCashMovement,
  appendAuditLog,
  getPdvUserRole
} = require("../services/pdvControlService");
const {
  createExchangeCredit: createExchangeCreditRecord,
  createManualExchangeCredit: createManualExchangeCreditRecord,
  listActiveExchangeCreditsForCustomer,
  cancelManualExchangeCredit: cancelManualExchangeCreditRecord,
  buildExchangeSourceKey
} = require("./pdvExchangeCreditService");
const { normalizeStoreKey, formatStoreLabel } = require("../utils/pdvStoreUtils");

const exchangesRootDir = path.join(process.cwd(), "data", "pdv", "sales");
const exchangesFilePath = path.join(exchangesRootDir, "exchanges.json");
const exchangeCreditsFilePath = path.join(exchangesRootDir, "exchange-credits.json");

function ensureExchangeDirs() {
  fs.mkdirSync(exchangesRootDir, { recursive: true });
  if (!fs.existsSync(exchangesFilePath)) {
    fs.writeFileSync(exchangesFilePath, "[]", "utf8");
  }
  if (!fs.existsSync(exchangeCreditsFilePath)) {
    fs.writeFileSync(exchangeCreditsFilePath, "[]", "utf8");
  }
}

function readJson(filePath, fallback = []) {
  ensureExchangeDirs();
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureExchangeDirs();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function loadExchanges() {
  return readJson(exchangesFilePath, []);
}

function saveExchanges(rows = []) {
  writeJson(exchangesFilePath, Array.isArray(rows) ? rows : []);
}

function loadExchangeCredits() {
  return readJson(exchangeCreditsFilePath, []);
}

function saveExchangeCredits(rows = []) {
  writeJson(exchangeCreditsFilePath, Array.isArray(rows) ? rows : []);
}

function buildId(prefix = "EXC") {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const normalized = String(value ?? "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value = 0) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function normalizeQuantity(value = 1) {
  const parsed = Number(value);
  return Math.max(1, Number.isFinite(parsed) ? Math.round(parsed * 1000) / 1000 : 1);
}

function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getActorName(user = {}) {
  return normalizeText(user?.name || user?.email || "sistema");
}

function maskPhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? `********${digits.slice(-4)}` : "";
}

function getUserAllowedStores(user = {}) {
  const rawStores = Array.isArray(user?.allowed_stores)
    ? user.allowed_stores
    : (typeof user?.allowed_stores === "string" ? user.allowed_stores.split(",") : []);
  return [...rawStores, user?.store_id, user?.store]
    .map((item) => normalizeStoreKey(item || ""))
    .filter(Boolean);
}

function ensureManualExchangeCreditPermission(user = {}, storeId = "") {
  const role = getPdvUserRole(user);
  const store = normalizeStoreKey(storeId || "");
  if (!store) {
    throw createHttpError("Informe a loja do Credito de Troca manual.");
  }
  if (!["ADMIN", "GERENTE"].includes(role)) {
    throw createHttpError("Apenas gestor ou admin pode criar Credito de Troca manual.", 403);
  }
  if (role === "ADMIN" || user?.permissions?.can_view_all_stores) {
    return true;
  }
  const allowedStores = getUserAllowedStores(user);
  if (!allowedStores.length || !allowedStores.includes(store)) {
    throw createHttpError("Loja fora do escopo do gestor para Credito de Troca manual.", 403);
  }
  return true;
}

function getSaleCustomer(sale = {}) {
  const customer = sale.customer || {};
  return {
    customer_id: normalizeText(customer.master_customer_id || customer.customer_id || customer.id || sale.customer_id || ""),
    name: normalizeText(customer.name || sale.customer_name || sale.cliente || ""),
    phone: normalizeText(customer.phone || sale.customer_phone || sale.telefone || ""),
    document: normalizeText(customer.document || customer.cpf || customer.cnpj || sale.customer_document || "")
  };
}

function normalizeExchangeCustomer(payload = {}) {
  const customerId = normalizeText(
    payload.exchange_customer_id
    || payload.receiver_customer_id
    || payload.customer_id
    || payload.master_customer_id
    || payload.id
    || ""
  );
  const name = normalizeText(payload.name || payload.nome || payload.customer_name || "");
  const phone = normalizeText(payload.phone || payload.telefone || payload.customer_phone || "");
  const document = normalizeText(payload.document || payload.cpf || payload.cnpj || "");
  return {
    exchange_customer_id: customerId,
    customer_id: customerId,
    name,
    phone,
    document,
    origin: normalizeText(payload.origin || payload.origin_label || "")
  };
}

function getSaleStoreId(sale = {}) {
  return normalizeStoreKey(sale.loja || sale.loja_venda || sale.store_id || sale.store_context?.store_id || "");
}

function getSaleSellerName(sale = {}) {
  return normalizeText(sale.vendedor_nome || sale.seller_name || sale.vendedor || sale.seller_id || "");
}

function getSaleTotal(sale = {}) {
  return roundMoney(sale.total_final || sale.total || sale.valor_total || 0);
}

function getSaleSubtotal(sale = {}) {
  const itemsTotal = (Array.isArray(sale.items) ? sale.items : []).reduce((sum, item) => {
    return sum + getSaleItemGrossValue(item);
  }, 0);
  return roundMoney(sale.subtotal || sale.gross_amount || itemsTotal || getSaleTotal(sale));
}

function getSaleItemId(item = {}, index = 0) {
  return normalizeText(
    item.item_id
    || item.cart_item_id
    || item.id
    || item.selected_inventory_id
    || item.inventory_id
    || item.product_id
    || item.sku
    || item.codigo
    || `item_${index + 1}`
  );
}

function getSaleItemQuantity(item = {}) {
  return normalizeQuantity(item.quantidade || item.quantity || item.qty || 1);
}

function getSaleItemUnitValue(item = {}) {
  return roundMoney(
    item.valor_unitario_pago
    || item.preco_pago_unitario
    || item.preco_unitario
    || item.unit_price
    || item.preco_referencia
    || item.price
    || item.preco_venda
    || item.valor
    || 0
  );
}

function getSaleItemGrossValue(item = {}) {
  const qty = getSaleItemQuantity(item);
  return roundMoney(item.total_item || item.total || item.valor_total || getSaleItemUnitValue(item) * qty);
}

function getProratedPaidUnitValue(sale = {}, item = {}) {
  const gross = getSaleItemGrossValue(item);
  const qty = getSaleItemQuantity(item);
  const subtotal = getSaleSubtotal(sale);
  const total = getSaleTotal(sale);
  if (subtotal > 0 && total >= 0) {
    return roundMoney((gross * Math.min(1, total / subtotal)) / qty);
  }
  return roundMoney(gross / qty);
}

function normalizeExchangeItemIdentity(item = {}) {
  return {
    availableIndex: normalizeText(item.available_index ?? item.selection_index ?? ""),
    sourceItemKey: normalizeText(item.source_item_key || ""),
    lineIndex: normalizeText(item.sale_line_index ?? item.line_index ?? ""),
    itemIds: [
      item.item_id,
      item.original_item_id,
      item.cart_item_id,
      item.id
    ].map((value) => normalizeText(value)).filter(Boolean),
    inventoryId: normalizeText(item.inventory_id || item.selected_inventory_id || ""),
    productId: normalizeText(item.product_id || item.selected_product_id || ""),
    sku: normalizeText(item.sku || item.selected_sku || item.codigo || item.selected_codigo || ""),
    codigo: normalizeText(item.codigo || item.selected_codigo || ""),
    cor: normalizeText(item.cor || item.color || ""),
    tamanho: normalizeText(item.tamanho || item.size || ""),
    nome: normalizeText(item.nome || item.selected_nome || item.name || "")
  };
}

function hasExchangeLineScopedIdentity(identity = {}) {
  if (identity.availableIndex || identity.sourceItemKey || identity.lineIndex) {
    return true;
  }
  return identity.itemIds.some((id) => /^(ITEM|LINE|SALEITEM|CART)[_-]/i.test(id) || /::line_\d+$/i.test(id));
}

function exchangeItemsMatch(a = {}, b = {}) {
  const left = normalizeExchangeItemIdentity(a);
  const right = normalizeExchangeItemIdentity(b);
  if (left.availableIndex && right.availableIndex) {
    return left.availableIndex === right.availableIndex;
  }
  if (left.lineIndex && right.lineIndex && left.lineIndex !== right.lineIndex) {
    return false;
  }
  if (left.sourceItemKey && right.sourceItemKey) {
    return left.sourceItemKey === right.sourceItemKey;
  }
  if (left.itemIds.length && right.itemIds.length && left.itemIds.some((id) => right.itemIds.includes(id))) {
    return true;
  }
  if (left.lineIndex && right.lineIndex && left.lineIndex === right.lineIndex) {
    return true;
  }
  if (left.itemIds.length && right.itemIds.length && hasExchangeLineScopedIdentity(left) && hasExchangeLineScopedIdentity(right)) {
    return false;
  }
  if (left.inventoryId && right.inventoryId && left.inventoryId === right.inventoryId) {
    return true;
  }
  const sameSku = Boolean(left.sku && right.sku && left.sku === right.sku);
  const sameProduct = Boolean(left.productId && right.productId && left.productId === right.productId);
  const sameCode = Boolean(left.codigo && right.codigo && left.codigo === right.codigo);
  if (!sameSku && !sameProduct && !sameCode) {
    return false;
  }
  const sameColor = !left.cor || !right.cor || left.cor === right.cor;
  const sameSize = !left.tamanho || !right.tamanho || left.tamanho === right.tamanho;
  return sameColor && sameSize;
}

function getExchangeReturnedItems(exchange = {}) {
  if (Array.isArray(exchange.returned_items)) {
    return exchange.returned_items.filter(Boolean);
  }
  return exchange.returned_item ? [exchange.returned_item] : [];
}

function syncExchangeReturnedItemCompatibility(exchange = {}) {
  const returnedItems = getExchangeReturnedItems(exchange);
  exchange.returned_items = returnedItems;
  exchange.returned_item = returnedItems[0] || null;
  return exchange;
}

function getFinalizedReturnedEntries(originalSaleId = "", options = {}) {
  const saleId = normalizeText(originalSaleId);
  const excludeExchangeId = normalizeText(options.excludeExchangeId || "");
  return loadExchanges()
    .filter((exchange) => normalizeText(exchange.original_sale_id || exchange.origin_sale_id || "") === saleId)
    .filter((exchange) => normalizeText(exchange.exchange_id || "") !== excludeExchangeId)
    .filter((exchange) => normalizeText(exchange.status || "").toLowerCase() === "finalizada")
    .flatMap((exchange) => getExchangeReturnedItems(exchange).map((returnedItem) => ({ exchange, returnedItem })))
    .filter(({ returnedItem }) => returnedItem);
}

function buildReturnedExchangeReference(entry = {}, quantity = 1) {
  return {
    exchange_id: normalizeText(entry.exchange?.exchange_id || ""),
    finalized_at: normalizeText(entry.exchange?.finalized_at || ""),
    credit_id: normalizeText(entry.exchange?.credit_id || ""),
    credit_generated: roundMoney(entry.returnedItem?.exchange_value || 0),
    quantity: roundMoney(quantity || 0)
  };
}

function getExchangeItemMatchScore(saleItem = {}, returnedItem = {}) {
  const left = normalizeExchangeItemIdentity(saleItem);
  const right = normalizeExchangeItemIdentity(returnedItem);
  if (left.availableIndex && right.availableIndex) {
    return left.availableIndex === right.availableIndex ? 110 : -1;
  }
  if (left.lineIndex && right.lineIndex) {
    return left.lineIndex === right.lineIndex ? 100 : -1;
  }
  if (left.sourceItemKey && right.sourceItemKey && left.sourceItemKey === right.sourceItemKey) {
    return 90;
  }
  if (left.itemIds.length && right.itemIds.length && left.itemIds.some((id) => right.itemIds.includes(id))) {
    return hasExchangeLineScopedIdentity(left) || hasExchangeLineScopedIdentity(right) ? 80 : 60;
  }
  if (left.inventoryId && right.inventoryId && left.inventoryId === right.inventoryId) {
    return 50;
  }
  if (exchangeItemsMatch(saleItem, returnedItem)) {
    return 10;
  }
  return -1;
}

function buildFinalizedReturnedAllocationMap(originalSaleId = "", saleItems = [], options = {}) {
  const summaries = new Map();
  const capacities = new Map();
  const normalizedSaleItems = (Array.isArray(saleItems) ? saleItems : []).map((item, index) => ({
    ...item,
    sale_line_index: item.sale_line_index ?? item.line_index ?? index,
    line_index: item.line_index ?? item.sale_line_index ?? index
  }));
  normalizedSaleItems.forEach((item, index) => {
    summaries.set(index, { quantity: 0, references: [] });
    capacities.set(index, normalizeQuantity(item.quantity_purchased || item.quantity || 1));
  });
  getFinalizedReturnedEntries(originalSaleId, options).forEach((entry) => {
    let remaining = normalizeQuantity(entry.returnedItem?.quantity || entry.returnedItem?.quantidade || 1);
    const candidates = normalizedSaleItems
      .map((item, index) => ({ item, index, score: getExchangeItemMatchScore(item, entry.returnedItem) }))
      .filter((candidate) => candidate.score >= 0)
      .sort((left, right) => right.score - left.score || left.index - right.index);
    candidates.forEach((candidate) => {
      if (remaining <= 0) return;
      const summary = summaries.get(candidate.index);
      const capacity = capacities.get(candidate.index) || 0;
      const available = Math.max(0, capacity - toNumber(summary.quantity || 0));
      if (available <= 0) return;
      const allocated = Math.min(remaining, available);
      summary.quantity = roundMoney(toNumber(summary.quantity || 0) + allocated);
      summary.references.push(buildReturnedExchangeReference(entry, allocated));
      remaining = roundMoney(remaining - allocated);
    });
  });
  return summaries;
}

function getSaleItemSelectionIndex(saleItems = [], saleItem = {}) {
  const targetIdentity = normalizeExchangeItemIdentity(saleItem);
  const normalizedSaleItems = (Array.isArray(saleItems) ? saleItems : []).map((item, index) => ({
    ...item,
    sale_line_index: item.sale_line_index ?? item.line_index ?? index,
    line_index: item.line_index ?? item.sale_line_index ?? index
  }));
  if (targetIdentity.lineIndex) {
    const exactLineIndex = normalizedSaleItems.findIndex((item) => normalizeText(item.sale_line_index ?? item.line_index ?? "") === targetIdentity.lineIndex);
    if (exactLineIndex >= 0) return exactLineIndex;
  }
  if (targetIdentity.sourceItemKey) {
    const exactSourceIndex = normalizedSaleItems.findIndex((item) => normalizeText(item.source_item_key || "") === targetIdentity.sourceItemKey);
    if (exactSourceIndex >= 0) return exactSourceIndex;
  }
  return normalizedSaleItems.findIndex((item) => exchangeItemsMatch(item, saleItem));
}

function buildExchangeSaleBaseItems(sale = {}) {
  return (Array.isArray(sale.items) ? sale.items : []).map((item, index) => {
    const quantity = getSaleItemQuantity(item);
    const unitValue = getProratedPaidUnitValue(sale, item);
    const exchangeItem = {
      item_id: getSaleItemId(item, index),
      available_index: index,
      selection_index: index,
      sale_line_index: index,
      line_index: index,
      original_item_id: normalizeText(item.item_id || ""),
      inventory_id: normalizeText(item.inventory_id || item.selected_inventory_id || ""),
      product_id: normalizeText(item.product_id || item.selected_product_id || ""),
      sku: normalizeText(item.sku || item.selected_sku || item.codigo || ""),
      codigo: normalizeText(item.codigo || item.selected_codigo || ""),
      nome: normalizeText(item.nome || item.selected_nome || item.name || ""),
      marca: normalizeText(item.marca || item.brand || ""),
      categoria: normalizeText(item.categoria || item.category || ""),
      cor: normalizeText(item.cor || item.color || ""),
      tamanho: normalizeText(item.tamanho || item.size || ""),
      quantity_purchased: quantity,
      quantity,
      unit_value: unitValue,
      store_id: normalizeStoreKey(item.loja_venda || sale.loja_venda || sale.loja || item.store_id || ""),
      stock_source_store_id: normalizeStoreKey(item.loja_origem_estoque || item.stock_source_store_id || item.selected_loja || item.store_id || sale.loja || "")
    };
    exchangeItem.source_item_key = buildExchangeSourceKey({
      original_sale_id: sale.sale_id || sale.id || "",
      returned_item: exchangeItem
    });
    return exchangeItem;
  });
}

function getFinalizedReturnedInfo(originalSaleId = "", saleItem = {}, options = {}) {
  const saleId = normalizeText(originalSaleId);
  const sale = getSaleById(saleId);
  if (sale) {
    const saleItems = buildExchangeSaleBaseItems(sale);
    const index = getSaleItemSelectionIndex(saleItems, saleItem);
    if (index >= 0) {
      return buildFinalizedReturnedAllocationMap(saleId, saleItems, options).get(index) || { quantity: 0, references: [] };
    }
  }
  const matches = getFinalizedReturnedEntries(saleId, options)
    .filter(({ returnedItem }) => returnedItem && exchangeItemsMatch(saleItem, returnedItem));
  return matches.reduce((summary, match) => {
    const quantity = normalizeQuantity(match.returnedItem?.quantity || match.returnedItem?.quantidade || 1);
    summary.quantity += quantity;
    summary.references.push({
      exchange_id: normalizeText(match.exchange?.exchange_id || ""),
      finalized_at: normalizeText(match.exchange?.finalized_at || ""),
      credit_id: normalizeText(match.exchange?.credit_id || ""),
      credit_generated: roundMoney(match.returnedItem?.exchange_value || 0)
    });
    return summary;
  }, { quantity: 0, references: [] });
}

function summarizeSaleForExchange(sale = {}, row = {}) {
  const customer = getSaleCustomer(sale);
  const storeId = getSaleStoreId(sale);
  return {
    sale_id: normalizeText(sale.sale_id || row.sale_id || ""),
    created_at: normalizeText(sale.created_at || row.created_at || ""),
    customer_name: customer.name || normalizeText(row.customer_name || ""),
    customer_phone: customer.phone || normalizeText(row.customer_phone || ""),
    store_id: storeId,
    store_label: normalizeText(sale.store_label || row.store_label || formatStoreLabel(storeId)),
    seller_name: getSaleSellerName(sale) || normalizeText(row.seller_name || ""),
    total: getSaleTotal(sale) || roundMoney(row.total || 0),
    item_count: Array.isArray(sale.items) ? sale.items.length : toNumber(row.item_count || 0),
    status: normalizeText(sale.status || row.status || "")
  };
}

function buildExchangeSaleItems(sale = {}, options = {}) {
  const saleId = sale.sale_id || sale.id || "";
  const baseItems = buildExchangeSaleBaseItems(sale);
  const returnedAllocations = buildFinalizedReturnedAllocationMap(saleId, baseItems, options);
  return baseItems.map((item, index) => {
    const quantity = normalizeQuantity(item.quantity_purchased || item.quantity || 1);
    const unitValue = roundMoney(item.unit_value || 0);
    const returnedInfo = returnedAllocations.get(index) || { quantity: 0, references: [] };
    const quantityExchanged = Math.min(quantity, Math.max(0, toNumber(returnedInfo.quantity || 0)));
    const quantityAvailable = Math.max(0, roundMoney(quantity - quantityExchanged));
    const exchangeItem = {
      ...item,
      item_id: getSaleItemId(item, index),
      quantity_purchased: quantity,
      quantity_exchanged: quantityExchanged,
      quantity_available: quantityAvailable,
      quantity,
      unit_value: unitValue,
      exchange_value: roundMoney(unitValue * quantityAvailable),
      previous_exchanges: returnedInfo.references,
      blocked_reason: quantityAvailable <= 0 ? "Item ja gerou Credito de Troca em uma troca finalizada." : "",
      status: quantityAvailable > 0 ? "elegivel" : "ja_trocado"
    };
    const previousExchange = returnedInfo.references[0] || {};
    exchangeItem.exchange_eligibility = {
      eligible: quantityAvailable > 0,
      reason: quantityAvailable > 0 ? "available" : "already_exchanged",
      purchased_quantity: quantity,
      exchanged_quantity: quantityExchanged,
      remaining_quantity: quantityAvailable,
      previous_exchange_id: previousExchange.exchange_id || "",
      previous_credit_id: previousExchange.credit_id || "",
      previous_credit_amount: roundMoney(previousExchange.credit_generated || 0),
      previous_exchange_at: previousExchange.finalized_at || ""
    };
    return exchangeItem;
  });
}

function summarizeExchangeHistoryForSale(items = []) {
  const summary = (Array.isArray(items) ? items : []).reduce((acc, item) => {
    acc.total_items_count += toNumber(item.quantity_purchased || item.quantity || 0);
    acc.exchanged_items_count += toNumber(item.quantity_exchanged || 0);
    acc.remaining_items_count += toNumber(item.quantity_available || 0);
    return acc;
  }, {
    has_exchange_history: false,
    exchanged_items_count: 0,
    total_items_count: 0,
    remaining_items_count: 0,
    exchange_state: "none"
  });
  summary.total_items_count = roundMoney(summary.total_items_count);
  summary.exchanged_items_count = roundMoney(summary.exchanged_items_count);
  summary.remaining_items_count = roundMoney(summary.remaining_items_count);
  summary.has_exchange_history = summary.exchanged_items_count > 0;
  if (summary.has_exchange_history && summary.remaining_items_count <= 0 && summary.total_items_count > 0) {
    summary.exchange_state = "full";
  } else if (summary.has_exchange_history) {
    summary.exchange_state = "partial";
  }
  return summary;
}

function calculateExchangeTotals(exchange = {}) {
  const returnedItems = getExchangeReturnedItems(exchange);
  const originalValue = roundMoney(returnedItems.reduce((sum, item) => sum + roundMoney(item.exchange_value || 0), 0));
  const newItems = getExchangeNewItems(exchange);
  const newValue = roundMoney(newItems.reduce((sum, item) => sum + roundMoney(item.exchange_value || item.total || 0), 0));
  return {
    original_value: originalValue,
    returned_total: originalValue,
    new_value: newValue,
    new_items_total: newValue,
    difference_due: 0,
    credit_generated: originalValue
  };
}

function applyExchangeTotals(exchange = {}) {
  if (exchange.status === "finalizada") {
    return exchange;
  }
  syncExchangeReturnedItemCompatibility(exchange);
  const totals = calculateExchangeTotals(exchange);
  exchange.original_value = totals.original_value;
  exchange.returned_total = totals.returned_total;
  exchange.new_value = totals.new_value;
  exchange.new_items_total = totals.new_items_total;
  exchange.difference_due = totals.difference_due;
  exchange.credit_generated = totals.credit_generated;
  if (!getExchangeReturnedItems(exchange).length) {
    exchange.status = "aguardando_item_devolvido";
  } else if (!exchange.exchange_customer?.name || !exchange.exchange_customer?.phone) {
    exchange.status = "aguardando_cliente_favorecido";
  } else if (!exchange.reason || !exchange.returned_condition) {
    exchange.status = "aguardando_motivo_condicao";
  } else if (totals.difference_due > 0) {
    exchange.status = "aguardando_pagamento_diferenca";
  } else {
    exchange.status = "pronta_para_gerar_credito";
  }
  return exchange;
}

function getExchangeNewItems(exchange = {}) {
  if (Array.isArray(exchange.new_items)) {
    return exchange.new_items.filter(Boolean);
  }
  if (exchange.new_item) {
    return [exchange.new_item];
  }
  return [];
}

function syncExchangeNewItemCompatibility(exchange = {}) {
  const newItems = getExchangeNewItems(exchange);
  exchange.new_items = newItems;
  exchange.new_item = newItems[0] || null;
  return exchange;
}

function getExchangeScoped(exchangeId = "", user = {}) {
  const exchange = loadExchanges().find((item) => normalizeText(item.exchange_id) === normalizeText(exchangeId));
  if (!exchange) {
    throw createHttpError("Troca nao encontrada.", 404);
  }
  const sale = getSaleById(exchange.original_sale_id || exchange.origin_sale_id || "");
  if (sale && !canAccessSale(sale, user)) {
    throw createHttpError("Voce nao tem permissao para acessar esta troca.", 403);
  }
  if (!sale && !canAccessExchangeByStore(exchange, user)) {
    throw createHttpError("Voce nao tem permissao para acessar esta troca.", 403);
  }
  return { exchange, sale };
}

function canAccessExchangeByStore(exchange = {}, user = {}) {
  if (user?.permissions?.can_view_all_stores) {
    return true;
  }
  const storeId = normalizeStoreKey(exchange.store_id || exchange.origin_store || exchange.original_sale_summary?.store_id || "");
  if (!storeId) {
    return false;
  }
  const allowedStores = Array.isArray(user?.allowed_stores)
    ? user.allowed_stores.map((item) => normalizeStoreKey(item)).filter(Boolean)
    : [];
  return !allowedStores.length || allowedStores.includes(storeId);
}

function saveExchangeUpdate(exchangeId = "", updater) {
  const rows = loadExchanges();
  const index = rows.findIndex((item) => normalizeText(item.exchange_id) === normalizeText(exchangeId));
  if (index < 0) {
    throw createHttpError("Troca nao encontrada.", 404);
  }
  const updated = updater({ ...rows[index] });
  updated.updated_at = nowIso();
  rows[index] = updated;
  saveExchanges(rows);
  return updated;
}

function searchExchangeOrigins(query = "", user = {}) {
  const q = normalizeText(query);
  if (q.length < 2) {
    return { items: [] };
  }
  const result = listPdvSalesOrders({ search: q, page_size: 12, page: 1, status: "all" }, user);
  return {
    items: (Array.isArray(result.rows) ? result.rows : []).map((row) => {
      const sale = getSaleById(row.sale_id || "");
      const saleItems = Array.isArray(sale?.items) ? sale.items : [];
      const exchangeItems = buildExchangeSaleItems(sale || {});
      const exchangeSummary = summarizeExchangeHistoryForSale(exchangeItems);
      return {
        sale_id: normalizeText(row.sale_id || ""),
        created_at: normalizeText(row.created_at || ""),
        customer_name: normalizeText(row.customer_name || ""),
        customer_phone: normalizeText(row.customer_phone || ""),
        store_id: normalizeStoreKey(row.store_id || sale?.store_id || sale?.loja || ""),
        store_label: normalizeText(row.store_label || sale?.store_label || formatStoreLabel(row.store_id || sale?.loja || "")),
        seller_name: normalizeText(row.seller_name || getSaleSellerName(sale || {})),
        total: roundMoney(row.total || getSaleTotal(sale || {}) || 0),
        item_count: saleItems.length || toNumber(row.item_count || row.items_count || 0),
        exchange_summary: exchangeSummary,
        eligible_items: exchangeItems.slice(0, 3).map((item) => ({
          item_id: item.item_id,
          sku: item.sku,
          nome: item.nome,
          quantity: item.quantity,
          quantity_available: item.quantity_available,
          quantity_exchanged: item.quantity_exchanged,
          exchange_value: item.exchange_value,
          status: item.status,
          source_item_key: item.source_item_key,
          exchange_eligibility: item.exchange_eligibility
        })),
        status: normalizeText(row.status || row.operational_status || sale?.status || "")
      };
    })
  };
}

function createExchangeDraft(payload = {}, user = {}) {
  const originalSaleId = normalizeText(payload.original_sale_id || payload.sale_id || "");
  if (!originalSaleId) {
    throw createHttpError("Informe a venda original para iniciar a troca.");
  }
  const detail = getPdvSalesOrderDetail(originalSaleId, user);
  if (!detail?.sale) {
    throw createHttpError("Venda original nao encontrada.", 404);
  }
  const sale = detail.sale;
  const storeId = normalizeStoreKey(payload.store_id || getSaleStoreId(sale));
  const originalCustomer = getSaleCustomer(sale);
  const exchangeCustomer = normalizeExchangeCustomer(originalCustomer);
  const exchange = applyExchangeTotals({
    exchange_id: buildId("EXC"),
    exchange_type: "venda_original",
    original_sale_id: originalSaleId,
    original_customer_id: originalCustomer.customer_id,
    customer: originalCustomer,
    exchange_customer_id: exchangeCustomer.exchange_customer_id,
    exchange_customer: exchangeCustomer,
    credit_owner_customer_id: "",
    original_sale_summary: summarizeSaleForExchange(sale, detail.row),
    available_items: buildExchangeSaleItems(sale),
    returned_item: null,
    returned_items: [],
    new_item: null,
    new_items: [],
    reason: "",
    reason_notes: "",
    returned_condition: "aguardando_conferencia",
    original_value: 0,
    new_value: 0,
    difference_due: 0,
    difference_paid: 0,
    credit_generated: 0,
    payment_methods: [],
    authorization: null,
    store_id: storeId,
    seller_id: normalizeText(payload.seller_id || user?.email || ""),
    seller_name: getActorName(user),
    created_at: nowIso(),
    updated_at: nowIso(),
    created_by: getActorName(user)
  });
  const rows = loadExchanges();
  rows.unshift(exchange);
  saveExchanges(rows);
  return { exchange };
}

function setExchangeReturnedItem(exchangeId = "", payload = {}, user = {}) {
  const { exchange, sale } = getExchangeScoped(exchangeId, user);
  if (!sale) {
    throw createHttpError("Venda original da troca nao encontrada.", 404);
  }
  const itemId = normalizeText(payload.item_id || payload.original_item_id || "");
  const sourceItemKey = normalizeText(payload.source_item_key || "");
  const lineIndex = normalizeText(payload.sale_line_index ?? payload.line_index ?? "");
  const availableIndex = normalizeText(payload.available_index ?? payload.selection_index ?? "");
  const items = buildExchangeSaleItems(sale);
  const selected = items.find((item, index) => {
    const itemSourceKey = normalizeText(item.source_item_key || "");
    const itemLineIndex = normalizeText(item.sale_line_index ?? item.line_index ?? "");
    if (availableIndex && normalizeText(item.available_index ?? index) === availableIndex) return true;
    if (lineIndex && itemLineIndex) return itemLineIndex === lineIndex;
    if (sourceItemKey && itemSourceKey) return itemSourceKey === sourceItemKey;
    return item.item_id === itemId || item.original_item_id === itemId;
  });
  if (!selected) {
    throw createHttpError("Item da venda original nao encontrado para troca.", 404);
  }
  if (selected.status !== "elegivel" || toNumber(selected.quantity_available || 0) <= 0) {
    const reference = selected.previous_exchanges?.[0]?.exchange_id ? ` Referencia: ${selected.previous_exchanges[0].exchange_id}.` : "";
    throw createHttpError(`Este item ja gerou Credito de Troca e nao esta disponivel para nova troca.${reference}`);
  }
  const quantity = normalizeQuantity(payload.quantity || payload.quantidade || 1);
  if (quantity > selected.quantity_available) {
    throw createHttpError(`Quantidade devolvida maior que a quantidade disponivel para troca (${selected.quantity_available}).`);
  }
  const returnedItem = {
    ...selected,
    quantity,
    exchange_value: roundMoney(selected.unit_value * quantity),
    original_sale_id: exchange.original_sale_id,
    source_item_key: selected.source_item_key || buildExchangeSourceKey({
      original_sale_id: exchange.original_sale_id,
      returned_item: selected
    })
  };
  const currentReturnedItems = getExchangeReturnedItems(exchange);
  const alreadySelected = currentReturnedItems.some((item) => exchangeItemsMatch(item, selected));
  const returnedItems = alreadySelected
    ? currentReturnedItems.filter((item) => !exchangeItemsMatch(item, selected))
    : [...currentReturnedItems, returnedItem];
  const updated = saveExchangeUpdate(exchange.exchange_id, (draft) => applyExchangeTotals({
    ...syncExchangeReturnedItemCompatibility({ ...draft, returned_items: returnedItems }),
    available_items: items,
  }));
  return { exchange: updated };
}

function normalizeNewExchangeItem(payload = {}, exchange = {}) {
  const quantity = normalizeQuantity(payload.quantity || payload.quantidade || 1);
  const price = roundMoney(
    payload.price
    || payload.preco
    || payload.preco_venda
    || payload.sale_price
    || payload.final_price
    || payload.valor
    || payload.unit_price
    || 0
  );
  return {
    item_id: normalizeText(payload.item_id || payload.line_id || "") || buildId("NEWITEM"),
    line_id: normalizeText(payload.line_id || payload.item_id || "") || buildId("LINE"),
    inventory_id: normalizeText(payload.inventory_id || payload.selected_inventory_id || ""),
    selected_inventory_id: normalizeText(payload.selected_inventory_id || payload.inventory_id || ""),
    product_id: normalizeText(payload.product_id || payload.selected_product_id || ""),
    selected_product_id: normalizeText(payload.selected_product_id || payload.product_id || ""),
    sku: normalizeText(payload.sku || payload.codigo || payload.selected_sku || ""),
    codigo: normalizeText(payload.codigo || payload.selected_codigo || ""),
    nome: normalizeText(payload.nome || payload.name || payload.selected_nome || ""),
    marca: normalizeText(payload.marca || payload.brand || ""),
    categoria: normalizeText(payload.categoria || payload.category || ""),
    cor: normalizeText(payload.cor || payload.color || ""),
    tamanho: normalizeText(payload.tamanho || payload.size || ""),
    quantity,
    quantidade: quantity,
    unit_value: price,
    price,
    exchange_value: roundMoney(price * quantity),
    total: roundMoney(price * quantity),
    store_id: normalizeStoreKey(payload.store_id || payload.loja || exchange.store_id || ""),
    loja_venda: normalizeStoreKey(exchange.store_id || payload.loja_venda || payload.store_id || ""),
    loja_origem_estoque: normalizeStoreKey(payload.loja_origem_estoque || payload.stock_source_store_id || payload.selected_loja || payload.store_id || exchange.store_id || ""),
    stock_source_store_id: normalizeStoreKey(payload.stock_source_store_id || payload.loja_origem_estoque || payload.selected_loja || payload.store_id || exchange.store_id || "")
  };
}

function getNewItemIdentity(item = {}) {
  return [
    normalizeText(item.inventory_id || item.selected_inventory_id || ""),
    normalizeText(item.product_id || item.selected_product_id || ""),
    normalizeText(item.sku || item.codigo || ""),
    normalizeStoreKey(item.loja_origem_estoque || item.stock_source_store_id || item.store_id || "")
  ].join("|");
}

function setExchangeNewItem(exchangeId = "", payload = {}, user = {}) {
  const { exchange } = getExchangeScoped(exchangeId, user);
  const newItem = normalizeNewExchangeItem(payload, exchange);
  if (!newItem.nome && !newItem.sku && !newItem.codigo) {
    throw createHttpError("Selecione o novo produto da troca.");
  }
  if (newItem.unit_value <= 0) {
    throw createHttpError("O novo produto precisa ter valor valido para calcular a troca.");
  }
  const currentItems = getExchangeNewItems(exchange);
  const identity = getNewItemIdentity(newItem);
  const existingIndex = currentItems.findIndex((item) => getNewItemIdentity(item) === identity);
  const newItems = existingIndex >= 0
    ? currentItems.map((item, index) => {
      if (index !== existingIndex) return item;
      const quantity = normalizeQuantity(toNumber(item.quantity || item.quantidade || 1) + newItem.quantity);
      return {
        ...item,
        quantity,
        quantidade: quantity,
        exchange_value: roundMoney(toNumber(item.unit_value || item.price || 0) * quantity),
        total: roundMoney(toNumber(item.unit_value || item.price || 0) * quantity)
      };
    })
    : [...currentItems, newItem];
  const updated = saveExchangeUpdate(exchange.exchange_id, (draft) => applyExchangeTotals({
    ...syncExchangeNewItemCompatibility({ ...draft, new_items: newItems })
  }));
  return { exchange: updated };
}

function setExchangeCustomer(exchangeId = "", payload = {}, user = {}) {
  const { exchange } = getExchangeScoped(exchangeId, user);
  const exchangeCustomer = normalizeExchangeCustomer(payload);
  if (!exchangeCustomer.name || !exchangeCustomer.phone) {
    throw createHttpError("Informe o cliente que esta efetuando a troca com nome e telefone.");
  }
  const updated = saveExchangeUpdate(exchange.exchange_id, (draft) => ({
    ...draft,
    exchange_customer_id: exchangeCustomer.exchange_customer_id || normalizeText(exchangeCustomer.phone),
    receiver_customer_id: exchangeCustomer.exchange_customer_id || normalizeText(exchangeCustomer.phone),
    exchange_customer: {
      ...exchangeCustomer,
      exchange_customer_id: exchangeCustomer.exchange_customer_id || normalizeText(exchangeCustomer.phone),
      customer_id: exchangeCustomer.exchange_customer_id || normalizeText(exchangeCustomer.phone)
    }
  }));
  return { exchange: updated };
}

function updateExchangeNewItemQuantity(exchangeId = "", lineId = "", payload = {}, user = {}) {
  const { exchange } = getExchangeScoped(exchangeId, user);
  const quantity = normalizeQuantity(payload.quantity || payload.quantidade || 1);
  const currentItems = getExchangeNewItems(exchange);
  const newItems = currentItems.map((item) => {
    if (normalizeText(item.line_id || item.item_id || "") !== normalizeText(lineId)) {
      return item;
    }
    return {
      ...item,
      quantity,
      quantidade: quantity,
      exchange_value: roundMoney(toNumber(item.unit_value || item.price || 0) * quantity),
      total: roundMoney(toNumber(item.unit_value || item.price || 0) * quantity)
    };
  });
  if (!newItems.some((item) => normalizeText(item.line_id || item.item_id || "") === normalizeText(lineId))) {
    throw createHttpError("Item do carrinho de troca nao encontrado.", 404);
  }
  const updated = saveExchangeUpdate(exchange.exchange_id, (draft) => applyExchangeTotals({
    ...syncExchangeNewItemCompatibility({ ...draft, new_items: newItems })
  }));
  return { exchange: updated };
}

function removeExchangeNewItem(exchangeId = "", lineId = "", user = {}) {
  const { exchange } = getExchangeScoped(exchangeId, user);
  const currentItems = getExchangeNewItems(exchange);
  const newItems = currentItems.filter((item) => normalizeText(item.line_id || item.item_id || "") !== normalizeText(lineId));
  if (newItems.length === currentItems.length) {
    throw createHttpError("Item do carrinho de troca nao encontrado.", 404);
  }
  const updated = saveExchangeUpdate(exchange.exchange_id, (draft) => applyExchangeTotals({
    ...syncExchangeNewItemCompatibility({ ...draft, new_items: newItems })
  }));
  return { exchange: updated };
}

function updateExchangeReason(exchangeId = "", payload = {}, user = {}) {
  const { exchange } = getExchangeScoped(exchangeId, user);
  const reason = normalizeText(payload.reason || "");
  const condition = normalizeText(payload.returned_condition || payload.condition || "aguardando_conferencia");
  const notes = normalizeText(payload.reason_notes || payload.notes || "");
  if (!reason) {
    throw createHttpError("Informe o motivo da troca.");
  }
  if (["Defeito", "Outro"].includes(reason) && !notes) {
    throw createHttpError("Este motivo exige observacao.");
  }
  const updated = saveExchangeUpdate(exchange.exchange_id, (draft) => applyExchangeTotals({
    ...draft,
    reason,
    reason_notes: notes,
    returned_condition: condition
  }));
  return { exchange: updated };
}

function normalizePaymentMethods(methods = []) {
  return (Array.isArray(methods) ? methods : []).map((item) => ({
    method: normalizeText(item.method || item.tipo || "dinheiro") || "dinheiro",
    amount: roundMoney(item.amount || item.valor || 0)
  })).filter((item) => item.amount > 0);
}

function buildExchangeReceipt(exchange = {}) {
  const newItems = getExchangeNewItems(exchange);
  const returnedItems = getExchangeReturnedItems(exchange);
  return {
    exchange_id: exchange.exchange_id,
    exchange_type: exchange.exchange_type,
    finalized_at: exchange.finalized_at,
    original_sale_id: exchange.original_sale_id,
    customer: exchange.customer || {},
    exchange_customer: exchange.exchange_customer || null,
    returned_item: returnedItems[0] || null,
    returned_items: returnedItems,
    new_item: exchange.new_item || null,
    new_items: newItems,
    reason: exchange.reason || "",
    returned_condition: exchange.returned_condition || "",
    original_value: roundMoney(exchange.original_value || 0),
    returned_total: roundMoney(exchange.returned_total || exchange.original_value || 0),
    new_value: roundMoney(exchange.new_value || 0),
    new_items_total: roundMoney(exchange.new_items_total || exchange.new_value || 0),
    difference_paid: roundMoney(exchange.difference_paid || 0),
    credit_generated: roundMoney(exchange.credit_generated || 0),
    credit_owner_customer_id: exchange.credit_owner_customer_id || "",
    credit_id: exchange.credit_id || "",
    credit_status: exchange.credit_status || "",
    store_id: exchange.store_id || "",
    seller_name: exchange.seller_name || ""
  };
}

function addDaysIso(dateValue = new Date(), days = 30) {
  const date = dateValue instanceof Date ? new Date(dateValue.getTime()) : new Date(dateValue || Date.now());
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function createExchangeCredit(exchange = {}, user = {}) {
  const amount = roundMoney(exchange.credit_generated || 0);
  if (amount <= 0) {
    return null;
  }
  const owner = normalizeExchangeCustomer(exchange.exchange_customer || {});
  const ownerId = normalizeText(exchange.exchange_customer_id || owner.exchange_customer_id || owner.customer_id || owner.phone || "");
  if (!ownerId || !owner.name || !owner.phone) {
    throw createHttpError("Selecione o cliente que esta efetuando a troca para vincular o credito.");
  }
  const credits = loadExchangeCredits();
  const existing = credits.find((item) => item.exchange_id === exchange.exchange_id && item.status !== "cancelado");
  if (existing) {
    return existing;
  }
  const credit = {
    credit_id: buildId("EXCR"),
    exchange_id: exchange.exchange_id,
    customer_id: ownerId,
    customer_name: owner.name,
    customer_phone: owner.phone,
    amount,
    remaining_amount: amount,
    status: "ativo",
    created_at: nowIso(),
    expires_at: addDaysIso(new Date(), 30),
    created_by: getActorName(user),
    origin: "troca"
  };
  credits.unshift(credit);
  saveExchangeCredits(credits);
  return credit;
}

function finalizeExchange(exchangeId = "", payload = {}, user = {}) {
  const { exchange, sale } = getExchangeScoped(exchangeId, user);
  if (exchange.status === "finalizada") {
    return { exchange, receipt: buildExchangeReceipt(exchange) };
  }
  if (!sale) {
    throw createHttpError("Venda original da troca nao encontrada.", 404);
  }
  const returnedItems = getExchangeReturnedItems(exchange);
  if (!returnedItems.length) {
    throw createHttpError("Selecione ao menos um item devolvido.");
  }
  const freshItems = buildExchangeSaleItems(sale);
  returnedItems.forEach((returnedItem) => {
    const freshReturnedItem = freshItems.find((item) => exchangeItemsMatch(item, returnedItem));
    const requestedQuantity = normalizeQuantity(returnedItem.quantity || returnedItem.quantidade || 1);
    const finalizedInfo = getFinalizedReturnedInfo(exchange.original_sale_id || "", returnedItem, { excludeExchangeId: exchange.exchange_id });
    const purchasedQuantity = toNumber(freshReturnedItem?.quantity_purchased || returnedItem.quantity_purchased || returnedItem.quantity || 1);
    const alreadyExchangedQuantity = toNumber(finalizedInfo.quantity || 0);
    if (alreadyExchangedQuantity + requestedQuantity > purchasedQuantity + 0.009) {
      const reference = finalizedInfo.references?.[0]?.exchange_id ? ` Referencia: ${finalizedInfo.references[0].exchange_id}.` : "";
      throw createHttpError(`Este item ja gerou Credito de Troca e nao esta disponivel para nova troca.${reference}`);
    }
    if (!freshReturnedItem || toNumber(freshReturnedItem.quantity_available || 0) < requestedQuantity) {
      const reference = freshReturnedItem?.previous_exchanges?.[0]?.exchange_id ? ` Referencia: ${freshReturnedItem.previous_exchanges[0].exchange_id}.` : "";
      throw createHttpError(`Este item ja gerou Credito de Troca e nao esta disponivel para nova troca.${reference}`);
    }
  });
  if (!exchange.reason) {
    throw createHttpError("Informe o motivo da troca.");
  }
  if (!exchange.returned_condition) {
    throw createHttpError("Informe a condicao do produto devolvido.");
  }
  const totals = calculateExchangeTotals(exchange);
  const exchangeCustomer = normalizeExchangeCustomer(exchange.exchange_customer || {});
  const exchangeCustomerId = normalizeText(exchange.exchange_customer_id || exchangeCustomer.exchange_customer_id || exchangeCustomer.customer_id || exchangeCustomer.phone || "");
  if (!exchangeCustomerId || !exchangeCustomer.name || !exchangeCustomer.phone) {
    throw createHttpError("Selecione ou cadastre o cliente que recebera o Credito de Troca antes de finalizar.");
  }
  const returnedItemsWithSource = returnedItems.map((returnedItem) => ({
    ...returnedItem,
    source_item_key: normalizeText(returnedItem?.source_item_key || "") || buildExchangeSourceKey({
      original_sale_id: exchange.original_sale_id,
      returned_item: returnedItem
    })
  }));
  const sourceItemKeys = returnedItemsWithSource.map((item) => item.source_item_key).filter(Boolean);
  const sourceItemKey = sourceItemKeys.join("||");
  const exchangeWithCreditBase = {
    ...exchange,
    ...totals,
    source_item_key: sourceItemKey,
    source_item_keys: sourceItemKeys,
    returned_item: returnedItemsWithSource[0] || null,
    returned_items: returnedItemsWithSource,
    exchange_customer_id: exchangeCustomerId,
    exchange_customer: exchangeCustomer
  };
  const credit = createExchangeCreditRecord({
    exchange: exchangeWithCreditBase,
    owner: exchangeCustomer,
    amount: totals.credit_generated,
    user
  });
  const inboundMovements = returnedItemsWithSource.flatMap((returnedItem) => applyExchangeInboundItem(returnedItem, exchangeWithCreditBase, user));
  const finalized = saveExchangeUpdate(exchange.exchange_id, (draft) => ({
    ...draft,
    ...totals,
    source_item_key: sourceItemKey,
    source_item_keys: sourceItemKeys,
    returned_item: returnedItemsWithSource[0] || null,
    returned_items: returnedItemsWithSource,
    status: "finalizada",
    finalized_at: nowIso(),
    finalized_by: getActorName(user),
    difference_paid: 0,
    payment_methods: [],
    new_item: null,
    new_items: [],
    new_value: 0,
    new_items_total: 0,
    exchange_customer_id: exchangeCustomerId || draft.exchange_customer_id || "",
    receiver_customer_id: exchangeCustomerId || draft.receiver_customer_id || "",
    exchange_customer: exchangeCustomerId ? exchangeCustomer : draft.exchange_customer || null,
    credit_owner_customer_id: credit?.customer_id || "",
    credit_id: credit?.credit_id || "",
    credit_status: "ativo",
    inventory_in_movements: inboundMovements.map((item) => item.movement_id),
    inventory_out_movements: [],
    cash_movement_id: ""
  }));
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "EXCHANGE_STAGE2_FINALIZED",
    created_at: nowIso(),
    actor: getActorName(user),
    actor_role: getPdvUserRole(user),
    loja: finalized.store_id || "",
    reason: finalized.reason || "",
    before: null,
    after: {
      exchange_id: finalized.exchange_id,
      original_sale_id: finalized.original_sale_id,
      original_value: finalized.original_value,
      returned_total: finalized.returned_total,
      returned_items_count: returnedItemsWithSource.length,
      credit_generated: finalized.credit_generated
    }
  });
  return { exchange: finalized, receipt: buildExchangeReceipt(finalized) };
}

function listExchangeCredits(query = {}, user = {}) {
  return listActiveExchangeCreditsForCustomer({
    customer_id: query.customer_id || query.customerId || "",
    phone: query.phone || query.telefone || "",
    name: query.name || ""
  });
}

function createManualExchangeCredit(payload = {}, user = {}) {
  const storeId = normalizeStoreKey(payload.store_id || payload.loja || user?.active_store_id || user?.store_id || user?.store || "");
  ensureManualExchangeCreditPermission(user, storeId);
  const credit = createManualExchangeCreditRecord({
    payload: {
      ...payload,
      store_id: storeId
    },
    user
  });
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "manual_exchange_credit_created",
    module: "exchange_credit",
    created_at: nowIso(),
    actor: getActorName(user),
    actor_role: getPdvUserRole(user),
    loja: storeId,
    after: {
      credit_id: credit.credit_id,
      source_type: credit.source_type,
      source_origin: credit.source_origin,
      source_reference: credit.source_reference || "",
      customer_id: credit.customer_id || "",
      customer_phone_masked: maskPhone(credit.customer_phone || ""),
      amount: credit.amount,
      remaining_amount: credit.remaining_amount,
      reason: credit.reason || "",
      notes: credit.notes || "",
      status: credit.status
    }
  });
  return {
    credit,
    credits: listActiveExchangeCreditsForCustomer({
      customer_id: credit.customer_id,
      phone: credit.customer_phone,
      name: credit.customer_name
    })
  };
}

function cancelManualExchangeCredit(creditId = "", payload = {}, user = {}) {
  const creditBefore = loadExchangeCredits().find((item) => normalizeText(item.credit_id || "") === normalizeText(creditId || ""));
  if (!creditBefore) {
    throw createHttpError("Credito de Troca nao encontrado.", 404);
  }
  const storeId = normalizeStoreKey(creditBefore.store_id || payload.store_id || user?.active_store_id || user?.store_id || user?.store || "");
  ensureManualExchangeCreditPermission(user, storeId);
  const credit = cancelManualExchangeCreditRecord({
    creditId,
    reason: payload.reason || payload.motivo || "",
    user
  });
  appendAuditLog({
    audit_id: buildId("AUD"),
    action: "manual_exchange_credit_cancelled",
    module: "exchange_credit",
    created_at: nowIso(),
    actor: getActorName(user),
    actor_role: getPdvUserRole(user),
    loja: storeId,
    before: {
      credit_id: creditBefore.credit_id,
      customer_id: creditBefore.customer_id || "",
      customer_phone_masked: maskPhone(creditBefore.customer_phone || ""),
      amount: creditBefore.amount,
      remaining_amount: creditBefore.remaining_amount,
      status: creditBefore.status
    },
    after: {
      credit_id: credit.credit_id,
      customer_id: credit.customer_id || "",
      customer_phone_masked: maskPhone(credit.customer_phone || ""),
      remaining_amount: credit.remaining_amount,
      status: credit.status,
      cancel_reason: credit.cancel_reason || ""
    }
  });
  return { credit };
}

function getExchange(exchangeId = "", user = {}) {
  return { exchange: applyExchangeTotals(getExchangeScoped(exchangeId, user).exchange) };
}

function listExchanges(query = {}, user = {}) {
  const limit = Math.min(100, Math.max(1, Number(query.limit || 30)));
  const rows = loadExchanges()
    .filter((exchange) => {
      const sale = getSaleById(exchange.original_sale_id || exchange.origin_sale_id || "");
      return sale ? canAccessSale(sale, user) : canAccessExchangeByStore(exchange, user);
    })
    .slice(0, limit);
  return { items: rows };
}

module.exports = {
  createExchange,
  getSalesSummary,
  searchExchangeOrigins,
  createExchangeDraft,
  setExchangeReturnedItem,
  setExchangeNewItem,
  setExchangeCustomer,
  updateExchangeNewItemQuantity,
  removeExchangeNewItem,
  updateExchangeReason,
  finalizeExchange,
  getExchange,
  listExchanges,
  listExchangeCredits,
  createManualExchangeCredit,
  cancelManualExchangeCredit
};
