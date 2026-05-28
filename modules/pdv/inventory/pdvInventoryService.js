"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { appendEvent } = require("../services/pdvOperationalService");
const { appendAuditLog, getPdvUserRole } = require("../services/pdvControlService");
const {
  normalizeStoreKey,
  getStoreLookupKey,
  formatStoreLabel,
  isSulStore,
  isActiveOperationalStore,
  isLegacyOperationalStore,
  isSelectableStockOriginStore,
  getStoreLogisticsGroup,
  getStoreLogisticsRelation
} = require("../utils/pdvStoreUtils");

const inventoryRootDir = path.join(process.cwd(), "data", "pdv", "inventory");
const inventoryFiles = {
  inventory: path.join(inventoryRootDir, "inventory.json"),
  movements: path.join(inventoryRootDir, "movements.json"),
  transfers: path.join(inventoryRootDir, "transfers.json")
};
const pdvProductsDatasetPath = path.join(process.cwd(), "data", "imports", "pdv", "datasets", "produtos.json");
const reservationsFilePath = path.join(process.cwd(), "data", "pdv", "operational", "reservations.json");
const inventorySeedCache = {
  key: "",
  records: null
};

const DEFAULT_STORE_ID = "LOJA_GERAL";
const INVENTORY_MOVEMENT_TYPES = [
  "IMPORT_INITIAL",
  "SALE_OUT",
  "SALE_CANCEL_RETURN",
  "RESERVATION_HOLD",
  "RESERVATION_RELEASE",
  "RESERVATION_CONVERTED",
  "EXCHANGE_IN",
  "EXCHANGE_OUT",
  "INTERNAL_CONSUMPTION_OUT",
  "MANUAL_ADJUSTMENT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "DEFECT_OUT",
  "LOSS_OUT"
];
const INVENTORY_ADJUSTMENT_REASONS = [
  "INVENTARIO",
  "ERRO_IMPORTACAO",
  "PERDA",
  "DEFEITO",
  "ACERTO_OPERACIONAL",
  "OUTRO"
];
const INTERNAL_CONSUMPTION_REASONS = [
  "USO_PESSOAL",
  "PRESENTE",
  "MARKETING",
  "INFLUENCIADOR",
  "ENSAIO",
  "UNIFORME",
  "OUTRO"
];
const FULFILLMENT_MODES = {
  NORMAL: "venda_normal",
  ADJACENT_STORE: "estoque_loja_vizinha_integrada",
  DIRECT_ORIGIN: "entrega_direta_origem",
  INTERNAL_TRANSFER: "transferencia_interna",
  STRATEGY_REQUIRED: "estrategia_origem_pendente",
  LOGISTICS_REVIEW: "analise_logistica",
  TRANSFER_ANALYSIS: "pendente_analise_transferencia",
  SUL_AUDIT_PENDING: "estoque_sul_pendente_auditoria",
  NO_STOCK: "sem_estoque"
};
const FULFILLMENT_STATUS = {
  CONFIRMED: "confirmado",
  PENDING: "pendente",
  PENDING_TRANSFER: "pendente_transferencia",
  PENDING_DELIVERY: "pendente_entrega",
  PENDING_ANALYSIS: "pendente_analise",
  BLOCKED_NO_STOCK: "bloqueado_sem_estoque",
  CANCELLED: "cancelado"
};

function ensureInventoryDirs() {
  fs.mkdirSync(inventoryRootDir, { recursive: true });
  Object.values(inventoryFiles).forEach((filePath) => {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "[]", "utf8");
    }
  });
}

function readJson(filePath, fallback = []) {
  ensureInventoryDirs();
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

const jsonFileCache = new Map();

function readJsonCached(filePath, fallback = []) {
  ensureInventoryDirs();
  try {
    if (!fs.existsSync(filePath)) {
      jsonFileCache.delete(filePath);
      return fallback;
    }
    const stats = fs.statSync(filePath);
    const cached = jsonFileCache.get(filePath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.value;
    }
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    jsonFileCache.set(filePath, {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      value
    });
    return value;
  } catch (error) {
    jsonFileCache.delete(filePath);
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureInventoryDirs();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  try {
    const stats = fs.statSync(filePath);
    jsonFileCache.set(filePath, {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      value
    });
  } catch (error) {
    jsonFileCache.delete(filePath);
  }
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pickFirstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
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

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizeTinyYesNo(value = "", fallback = true) {
  const normalized = normalizeLookup(value || "");
  if (!normalized) return Boolean(fallback);
  if (["sim", "s", "yes", "y", "true", "1"].includes(normalized)) return true;
  if (["nao", "não", "n", "no", "false", "0"].includes(normalized)) return false;
  return Boolean(fallback);
}

function normalizeTinyImportMode(value = "") {
  const normalized = normalizeLookup(value || "");
  if (["products_only", "produtos", "apenas_produtos", "produto", "products"].includes(normalized)) {
    return "products_only";
  }
  if (["stock_only", "estoque", "apenas_estoque", "stock"].includes(normalized)) {
    return "stock_only";
  }
  return "products_stock";
}

function formatTinyImportModeLabel(value = "") {
  const mode = normalizeTinyImportMode(value);
  if (mode === "products_only") return "Importar apenas produtos";
  if (mode === "stock_only") return "Atualizar estoque provisório conforme Tiny";
  return "Importar produtos + estoque provisório";
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMoneyLike(value) {
  if (typeof value === "number") {
    return toNumber(value);
  }
  const raw = String(value ?? "").trim();
  if (!raw) {
    return 0;
  }
  const sanitized = raw.replace(/[^\d,.-]/g, "");
  const decimalIndex = Math.max(sanitized.lastIndexOf(","), sanitized.lastIndexOf("."));
  if (decimalIndex >= 0) {
    const integerPart = sanitized.slice(0, decimalIndex).replace(/[^\d-]/g, "");
    const decimalPart = sanitized.slice(decimalIndex + 1).replace(/\D/g, "");
    const parsed = Number(`${integerPart || "0"}.${decimalPart || "0"}`);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return toNumber(sanitized.replace(/[^\d-]/g, ""));
}

function roundQty(value) {
  return Number(toNumber(value).toFixed(2));
}

function roundMoneyLike(value) {
  return Number(parseMoneyLike(value).toFixed(2));
}

function nowIso() {
  return new Date().toISOString();
}

function buildId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeArray(value) {
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

function normalizeStoreId(value = "") {
  return normalizeStoreKey(value || DEFAULT_STORE_ID) || DEFAULT_STORE_ID;
}

function normalizeStoreLookup(value = "") {
  return getStoreLookupKey(value || DEFAULT_STORE_ID);
}

function buildProductIdentity({ product_id = "", sku = "", codigo = "", nome = "" } = {}) {
  return normalizeText(product_id || sku || codigo || nome || buildId("PRD"));
}

function getProductAvailabilityLabel(availableQty = 0) {
  const qty = roundQty(availableQty);
  if (qty <= 0) return "Esgotado";
  if (qty <= 1) return "Última peça";
  return "Disponível";
}

function loadProductsDataset() {
  return readJsonCached(pdvProductsDatasetPath, []);
}

function saveProductsDataset(rows) {
  writeJson(pdvProductsDatasetPath, rows);
  inventorySeedCache.key = "";
  inventorySeedCache.records = null;
}

function loadInventoryRecords() {
  return readJsonCached(inventoryFiles.inventory, []);
}

function saveInventoryRecords(rows) {
  writeJson(inventoryFiles.inventory, rows);
  inventorySeedCache.key = "";
  inventorySeedCache.records = null;
}

function loadInventoryMovements() {
  return readJsonCached(inventoryFiles.movements, []);
}

function saveInventoryMovements(rows) {
  writeJson(inventoryFiles.movements, rows.slice(0, 30000));
}

function loadTransfers() {
  return readJson(inventoryFiles.transfers, []);
}

function saveTransfers(rows) {
  writeJson(inventoryFiles.transfers, rows.slice(0, 10000));
}

function loadReservationsSnapshot() {
  return readJsonCached(reservationsFilePath, []);
}

function getFileCacheSignature(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch (error) {
    return "missing";
  }
}

function buildInventoryRecordFromProduct(product = {}, storeId = DEFAULT_STORE_ID) {
  const productId = buildProductIdentity({
    product_id: product.product_id,
    sku: product.sku,
    codigo: product.codigo,
    nome: product.nome
  });
  return {
    inventory_id: buildId("INV"),
    product_id: productId,
    sku: normalizeText(product.sku || product.codigo || ""),
    codigo: normalizeText(product.codigo || ""),
    codigo_tiny: normalizeText(product.codigo_tiny || ""),
    codigo_etiqueta: normalizeText(product.codigo_etiqueta || ""),
    ean: normalizeDigits(product.ean || product.codigo_barras || ""),
    codigo_barras: normalizeDigits(product.codigo_barras || product.ean || ""),
    codigo_interno: normalizeText(product.codigo_interno || ""),
    nome: normalizeText(product.nome || ""),
    descricao: normalizeText(product.descricao || ""),
    marca: normalizeText(product.marca || ""),
    categoria: normalizeText(product.categoria || ""),
    linha_genero: normalizeText(product.linha_genero || ""),
    tipo: normalizeText(product.tipo || ""),
    cor: normalizeText(product.cor || ""),
    tamanho: normalizeText(product.tamanho || ""),
    grade: normalizeText(product.grade || ""),
    preco_venda: roundQty(product.preco_venda || 0),
    preco_custo: roundQty(product.preco_custo || 0),
    store_id: normalizeStoreId(storeId),
    available_qty: roundQty(product.estoque || 0),
    reserved_qty: 0,
    unavailable_qty: 0,
    exchange_qty: 0,
    consumption_qty: 0,
    last_movement_at: nowIso(),
    status: normalizeText(product.status || "ACTIVE") || "ACTIVE",
    observacao: normalizeText(product.observacao || ""),
    media_id: Number(product.media_id || 0) || null,
    photo_preview_url: normalizeText(product.photo_preview_url || product.preview_url || ""),
    media_url: normalizeText(product.media_url || ""),
    foto: normalizeText(product.foto || ""),
    source: normalizeText(product.source || "PDV_IMPORT") || "PDV_IMPORT"
  };
}

function getDatasetProductStoreId(product = {}) {
  return normalizeStoreId(product.store_id || product.origem_estoque || DEFAULT_STORE_ID);
}

function buildInventoryUniqueKey(record = {}) {
  const storeKey = normalizeStoreId(record.store_id || DEFAULT_STORE_ID);
  const productKey = buildProductIdentity(record);
  return `${storeKey}::${productKey}`;
}

function mergeInventoryDuplicateRecord(target = {}, duplicate = {}) {
  target.sku = target.sku || normalizeText(duplicate.sku || duplicate.codigo || "");
  target.codigo = target.codigo || normalizeText(duplicate.codigo || "");
  target.codigo_tiny = target.codigo_tiny || normalizeText(duplicate.codigo_tiny || "");
  target.codigo_etiqueta = target.codigo_etiqueta || normalizeText(duplicate.codigo_etiqueta || "");
  target.ean = target.ean || normalizeDigits(duplicate.ean || duplicate.codigo_barras || "");
  target.codigo_barras = target.codigo_barras || normalizeDigits(duplicate.codigo_barras || duplicate.ean || "");
  target.codigo_interno = target.codigo_interno || normalizeText(duplicate.codigo_interno || "");
  target.nome = target.nome || normalizeText(duplicate.nome || "");
  target.descricao = target.descricao || normalizeText(duplicate.descricao || "");
  target.marca = target.marca || normalizeText(duplicate.marca || "");
  target.categoria = target.categoria || normalizeText(duplicate.categoria || "");
  target.linha_genero = target.linha_genero || normalizeText(duplicate.linha_genero || "");
  target.tipo = target.tipo || normalizeText(duplicate.tipo || "");
  target.cor = target.cor || normalizeText(duplicate.cor || "");
  target.tamanho = target.tamanho || normalizeText(duplicate.tamanho || "");
  target.grade = target.grade || normalizeText(duplicate.grade || "");
  target.preco_venda = roundQty(Math.max(toNumber(target.preco_venda), toNumber(duplicate.preco_venda)));
  target.preco_custo = roundQty(Math.max(toNumber(target.preco_custo), toNumber(duplicate.preco_custo)));
  target.available_qty = roundQty(Math.max(toNumber(target.available_qty), toNumber(duplicate.available_qty)));
  target.reserved_qty = roundQty(Math.max(toNumber(target.reserved_qty), toNumber(duplicate.reserved_qty)));
  target.unavailable_qty = roundQty(Math.max(toNumber(target.unavailable_qty), toNumber(duplicate.unavailable_qty)));
  target.exchange_qty = roundQty(Math.max(toNumber(target.exchange_qty), toNumber(duplicate.exchange_qty)));
  target.consumption_qty = roundQty(Math.max(toNumber(target.consumption_qty), toNumber(duplicate.consumption_qty)));
  target.media_id = target.media_id || Number(duplicate.media_id || 0) || null;
  target.photo_preview_url = target.photo_preview_url || normalizeText(duplicate.photo_preview_url || "");
  target.media_url = target.media_url || normalizeText(duplicate.media_url || "");
  target.foto = target.foto || normalizeText(duplicate.foto || "");
  target.observacao = target.observacao || normalizeText(duplicate.observacao || "");
  target.source = target.source || normalizeText(duplicate.source || "");
  target.status = target.status || normalizeText(duplicate.status || "ACTIVE") || "ACTIVE";
  if (!target.last_movement_at || String(duplicate.last_movement_at || "") > String(target.last_movement_at || "")) {
    target.last_movement_at = duplicate.last_movement_at || target.last_movement_at;
  }
}

function dedupeInventoryRecords(records = []) {
  const incoming = Array.isArray(records) ? records : [];
  const deduped = [];
  const indexByKey = new Map();
  let changed = false;
  incoming.forEach((record) => {
    const key = buildInventoryUniqueKey(record);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, deduped.length);
      deduped.push(record);
      return;
    }
    mergeInventoryDuplicateRecord(deduped[existingIndex], record);
    changed = true;
  });
  return {
    records: deduped,
    changed
  };
}

function ensureInventorySeeded() {
  ensureInventoryDirs();
  const cacheKey = [
    getFileCacheSignature(inventoryFiles.inventory),
    getFileCacheSignature(pdvProductsDatasetPath)
  ].join("|");
  if (inventorySeedCache.key === cacheKey && Array.isArray(inventorySeedCache.records)) {
    return inventorySeedCache.records;
  }
  const dedupeResult = dedupeInventoryRecords(loadInventoryRecords());
  const inventory = dedupeResult.records;
  const products = loadProductsDataset();
  let changed = dedupeResult.changed;
  const inventoryByProductStore = new Map();
  inventory.forEach((item) => {
    const key = `${normalizeStoreId(item.store_id || DEFAULT_STORE_ID)}::${normalizeText(item.product_id || "")}`;
    if (key !== `${normalizeStoreId(item.store_id || DEFAULT_STORE_ID)}::`) {
      inventoryByProductStore.set(key, item);
    }
  });
  products.forEach((product) => {
    const productId = buildProductIdentity(product);
    const preferredStoreId = getDatasetProductStoreId(product);
    const existingKey = `${preferredStoreId}::${productId}`;
    const existing = inventoryByProductStore.get(existingKey);
    if (!existing) {
      const nextRecord = buildInventoryRecordFromProduct(product, preferredStoreId);
      inventory.push(nextRecord);
      inventoryByProductStore.set(existingKey, nextRecord);
      changed = true;
    } else {
      const beforeSignature = JSON.stringify([existing.nome, existing.descricao, existing.marca, existing.categoria, existing.tipo, existing.cor, existing.tamanho, existing.preco_venda]);
      existing.nome = existing.nome || normalizeText(product.nome || "");
      existing.descricao = existing.descricao || normalizeText(product.descricao || "");
      existing.marca = existing.marca || normalizeText(product.marca || "");
      existing.categoria = existing.categoria || normalizeText(product.categoria || "");
      existing.linha_genero = existing.linha_genero || normalizeText(product.linha_genero || "");
      existing.tipo = existing.tipo || normalizeText(product.tipo || "");
      existing.cor = existing.cor || normalizeText(product.cor || "");
      existing.tamanho = existing.tamanho || normalizeText(product.tamanho || "");
      existing.grade = existing.grade || normalizeText(product.grade || "");
      existing.codigo_tiny = existing.codigo_tiny || normalizeText(product.codigo_tiny || "");
      existing.codigo_etiqueta = existing.codigo_etiqueta || normalizeText(product.codigo_etiqueta || "");
      existing.ean = existing.ean || normalizeDigits(product.ean || product.codigo_barras || "");
      existing.codigo_barras = existing.codigo_barras || normalizeDigits(product.codigo_barras || product.ean || "");
      existing.codigo_interno = existing.codigo_interno || normalizeText(product.codigo_interno || "");
      existing.preco_custo = roundQty(existing.preco_custo || product.preco_custo || 0);
      existing.observacao = existing.observacao || normalizeText(product.observacao || "");
      existing.media_id = existing.media_id || Number(product.media_id || 0) || null;
      existing.photo_preview_url = existing.photo_preview_url || normalizeText(product.photo_preview_url || product.preview_url || "");
      existing.media_url = existing.media_url || normalizeText(product.media_url || "");
      existing.foto = existing.foto || normalizeText(product.foto || "");
      if (!toNumber(existing.preco_venda)) {
        existing.preco_venda = roundQty(product.preco_venda || 0);
      }
      const afterSignature = JSON.stringify([
        existing.nome,
        existing.descricao,
        existing.marca,
        existing.categoria,
        existing.linha_genero,
        existing.tipo,
        existing.cor,
        existing.tamanho,
        existing.grade,
        existing.preco_venda,
        existing.preco_custo,
        existing.codigo_tiny,
        existing.codigo_etiqueta,
        existing.ean,
        existing.codigo_interno,
        existing.photo_preview_url
      ]);
      if (beforeSignature !== afterSignature) {
        changed = true;
      }
    }
  });
  if (changed) {
    saveInventoryRecords(inventory);
  }
  inventorySeedCache.key = [
    getFileCacheSignature(inventoryFiles.inventory),
    getFileCacheSignature(pdvProductsDatasetPath)
  ].join("|");
  inventorySeedCache.records = inventory;
  return inventory;
}

function cloneInventorySnapshot(record = {}) {
  return {
    available_qty: roundQty(record.available_qty),
    reserved_qty: roundQty(record.reserved_qty),
    unavailable_qty: roundQty(record.unavailable_qty),
    exchange_qty: roundQty(record.exchange_qty),
    consumption_qty: roundQty(record.consumption_qty)
  };
}

function findInventoryRecord(records, { productId = "", sku = "", codigo = "", storeId = DEFAULT_STORE_ID } = {}) {
  const normalizedStore = normalizeStoreLookup(storeId);
  const normalizedProductId = normalizeText(productId || "");
  const normalizedSku = normalizeText(sku || "");
  const normalizedCodigo = normalizeText(codigo || "");
  let record = records.find((item) => normalizeStoreLookup(item.store_id) === normalizedStore && (
    (normalizedProductId && normalizeText(item.product_id) === normalizedProductId)
    || (normalizedSku && normalizeText(item.sku) === normalizedSku)
    || (normalizedCodigo && normalizeText(item.codigo) === normalizedCodigo)
  ));
  if (!record && normalizedStore !== normalizeStoreLookup(DEFAULT_STORE_ID)) {
    record = records.find((item) => normalizeStoreLookup(item.store_id) === normalizeStoreLookup(DEFAULT_STORE_ID) && (
      (normalizedProductId && normalizeText(item.product_id) === normalizedProductId)
      || (normalizedSku && normalizeText(item.sku) === normalizedSku)
      || (normalizedCodigo && normalizeText(item.codigo) === normalizedCodigo)
    ));
  }
  return record || null;
}

function findInventoryCandidates(records, { inventoryId = "", productId = "", sku = "", codigo = "", storeId = DEFAULT_STORE_ID } = {}) {
  const normalizedStore = normalizeStoreLookup(storeId);
  const normalizedInventoryId = normalizeText(inventoryId || "");
  const normalizedProductId = normalizeText(productId || "");
  const normalizedSku = normalizeText(sku || "");
  const normalizedCodigo = normalizeText(codigo || "");
  return (records || []).filter((item) => {
    if (normalizeStoreLookup(item.store_id) !== normalizedStore) {
      return false;
    }
    if (normalizedInventoryId) {
      return normalizeText(item.inventory_id) === normalizedInventoryId;
    }
    if (normalizedProductId) {
      return normalizeText(item.product_id) === normalizedProductId;
    }
    return (normalizedSku && normalizeText(item.sku) === normalizedSku)
      || (normalizedCodigo && normalizeText(item.codigo) === normalizedCodigo);
  });
}

function resolveStrictInventoryRecord(records, item = {}, storeId = DEFAULT_STORE_ID) {
  const normalizedStore = normalizeStoreId(storeId || item.store_id || item.selected_loja || DEFAULT_STORE_ID);
  const inventoryId = normalizeText(item.inventory_id || item.selected_inventory_id || "");
  const productId = normalizeText(item.product_id || item.selected_product_id || "");
  const sku = normalizeText(item.sku || item.selected_sku || "");
  const codigo = normalizeText(item.codigo || item.selected_codigo || "");
  const referenceLabel = item.nome || item.selected_nome || item.sku || item.codigo || item.product_id || "item do PDV";

  if (inventoryId) {
    const candidates = findInventoryCandidates(records, { inventoryId, storeId: normalizedStore });
    if (candidates.length > 1) {
      throw new Error(`Produto ambíguo no estoque. Não foi possível baixar com segurança: ${referenceLabel}.`);
    }
    if (!candidates.length) {
      throw new Error(`Produto selecionado não foi encontrado no estoque da loja ${normalizedStore}: ${referenceLabel}.`);
    }
    const record = candidates[0];
    if (productId && normalizeText(record.product_id) !== productId) {
      throw new Error(`Divergência de identidade do produto no estoque para ${referenceLabel}.`);
    }
    return record;
  }

  if (productId) {
    const candidates = findInventoryCandidates(records, { productId, storeId: normalizedStore });
    if (candidates.length > 1) {
      throw new Error(`Produto ambíguo no estoque. Não foi possível baixar com segurança: ${referenceLabel}.`);
    }
    if (!candidates.length) {
      throw new Error(`Produto selecionado não foi encontrado na loja ${normalizedStore}: ${referenceLabel}.`);
    }
    return candidates[0];
  }

  const fallbackCandidates = findInventoryCandidates(records, { sku, codigo, storeId: normalizedStore });
  if (fallbackCandidates.length > 1) {
    throw new Error(`Produto ambíguo no estoque. Não foi possível baixar com segurança: ${referenceLabel}.`);
  }
  if (!fallbackCandidates.length) {
    throw new Error(`Produto não encontrado no estoque da loja ${normalizedStore}: ${referenceLabel}.`);
  }
  return fallbackCandidates[0];
}

function sortFulfillmentCandidates(candidates = [], saleStoreId = DEFAULT_STORE_ID, preferredStoreId = "") {
  const normalizedSaleStore = normalizeStoreId(saleStoreId);
  const normalizedPreferredStore = normalizeStoreKey(preferredStoreId || "");
  const normalizedGeneralStore = normalizeStoreId(DEFAULT_STORE_ID);
  return [...candidates].sort((left, right) => {
    const leftStore = normalizeStoreId(left.store_id);
    const rightStore = normalizeStoreId(right.store_id);
    const leftScore = (leftStore === normalizedSaleStore ? 4 : 0)
      + (normalizedPreferredStore && leftStore === normalizedPreferredStore ? 2 : 0)
      + (leftStore === normalizedGeneralStore ? -1 : 0);
    const rightScore = (rightStore === normalizedSaleStore ? 4 : 0)
      + (normalizedPreferredStore && rightStore === normalizedPreferredStore ? 2 : 0)
      + (rightStore === normalizedGeneralStore ? -1 : 0);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    const leftAvailable = roundQty(left.available_qty || 0);
    const rightAvailable = roundQty(right.available_qty || 0);
    if (leftAvailable !== rightAvailable) {
      return rightAvailable - leftAvailable;
    }
    return normalizeText(left.inventory_id).localeCompare(normalizeText(right.inventory_id), "pt-BR");
  });
}

function findCrossStoreInventoryCandidates(records, item = {}) {
  const inventoryId = normalizeText(item.inventory_id || item.selected_inventory_id || "");
  const productId = normalizeText(item.product_id || item.selected_product_id || "");
  const sku = normalizeText(item.sku || item.selected_sku || "");
  const codigo = normalizeText(item.codigo || item.selected_codigo || "");
  return (records || []).filter((record) => {
    if (inventoryId) {
      return normalizeText(record.inventory_id) === inventoryId;
    }
    if (productId) {
      return normalizeText(record.product_id) === productId;
    }
    return (sku && normalizeText(record.sku) === sku)
      || (codigo && normalizeText(record.codigo) === codigo);
  });
}

function buildOperationalSourceOption(record = {}, saleStoreId = DEFAULT_STORE_ID) {
  const storeId = normalizeStoreId(record.store_id || DEFAULT_STORE_ID);
  const availableQty = roundQty(record.available_qty || 0);
  const stockStatus = normalizeLookup(record.estoque_status || record.stock_status || "");
  const inventoryStatus = normalizeLookup(record.inventory_status || "");
  const isProvisional = stockStatus.startsWith("provisional") || inventoryStatus === "pending_count";
  const isDivergent = stockStatus.includes("divergent") || availableQty < 0 || roundQty(record.tiny_stock_quantity || record.imported_quantity_original || 0) < 0;
  return {
    store_id: storeId,
    store_name: formatStoreLabel(storeId),
    inventory_id: normalizeText(record.inventory_id || ""),
    product_id: normalizeText(record.product_id || ""),
    sku: normalizeText(record.sku || ""),
    codigo: normalizeText(record.codigo || ""),
    available_qty: availableQty,
    tiny_stock_quantity: roundQty(record.tiny_stock_quantity || record.imported_quantity_original || availableQty || 0),
    estoque_status: normalizeText(record.estoque_status || record.stock_status || ""),
    inventory_status: normalizeText(record.inventory_status || ""),
    needs_physical_confirmation: isProvisional || availableQty <= 0,
    is_provisional: isProvisional,
    is_divergent: isDivergent,
    logistics_group: getStoreLogisticsGroup(storeId),
    logistics_relation: getStoreLogisticsRelation(saleStoreId, storeId)
  };
}

function getProductOperationalAvailability(item = {}, saleStoreId = DEFAULT_STORE_ID, options = {}) {
  const records = options.records || ensureInventorySeeded();
  const normalizedSaleStore = normalizeStoreId(saleStoreId || item.loja_venda || item.loja || DEFAULT_STORE_ID);
  const preferredOriginStore = normalizeStoreKey(
    item.loja_origem_estoque
    || item.stock_source_store_id
    || item.selected_loja
    || item.store_id
    || options.preferredOriginStore
    || ""
  );
  const allCandidates = findCrossStoreInventoryCandidates(records, item)
    .filter((record) => isSelectableStockOriginStore(record.store_id || ""));
  const candidates = sortFulfillmentCandidates(
    allCandidates.filter((record) => roundQty(record.available_qty || 0) > 0),
    normalizedSaleStore,
    preferredOriginStore
  );
  const uniqueByStore = new Map();
  candidates.forEach((record) => {
    const storeId = normalizeStoreId(record.store_id || DEFAULT_STORE_ID);
    if (!storeId || uniqueByStore.has(storeId)) {
      return;
    }
    uniqueByStore.set(storeId, buildOperationalSourceOption(record, normalizedSaleStore));
  });
  const sourceOptions = Array.from(uniqueByStore.values());
  const localOption = sourceOptions.find((option) => option.store_id === normalizedSaleStore) || null;
  const allSourceOptionsByStore = new Map();
  allCandidates.forEach((record) => {
    const storeId = normalizeStoreId(record.store_id || DEFAULT_STORE_ID);
    if (!storeId || allSourceOptionsByStore.has(storeId)) {
      return;
    }
    allSourceOptionsByStore.set(storeId, buildOperationalSourceOption(record, normalizedSaleStore));
  });
  const allSourceOptions = Array.from(allSourceOptionsByStore.values());
  const localAnyOption = allSourceOptions.find((option) => option.store_id === normalizedSaleStore) || null;
  const otherPendingOptions = allSourceOptions
    .filter((option) => option.store_id !== normalizedSaleStore)
    .filter((option) => option.needs_physical_confirmation || option.available_qty <= 0);
  const adjacentOption = sourceOptions.find((option) => option.logistics_relation === "adjacent") || null;
  const sameCityOptions = sourceOptions.filter((option) => option.logistics_relation === "same_city");
  const otherRegionOptions = sourceOptions.filter((option) => ["same_region", "other_region"].includes(option.logistics_relation));
  const preferredOption = localOption || adjacentOption || sameCityOptions[0] || otherRegionOptions[0] || localAnyOption || otherPendingOptions[0] || null;
  const status = localOption
    ? "AVAILABLE_LOCAL"
    : localAnyOption
      ? (localAnyOption.is_divergent ? "PROVISIONAL_DIVERGENT_LOCAL" : "PENDING_LOCAL_CONFIRMATION")
      : adjacentOption
        ? "AVAILABLE_ADJACENT_STORE"
        : sameCityOptions.length
          ? "AVAILABLE_SAME_CITY"
          : otherRegionOptions.length
            ? "LOGISTICS_REVIEW_REQUIRED"
            : otherPendingOptions.length
              ? "PENDING_OTHER_STORE_CONFIRMATION"
              : "NO_KNOWN_STOCK";
  return {
    sale_store_id: normalizedSaleStore,
    sale_store_name: formatStoreLabel(normalizedSaleStore),
    local_option: localOption || localAnyOption,
    adjacent_option: adjacentOption,
    same_city_options: sameCityOptions,
    other_region_options: otherRegionOptions,
    pending_other_store_options: otherPendingOptions,
    preferred_option: preferredOption,
    source_options: sourceOptions.length ? sourceOptions : allSourceOptions,
    status,
    can_add_directly: status === "AVAILABLE_LOCAL" || status === "AVAILABLE_ADJACENT_STORE",
    requires_resolution: ["AVAILABLE_SAME_CITY", "PENDING_LOCAL_CONFIRMATION", "PROVISIONAL_DIVERGENT_LOCAL", "PENDING_OTHER_STORE_CONFIRMATION"].includes(status),
    requires_logistics_review: status === "LOGISTICS_REVIEW_REQUIRED",
    is_unavailable: false,
    ideal_source_store_id: preferredOption?.store_id || "",
    ideal_source_store_name: preferredOption?.store_name || ""
  };
}

function resolveSaleItemFulfillment(item = {}, saleStoreId = DEFAULT_STORE_ID, options = {}) {
  const records = options.records || ensureInventorySeeded();
  const requestedQty = Math.max(1, roundQty(item.quantidade || 1));
  const normalizedSaleStore = normalizeStoreId(saleStoreId || item.loja_venda || item.loja || DEFAULT_STORE_ID);
  const normalizedDeliveryStore = normalizeStoreId(options.deliveryStoreId || item.loja_entrega_retirada || normalizedSaleStore);
  const preferredOriginStore = normalizeStoreKey(
    item.loja_origem_estoque
    || item.selected_loja
    || item.store_id
    || options.preferredOriginStore
    || ""
  );
  const itemLabel = normalizeText(item.nome || item.selected_nome || item.sku || item.codigo || item.product_id || "Produto");
  const explicitFulfillment = normalizeText(item.fulfillment_mode || item.fulfillment_type || "");
  const availability = getProductOperationalAvailability(item, normalizedSaleStore, {
    records,
    preferredOriginStore
  });
  const selectedOriginStore = normalizeStoreId(
    item.loja_origem_estoque
    || item.stock_source_store_id
    || availability.ideal_source_store_id
    || ""
  );
  const selectedSameCityOption = availability.same_city_options.find((option) => option.store_id === selectedOriginStore)
    || availability.same_city_options[0]
    || null;
  const wantsInternalTransfer = explicitFulfillment === FULFILLMENT_MODES.INTERNAL_TRANSFER || explicitFulfillment === "INTERNAL_TRANSFER";
  const wantsDirectDelivery = explicitFulfillment === FULFILLMENT_MODES.DIRECT_ORIGIN || explicitFulfillment === "DIRECT_DELIVERY";
  const wantsLogisticsReview = explicitFulfillment === FULFILLMENT_MODES.LOGISTICS_REVIEW || explicitFulfillment === "LOGISTICS_REVIEW";

  const localResolutionCandidates = [
    item,
    {
      ...item,
      inventory_id: "",
      selected_inventory_id: ""
    }
  ];
  for (const localCandidate of localResolutionCandidates) {
    try {
      const localRecord = resolveStrictInventoryRecord(records, localCandidate, normalizedSaleStore);
      if (
        normalizeStoreId(localRecord.store_id || "") === normalizedSaleStore
        && roundQty(localRecord.available_qty || 0) >= requestedQty
      ) {
        return {
          ok: true,
          can_finalize: true,
          blocked: false,
          item_id: normalizeText(item.item_id || ""),
          product_id: normalizeText(item.product_id || item.selected_product_id || localRecord.product_id || ""),
          sku: normalizeText(item.sku || item.selected_sku || localRecord.sku || ""),
          codigo: normalizeText(item.codigo || item.selected_codigo || localRecord.codigo || ""),
          nome: itemLabel,
          quantidade: requestedQty,
          inventory_id: normalizeText(localRecord.inventory_id || ""),
          available_qty: roundQty(localRecord.available_qty || 0),
          loja_venda: normalizedSaleStore,
          loja_origem_estoque: normalizeStoreId(localRecord.store_id),
          loja_entrega_retirada: normalizedDeliveryStore || normalizedSaleStore,
          stock_source_store_id: normalizeStoreId(localRecord.store_id),
          stock_source_store_name: formatStoreLabel(localRecord.store_id),
          fulfillment_type: "LOCAL_STOCK",
          fulfillment_mode: FULFILLMENT_MODES.NORMAL,
          fulfillment_status: FULFILLMENT_STATUS.CONFIRMED,
          requires_logistics_review: false,
          is_adjacent_store: false,
          message: "Produto disponível na loja da venda."
        };
      }
    } catch (error) {
      // Continua tentando as demais identidades seguras do item.
    }
  }

  if (availability.adjacent_option && roundQty(availability.adjacent_option.available_qty || 0) >= requestedQty) {
    return {
      ok: true,
      can_finalize: true,
      blocked: false,
      item_id: normalizeText(item.item_id || ""),
      product_id: normalizeText(item.product_id || item.selected_product_id || availability.adjacent_option.product_id || ""),
      sku: normalizeText(item.sku || item.selected_sku || availability.adjacent_option.sku || ""),
      codigo: normalizeText(item.codigo || item.selected_codigo || availability.adjacent_option.codigo || ""),
      nome: itemLabel,
      quantidade: requestedQty,
      inventory_id: normalizeText(availability.adjacent_option.inventory_id || ""),
      available_qty: roundQty(availability.adjacent_option.available_qty || 0),
      loja_venda: normalizedSaleStore,
      loja_origem_estoque: availability.adjacent_option.store_id,
      loja_entrega_retirada: normalizedDeliveryStore || normalizedSaleStore,
      stock_source_store_id: availability.adjacent_option.store_id,
      stock_source_store_name: availability.adjacent_option.store_name,
      fulfillment_type: "ADJACENT_STORE_STOCK",
      fulfillment_mode: FULFILLMENT_MODES.ADJACENT_STORE,
      fulfillment_status: FULFILLMENT_STATUS.CONFIRMED,
      requires_logistics_review: false,
      is_adjacent_store: true,
      message: `Disponivel na loja vizinha ${availability.adjacent_option.store_name}.`
    };
  }

  if (selectedSameCityOption && roundQty(selectedSameCityOption.available_qty || 0) >= requestedQty) {
    if (wantsInternalTransfer || wantsDirectDelivery) {
      return {
        ok: true,
        can_finalize: true,
        blocked: false,
        item_id: normalizeText(item.item_id || ""),
        product_id: normalizeText(item.product_id || item.selected_product_id || selectedSameCityOption.product_id || ""),
        sku: normalizeText(item.sku || item.selected_sku || selectedSameCityOption.sku || ""),
        codigo: normalizeText(item.codigo || item.selected_codigo || selectedSameCityOption.codigo || ""),
        nome: itemLabel,
        quantidade: requestedQty,
        inventory_id: normalizeText(selectedSameCityOption.inventory_id || ""),
        available_qty: roundQty(selectedSameCityOption.available_qty || 0),
        loja_venda: normalizedSaleStore,
        loja_origem_estoque: selectedSameCityOption.store_id,
        loja_entrega_retirada: wantsDirectDelivery ? normalizeStoreId(item.loja_entrega_retirada || "cliente") : normalizedSaleStore,
        stock_source_store_id: selectedSameCityOption.store_id,
        stock_source_store_name: selectedSameCityOption.store_name,
        fulfillment_type: wantsDirectDelivery ? "DIRECT_DELIVERY" : "INTERNAL_TRANSFER",
        fulfillment_mode: wantsDirectDelivery ? FULFILLMENT_MODES.DIRECT_ORIGIN : FULFILLMENT_MODES.INTERNAL_TRANSFER,
        fulfillment_status: wantsDirectDelivery ? FULFILLMENT_STATUS.PENDING_DELIVERY : FULFILLMENT_STATUS.PENDING_TRANSFER,
        requires_logistics_review: false,
        is_adjacent_store: false,
        message: wantsDirectDelivery
          ? `Entrega direta definida a partir de ${selectedSameCityOption.store_name}.`
          : `Transferencia interna definida a partir de ${selectedSameCityOption.store_name}.`
      };
    }
    return {
      ok: false,
      can_finalize: false,
      blocked: true,
      item_id: normalizeText(item.item_id || ""),
      product_id: normalizeText(item.product_id || item.selected_product_id || selectedSameCityOption.product_id || ""),
      sku: normalizeText(item.sku || item.selected_sku || selectedSameCityOption.sku || ""),
      codigo: normalizeText(item.codigo || item.selected_codigo || selectedSameCityOption.codigo || ""),
      nome: itemLabel,
      quantidade: requestedQty,
      inventory_id: normalizeText(selectedSameCityOption.inventory_id || ""),
      available_qty: roundQty(selectedSameCityOption.available_qty || 0),
      loja_venda: normalizedSaleStore,
      loja_origem_estoque: selectedSameCityOption.store_id,
      loja_entrega_retirada: normalizedDeliveryStore || normalizedSaleStore,
      stock_source_store_id: selectedSameCityOption.store_id,
      stock_source_store_name: selectedSameCityOption.store_name,
      fulfillment_type: "",
      fulfillment_mode: FULFILLMENT_MODES.STRATEGY_REQUIRED,
      fulfillment_status: FULFILLMENT_STATUS.PENDING,
      requires_logistics_review: false,
      is_adjacent_store: false,
      message: `Defina transferencia ou entrega direta para usar o estoque de ${selectedSameCityOption.store_name}.`
    };
  }

  if (availability.other_region_options.length) {
    const source = availability.other_region_options.find((option) => option.store_id === selectedOriginStore)
      || availability.other_region_options[0];
    return {
      ok: false,
      can_finalize: false,
      blocked: true,
      item_id: normalizeText(item.item_id || ""),
      product_id: normalizeText(item.product_id || item.selected_product_id || source?.product_id || ""),
      sku: normalizeText(item.sku || item.selected_sku || source?.sku || ""),
      codigo: normalizeText(item.codigo || item.selected_codigo || source?.codigo || ""),
      nome: itemLabel,
      quantidade: requestedQty,
      inventory_id: normalizeText(source?.inventory_id || ""),
      available_qty: roundQty(source?.available_qty || 0),
      loja_venda: normalizedSaleStore,
      loja_origem_estoque: source?.store_id || "",
      loja_entrega_retirada: normalizedDeliveryStore || normalizedSaleStore,
      stock_source_store_id: source?.store_id || "",
      stock_source_store_name: source?.store_name || "",
      fulfillment_type: "LOGISTICS_REVIEW",
      fulfillment_mode: wantsLogisticsReview ? FULFILLMENT_MODES.LOGISTICS_REVIEW : FULFILLMENT_MODES.TRANSFER_ANALYSIS,
      fulfillment_status: FULFILLMENT_STATUS.PENDING_ANALYSIS,
      requires_logistics_review: true,
      is_adjacent_store: false,
      message: source
        ? `Produto disponivel em ${source.store_name}, fora do grupo local da venda. Envie para analise logistica antes de concluir.`
        : "Produto disponivel apenas fora do grupo local da venda. Envie para analise logistica antes de concluir."
    };
  }

  const candidates = sortFulfillmentCandidates(
    findCrossStoreInventoryCandidates(records, item)
      .filter((record) => roundQty(record.available_qty || 0) >= requestedQty)
      .filter((record) => isSelectableStockOriginStore(record.store_id || "")),
    normalizedSaleStore,
    preferredOriginStore
  );

  if (candidates.length) {
    const originRecord = candidates[0];
    const originStore = normalizeStoreId(originRecord.store_id);
    if (isSulStore(normalizedSaleStore)) {
      return {
        ok: false,
        can_finalize: false,
        blocked: true,
        item_id: normalizeText(item.item_id || ""),
        product_id: normalizeText(item.product_id || item.selected_product_id || originRecord.product_id || ""),
        sku: normalizeText(item.sku || item.selected_sku || originRecord.sku || ""),
        codigo: normalizeText(item.codigo || item.selected_codigo || originRecord.codigo || ""),
        nome: itemLabel,
        quantidade: requestedQty,
        inventory_id: normalizeText(originRecord.inventory_id || ""),
        available_qty: roundQty(originRecord.available_qty || 0),
        loja_venda: normalizedSaleStore,
        loja_origem_estoque: originStore,
        loja_entrega_retirada: normalizedDeliveryStore || normalizedSaleStore,
        fulfillment_mode: FULFILLMENT_MODES.TRANSFER_ANALYSIS,
        fulfillment_status: FULFILLMENT_STATUS.PENDING_ANALYSIS,
        message: "Este produto está disponível em outra loja. Como a venda é da Sul, avalie custo, prazo e viabilidade de transferência antes de prometer entrega ao cliente."
      };
    }
    const deliveryStore = normalizedDeliveryStore || normalizedSaleStore;
    const mode = deliveryStore === originStore ? FULFILLMENT_MODES.DIRECT_ORIGIN : FULFILLMENT_MODES.INTERNAL_TRANSFER;
    const status = deliveryStore === originStore ? FULFILLMENT_STATUS.PENDING_DELIVERY : FULFILLMENT_STATUS.PENDING_TRANSFER;
    return {
      ok: false,
      can_finalize: false,
      blocked: true,
      item_id: normalizeText(item.item_id || ""),
      product_id: normalizeText(item.product_id || item.selected_product_id || originRecord.product_id || ""),
      sku: normalizeText(item.sku || item.selected_sku || originRecord.sku || ""),
      codigo: normalizeText(item.codigo || item.selected_codigo || originRecord.codigo || ""),
      nome: itemLabel,
      quantidade: requestedQty,
      inventory_id: normalizeText(originRecord.inventory_id || ""),
      available_qty: roundQty(originRecord.available_qty || 0),
      loja_venda: normalizedSaleStore,
      loja_origem_estoque: originStore,
      loja_entrega_retirada: deliveryStore,
      fulfillment_mode: mode,
      fulfillment_status: status,
      message: "Produto disponível em outra loja. Será necessário definir entrega direta ou transferência antes de concluir a venda."
    };
  }

  if (isSulStore(normalizedSaleStore)) {
    return {
      ok: false,
      can_finalize: false,
      blocked: true,
      item_id: normalizeText(item.item_id || ""),
      product_id: normalizeText(item.product_id || item.selected_product_id || ""),
      sku: normalizeText(item.sku || item.selected_sku || ""),
      codigo: normalizeText(item.codigo || item.selected_codigo || ""),
      nome: itemLabel,
      quantidade: requestedQty,
      inventory_id: "",
      available_qty: 0,
      loja_venda: normalizedSaleStore,
      loja_origem_estoque: "",
      loja_entrega_retirada: normalizedDeliveryStore || normalizedSaleStore,
      fulfillment_mode: FULFILLMENT_MODES.SUL_AUDIT_PENDING,
      fulfillment_status: FULFILLMENT_STATUS.PENDING_ANALYSIS,
      message: "O estoque físico da loja Sul ainda está em implantação no sistema. Confirme o saldo antes de concluir vendas que dependam do estoque da Sul."
    };
  }

  return {
    ok: false,
    can_finalize: false,
    blocked: true,
    item_id: normalizeText(item.item_id || ""),
    product_id: normalizeText(item.product_id || item.selected_product_id || ""),
    sku: normalizeText(item.sku || item.selected_sku || ""),
    codigo: normalizeText(item.codigo || item.selected_codigo || ""),
    nome: itemLabel,
    quantidade: requestedQty,
    inventory_id: "",
    available_qty: 0,
    loja_venda: normalizedSaleStore,
    loja_origem_estoque: "",
    loja_entrega_retirada: normalizedDeliveryStore || normalizedSaleStore,
    fulfillment_mode: FULFILLMENT_MODES.NO_STOCK,
    fulfillment_status: FULFILLMENT_STATUS.BLOCKED_NO_STOCK,
    message: "Produto sem saldo disponível em nenhuma loja cadastrada no sistema."
  };
}

function resolveSaleFulfillmentPlan(items = [], saleStoreId = DEFAULT_STORE_ID, options = {}) {
  const records = options.records || ensureInventorySeeded();
  const fulfillments = (items || []).map((item) => resolveSaleItemFulfillment(item, saleStoreId, {
    records,
    deliveryStoreId: options.deliveryStoreId || item.loja_entrega_retirada || saleStoreId,
    preferredOriginStore: options.preferredOriginStore || item.selected_loja || item.store_id || ""
  }));
  return {
    ok: fulfillments.every((item) => item.ok),
    can_finalize: fulfillments.every((item) => item.can_finalize),
    fulfillments,
    blocked: fulfillments.filter((item) => item.blocked)
  };
}

function ensureInventoryRecord(records, payload = {}) {
  let record = findInventoryRecord(records, payload);
  if (record) {
    return record;
  }
  const productId = buildProductIdentity(payload);
  record = {
    inventory_id: buildId("INV"),
    product_id: productId,
    sku: normalizeText(payload.sku || payload.codigo || ""),
    codigo: normalizeText(payload.codigo || ""),
    nome: normalizeText(payload.nome || ""),
    descricao: normalizeText(payload.descricao || ""),
    marca: normalizeText(payload.marca || ""),
    categoria: normalizeText(payload.categoria || ""),
    tipo: normalizeText(payload.tipo || ""),
    cor: normalizeText(payload.cor || ""),
    tamanho: normalizeText(payload.tamanho || ""),
    preco_venda: roundQty(payload.preco_venda || 0),
    store_id: normalizeStoreId(payload.storeId || payload.store_id || DEFAULT_STORE_ID),
    available_qty: roundQty(payload.available_qty || 0),
    reserved_qty: roundQty(payload.reserved_qty || 0),
    unavailable_qty: roundQty(payload.unavailable_qty || 0),
    exchange_qty: roundQty(payload.exchange_qty || 0),
    consumption_qty: roundQty(payload.consumption_qty || 0),
    last_movement_at: nowIso(),
    status: normalizeText(payload.status || "ACTIVE") || "ACTIVE",
    source: normalizeText(payload.source || "PDV_OPERATIONAL")
  };
  records.push(record);
  return record;
}

function buildInventoryMovementRecord(payload = {}, user = {}) {
  return {
    movement_id: buildId("MOV"),
    inventory_id: normalizeText(payload.inventory_id || ""),
    type: normalizeText(payload.type || ""),
    product_id: normalizeText(payload.product_id || ""),
    sku: normalizeText(payload.sku || ""),
    codigo: normalizeText(payload.codigo || ""),
    nome: normalizeText(payload.nome || ""),
    store_id: normalizeStoreId(payload.store_id || payload.storeId || DEFAULT_STORE_ID),
    quantity: roundQty(payload.quantity || 0),
    direction: normalizeText(payload.direction || ""),
    reference_type: normalizeText(payload.reference_type || ""),
    reference_id: normalizeText(payload.reference_id || ""),
    reason: normalizeText(payload.reason || ""),
    created_by: user?.name || user?.email || "sistema",
    created_at: nowIso(),
    notes: normalizeText(payload.notes || ""),
    before_qty: roundQty(payload.before_qty || 0),
    after_qty: roundQty(payload.after_qty || 0),
    before_snapshot: payload.before_snapshot || null,
    after_snapshot: payload.after_snapshot || null,
    loja: normalizeStoreId(payload.store_id || payload.storeId || DEFAULT_STORE_ID),
    metadata: payload.metadata || {}
  };
}

function appendInventoryMovement(payload = {}, user = {}) {
  const movements = loadInventoryMovements();
  const movement = buildInventoryMovementRecord(payload, user);
  movements.unshift(movement);
  saveInventoryMovements(movements);
  appendEvent("INVENTORY_MOVEMENT", {
    loja: movement.store_id,
    reference_type: movement.reference_type,
    reference_id: movement.reference_id
  }, movement, user);
  return movement;
}

function saveInventoryAudit(action, payload = {}, user = {}) {
  appendAuditLog({
    audit_id: buildId("AUD"),
    action,
    created_at: nowIso(),
    actor: user?.name || user?.email || "sistema",
    actor_role: getPdvUserRole(user),
    loja: normalizeStoreId(payload.store_id || payload.loja || ""),
    reason: normalizeText(payload.reason || payload.notes || ""),
    before: payload.before || null,
    after: payload.after || null
  });
}

function updateRecordAvailabilityStatus(record) {
  const stockStatus = normalizeLookup(record?.estoque_status || record?.stock_status || "");
  const inventoryStatus = normalizeLookup(record?.inventory_status || "");
  if (stockStatus.startsWith("provisional") || inventoryStatus === "pending_count") {
    record.status = "ACTIVE";
    return record;
  }
  const available = roundQty(record.available_qty);
  if (available < 0) {
    record.status = "NEGATIVE";
  } else if (available === 0) {
    record.status = "OUT";
  } else if (available <= 1) {
    record.status = "LOW";
  } else if (!normalizeText(record.status) || ["OUT", "LOW", "NEGATIVE"].includes(normalizeText(record.status))) {
    record.status = "ACTIVE";
  }
  return record;
}

function emitStockAlertEvents(record, user = {}) {
  const available = roundQty(record.available_qty);
  if (available < 0) {
    appendEvent("STOCK_LOW", { loja: record.store_id }, { type: "negative_stock", product_id: record.product_id, sku: record.sku, available_qty: available }, user);
  } else if (available === 0) {
    appendEvent("STOCK_OUT", { loja: record.store_id }, { product_id: record.product_id, sku: record.sku, available_qty: available }, user);
  } else if (available === 1) {
    appendEvent("STOCK_LOW", { loja: record.store_id }, { type: "last_piece", product_id: record.product_id, sku: record.sku, available_qty: available }, user);
  }
}

function changeInventoryRecord(record, mutation = {}) {
  const before = cloneInventorySnapshot(record);
  record.available_qty = roundQty(toNumber(record.available_qty) + toNumber(mutation.available_delta || 0));
  record.reserved_qty = roundQty(toNumber(record.reserved_qty) + toNumber(mutation.reserved_delta || 0));
  record.unavailable_qty = roundQty(toNumber(record.unavailable_qty) + toNumber(mutation.unavailable_delta || 0));
  record.exchange_qty = roundQty(toNumber(record.exchange_qty) + toNumber(mutation.exchange_delta || 0));
  record.consumption_qty = roundQty(toNumber(record.consumption_qty) + toNumber(mutation.consumption_delta || 0));
  record.last_movement_at = nowIso();
  updateRecordAvailabilityStatus(record);
  const after = cloneInventorySnapshot(record);
  return { before, after };
}

function getInventorySummary({ storeId = "" } = {}) {
  const records = ensureInventorySeeded();
  const normalizedStore = normalizeStoreLookup(storeId || DEFAULT_STORE_ID);
  const filtered = storeId
    ? records.filter((item) => normalizeStoreLookup(item.store_id) === normalizedStore)
    : records;
  const alerts = getInventoryAlerts({ storeId, limit: 60 });
  const movements = getInventoryMovements({ storeId, limit: 20 }).items;
  const movementCountByProduct = new Map();
  getInventoryMovements({ storeId, limit: 1000 }).items.forEach((movement) => {
    const key = normalizeText(movement.product_id || movement.sku || movement.codigo || "");
    if (!key) return;
    movementCountByProduct.set(key, (movementCountByProduct.get(key) || 0) + Math.abs(toNumber(movement.quantity)));
  });
  const mostMoved = filtered
    .map((record) => ({
      ...record,
      movement_count: movementCountByProduct.get(normalizeText(record.product_id || "")) || 0
    }))
    .sort((left, right) => right.movement_count - left.movement_count)
    .slice(0, 12);
  return {
    metrics: {
      total_products: filtered.length,
      total_available_items: roundQty(filtered.reduce((sum, item) => sum + toNumber(item.available_qty), 0)),
      total_reserved_items: roundQty(filtered.reduce((sum, item) => sum + toNumber(item.reserved_qty), 0)),
      total_unavailable_items: roundQty(filtered.reduce((sum, item) => sum + toNumber(item.unavailable_qty), 0)),
      out_of_stock_products: filtered.filter((item) => toNumber(item.available_qty) <= 0).length,
      last_piece_products: filtered.filter((item) => toNumber(item.available_qty) === 1).length,
      movements_logged: getInventoryMovements({ storeId, limit: 1000 }).items.length,
      active_alerts: alerts.items.length
    },
    records: filtered.slice(0, 120),
    latestMovements: movements,
    alerts: alerts.items,
    alerts_count: alerts.total,
    alertsCount: alerts.total,
    mostMoved
  };
}

function buildInventorySearchText(record = {}) {
  return normalizeLookup([
    record.product_id,
    record.sku,
    record.codigo,
    record.codigo_tiny,
    record.codigo_etiqueta,
    record.ean,
    record.codigo_barras,
    record.barcode,
    record.gtin,
    record.gtin_ean,
    record.codigo_interno,
    record.nome,
    record.descricao,
    record.marca,
    record.categoria,
    record.linha_genero,
    record.tipo,
    record.cor,
    record.tamanho,
    record.store_id
  ].join(" "));
}

function isInventoryCodeLikeQuery(query = "") {
  const normalized = normalizeText(query || "");
  const digits = normalizeDigits(normalized);
  return Boolean(digits && digits.length >= 3 && /^[\d\s.\-_/]+$/.test(normalized));
}

function inventoryRecordMatchesExactCode(record = {}, query = "") {
  const normalizedQuery = normalizeText(query || "");
  const normalizedDigitsQuery = normalizeDigits(query || "");
  const textFields = [
    record.sku,
    record.codigo,
    record.codigo_tiny,
    record.codigo_etiqueta,
    record.codigo_interno
  ].map((value) => normalizeText(value || ""));
  const digitFields = [
    record.ean,
    record.codigo_barras,
    record.barcode,
    record.gtin,
    record.gtin_ean
  ].map((value) => normalizeDigits(value || ""));
  return textFields.includes(normalizedQuery) || (normalizedDigitsQuery && digitFields.includes(normalizedDigitsQuery));
}

function listInventoryProducts({ q = "", storeId = "", status = "", alert = "", page = 1, limit = 300 } = {}) {
  const records = ensureInventorySeeded();
  const normalizedQuery = normalizeLookup(q);
  const codeLikeQuery = isInventoryCodeLikeQuery(q);
  const normalizedStore = normalizeStoreLookup(storeId || DEFAULT_STORE_ID);
  const shouldScopeToStore = Boolean(storeId && !normalizedQuery);
  const normalizedStatus = normalizeText(status || "").toUpperCase();
  const normalizedAlert = normalizeText(alert || "").toLowerCase();
  const safePage = Math.max(1, Number(page || 1));
  const safeLimit = Math.max(1, Math.min(1000, Number(limit || 300)));
  const offset = Math.max(0, (safePage - 1) * safeLimit);
  const rows = records.filter((item) => {
    if (shouldScopeToStore && normalizeStoreLookup(item.store_id) !== normalizedStore) return false;
    if (normalizedStatus && normalizeText(item.status).toUpperCase() !== normalizedStatus) return false;
    if (normalizedQuery) {
      if (codeLikeQuery && !inventoryRecordMatchesExactCode(item, q)) return false;
      if (!codeLikeQuery && !buildInventorySearchText(item).includes(normalizedQuery)) return false;
    }
    if (normalizedAlert === "out" && toNumber(item.available_qty) > 0) return false;
    if (normalizedAlert === "low" && toNumber(item.available_qty) !== 1) return false;
    if (normalizedAlert === "negative" && toNumber(item.available_qty) >= 0) return false;
    return true;
  }).map((item) => {
    const itemStore = normalizeStoreLookup(item.store_id || "");
    const isOtherStoreResult = Boolean(storeId && normalizedQuery && itemStore && itemStore !== normalizedStore);
    const stockStatus = normalizeLookup(item.estoque_status || item.stock_status || "");
    const inventoryStatus = normalizeLookup(item.inventory_status || "");
    const qty = roundQty(item.available_qty || 0);
    let availabilityLabel = getProductAvailabilityLabel(qty);
    if (isOtherStoreResult) {
      availabilityLabel = qty > 0
        ? `Consultar ${formatStoreLabel(item.store_id)}`
        : `${formatStoreLabel(item.store_id)} em conferencia`;
    } else if (stockStatus.includes("divergent") || qty < 0) {
      availabilityLabel = "Divergente/provisorio - confirmar fisicamente";
    } else if (stockStatus.startsWith("provisional") || inventoryStatus === "pending_count") {
      availabilityLabel = "Pendente de conferencia";
    }
    return {
      ...item,
      active_store_context: storeId ? normalizeStoreId(storeId) : "",
      cross_store_result: isOtherStoreResult,
      availability_label: availabilityLabel
    };
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / safeLimit));
  return {
    items: rows.slice(offset, offset + safeLimit),
    total: rows.length,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: rows.length,
      totalPages,
      total_pages: totalPages,
      has_more: safePage < totalPages
    }
  };
}

function getInventoryProduct(identifier = "", { storeId = "" } = {}) {
  const records = ensureInventorySeeded();
  const normalizedIdentifier = normalizeText(identifier || "");
  const normalizedDigitsIdentifier = normalizeDigits(identifier || "");
  const normalizedStore = normalizeStoreLookup(storeId || DEFAULT_STORE_ID);
  const record = records.find((item) => (
    (!storeId || normalizeStoreLookup(item.store_id) === normalizedStore)
    && (
      [item.inventory_id, item.product_id, item.sku, item.codigo, item.codigo_tiny, item.codigo_etiqueta, item.codigo_interno]
        .map((value) => normalizeText(value))
        .includes(normalizedIdentifier)
      || (normalizedDigitsIdentifier && [item.ean, item.codigo_barras, item.barcode, item.gtin, item.gtin_ean].map((value) => normalizeDigits(value)).includes(normalizedDigitsIdentifier))
    )
  )) || null;
  if (!record) {
    return null;
  }
  const movements = loadInventoryMovements().filter((movement) => normalizeText(movement.product_id) === normalizeText(record.product_id)).slice(0, 120);
  return {
    ...record,
    availability_label: getProductAvailabilityLabel(record.available_qty),
    movements
  };
}

function getInventoryMovements({ storeId = "", productId = "", referenceId = "", limit = 200 } = {}) {
  const normalizedStore = normalizeStoreLookup(storeId || DEFAULT_STORE_ID);
  const normalizedProductId = normalizeText(productId || "");
  const normalizedReferenceId = normalizeText(referenceId || "");
  const items = loadInventoryMovements().filter((movement) => {
    if (storeId && normalizeStoreLookup(movement.store_id) !== normalizedStore) return false;
    if (normalizedProductId && normalizeText(movement.product_id) !== normalizedProductId && normalizeText(movement.sku) !== normalizedProductId && normalizeText(movement.codigo) !== normalizedProductId) return false;
    if (normalizedReferenceId && normalizeText(movement.reference_id) !== normalizedReferenceId) return false;
    return true;
  });
  return {
    items: items.slice(0, Math.max(1, Math.min(1000, Number(limit || 200)))),
    total: items.length
  };
}

function getInventoryAlerts({ storeId = "", limit = 120 } = {}) {
  const records = ensureInventorySeeded();
  const reservations = loadReservationsSnapshot();
  const normalizedStore = normalizeStoreLookup(storeId || DEFAULT_STORE_ID);
  const alerts = [];
  const expectedReservedByKey = new Map();
  reservations.forEach((reservation) => {
    if (reservation.inventory_status !== "HELD") return;
    const reservationStore = normalizeStoreLookup(reservation.loja || reservation.session_snapshot?.loja || DEFAULT_STORE_ID);
    if (storeId && reservationStore !== normalizedStore) return;
    (reservation.session_snapshot?.cart_items || []).forEach((item) => {
      const key = `${reservationStore}::${normalizeText(item.product_id || item.sku || item.codigo || "")}`;
      expectedReservedByKey.set(key, roundQty((expectedReservedByKey.get(key) || 0) + toNumber(item.quantidade || 1)));
    });
  });
  records.forEach((record) => {
    if (storeId && normalizeStoreLookup(record.store_id) !== normalizedStore) return;
    if (toNumber(record.available_qty) < 0) {
      alerts.push({ alert_id: buildId("ALT"), type: "negative_stock", severity: "error", product_id: record.product_id, sku: record.sku, store_id: record.store_id, message: `Estoque negativo em ${record.nome || record.sku || record.codigo}.`, created_at: nowIso() });
    } else if (toNumber(record.available_qty) === 0) {
      alerts.push({ alert_id: buildId("ALT"), type: "stock_out", severity: "warning", product_id: record.product_id, sku: record.sku, store_id: record.store_id, message: `Produto esgotado em ${record.store_id}.`, created_at: nowIso() });
    } else if (toNumber(record.available_qty) === 1) {
      alerts.push({ alert_id: buildId("ALT"), type: "last_piece", severity: "info", product_id: record.product_id, sku: record.sku, store_id: record.store_id, message: `Última peça disponível para ${record.nome || record.sku || record.codigo}.`, created_at: nowIso() });
    }
    if (!normalizeText(record.categoria)) {
      alerts.push({ alert_id: buildId("ALT"), type: "missing_category", severity: "warning", product_id: record.product_id, sku: record.sku, store_id: record.store_id, message: "Produto sem categoria operacional.", created_at: nowIso() });
    }
    if (!normalizeText(record.sku) && !normalizeText(record.codigo)) {
      alerts.push({ alert_id: buildId("ALT"), type: "missing_identifier", severity: "warning", product_id: record.product_id, sku: record.sku, store_id: record.store_id, message: "Produto sem SKU ou código.", created_at: nowIso() });
    }
    const reservedKey = `${normalizeStoreLookup(record.store_id)}::${normalizeText(record.product_id || record.sku || record.codigo || "")}`;
    const expectedReserved = roundQty(expectedReservedByKey.get(reservedKey) || 0);
    if (roundQty(record.reserved_qty) !== expectedReserved) {
      alerts.push({
        alert_id: buildId("ALT"),
        type: "movement_divergence",
        severity: "warning",
        product_id: record.product_id,
        sku: record.sku,
        store_id: record.store_id,
        message: `Divergência de movimentação no reservado: sistema ${roundQty(record.reserved_qty)} x reservas ativas ${expectedReserved}.`,
        created_at: nowIso()
      });
    }
  });
  reservations.forEach((reservation) => {
    const validade = reservation.validade ? new Date(reservation.validade) : null;
    const reservationStore = normalizeStoreLookup(reservation.loja || reservation.session_snapshot?.loja || DEFAULT_STORE_ID);
    if (storeId && reservationStore !== normalizedStore) return;
    if (!validade || Number.isNaN(validade.getTime())) return;
    if (reservation.inventory_status === "RELEASED" || reservation.inventory_status === "CONVERTED") return;
    if (validade < new Date()) {
      alerts.push({
        alert_id: buildId("ALT"),
        type: "expired_reservation",
        severity: "warning",
        product_id: "",
        sku: "",
        store_id: normalizeStoreId(reservation.loja || reservation.session_snapshot?.loja || DEFAULT_STORE_ID),
        message: `Reserva ${reservation.reservation_id} está vencida e ainda segura estoque.`,
        created_at: nowIso(),
        reference_id: reservation.reservation_id
      });
    }
  });
  return {
    items: alerts.slice(0, Math.max(1, Math.min(500, Number(limit || 120)))),
    total: alerts.length
  };
}

function validateStockAvailability(items = [], storeId = DEFAULT_STORE_ID) {
  const records = ensureInventorySeeded();
  const errors = [];
  (items || []).forEach((item) => {
    const requestedQty = Math.max(1, roundQty(item.quantidade || 1));
    const sourceStoreId = normalizeStoreId(
      item.loja_origem_estoque
      || item.stock_source_store_id
      || item.selected_loja
      || storeId
    );
    try {
      const record = resolveStrictInventoryRecord(records, item, sourceStoreId);
      const availableQty = roundQty(record?.available_qty || 0);
      if (availableQty < requestedQty) {
        errors.push({
          inventory_id: normalizeText(item.inventory_id || item.selected_inventory_id || record.inventory_id || ""),
          product_id: normalizeText(item.product_id || item.selected_product_id || item.sku || item.codigo || ""),
          sku: normalizeText(item.sku || item.codigo || ""),
          nome: normalizeText(item.nome || ""),
          store_id: sourceStoreId,
          requested_qty: requestedQty,
          available_qty: availableQty
        });
      }
    } catch (error) {
      errors.push({
        inventory_id: normalizeText(item.inventory_id || item.selected_inventory_id || ""),
        product_id: normalizeText(item.product_id || item.selected_product_id || item.sku || item.codigo || ""),
        sku: normalizeText(item.sku || item.codigo || ""),
        nome: normalizeText(item.nome || ""),
        store_id: sourceStoreId,
        requested_qty: requestedQty,
        available_qty: 0,
        reason: error.message || "Produto ambíguo no estoque."
      });
    }
  });
  return {
    ok: errors.length === 0,
    errors
  };
}

function applySaleInventory(sale, user = {}) {
  const records = ensureInventorySeeded();
  const movements = [];
  (sale.items || []).forEach((item) => {
    const originStore = normalizeStoreId(item.loja_origem_estoque || sale.loja_origem_estoque || sale.loja_venda || sale.loja);
    const record = resolveStrictInventoryRecord(records, item, originStore);
    const requestedQty = Math.max(1, roundQty(item.quantidade || 1));
    if (roundQty(record.available_qty) < requestedQty) {
      throw new Error(`Estoque insuficiente para ${item.nome || item.sku || item.codigo || "item do PDV"} na loja ${normalizeStoreId(originStore)}.`);
    }
    if (normalizeText(item.product_id || item.selected_product_id || "") && normalizeText(record.product_id) !== normalizeText(item.product_id || item.selected_product_id || "")) {
      throw new Error(`Produto ambíguo no estoque. Não foi possível baixar com segurança: ${item.nome || item.sku || item.codigo || "item do PDV"}.`);
    }
    const snapshots = changeInventoryRecord(record, {
      available_delta: -requestedQty
    });
    const movementType = sale.exchange_mode ? "EXCHANGE_OUT" : "SALE_OUT";
    const movement = appendInventoryMovement({
      inventory_id: record.inventory_id,
      type: movementType,
      product_id: record.product_id,
      sku: record.sku,
      codigo: record.codigo,
      nome: record.nome,
      store_id: record.store_id,
      quantity: requestedQty,
      direction: "OUT",
      reference_type: "SALE",
      reference_id: sale.sale_id,
      reason: sale.exchange_mode ? "Baixa operacional por troca." : "Baixa operacional por venda.",
      notes: sale.observacoes,
      before_qty: snapshots.before.available_qty,
      after_qty: snapshots.after.available_qty,
      before_snapshot: snapshots.before,
      after_snapshot: snapshots.after,
      metadata: {
        seller: sale.vendedor || "",
        customer_name: sale.customer?.name || "",
        exchange_origin_sale_id: sale.exchange_origin_sale_id || "",
        selected_product_id: normalizeText(item.product_id || item.selected_product_id || ""),
        selected_inventory_id: normalizeText(item.inventory_id || item.selected_inventory_id || ""),
        loja_venda: normalizeStoreId(item.loja_venda || sale.loja_venda || sale.loja),
        loja_origem_estoque: originStore,
        loja_entrega_retirada: normalizeStoreId(item.loja_entrega_retirada || sale.loja_entrega_retirada || sale.loja_venda || sale.loja),
        fulfillment_mode: normalizeText(item.fulfillment_mode || sale.fulfillment_mode || ""),
        fulfillment_status: normalizeText(item.fulfillment_status || sale.fulfillment_status || "")
      }
    }, user);
    movements.push(movement);
    emitStockAlertEvents(record, user);
  });
  saveInventoryRecords(records);
  saveInventoryAudit("PDV_INVENTORY_SALE_OUT", {
    store_id: sale.loja_venda || sale.loja,
    reason: "Baixa operacional de estoque por venda do PDV",
    before: { sale_id: sale.sale_id, items: (sale.items || []).map((item) => ({ sku: item.sku, quantidade: item.quantidade })) },
    after: { movement_ids: movements.map((item) => item.movement_id) }
  }, user);
  return movements;
}

function restoreSaleInventory(sale, user = {}) {
  const records = ensureInventorySeeded();
  const movements = [];
  (sale.items || []).forEach((item) => {
    const originStore = normalizeStoreId(item.loja_origem_estoque || sale.loja_origem_estoque || sale.loja_venda || sale.loja);
    const record = resolveStrictInventoryRecord(records, item, originStore);
    const quantity = Math.max(1, roundQty(item.quantidade || 1));
    const snapshots = changeInventoryRecord(record, {
      available_delta: quantity
    });
    const movement = appendInventoryMovement({
      inventory_id: record.inventory_id,
      type: "SALE_CANCEL_RETURN",
      product_id: record.product_id,
      sku: record.sku,
      codigo: record.codigo,
      nome: record.nome,
      store_id: record.store_id,
      quantity,
      direction: "IN",
      reference_type: "SALE",
      reference_id: sale.sale_id,
      reason: "Devolução operacional por cancelamento de venda.",
      notes: sale.cancel_reason || "",
      before_qty: snapshots.before.available_qty,
      after_qty: snapshots.after.available_qty,
      before_snapshot: snapshots.before,
      after_snapshot: snapshots.after
    }, user);
    movements.push(movement);
    emitStockAlertEvents(record, user);
  });
  saveInventoryRecords(records);
  saveInventoryAudit("PDV_INVENTORY_SALE_CANCEL_RETURN", {
    store_id: sale.loja_origem_estoque || sale.loja_venda || sale.loja,
    reason: sale.cancel_reason || "Cancelamento de venda com retorno ao estoque operacional",
    before: { sale_id: sale.sale_id },
    after: { movement_ids: movements.map((item) => item.movement_id) }
  }, user);
  return movements;
}

function holdReservationInventory(reservation, user = {}) {
  const records = ensureInventorySeeded();
  const items = reservation.session_snapshot?.cart_items || [];
  const validation = validateStockAvailability(items, reservation.loja || reservation.session_snapshot?.loja || DEFAULT_STORE_ID);
  if (!validation.ok) {
    throw new Error(`Reserva não pode ser criada porque faltam peças disponíveis: ${validation.errors.map((item) => item.nome || item.sku || item.product_id).join(", ")}.`);
  }
  const movements = [];
  items.forEach((item) => {
    const record = resolveStrictInventoryRecord(records, item, reservation.loja || reservation.session_snapshot?.loja || DEFAULT_STORE_ID);
    const quantity = Math.max(1, roundQty(item.quantidade || 1));
    const snapshots = changeInventoryRecord(record, {
      available_delta: -quantity,
      reserved_delta: quantity
    });
    const movement = appendInventoryMovement({
      inventory_id: record.inventory_id,
      type: "RESERVATION_HOLD",
      product_id: record.product_id,
      sku: record.sku,
      codigo: record.codigo,
      nome: record.nome,
      store_id: record.store_id,
      quantity,
      direction: "HOLD",
      reference_type: "RESERVATION",
      reference_id: reservation.reservation_id,
      reason: "Estoque separado para reserva do PDV.",
      notes: reservation.observacoes,
      before_qty: snapshots.before.available_qty,
      after_qty: snapshots.after.available_qty,
      before_snapshot: snapshots.before,
      after_snapshot: snapshots.after
    }, user);
    movements.push(movement);
  });
  saveInventoryRecords(records);
  reservation.inventory_status = "HELD";
  reservation.inventory_movements = movements.map((item) => item.movement_id);
  appendEvent("RESERVATION_HOLD", {
    loja: reservation.loja || reservation.session_snapshot?.loja || DEFAULT_STORE_ID,
    reference_id: reservation.reservation_id
  }, {
    reservation_id: reservation.reservation_id,
    movements: reservation.inventory_movements
  }, user);
  return movements;
}

function releaseReservationInventory(reservation, user = {}, { reason = "Liberação operacional de reserva." } = {}) {
  if (!reservation || reservation.inventory_status === "RELEASED" || reservation.inventory_status === "CONVERTED") {
    return [];
  }
  const records = ensureInventorySeeded();
  const items = reservation.session_snapshot?.cart_items || [];
  const movements = [];
  items.forEach((item) => {
    const record = resolveStrictInventoryRecord(records, item, reservation.loja || reservation.session_snapshot?.loja || DEFAULT_STORE_ID);
    const quantity = Math.max(1, roundQty(item.quantidade || 1));
    const snapshots = changeInventoryRecord(record, {
      available_delta: quantity,
      reserved_delta: -quantity
    });
    const movement = appendInventoryMovement({
      inventory_id: record.inventory_id,
      type: "RESERVATION_RELEASE",
      product_id: record.product_id,
      sku: record.sku,
      codigo: record.codigo,
      nome: record.nome,
      store_id: record.store_id,
      quantity,
      direction: "RELEASE",
      reference_type: "RESERVATION",
      reference_id: reservation.reservation_id,
      reason,
      notes: reservation.observacoes,
      before_qty: snapshots.before.available_qty,
      after_qty: snapshots.after.available_qty,
      before_snapshot: snapshots.before,
      after_snapshot: snapshots.after
    }, user);
    movements.push(movement);
  });
  saveInventoryRecords(records);
  reservation.inventory_status = "RELEASED";
  reservation.released_at = nowIso();
  reservation.released_by = user?.name || user?.email || "sistema";
  appendEvent("RESERVATION_RELEASED", {
    loja: reservation.loja || reservation.session_snapshot?.loja || DEFAULT_STORE_ID,
    reference_id: reservation.reservation_id
  }, {
    reservation_id: reservation.reservation_id,
    movements: movements.map((item) => item.movement_id)
  }, user);
  return movements;
}

function convertReservationInventory(reservation, sale, user = {}) {
  if (!reservation || reservation.inventory_status !== "HELD") {
    return [];
  }
  const records = ensureInventorySeeded();
  const items = reservation.session_snapshot?.cart_items || [];
  const movements = [];
  items.forEach((item) => {
    const record = resolveStrictInventoryRecord(records, item, reservation.loja || reservation.session_snapshot?.loja || DEFAULT_STORE_ID);
    const quantity = Math.max(1, roundQty(item.quantidade || 1));
    const snapshots = changeInventoryRecord(record, {
      reserved_delta: -quantity
    });
    const movement = appendInventoryMovement({
      inventory_id: record.inventory_id,
      type: "RESERVATION_CONVERTED",
      product_id: record.product_id,
      sku: record.sku,
      codigo: record.codigo,
      nome: record.nome,
      store_id: record.store_id,
      quantity,
      direction: "CONVERT",
      reference_type: "SALE",
      reference_id: sale.sale_id,
      reason: "Reserva convertida em venda operacional.",
      notes: reservation.observacoes,
      before_qty: snapshots.before.available_qty,
      after_qty: snapshots.after.available_qty,
      before_snapshot: snapshots.before,
      after_snapshot: snapshots.after
    }, user);
    movements.push(movement);
  });
  saveInventoryRecords(records);
  reservation.inventory_status = "CONVERTED";
  reservation.converted_at = nowIso();
  reservation.converted_sale_id = sale.sale_id;
  return movements;
}

function applyInternalConsumptionInventory(entry, user = {}) {
  const records = ensureInventorySeeded();
  const record = ensureInventoryRecord(records, {
    sku: entry.sku,
    codigo: entry.sku,
    nome: entry.produto,
    storeId: entry.loja
  });
  const quantity = Math.max(1, roundQty(entry.quantidade || 1));
  if (roundQty(record.available_qty) < quantity) {
    throw new Error(`Estoque insuficiente para registrar uso e consumo de ${entry.produto || entry.sku || "item"} em ${normalizeStoreId(entry.loja)}.`);
  }
  const snapshots = changeInventoryRecord(record, {
    available_delta: -quantity,
    consumption_delta: quantity
  });
  const movement = appendInventoryMovement({
    type: "INTERNAL_CONSUMPTION_OUT",
    product_id: record.product_id,
    sku: record.sku,
    codigo: record.codigo,
    nome: record.nome,
    store_id: record.store_id,
    quantity,
    direction: "OUT",
    reference_type: "INTERNAL_CONSUMPTION",
    reference_id: entry.consumption_id,
    reason: normalizeText(entry.motivo || "Uso e consumo operacional."),
    notes: normalizeText(entry.observacao || ""),
    before_qty: snapshots.before.available_qty,
    after_qty: snapshots.after.available_qty,
    before_snapshot: snapshots.before,
    after_snapshot: snapshots.after
  }, user);
  saveInventoryRecords(records);
  appendEvent("INTERNAL_CONSUMPTION_STOCK_OUT", {
    loja: record.store_id,
    reference_id: entry.consumption_id
  }, movement, user);
  return movement;
}

function applyExchangeInboundFromSale(originSale, exchange = {}, user = {}) {
  if (!originSale || !(originSale.items || []).length) {
    return [];
  }
  const records = ensureInventorySeeded();
  const movements = [];
  (originSale.items || []).forEach((item) => {
    const record = ensureInventoryRecord(records, {
      productId: item.product_id,
      sku: item.sku,
      codigo: item.codigo,
      nome: item.nome,
      marca: item.marca,
      categoria: item.categoria,
      cor: item.cor,
      tamanho: item.tamanho,
      storeId: originSale.loja || DEFAULT_STORE_ID
    });
    const quantity = Math.max(1, roundQty(item.quantidade || 1));
    const snapshots = changeInventoryRecord(record, {
      available_delta: quantity
    });
    const movement = appendInventoryMovement({
      type: "EXCHANGE_IN",
      product_id: record.product_id,
      sku: record.sku,
      codigo: record.codigo,
      nome: record.nome,
      store_id: record.store_id,
      quantity,
      direction: "IN",
      reference_type: "EXCHANGE",
      reference_id: exchange.exchange_id || "",
      reason: "Entrada operacional por troca de item devolvido.",
      notes: exchange.notes || "",
      before_qty: snapshots.before.available_qty,
      after_qty: snapshots.after.available_qty,
      before_snapshot: snapshots.before,
      after_snapshot: snapshots.after,
      metadata: {
        origin_sale_id: originSale.sale_id,
        exchange_id: exchange.exchange_id || ""
      }
    }, user);
    movements.push(movement);
    emitStockAlertEvents(record, user);
  });
  saveInventoryRecords(records);
  return movements;
}

function getExchangeInboundMutationByCondition(condition = "", quantity = 1) {
  const normalizedCondition = normalizeText(condition || "").toLowerCase();
  if (["disponivel", "disponivel_para_venda", "available", "ok"].includes(normalizedCondition)) {
    return {
      available_delta: quantity,
      bucket: "available"
    };
  }
  if (["perda", "perda_nao_retornar", "nao_retornar", "loss"].includes(normalizedCondition)) {
    return {
      unavailable_delta: quantity,
      bucket: "loss"
    };
  }
  return {
    exchange_delta: quantity,
    bucket: "exchange_review"
  };
}

function applyExchangeInboundItem(returnedItem = {}, exchange = {}, user = {}) {
  const quantity = Math.max(1, roundQty(returnedItem.quantity || returnedItem.quantidade || 1));
  if (!returnedItem || (!returnedItem.product_id && !returnedItem.sku && !returnedItem.codigo && !returnedItem.nome)) {
    throw new Error("Informe o item devolvido para registrar a entrada da troca.");
  }
  const records = ensureInventorySeeded();
  const storeId = normalizeStoreId(
    returnedItem.return_store_id
    || returnedItem.store_id
    || exchange.return_store_id
    || exchange.store_id
    || exchange.original_sale_store_id
    || DEFAULT_STORE_ID
  );
  const record = ensureInventoryRecord(records, {
    productId: returnedItem.product_id || returnedItem.selected_product_id,
    sku: returnedItem.sku,
    codigo: returnedItem.codigo,
    nome: returnedItem.nome || returnedItem.name,
    marca: returnedItem.marca || returnedItem.brand,
    categoria: returnedItem.categoria || returnedItem.category,
    cor: returnedItem.cor || returnedItem.color,
    tamanho: returnedItem.tamanho || returnedItem.size,
    preco_venda: returnedItem.preco_venda || returnedItem.price || returnedItem.unit_value,
    storeId
  });
  const condition = normalizeText(exchange.returned_condition || returnedItem.returned_condition || returnedItem.condition || "aguardando_conferencia");
  const mutation = getExchangeInboundMutationByCondition(condition, quantity);
  const snapshots = changeInventoryRecord(record, mutation);
  const movement = appendInventoryMovement({
    inventory_id: record.inventory_id,
    type: "EXCHANGE_IN",
    product_id: record.product_id,
    sku: record.sku,
    codigo: record.codigo,
    nome: record.nome,
    store_id: record.store_id,
    quantity,
    direction: "IN",
    reference_type: "EXCHANGE",
    reference_id: exchange.exchange_id || "",
    reason: mutation.bucket === "available"
      ? "Entrada por troca de item devolvido disponível para venda."
      : "Entrada por troca de item devolvido para conferência.",
    notes: exchange.notes || exchange.reason_notes || "",
    before_qty: snapshots.before.available_qty,
    after_qty: snapshots.after.available_qty,
    before_snapshot: snapshots.before,
    after_snapshot: snapshots.after,
    metadata: {
      origin_sale_id: exchange.original_sale_id || returnedItem.original_sale_id || "",
      origin_item_id: returnedItem.item_id || returnedItem.original_item_id || "",
      exchange_id: exchange.exchange_id || "",
      returned_condition: condition,
      inventory_bucket: mutation.bucket
    }
  }, user);
  emitStockAlertEvents(record, user);
  saveInventoryRecords(records);
  return [movement];
}

function createManualAdjustment(payload = {}, user = {}) {
  const records = ensureInventorySeeded();
  const reason = normalizeText(payload.reason || payload.motivo || "").toUpperCase();
  const notes = normalizeText(payload.notes || payload.observacao || "");
  const quantity = roundQty(payload.quantity || payload.quantidade || 0);
  if (!quantity) {
    throw new Error("Informe a quantidade do ajuste operacional.");
  }
  if (quantity < 0 && !reason) {
    throw new Error("Ajustes negativos exigem motivo obrigatório.");
  }
  if (reason && !INVENTORY_ADJUSTMENT_REASONS.includes(reason)) {
    throw new Error("Motivo de ajuste operacional do estoque inválido.");
  }
  const record = ensureInventoryRecord(records, {
    productId: payload.product_id,
    sku: payload.sku,
    codigo: payload.codigo,
    nome: payload.nome,
    marca: payload.marca,
    categoria: payload.categoria,
    cor: payload.cor,
    tamanho: payload.tamanho,
    storeId: payload.store_id || payload.loja || DEFAULT_STORE_ID
  });
  const snapshots = changeInventoryRecord(record, {
    available_delta: quantity,
    unavailable_delta: reason === "DEFEITO" ? Math.abs(Math.min(0, quantity)) : 0
  });
  const movementType = quantity >= 0 ? "MANUAL_ADJUSTMENT" : (reason === "DEFEITO" ? "DEFECT_OUT" : reason === "PERDA" ? "LOSS_OUT" : "MANUAL_ADJUSTMENT");
  const movement = appendInventoryMovement({
    type: movementType,
    product_id: record.product_id,
    sku: record.sku,
    codigo: record.codigo,
    nome: record.nome,
    store_id: record.store_id,
    quantity: Math.abs(quantity),
    direction: quantity >= 0 ? "IN" : "OUT",
    reference_type: "MANUAL_ADJUSTMENT",
    reference_id: buildId("ADJ"),
    reason: reason || "OUTRO",
    notes,
    before_qty: snapshots.before.available_qty,
    after_qty: snapshots.after.available_qty,
    before_snapshot: snapshots.before,
    after_snapshot: snapshots.after
  }, user);
  saveInventoryRecords(records);
  saveInventoryAudit("PDV_INVENTORY_MANUAL_ADJUSTMENT", {
    store_id: record.store_id,
    reason,
    notes,
    before: { product_id: record.product_id, snapshot: snapshots.before },
    after: { product_id: record.product_id, snapshot: snapshots.after, movement_id: movement.movement_id }
  }, user);
  emitStockAlertEvents(record, user);
  return {
    record,
    movement
  };
}

function createTransfer(payload = {}, user = {}) {
  const sourceStore = normalizeStoreId(payload.source_store || payload.loja_origem || "");
  const destinationStore = normalizeStoreId(payload.destination_store || payload.loja_destino || "");
  if (!sourceStore || !destinationStore || sourceStore === destinationStore) {
    throw new Error("Informe lojas de origem e destino diferentes para a transferência.");
  }
  const quantity = Math.max(1, roundQty(payload.quantity || payload.quantidade || 0));
  const records = ensureInventorySeeded();
  const sourceRecord = ensureInventoryRecord(records, {
    productId: payload.product_id,
    sku: payload.sku,
    codigo: payload.codigo,
    nome: payload.nome,
    marca: payload.marca,
    categoria: payload.categoria,
    cor: payload.cor,
    tamanho: payload.tamanho,
    storeId: sourceStore
  });
  if (roundQty(sourceRecord.available_qty) < quantity) {
    throw new Error("Estoque insuficiente na loja de origem para a transferência operacional.");
  }
  const destinationRecord = ensureInventoryRecord(records, {
    productId: sourceRecord.product_id,
    sku: sourceRecord.sku,
    codigo: sourceRecord.codigo,
    nome: sourceRecord.nome,
    marca: sourceRecord.marca,
    categoria: sourceRecord.categoria,
    cor: sourceRecord.cor,
    tamanho: sourceRecord.tamanho,
    storeId: destinationStore
  });
  const transfer = {
    transfer_id: buildId("TRF"),
    status: "SENT",
    source_store: sourceStore,
    destination_store: destinationStore,
    product_id: sourceRecord.product_id,
    sku: sourceRecord.sku,
    codigo: sourceRecord.codigo,
    nome: sourceRecord.nome,
    quantity,
    notes: normalizeText(payload.notes || payload.observacao || ""),
    created_at: nowIso(),
    created_by: user?.name || user?.email || "sistema"
  };
  const sourceSnapshots = changeInventoryRecord(sourceRecord, {
    available_delta: -quantity
  });
  const destinationSnapshots = changeInventoryRecord(destinationRecord, {
    available_delta: quantity
  });
  const movementOut = appendInventoryMovement({
    type: "TRANSFER_OUT",
    product_id: sourceRecord.product_id,
    sku: sourceRecord.sku,
    codigo: sourceRecord.codigo,
    nome: sourceRecord.nome,
    store_id: sourceStore,
    quantity,
    direction: "OUT",
    reference_type: "TRANSFER",
    reference_id: transfer.transfer_id,
    reason: "Transferência operacional entre lojas.",
    notes: transfer.notes,
    before_qty: sourceSnapshots.before.available_qty,
    after_qty: sourceSnapshots.after.available_qty,
    before_snapshot: sourceSnapshots.before,
    after_snapshot: sourceSnapshots.after
  }, user);
  const movementIn = appendInventoryMovement({
    type: "TRANSFER_IN",
    product_id: destinationRecord.product_id,
    sku: destinationRecord.sku,
    codigo: destinationRecord.codigo,
    nome: destinationRecord.nome,
    store_id: destinationStore,
    quantity,
    direction: "IN",
    reference_type: "TRANSFER",
    reference_id: transfer.transfer_id,
    reason: "Recebimento operacional de transferência entre lojas.",
    notes: transfer.notes,
    before_qty: destinationSnapshots.before.available_qty,
    after_qty: destinationSnapshots.after.available_qty,
    before_snapshot: destinationSnapshots.before,
    after_snapshot: destinationSnapshots.after
  }, user);
  const transfers = loadTransfers();
  transfers.unshift({
    ...transfer,
    movement_out_id: movementOut.movement_id,
    movement_in_id: movementIn.movement_id
  });
  saveTransfers(transfers);
  saveInventoryRecords(records);
  appendEvent("TRANSFER_CREATED", {
    loja: sourceStore,
    reference_id: transfer.transfer_id
  }, transfer, user);
  saveInventoryAudit("PDV_INVENTORY_TRANSFER", {
    store_id: sourceStore,
    reason: "Transferência operacional entre lojas",
    notes: transfer.notes,
    before: { source_store: sourceStore, destination_store: destinationStore },
    after: transfer
  }, user);
  return transfer;
}

function syncReservationRecordUpdate(reservation, updater) {
  const reservations = loadReservationsSnapshot();
  const index = reservations.findIndex((item) => item.reservation_id === reservation.reservation_id);
  if (index >= 0) {
    updater(reservations[index]);
    writeJson(reservationsFilePath, reservations);
    return reservations[index];
  }
  return reservation;
}

function releaseReservationById(reservationId, payload = {}, user = {}) {
  const reservations = loadReservationsSnapshot();
  const reservation = reservations.find((item) => item.reservation_id === normalizeText(reservationId));
  if (!reservation) {
    throw new Error("Reserva do PDV não encontrada para liberar estoque.");
  }
  const movements = releaseReservationInventory(reservation, user, { reason: normalizeText(payload.reason || payload.motivo || "Liberação manual de reserva.") });
  syncReservationRecordUpdate(reservation, (row) => {
    row.inventory_status = reservation.inventory_status;
    row.released_at = reservation.released_at;
    row.released_by = reservation.released_by;
  });
  return {
    reservation,
    movements
  };
}

function convertReservationById(reservationId, saleId, user = {}) {
  const reservations = loadReservationsSnapshot();
  const reservation = reservations.find((item) => item.reservation_id === normalizeText(reservationId));
  if (!reservation) {
    throw new Error("Reserva do PDV não encontrada para conversão.");
  }
  const salesPath = path.join(process.cwd(), "data", "pdv", "sales", "sales.json");
  const sales = readJson(salesPath, []);
  const sale = sales.find((item) => item.sale_id === normalizeText(saleId));
  if (!sale) {
    throw new Error("Venda do PDV não encontrada para converter a reserva.");
  }
  const movements = convertReservationInventory(reservation, sale, user);
  syncReservationRecordUpdate(reservation, (row) => {
    row.inventory_status = reservation.inventory_status;
    row.converted_at = reservation.converted_at;
    row.converted_sale_id = reservation.converted_sale_id;
  });
  return {
    reservation,
    sale,
    movements
  };
}

function searchInventoryProducts(query = "", { storeId = "", limit = 80 } = {}) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit || 80)));
  const rows = listInventoryProducts({ q: query, storeId, limit: safeLimit }).items;
  const priceByReference = new Map();
  if (rows.some((item) => roundQty(item.preco_venda || 0) <= 0)) {
    loadProductsDataset().forEach((product) => {
      const keys = [
        normalizeText(product.product_id || ""),
        normalizeText(product.sku || ""),
        normalizeText(product.codigo || ""),
        normalizeText(product.codigo_tiny || ""),
        normalizeText(product.codigo_etiqueta || ""),
        normalizeText(product.codigo_interno || ""),
        normalizeDigits(product.ean || product.codigo_barras || "")
      ].filter(Boolean);
      const nextPrice = roundQty(product.preco_venda || product.price || 0);
      keys.forEach((key) => {
        const currentPrice = roundQty(priceByReference.get(key) || 0);
        if (!priceByReference.has(key) || (currentPrice <= 0 && nextPrice > 0)) {
          priceByReference.set(key, nextPrice);
        }
      });
    });
  }
  return rows.slice(0, safeLimit).map((item) => {
    const lookupKeys = [
      normalizeText(item.product_id || ""),
      normalizeText(item.sku || ""),
      normalizeText(item.codigo || ""),
      normalizeText(item.codigo_tiny || ""),
      normalizeText(item.codigo_etiqueta || ""),
      normalizeText(item.codigo_interno || ""),
      normalizeDigits(item.ean || item.codigo_barras || "")
    ].filter(Boolean);
    const resolvedPrice = lookupKeys.reduce((found, key) => {
      if (found > 0) {
        return found;
      }
      return roundQty(priceByReference.get(key) || 0);
    }, roundQty(item.preco_venda || 0));
    return {
      id: normalizeText(item.product_id || item.sku || item.codigo || item.inventory_id),
      inventory_id: item.inventory_id,
      product_id: item.product_id,
      codigo: item.codigo,
      sku: item.sku,
      codigo_tiny: item.codigo_tiny || "",
      codigo_etiqueta: item.codigo_etiqueta || "",
      ean: item.ean || "",
      codigo_barras: item.codigo_barras || "",
      codigo_interno: item.codigo_interno || "",
      nome: item.nome,
      descricao: item.descricao,
      marca: item.marca,
      categoria: item.categoria,
      linha_genero: item.linha_genero || "",
      tipo: item.tipo,
      cor: item.cor,
      tamanho: item.tamanho,
      grade: item.grade || "",
      preco_venda: resolvedPrice,
      preco_custo: roundQty(item.preco_custo || 0),
      estoque: roundQty(item.available_qty),
      available_qty: roundQty(item.available_qty),
      reserved_qty: roundQty(item.reserved_qty),
      unavailable_qty: roundQty(item.unavailable_qty),
      store_id: item.store_id,
      status: item.status || "",
      tiny_stock_quantity: item.tiny_stock_quantity,
      imported_quantity_original: item.imported_quantity_original,
      estoque_status: item.estoque_status || "",
      inventory_status: item.inventory_status || "",
      sale_enabled: item.sale_enabled,
      parent_sku: item.parent_sku || "",
      gtin_tributavel: item.gtin_tributavel || "",
      unidade: item.unidade || "",
      ncm: item.ncm || "",
      origem_fiscal: item.origem_fiscal || "",
      import_batch_id: item.import_batch_id || "",
      active_store_context: item.active_store_context || "",
      cross_store_result: Boolean(item.cross_store_result),
      availability_label: item.availability_label || getProductAvailabilityLabel(item.available_qty),
      media_id: item.media_id || null,
      photo_preview_url: item.photo_preview_url || "",
      media_url: item.media_url || "",
      foto: item.foto || "",
      observacao: item.observacao || "",
      image: "",
      tags: [normalizeText(item.marca), normalizeText(item.categoria)].filter(Boolean)
    };
  });
}

function buildProductComparableIdentifiers(record = {}) {
  return [
    { field: "sku", label: "SKU", value: normalizeText(record.sku || "") },
    { field: "codigo_tiny", label: "Código Tiny", value: normalizeText(record.codigo_tiny || "") },
    { field: "codigo_etiqueta", label: "Código da etiqueta", value: normalizeText(record.codigo_etiqueta || "") },
    { field: "ean", label: "Código de barras / EAN", value: normalizeDigits(record.ean || record.codigo_barras || "") },
    { field: "codigo_interno", label: "Código interno", value: normalizeText(record.codigo_interno || record.codigo || "") },
    { field: "codigo", label: "Código", value: normalizeText(record.codigo || "") }
  ].filter((entry) => entry.value);
}

function normalizeManualProductPayload(payload = {}) {
  const labelCode = normalizeText(payload.label_code || payload.labelCode || payload.codigo_etiqueta || payload.codigoEtiqueta || payload.internal_code || payload.internalCode || payload.codigo_interno || payload.codigoInterno || payload.codigo || "");
  const barcode = normalizeDigits(payload.barcode || payload.codigo_barras || payload.codigoBarras || payload.ean || payload.gtin || payload.gtin_ean || payload.gtinEan || "");
  const sku = normalizeText(payload.sku || labelCode || "");
  const codigoTiny = normalizeText(payload.codigo_tiny || payload.codigoTiny || "");
  const codigoEtiqueta = normalizeText(payload.codigo_etiqueta || payload.codigoEtiqueta || payload.label_code || payload.labelCode || labelCode || "");
  const ean = barcode;
  const codigoInterno = normalizeText(payload.codigo_interno || payload.codigoInterno || payload.internal_code || payload.internalCode || labelCode || "");
  const productId = normalizeText(payload.product_id || payload.productId || "") || buildId("PRD");
  const codigoPrincipal = normalizeText(payload.codigo || codigoInterno || codigoTiny || sku || productId);
  const originalImportedQty = roundQty(pickFirstDefined(payload.imported_quantity_original, payload.tiny_stock_quantity, payload.estoque_original, payload.estoque, payload.estoque_inicial, payload.available_qty, 0));
  const operationalQty = roundQty(pickFirstDefined(payload.estoque, payload.available_qty, Math.max(0, originalImportedQty), 0));
  return {
    product_id: productId,
    codigo: codigoPrincipal,
    sku,
    codigo_tiny: codigoTiny,
    codigo_etiqueta: codigoEtiqueta,
    ean,
    codigo_barras: ean,
    codigo_interno: codigoInterno,
    nome: normalizeText(payload.nome || payload.name || ""),
    descricao: normalizeText(payload.descricao || payload.short_description || ""),
    marca: normalizeText(payload.marca || payload.brand || ""),
    categoria: normalizeText(payload.categoria || payload.category || ""),
    linha_genero: normalizeText(payload.linha_genero || payload.linhaGenero || ""),
    tipo: normalizeText(payload.tipo || payload.tipo_peca || payload.tipoPeca || ""),
    cor: normalizeText(payload.cor || ""),
    tamanho: normalizeText(payload.tamanho || ""),
    grade: normalizeText(payload.grade || ""),
    preco_venda: roundMoneyLike(pickFirstDefined(payload.preco_venda, payload.sale_price, payload.salePrice, payload.price, 0)),
    original_price: roundMoneyLike(payload.original_price || payload.originalPrice || payload.preco_original || payload.precoOriginal || 0),
    sale_price: roundMoneyLike(pickFirstDefined(payload.sale_price, payload.salePrice, payload.preco_venda, payload.price, 0)),
    preco_custo: roundMoneyLike(payload.preco_custo || payload.cost_price || payload.cost || 0),
    estoque: operationalQty,
    tiny_stock_quantity: originalImportedQty,
    imported_quantity_original: originalImportedQty,
    store_id: normalizeStoreId(payload.store_id || payload.origem_estoque || payload.storeId || DEFAULT_STORE_ID),
    status: normalizeText(payload.status || "ACTIVE") || "ACTIVE",
    observacao: normalizeText(payload.observacao || ""),
    media_id: Number(payload.media_id || payload.mediaId || 0) || null,
    photo_preview_url: normalizeText(payload.photo_preview_url || payload.preview_url || payload.previewUrl || ""),
    media_url: normalizeText(payload.media_url || payload.mediaUrl || ""),
    foto: normalizeText(payload.foto || payload.photo_preview_url || payload.preview_url || payload.previewUrl || ""),
    source: normalizeText(payload.source || "PDV_MANUAL") || "PDV_MANUAL",
    origem: normalizeText(payload.origem || payload.origin || ""),
    estoque_status: normalizeText(payload.estoque_status || payload.stock_status || ""),
    inventory_status: normalizeText(payload.inventory_status || payload.inventoryStatus || ""),
    import_batch_id: normalizeText(payload.import_batch_id || payload.importBatchId || ""),
    imported_at: normalizeText(payload.imported_at || payload.importedAt || ""),
    imported_by: normalizeText(payload.imported_by || payload.importedBy || ""),
    import_mode: normalizeTinyImportMode(payload.import_mode || payload.importMode || ""),
    stock_import_enabled: payload.stock_import_enabled === false ? false : payload.stockImportEnabled !== false,
    sale_enabled: typeof payload.sale_enabled === "boolean" ? payload.sale_enabled : normalizeTinyYesNo(payload.sale_enabled ?? payload.permitir_venda, true),
    parent_sku: normalizeText(payload.parent_sku || payload.parentSku || payload.codigo_pai || ""),
    gtin_tributavel: normalizeDigits(payload.gtin_tributavel || payload.gtinTributavel || ""),
    unidade: normalizeText(payload.unidade || payload.unit || ""),
    ncm: normalizeText(payload.ncm || payload.classificacao_fiscal || payload.classificacaoFiscal || ""),
    origem_fiscal: normalizeText(payload.origem_fiscal || payload.origemFiscal || ""),
    cest: normalizeText(payload.cest || ""),
    loja_confirmacao: normalizeStoreId(payload.loja_confirmacao || payload.confirmation_store_id || payload.store_id || payload.storeId || ""),
    usuario_confirmacao: normalizeText(payload.usuario_confirmacao || payload.confirmation_user || payload.confirmed_by || ""),
    data_confirmacao: normalizeText(payload.data_confirmacao || payload.confirmed_at || "")
  };
}

function findDuplicateProductByIdentifiers(datasetRows = [], inventoryRows = [], payload = {}, options = {}) {
  const incomingIdentifiers = buildProductComparableIdentifiers(payload);
  if (!incomingIdentifiers.length) {
    return null;
  }
  const excludedValues = new Set(buildProductComparableIdentifiers(options.currentProduct || {}).map((entry) => entry.value));
  const excludedProductId = normalizeText(options.currentProduct?.product_id || options.excludeProductId || "");
  const excludedInventoryId = normalizeText(options.currentInventoryId || options.excludeInventoryId || "");
  const datasetList = Array.isArray(datasetRows) ? datasetRows : [];
  const inventoryList = Array.isArray(inventoryRows) ? inventoryRows : [];
  const candidates = [
    ...datasetList.map((row) => ({ ...row, _source: "dataset" })),
    ...inventoryList.map((row) => ({ ...row, _source: "inventory" }))
  ];
  for (const candidate of candidates) {
    if (excludedProductId && normalizeText(candidate.product_id || "") === excludedProductId) {
      continue;
    }
    if (excludedInventoryId && normalizeText(candidate.inventory_id || "") === excludedInventoryId) {
      continue;
    }
    const candidateIdentifiers = buildProductComparableIdentifiers(candidate);
    for (const incoming of incomingIdentifiers) {
      if (excludedValues.has(incoming.value)) {
        continue;
      }
      const duplicateEntry = candidateIdentifiers.find((candidateEntry) => candidateEntry.value === incoming.value);
      if (duplicateEntry) {
        return {
          field: incoming.field,
          label: incoming.label,
          value: incoming.value,
          existing_product_id: normalizeText(candidate.product_id || ""),
          existing_inventory_id: normalizeText(candidate.inventory_id || ""),
          existing_name: normalizeText(candidate.nome || candidate.name || ""),
          existing_source: candidate._source
        };
      }
    }
  }
  return null;
}

function buildProductIdentifierLookup(datasetRows = [], inventoryRows = []) {
  const lookup = new Map();
  const addRecord = (record = {}, source = "") => {
    buildProductComparableIdentifiers(record).forEach((identifier) => {
      if (!identifier.value || lookup.has(identifier.value)) {
        return;
      }
      lookup.set(identifier.value, {
        field: identifier.field,
        label: identifier.label,
        value: identifier.value,
        existing_product_id: normalizeText(record.product_id || ""),
        existing_inventory_id: normalizeText(record.inventory_id || ""),
        existing_name: normalizeText(record.nome || record.name || ""),
        existing_source: source
      });
    });
  };
  (Array.isArray(datasetRows) ? datasetRows : []).forEach((row) => addRecord(row, "dataset"));
  (Array.isArray(inventoryRows) ? inventoryRows : []).forEach((row) => addRecord(row, "inventory"));
  return lookup;
}

function findDuplicateProductByIdentifierLookup(identifierLookup, payload = {}) {
  if (!(identifierLookup instanceof Map)) {
    return null;
  }
  const incomingIdentifiers = buildProductComparableIdentifiers(payload);
  for (const incoming of incomingIdentifiers) {
    const duplicate = identifierLookup.get(incoming.value);
    if (duplicate) {
      return {
        ...duplicate,
        field: incoming.field,
        label: incoming.label,
        value: incoming.value
      };
    }
  }
  return null;
}

function persistInventoryProduct(payload = {}, user = {}, options = {}) {
  const normalized = normalizeManualProductPayload(payload);
  if (!normalized.nome) {
    throw new Error("Informe o nome do produto para continuar.");
  }
  if (normalized.preco_venda <= 0) {
    throw new Error("Informe o preço de venda do produto.");
  }
  if (!buildProductComparableIdentifiers(normalized).length) {
    throw new Error("Informe pelo menos um identificador para o PDV reconhecer este produto.");
  }

  const datasetRows = loadProductsDataset();
  const inventoryRows = ensureInventorySeeded();
  const currentProduct = options.currentProduct ? normalizeManualProductPayload(options.currentProduct) : {};
  const duplicate = findDuplicateProductByIdentifiers(datasetRows, inventoryRows, normalized, {
    currentProduct,
    currentInventoryId: options.currentInventoryId || payload.inventory_id || ""
  });
  if (duplicate) {
    throw new Error("Já existe um produto com este identificador. Revise antes de cadastrar outro item.");
  }

  const timestamp = nowIso();
  const datasetIndex = datasetRows.findIndex((row) => normalizeText(row.product_id || "") === normalizeText(options.currentProduct?.product_id || normalized.product_id));
  const existingDataset = datasetIndex >= 0 ? datasetRows[datasetIndex] : null;
  const nextDatasetRow = {
    ...(existingDataset || {}),
    ...normalized,
    estoque: normalized.estoque,
    created_at: existingDataset?.created_at || timestamp,
    updated_at: timestamp,
    is_seed_data: existingDataset?.is_seed_data || false,
    batch_id: existingDataset?.batch_id || ""
  };
  if (datasetIndex >= 0) {
    datasetRows[datasetIndex] = nextDatasetRow;
  } else {
    datasetRows.unshift(nextDatasetRow);
  }
  saveProductsDataset(datasetRows);

  let targetInventoryRecord = null;
  const desiredStoreId = normalizeStoreId(normalized.store_id || DEFAULT_STORE_ID);
  if (options.currentInventoryId) {
    targetInventoryRecord = inventoryRows.find((row) => normalizeText(row.inventory_id || "") === normalizeText(options.currentInventoryId));
  }
  if (!targetInventoryRecord) {
    targetInventoryRecord = inventoryRows.find((row) => normalizeText(row.product_id || "") === normalizeText(nextDatasetRow.product_id) && normalizeStoreId(row.store_id) === desiredStoreId) || null;
  }
  if (!targetInventoryRecord) {
    targetInventoryRecord = ensureInventoryRecord(inventoryRows, {
      ...nextDatasetRow,
      store_id: desiredStoreId,
      available_qty: normalized.estoque,
      source: normalized.source
    });
    targetInventoryRecord.store_id = desiredStoreId;
  }
  const beforeSnapshot = cloneInventorySnapshot(targetInventoryRecord);
  Object.assign(targetInventoryRecord, {
    product_id: nextDatasetRow.product_id,
    sku: nextDatasetRow.sku || nextDatasetRow.codigo,
    codigo: nextDatasetRow.codigo,
    codigo_tiny: nextDatasetRow.codigo_tiny,
    codigo_etiqueta: nextDatasetRow.codigo_etiqueta,
    ean: nextDatasetRow.ean,
    codigo_barras: nextDatasetRow.codigo_barras,
    codigo_interno: nextDatasetRow.codigo_interno,
    nome: nextDatasetRow.nome,
    descricao: nextDatasetRow.descricao,
    marca: nextDatasetRow.marca,
    categoria: nextDatasetRow.categoria,
    linha_genero: nextDatasetRow.linha_genero,
    tipo: nextDatasetRow.tipo,
    cor: nextDatasetRow.cor,
    tamanho: nextDatasetRow.tamanho,
    grade: nextDatasetRow.grade,
    preco_venda: nextDatasetRow.preco_venda,
    original_price: nextDatasetRow.original_price,
    sale_price: nextDatasetRow.sale_price,
    preco_custo: nextDatasetRow.preco_custo,
    store_id: desiredStoreId,
    available_qty: normalized.estoque,
    tiny_stock_quantity: nextDatasetRow.tiny_stock_quantity,
    imported_quantity_original: nextDatasetRow.imported_quantity_original,
    observacao: nextDatasetRow.observacao,
    media_id: nextDatasetRow.media_id,
    photo_preview_url: nextDatasetRow.photo_preview_url,
    media_url: nextDatasetRow.media_url,
    foto: nextDatasetRow.foto,
    source: nextDatasetRow.source,
    origem: nextDatasetRow.origem,
    estoque_status: nextDatasetRow.estoque_status,
    inventory_status: nextDatasetRow.inventory_status,
    import_batch_id: nextDatasetRow.import_batch_id,
    imported_at: nextDatasetRow.imported_at,
    imported_by: nextDatasetRow.imported_by,
    import_mode: nextDatasetRow.import_mode,
    stock_import_enabled: nextDatasetRow.stock_import_enabled,
    sale_enabled: nextDatasetRow.sale_enabled,
    parent_sku: nextDatasetRow.parent_sku,
    gtin_tributavel: nextDatasetRow.gtin_tributavel,
    unidade: nextDatasetRow.unidade,
    ncm: nextDatasetRow.ncm,
    origem_fiscal: nextDatasetRow.origem_fiscal,
    cest: nextDatasetRow.cest,
    loja_confirmacao: nextDatasetRow.loja_confirmacao,
    usuario_confirmacao: nextDatasetRow.usuario_confirmacao,
    data_confirmacao: nextDatasetRow.data_confirmacao,
    status: nextDatasetRow.status,
    last_movement_at: timestamp
  });
  updateRecordAvailabilityStatus(targetInventoryRecord);
  saveInventoryRecords(inventoryRows);

  if (!existingDataset && normalized.estoque > 0) {
    appendInventoryMovement({
      inventory_id: targetInventoryRecord.inventory_id,
      type: "IMPORT_INITIAL",
      product_id: targetInventoryRecord.product_id,
      sku: targetInventoryRecord.sku,
      codigo: targetInventoryRecord.codigo,
      nome: targetInventoryRecord.nome,
      store_id: targetInventoryRecord.store_id,
      quantity: normalized.estoque,
      direction: "IN",
      reference_type: "PRODUCT_CREATE",
      reference_id: targetInventoryRecord.product_id,
      reason: "Cadastro manual inicial do produto no PDV.",
      before_qty: beforeSnapshot.available_qty,
      after_qty: targetInventoryRecord.available_qty,
      before_snapshot: beforeSnapshot,
      after_snapshot: cloneInventorySnapshot(targetInventoryRecord)
    }, user);
  }

  saveInventoryAudit(existingDataset ? "PRODUCT_UPDATED" : "PRODUCT_CREATED", {
    store_id: targetInventoryRecord.store_id,
    reason: existingDataset ? "Produto atualizado manualmente no PDV." : "Produto cadastrado manualmente no PDV.",
    before: existingDataset || null,
    after: {
      product_id: nextDatasetRow.product_id,
      sku: nextDatasetRow.sku,
      codigo: nextDatasetRow.codigo,
      nome: nextDatasetRow.nome,
      store_id: targetInventoryRecord.store_id
    }
  }, user);

  return {
    product: {
      ...targetInventoryRecord,
      availability_label: getProductAvailabilityLabel(targetInventoryRecord.available_qty)
    },
    duplicate: null
  };
}

function resolveTinyImportManualStoreOverride(value = "") {
  const normalized = normalizeText(value || "");
  if (!normalized || !isActiveOperationalStore(normalized)) {
    return null;
  }
  const storeId = normalizeStoreId(normalized);
  if (!storeId || storeId === DEFAULT_STORE_ID) {
    return null;
  }
  return {
    requested_value: normalized,
    store_id: storeId,
    store_label: formatStoreLabel(storeId)
  };
}

function mapTinyImportStoreInfo(item = {}) {
  const rawStore = normalizeText(item.store || item.loja || "");
  if (!rawStore) {
    return {
      raw_store: "",
      store_id: DEFAULT_STORE_ID,
      store_label: formatStoreLabel(DEFAULT_STORE_ID),
      pendingReason: "Loja não identificada na planilha. Estoque enviado para Estoque geral interno até auditoria."
    };
  }
  if (isActiveOperationalStore(rawStore)) {
    const storeId = normalizeStoreId(rawStore);
    return {
      raw_store: rawStore,
      store_id: storeId,
      store_label: formatStoreLabel(storeId),
      pendingReason: ""
    };
  }
  const normalizedStore = normalizeStoreId(rawStore);
  if (isLegacyOperationalStore(rawStore) || normalizedStore === DEFAULT_STORE_ID) {
    return {
      raw_store: rawStore,
      store_id: DEFAULT_STORE_ID,
      store_label: formatStoreLabel(DEFAULT_STORE_ID),
      pendingReason: `Loja "${rawStore}" não faz parte das lojas operacionais ativas. Estoque enviado para Estoque geral interno até conferência.`
    };
  }
  return {
    raw_store: rawStore,
    store_id: DEFAULT_STORE_ID,
    store_label: formatStoreLabel(DEFAULT_STORE_ID),
    pendingReason: `Loja "${rawStore}" não reconhecida. Estoque enviado para Estoque geral interno até conferência.`
  };
}

function mapTinyImportStoreInfoForImport(item = {}, options = {}) {
  const baseInfo = mapTinyImportStoreInfo(item);
  const manualOverride = resolveTinyImportManualStoreOverride(options.manualStoreOverride || options.storeOverride || "");
  const detectedStoreId = normalizeText(baseInfo.store_id || "") === normalizeText(DEFAULT_STORE_ID) && !normalizeText(baseInfo.raw_store || "")
    ? ""
    : normalizeText(baseInfo.store_id || "");
  const detectedStoreLabel = detectedStoreId ? formatStoreLabel(detectedStoreId) : "";
  if (!manualOverride) {
    return {
      ...baseInfo,
      detected_store_id: detectedStoreId,
      detected_store_label: detectedStoreLabel,
      override_applied: false,
      override_warning: ""
    };
  }
  if (!normalizeText(baseInfo.raw_store || "")) {
    return {
      ...baseInfo,
      detected_store_id: "",
      detected_store_label: "",
      store_id: manualOverride.store_id,
      store_label: manualOverride.store_label,
      pendingReason: "",
      override_applied: true,
      override_warning: `Loja definida manualmente para este arquivo: ${manualOverride.store_label}.`
    };
  }
  const detectedLabel = detectedStoreLabel || normalizeText(baseInfo.raw_store || "");
  return {
    ...baseInfo,
    detected_store_id: detectedStoreId,
    detected_store_label: detectedStoreLabel,
    store_id: manualOverride.store_id,
    store_label: manualOverride.store_label,
    pendingReason: "",
    override_applied: normalizeText(manualOverride.store_id) !== normalizeText(detectedStoreId),
    override_warning: normalizeText(manualOverride.store_id) !== normalizeText(detectedStoreId)
      ? `AtenÃ§Ã£o: vocÃª estÃ¡ substituindo a loja detectada no arquivo (${detectedLabel}) por ${manualOverride.store_label}.`
      : ""
  };
}

function inferTinyImportPieceType(item = {}) {
  const joined = normalizeLookup([
    item.category,
    item.name,
    item.commercial_name,
    item.color,
    item.raw_variations
  ].filter(Boolean).join(" "));
  if (!joined) {
    return "";
  }
  if (/(calcado|calçado|tenis|tênis|sapato|chinelo|birken|bota)/.test(joined)) {
    return "Calçado";
  }
  if (/(acessorio|acessorio|bolsa|bone|boné|cinto|oculos|óculos)/.test(joined)) {
    return "Acessório";
  }
  if (/(calca|calça|bermuda|short|saia)/.test(joined)) {
    return "Parte de baixo";
  }
  if (/(camiseta|camisa|regata|blusa|cropped|jaqueta|casaco|moletom|polo)/.test(joined)) {
    return "Parte de cima";
  }
  return "";
}

function mapTinyGroupedItemToInventoryPayload(item = {}, options = {}) {
  const storeInfo = mapTinyImportStoreInfoForImport(item, options);
  const sizeList = Array.isArray(item.sizes) ? item.sizes.map((value) => normalizeText(value)).filter(Boolean) : [];
  const importMode = normalizeTinyImportMode(options.importMode || "");
  const shouldImportStock = importMode !== "products_only";
  const originalPrice = roundQty(item.price);
  const promotionalPrice = roundQty(item.promotional_price);
  const normalizedPrice = promotionalPrice > 0 ? promotionalPrice : originalPrice;
  const normalizedCost = roundQty(item.cost);
  const originalTinyStock = roundQty(item.estoque_total);
  const operationalStock = shouldImportStock ? Math.max(0, originalTinyStock) : 0;
  const stockStatus = originalTinyStock < 0 ? "provisional_divergent" : "provisional";
  const importedAt = nowIso();
  const payload = {
    nome: normalizeText(item.commercial_name || item.name || ""),
    descricao: normalizeText(item.short_description || ""),
    marca: normalizeText(item.marca || ""),
    categoria: normalizeText(item.category || ""),
    linha_genero: normalizeText(item.gender || ""),
    tipo_peca: inferTinyImportPieceType(item),
    cor: normalizeText(item.color || ""),
    tamanho: sizeList.length === 1 ? sizeList[0] : "",
    grade: sizeList.length > 1 ? sizeList.join(", ") : "",
    sku: normalizeText(item.sku || item.codigo || ""),
    codigo: normalizeText(item.codigo || item.sku || ""),
    codigo_tiny: normalizeText(item.codigo || item.sku || ""),
    tiny_id: normalizeText(item.tiny_id || ""),
    codigo_etiqueta: normalizeText(item.codigo_etiqueta || item.sku || item.codigo || ""),
    ean: normalizeDigits(item.ean || item.codigo_barras || item.gtin || ""),
    codigo_barras: normalizeDigits(item.ean || item.codigo_barras || item.gtin || ""),
    gtin_tributavel: normalizeDigits(item.gtin_tributavel || ""),
    codigo_interno: normalizeText(item.codigo_interno || item.sku || item.codigo || ""),
    preco_venda: normalizedPrice,
    original_price: originalPrice,
    sale_price: normalizedPrice,
    preco_custo: normalizedCost,
    estoque: operationalStock,
    tiny_stock_quantity: originalTinyStock,
    imported_quantity_original: originalTinyStock,
    origem_estoque: storeInfo.store_id,
    store_id: storeInfo.store_id,
    status: "ACTIVE",
    sale_enabled: normalizeTinyYesNo(item.permitir_venda, true),
    parent_sku: normalizeText(item.codigo_pai || ""),
    unidade: normalizeText(item.unidade || ""),
    ncm: normalizeText(item.ncm || ""),
    origem_fiscal: normalizeText(item.origem_fiscal || ""),
    cest: normalizeText(item.cest || ""),
    origem: "tiny_import",
    estoque_status: stockStatus,
    inventory_status: "pending_count",
    imported_at: importedAt,
    imported_by: normalizeText(options.importedBy || ""),
    import_batch_id: normalizeText(options.importBatchId || ""),
    import_mode: importMode,
    stock_import_enabled: shouldImportStock,
    observacao: normalizeText(item.short_description || ""),
    photo_preview_url: Array.isArray(item.photos) ? normalizeText(item.photos[0] || "") : "",
    foto: Array.isArray(item.photos) ? normalizeText(item.photos[0] || "") : "",
    source: "tiny_import"
  };
  return {
    payload,
    storeInfo,
    sizeList
  };
}

function buildTinyInventoryPendingIssues(item = {}, mapped = {}, duplicate = null, duplicateInFile = false) {
  const pendingIssues = [];
  const blockingIssues = [];
  const payload = mapped.payload || {};
  if (!payload.nome) {
    blockingIssues.push("Sem nome");
  }
  if (!(payload.preco_venda > 0)) {
    blockingIssues.push("Sem preço");
  }
  if (!buildProductComparableIdentifiers(payload).length) {
    blockingIssues.push("Sem identificador");
  }
  if (!payload.sku) {
    pendingIssues.push("Sem SKU");
  }
  if (!payload.codigo_etiqueta) {
    pendingIssues.push("Sem etiqueta");
  }
  if (!payload.ean) {
    pendingIssues.push("Sem EAN");
  }
  if (!payload.foto) {
    pendingIssues.push("Sem foto");
  }
  if (!payload.marca) {
    pendingIssues.push("Sem marca");
  }
  if (!payload.sale_enabled) {
    pendingIssues.push("Tiny marcou como nao permitido nas vendas");
  }
  if (["inativo", "inactive", "hidden", "oculto"].includes(normalizeLookup(item.status || item.status_original || ""))) {
    pendingIssues.push("Tiny marcou como inativo");
  }
  if (mapped.storeInfo?.pendingReason) {
    pendingIssues.push("Estoque pendente de auditoria");
  }
  if (duplicateInFile) {
    pendingIssues.push("Duplicado no arquivo");
  }
  if (duplicate) {
    pendingIssues.push("Possível duplicidade");
  }
  if (normalizeArray(item.source_files).filter(Boolean).length > 1) {
    pendingIssues.push("SKU repetido entre arquivos: consolidado no lote");
  }
  const originalTinyStock = Number(item.estoque_total);
  if (Number.isFinite(originalTinyStock) && originalTinyStock < 0) {
    pendingIssues.push("Estoque negativo Tiny: divergencia provisoria");
  } else if (Number.isFinite(originalTinyStock) && originalTinyStock === 0) {
    pendingIssues.push("Estoque zerado provisoriamente");
  }
  return {
    pendingIssues,
    blockingIssues
  };
}

function applyTinyDuplicateImportToStore(entry = {}, user = {}) {
  const duplicate = entry.duplicate || null;
  if (!duplicate) {
    throw new Error("Produto duplicado sem referência existente para sincronizar o estoque.");
  }
  const datasetRows = loadProductsDataset();
  const inventoryRows = ensureInventorySeeded();
  const existingDataset = datasetRows.find((row) => normalizeText(row.product_id || "") === normalizeText(duplicate.existing_product_id || "")) || null;
  const existingInventory = inventoryRows.find((row) => normalizeText(row.inventory_id || "") === normalizeText(duplicate.existing_inventory_id || "")) || null;
  const sourceRecord = existingDataset || existingInventory;
  if (!sourceRecord) {
    throw new Error("Não foi possível localizar o produto base para aplicar o estoque na nova loja.");
  }
  const desiredStoreId = normalizeStoreId(entry.payload?.store_id || entry.payload?.origem_estoque || DEFAULT_STORE_ID);
  let targetInventoryRecord = inventoryRows.find((row) => normalizeText(row.product_id || "") === normalizeText(sourceRecord.product_id || "") && normalizeStoreId(row.store_id) === desiredStoreId) || null;
  if (!targetInventoryRecord) {
    targetInventoryRecord = ensureInventoryRecord(inventoryRows, {
      ...sourceRecord,
      ...entry.payload,
      productId: sourceRecord.product_id,
      storeId: desiredStoreId
    });
  }
  const beforeSnapshot = cloneInventorySnapshot(targetInventoryRecord);
  const shouldImportStock = entry.payload?.stock_import_enabled !== false;
  const nextAvailableQty = shouldImportStock
    ? roundQty(entry.payload?.estoque || 0)
    : roundQty(targetInventoryRecord.available_qty ?? sourceRecord.available_qty ?? sourceRecord.estoque ?? 0);
  Object.assign(targetInventoryRecord, {
    product_id: normalizeText(sourceRecord.product_id || targetInventoryRecord.product_id || ""),
    sku: normalizeText(entry.payload?.sku || sourceRecord.sku || sourceRecord.codigo || ""),
    codigo: normalizeText(sourceRecord.codigo || entry.payload?.codigo || ""),
    codigo_tiny: normalizeText(entry.payload?.codigo_tiny || sourceRecord.codigo_tiny || ""),
    codigo_etiqueta: normalizeText(entry.payload?.codigo_etiqueta || sourceRecord.codigo_etiqueta || ""),
    ean: normalizeDigits(entry.payload?.ean || sourceRecord.ean || sourceRecord.codigo_barras || ""),
    codigo_barras: normalizeDigits(entry.payload?.ean || sourceRecord.codigo_barras || sourceRecord.ean || ""),
    codigo_interno: normalizeText(entry.payload?.codigo_interno || sourceRecord.codigo_interno || sourceRecord.codigo || ""),
    nome: normalizeText(entry.payload?.nome || sourceRecord.nome || ""),
    descricao: normalizeText(entry.payload?.descricao || sourceRecord.descricao || ""),
    marca: normalizeText(entry.payload?.marca || sourceRecord.marca || ""),
    categoria: normalizeText(entry.payload?.categoria || sourceRecord.categoria || ""),
    linha_genero: normalizeText(entry.payload?.linha_genero || sourceRecord.linha_genero || ""),
    tipo: normalizeText(entry.payload?.tipo || sourceRecord.tipo || ""),
    cor: normalizeText(entry.payload?.cor || sourceRecord.cor || ""),
    tamanho: normalizeText(entry.payload?.tamanho || sourceRecord.tamanho || ""),
    grade: normalizeText(entry.payload?.grade || sourceRecord.grade || ""),
    preco_venda: roundQty(entry.payload?.preco_venda || sourceRecord.preco_venda || 0),
    preco_custo: roundQty(entry.payload?.preco_custo || sourceRecord.preco_custo || 0),
    store_id: desiredStoreId,
    available_qty: nextAvailableQty,
    tiny_stock_quantity: roundQty(entry.payload?.tiny_stock_quantity ?? sourceRecord.tiny_stock_quantity ?? entry.payload?.estoque ?? 0),
    imported_quantity_original: roundQty(entry.payload?.imported_quantity_original ?? sourceRecord.imported_quantity_original ?? entry.payload?.estoque ?? 0),
    observacao: normalizeText(entry.payload?.observacao || sourceRecord.observacao || ""),
    media_id: Number(entry.payload?.media_id || sourceRecord.media_id || 0) || null,
    photo_preview_url: normalizeText(entry.payload?.photo_preview_url || sourceRecord.photo_preview_url || ""),
    media_url: normalizeText(entry.payload?.media_url || sourceRecord.media_url || ""),
    foto: normalizeText(entry.payload?.foto || sourceRecord.foto || ""),
    source: normalizeText(entry.payload?.source || sourceRecord.source || "TINY_IMPORT") || "TINY_IMPORT",
    origem: normalizeText(entry.payload?.origem || sourceRecord.origem || "tiny_import") || "tiny_import",
    estoque_status: normalizeText(entry.payload?.estoque_status || sourceRecord.estoque_status || "provisional") || "provisional",
    inventory_status: normalizeText(entry.payload?.inventory_status || sourceRecord.inventory_status || "pending_count") || "pending_count",
    import_batch_id: normalizeText(entry.payload?.import_batch_id || sourceRecord.import_batch_id || ""),
    imported_at: normalizeText(entry.payload?.imported_at || sourceRecord.imported_at || nowIso()),
    imported_by: normalizeText(entry.payload?.imported_by || sourceRecord.imported_by || user?.name || user?.email || ""),
    import_mode: normalizeText(entry.payload?.import_mode || sourceRecord.import_mode || ""),
    stock_import_enabled: shouldImportStock,
    sale_enabled: typeof entry.payload?.sale_enabled === "boolean" ? entry.payload.sale_enabled : sourceRecord.sale_enabled,
    parent_sku: normalizeText(entry.payload?.parent_sku || sourceRecord.parent_sku || ""),
    gtin_tributavel: normalizeDigits(entry.payload?.gtin_tributavel || sourceRecord.gtin_tributavel || ""),
    unidade: normalizeText(entry.payload?.unidade || sourceRecord.unidade || ""),
    ncm: normalizeText(entry.payload?.ncm || sourceRecord.ncm || ""),
    origem_fiscal: normalizeText(entry.payload?.origem_fiscal || sourceRecord.origem_fiscal || ""),
    cest: normalizeText(entry.payload?.cest || sourceRecord.cest || ""),
    status: normalizeText(entry.payload?.status || sourceRecord.status || "ACTIVE") || "ACTIVE",
    last_movement_at: nowIso()
  });
  updateRecordAvailabilityStatus(targetInventoryRecord);
  saveInventoryRecords(inventoryRows);
  appendInventoryMovement({
    inventory_id: targetInventoryRecord.inventory_id,
    type: "IMPORT_STORE_SYNC",
    product_id: targetInventoryRecord.product_id,
    sku: targetInventoryRecord.sku,
    codigo: targetInventoryRecord.codigo,
    nome: targetInventoryRecord.nome,
    store_id: targetInventoryRecord.store_id,
    quantity: shouldImportStock ? roundQty(entry.payload?.estoque || 0) : 0,
    direction: "IN",
    reference_type: "TINY_IMPORT",
    reference_id: targetInventoryRecord.product_id,
    reason: "Sincronização de estoque Tiny para loja operacional específica.",
    before_qty: beforeSnapshot.available_qty,
    after_qty: targetInventoryRecord.available_qty,
    before_snapshot: beforeSnapshot,
    after_snapshot: cloneInventorySnapshot(targetInventoryRecord)
  }, user);
  saveInventoryAudit("TINY_IMPORT_STORE_SYNC", {
    store_id: targetInventoryRecord.store_id,
    reason: "Estoque importado do Tiny aplicado em loja operacional já existente.",
    before: beforeSnapshot,
    after: cloneInventorySnapshot(targetInventoryRecord)
  }, user);
  return targetInventoryRecord;
}

function getTinyInventoryImportStatus(item = {}, analysis = {}) {
  const originalStatus = normalizeLookup(item.status || item.status_original || "");
  if (["inativo", "inactive", "hidden", "oculto"].includes(originalStatus)) {
    return "PENDING_REVIEW";
  }
  if (analysis.pendingIssues?.length) {
    return "PENDING_REVIEW";
  }
  return "ACTIVE";
}

function buildTinyInventoryPreviewRow(item = {}, options = {}) {
  const datasetRows = Array.isArray(options.datasetRows) ? options.datasetRows : loadProductsDataset();
  const inventoryRows = Array.isArray(options.inventoryRows) ? options.inventoryRows : ensureInventorySeeded();
  const fileIdentifierMap = options.fileIdentifierMap instanceof Map ? options.fileIdentifierMap : new Map();
  const mapped = mapTinyGroupedItemToInventoryPayload(item, options);
  const normalizedPayload = normalizeManualProductPayload(mapped.payload);
  const comparableIdentifiers = buildProductComparableIdentifiers(normalizedPayload);
  const duplicate = options.identifierLookup instanceof Map
    ? findDuplicateProductByIdentifierLookup(options.identifierLookup, normalizedPayload)
    : findDuplicateProductByIdentifiers(datasetRows, inventoryRows, normalizedPayload);
  const currentLineNumber = item.lineNumbers?.[0] || item.line || 0;
  const requestedImportMode = normalizeTinyImportMode(options.importMode || "");
  const currentSourceFiles = normalizeArray(item.source_files).filter(Boolean);
  let duplicateInFile = false;
  let duplicateBetweenFiles = false;
  comparableIdentifiers.forEach((entry) => {
    if (!entry.value) {
      return;
    }
    const firstSeen = fileIdentifierMap.get(entry.value) || null;
    const firstSeenLine = Number(firstSeen && typeof firstSeen === "object" ? firstSeen.line : firstSeen || 0);
    const firstSeenFiles = normalizeArray(firstSeen && typeof firstSeen === "object" ? firstSeen.sourceFiles : []).filter(Boolean);
    const sharesSourceFile = currentSourceFiles.length && firstSeenFiles.length
      ? currentSourceFiles.some((file) => firstSeenFiles.includes(file))
      : true;
    if (firstSeen && (!sharesSourceFile || firstSeenLine !== currentLineNumber)) {
      duplicateInFile = true;
      duplicateBetweenFiles = !sharesSourceFile;
    } else {
      fileIdentifierMap.set(entry.value, {
        line: currentLineNumber,
        sourceFiles: currentSourceFiles
      });
    }
  });
  const issueAnalysis = buildTinyInventoryPendingIssues(item, mapped, duplicate, duplicateInFile);
  const canUpdateExisting = Boolean(duplicate && !duplicateInFile);
  const normalizedPendingIssues = canUpdateExisting
    ? issueAnalysis.pendingIssues.filter((issue) => issue !== "PossÃ­vel duplicidade")
    : issueAnalysis.pendingIssues;
  const normalizedIssueAnalysis = {
    ...issueAnalysis,
    pendingIssues: normalizedPendingIssues
  };
  if (duplicateBetweenFiles) {
    normalizedIssueAnalysis.pendingIssues = [
      ...normalizedIssueAnalysis.pendingIssues,
      "Duplicado entre arquivos do lote"
    ];
  }
  if (requestedImportMode === "stock_only" && !duplicate) {
    normalizedIssueAnalysis.blockingIssues = [
      ...normalizedIssueAnalysis.blockingIssues,
      "Produto novo ignorado no modo apenas estoque"
    ];
  }
  const status = getTinyInventoryImportStatus(item, normalizedIssueAnalysis);
  const shouldSkipDuplicate = Boolean(duplicateInFile);
  const canImport = !normalizedIssueAnalysis.blockingIssues.length && !shouldSkipDuplicate;
  const payload = {
    ...normalizedPayload,
    status,
    observacao: normalizeText([
      normalizedPayload.observacao,
      mapped.storeInfo?.pendingReason || "",
      mapped.storeInfo?.override_warning || "",
      duplicateInFile ? "Linha com identificador repetido dentro do arquivo Tiny." : ""
    ].filter(Boolean).join(" | "))
  };
  const action = normalizedIssueAnalysis.blockingIssues.length
    ? "error"
    : shouldSkipDuplicate
      ? "duplicate"
      : normalizedIssueAnalysis.pendingIssues.length
        ? "pending"
        : "ready";
  return {
    line_number: item.lineNumbers?.[0] || item.line || 0,
    nome: payload.nome,
    codigo_tiny: payload.codigo_tiny || normalizeText(item.tiny_id || ""),
    sku: payload.sku,
    codigo_etiqueta: payload.codigo_etiqueta,
    ean: payload.ean,
    codigo_barras: payload.codigo_barras || payload.ean,
    barcode: payload.codigo_barras || payload.ean,
    gtin: payload.ean,
    gtin_ean: payload.ean,
    codigo_interno: payload.codigo_interno,
    preco_venda: payload.preco_venda,
    original_price: payload.original_price,
    sale_price: payload.sale_price,
    preco_custo: payload.preco_custo,
    estoque: payload.estoque,
    tiny_stock_quantity: payload.tiny_stock_quantity,
    imported_quantity_original: payload.imported_quantity_original,
    estoque_status: payload.estoque_status,
    inventory_status: payload.inventory_status,
    sale_enabled: payload.sale_enabled,
    parent_sku: payload.parent_sku,
    gtin_tributavel: payload.gtin_tributavel,
    source_file: normalizeArray(item.source_files).filter(Boolean)[0] || "",
    source_files: item.source_files || [],
    categoria: payload.categoria,
    marca: payload.marca,
    cor: payload.cor,
    tamanho: payload.tamanho || mapped.sizeList?.join(", ") || "",
    grade: payload.grade,
    status,
    action,
    import_mode: canUpdateExisting ? "update" : "create",
    requested_import_mode: requestedImportMode,
    requested_import_mode_label: formatTinyImportModeLabel(requestedImportMode),
    can_import: canImport,
    pendencias: [...normalizedIssueAnalysis.blockingIssues, ...normalizedIssueAnalysis.pendingIssues],
    duplicate,
    duplicate_in_file: duplicateInFile,
    duplicate_between_files: duplicateBetweenFiles,
    store_id: payload.store_id,
    store_label: mapped.storeInfo?.store_label || formatStoreLabel(payload.store_id || DEFAULT_STORE_ID),
    detected_store_id: mapped.storeInfo?.detected_store_id || "",
    detected_store_label: mapped.storeInfo?.detected_store_label || "",
    override_applied: Boolean(mapped.storeInfo?.override_applied),
    override_warning: mapped.storeInfo?.override_warning || "",
    raw_store: mapped.storeInfo?.raw_store || "",
    photo_preview_url: payload.photo_preview_url || "",
    payload
  };
}

function previewTinyInventoryImport(groupedItems = [], options = {}) {
  const datasetRows = loadProductsDataset();
  const inventoryRows = ensureInventorySeeded();
  const fileIdentifierMap = new Map();
  const identifierLookup = buildProductIdentifierLookup(datasetRows, inventoryRows);
  const preview = normalizeArray(groupedItems).map((item) => buildTinyInventoryPreviewRow(item, {
    datasetRows,
    inventoryRows,
    identifierLookup,
    fileIdentifierMap,
    manualStoreOverride: options.manualStoreOverride || "",
    importBatchId: options.importBatchId || "",
    importedBy: options.importedBy || "",
    importMode: options.importMode || ""
  }));
  const brandSet = new Set();
  const detectedStoreSet = new Set();
  const appliedStoreSet = new Set();
  const fileSummaryMap = new Map();
  const hasDestinationInventory = (item = {}) => {
    const targetStoreId = normalizeStoreId(item.store_id || DEFAULT_STORE_ID);
    const duplicate = item.duplicate && typeof item.duplicate === "object" ? item.duplicate : null;
    const productId = normalizeText(
      duplicate?.existing_product_id
      || item.payload?.product_id
      || item.product_id
      || ""
    );
    const inventoryId = normalizeText(duplicate?.existing_inventory_id || item.inventory_id || "");
    if (!productId && !inventoryId) {
      return false;
    }
    return inventoryRows.some((row) => {
      const sameStore = normalizeStoreId(row.store_id || row.loja || DEFAULT_STORE_ID) === targetStoreId;
      const sameProduct = productId && normalizeText(row.product_id || "") === productId;
      const sameInventory = inventoryId && normalizeText(row.inventory_id || "") === inventoryId;
      return sameStore && (sameProduct || sameInventory);
    });
  };
  const importablePreview = preview.filter((item) => item.can_import);
  const destinationStockExistingRows = importablePreview.filter((item) => hasDestinationInventory(item)).length;
  const destinationStockCreateRows = Math.max(0, importablePreview.length - destinationStockExistingRows);
  const destinationStockUpsertRows = importablePreview.length;
  preview.forEach((item) => {
    if (normalizeText(item.marca || "")) brandSet.add(normalizeText(item.marca || ""));
    if (normalizeText(item.detected_store_label || "")) detectedStoreSet.add(normalizeText(item.detected_store_label || ""));
    if (normalizeText(item.store_label || "")) appliedStoreSet.add(normalizeText(item.store_label || ""));
    const sourceFiles = normalizeArray(item.source_files).filter(Boolean);
    const files = sourceFiles.length ? sourceFiles : ["Arquivo nao informado"];
    files.forEach((fileName) => {
      const fileKey = normalizeText(fileName || "Arquivo nao informado");
      const current = fileSummaryMap.get(fileKey) || {
        file: fileKey,
        rows: 0,
        validRows: 0,
        positiveStockRows: 0,
        zeroStockRows: 0,
        negativeStockRows: 0,
        duplicateRows: 0,
        consolidatedDuplicateRows: 0
      };
      const tinyQty = toNumber(item.tiny_stock_quantity ?? item.estoque ?? 0);
      current.rows += 1;
      if (item.can_import) current.validRows += 1;
      if (tinyQty > 0) current.positiveStockRows += 1;
      if (tinyQty === 0) current.zeroStockRows += 1;
      if (tinyQty < 0) current.negativeStockRows += 1;
      if (item.action === "duplicate") current.duplicateRows += 1;
      if (item.duplicate_between_files || sourceFiles.length > 1) current.consolidatedDuplicateRows += 1;
      fileSummaryMap.set(fileKey, current);
    });
  });
  const manualOverride = resolveTinyImportManualStoreOverride(options.manualStoreOverride || "");
  const summary = {
    totalRows: preview.length,
    validRows: preview.filter((item) => item.can_import).length,
    newRows: preview.filter((item) => item.can_import && item.import_mode === "create").length,
    updateRows: preview.filter((item) => item.can_import && item.import_mode === "update").length,
    catalogNewRows: preview.filter((item) => item.can_import && item.import_mode === "create").length,
    catalogExistingRows: preview.filter((item) => item.can_import && item.import_mode === "update").length,
    destinationStockExistingRows,
    destinationStockCreateRows,
    destinationStockUpdateRows: destinationStockExistingRows,
    destinationStockUpsertRows,
    readyRows: preview.filter((item) => item.action === "ready").length,
    pendingRows: preview.filter((item) => item.action === "pending").length,
    duplicateRows: preview.filter((item) => item.action === "duplicate").length,
    invalidRows: preview.filter((item) => item.action === "error").length,
    importedRows: 0,
    skippedRows: 0,
    productsWithPositiveStock: preview.filter((item) => toNumber(item.tiny_stock_quantity ?? item.estoque ?? 0) > 0).length,
    productsWithZeroStock: preview.filter((item) => toNumber(item.tiny_stock_quantity ?? item.estoque ?? 0) === 0).length,
    productsWithNegativeStock: preview.filter((item) => toNumber(item.tiny_stock_quantity ?? item.estoque ?? 0) < 0).length,
    negativeStockImportableRows: preview.filter((item) => toNumber(item.tiny_stock_quantity ?? item.estoque ?? 0) < 0 && item.can_import).length,
    provisionalStockRows: preview.filter((item) => ["provisional", "provisional_divergent"].includes(normalizeText(item.estoque_status || ""))).length,
    provisionalDivergentRows: preview.filter((item) => normalizeText(item.estoque_status || "") === "provisional_divergent").length,
    productsWithSku: preview.filter((item) => normalizeText(item.sku || "")).length,
    productsWithoutPrice: preview.filter((item) => item.pendencias.includes("Sem preço")).length,
    productsWithoutIdentifier: preview.filter((item) => item.pendencias.includes("Sem identificador")).length,
    productsWithoutSku: preview.filter((item) => item.pendencias.includes("Sem SKU")).length,
    productsWithoutEan: preview.filter((item) => item.pendencias.includes("Sem EAN")).length,
    productsWithoutEtiqueta: preview.filter((item) => item.pendencias.includes("Sem etiqueta")).length,
    productsWithoutBrand: preview.filter((item) => item.pendencias.includes("Sem marca")).length,
    productsWithoutPhoto: preview.filter((item) => item.pendencias.includes("Sem foto")).length,
    pendingAuditStock: preview.filter((item) => item.pendencias.includes("Estoque pendente de auditoria")).length,
    stockPositiveTotal: roundQty(preview.reduce((sum, item) => {
      const qty = toNumber(item.tiny_stock_quantity ?? item.estoque ?? 0);
      return qty > 0 ? sum + qty : sum;
    }, 0)),
    stockZeroTotal: preview.filter((item) => toNumber(item.tiny_stock_quantity ?? item.estoque ?? 0) === 0).length,
    stockNegativeTotal: roundQty(preview.reduce((sum, item) => {
      const qty = toNumber(item.tiny_stock_quantity ?? item.estoque ?? 0);
      return qty < 0 ? sum + qty : sum;
    }, 0)),
    provisionalStockTotal: roundQty(preview.reduce((sum, item) => sum + toNumber(item.estoque || 0), 0)),
    negativeStockMessage: preview.some((item) => toNumber(item.tiny_stock_quantity ?? item.estoque ?? 0) < 0)
      ? "Estoque negativo no Tiny será importado como divergência provisória. O produto continuará ativo e poderá ser vendido mediante confirmação física durante o inventário."
      : "",
    detectedBrands: Array.from(brandSet).sort((a, b) => a.localeCompare(b, "pt-BR")),
    detectedStores: Array.from(detectedStoreSet).sort((a, b) => a.localeCompare(b, "pt-BR")),
    appliedStores: Array.from(appliedStoreSet).sort((a, b) => a.localeCompare(b, "pt-BR")),
    detectedStoreLabel: Array.from(detectedStoreSet)[0] || "",
    appliedStoreLabel: manualOverride?.store_label || Array.from(appliedStoreSet)[0] || "",
    manualStoreOverride: manualOverride?.store_id || "",
    manualStoreOverrideLabel: manualOverride?.store_label || "",
    overrideAppliedRows: preview.filter((item) => item.override_applied).length,
    productsBoundToAppliedStore: manualOverride
      ? preview.filter((item) => normalizeStoreId(item.store_id || "") === manualOverride.store_id).length
      : 0,
    importMode: normalizeTinyImportMode(options.importMode || ""),
    importModeLabel: formatTinyImportModeLabel(options.importMode || ""),
    stockOnlySkippedNewRows: preview.filter((item) => item.pendencias.includes("Produto novo ignorado no modo apenas estoque")).length,
    duplicatedSkusAcrossFiles: preview.filter((item) => item.duplicate_between_files || normalizeArray(item.source_files).filter(Boolean).length > 1).length,
    fileSummaries: Array.from(fileSummaryMap.values()).sort((a, b) => a.file.localeCompare(b.file, "pt-BR"))
  };
  return {
    preview,
    summary
  };
}

const MAX_TINY_IMPORT_RESPONSE_PRODUCTS = 250;
const TINY_IMPORT_COMMIT_CHUNK_SIZE = 50;

function waitForNextImportChunk() {
  return new Promise((resolve) => setImmediate(resolve));
}

function getInventoryProductStoreKey(productId = "", storeId = "") {
  return `${normalizeText(productId || "")}::${normalizeStoreId(storeId || DEFAULT_STORE_ID)}`;
}

function buildTinyCommitIndexes(datasetRows = [], inventoryRows = []) {
  const datasetByProductId = new Map();
  const inventoryById = new Map();
  const inventoryByProductStore = new Map();
  datasetRows.forEach((row) => {
    const productId = normalizeText(row.product_id || "");
    if (productId) {
      datasetByProductId.set(productId, row);
    }
  });
  inventoryRows.forEach((row) => {
    const inventoryId = normalizeText(row.inventory_id || "");
    const productId = normalizeText(row.product_id || "");
    if (inventoryId) {
      inventoryById.set(inventoryId, row);
    }
    if (productId) {
      inventoryByProductStore.set(getInventoryProductStoreKey(productId, row.store_id), row);
    }
  });
  return {
    datasetByProductId,
    inventoryById,
    inventoryByProductStore
  };
}

function indexTinyCommitInventoryRecord(indexes, record = {}) {
  const inventoryId = normalizeText(record.inventory_id || "");
  const productId = normalizeText(record.product_id || "");
  if (inventoryId) {
    indexes.inventoryById.set(inventoryId, record);
  }
  if (productId) {
    indexes.inventoryByProductStore.set(getInventoryProductStoreKey(productId, record.store_id), record);
  }
}

function createTinyCommitInventoryRecord(inventoryRows = [], indexes, payload = {}) {
  const productId = normalizeText(payload.product_id || payload.productId || "") || buildProductIdentity(payload);
  const storeId = normalizeStoreId(payload.store_id || payload.storeId || DEFAULT_STORE_ID);
  const record = {
    inventory_id: buildId("INV"),
    product_id: productId,
    sku: normalizeText(payload.sku || payload.codigo || ""),
    codigo: normalizeText(payload.codigo || ""),
    nome: normalizeText(payload.nome || ""),
    descricao: normalizeText(payload.descricao || ""),
    marca: normalizeText(payload.marca || ""),
    categoria: normalizeText(payload.categoria || ""),
    tipo: normalizeText(payload.tipo || ""),
    cor: normalizeText(payload.cor || ""),
    tamanho: normalizeText(payload.tamanho || ""),
    preco_venda: roundQty(payload.preco_venda || 0),
    store_id: storeId,
    available_qty: roundQty(payload.available_qty || payload.estoque || 0),
    reserved_qty: roundQty(payload.reserved_qty || 0),
    unavailable_qty: roundQty(payload.unavailable_qty || 0),
    exchange_qty: roundQty(payload.exchange_qty || 0),
    consumption_qty: roundQty(payload.consumption_qty || 0),
    last_movement_at: nowIso(),
    status: normalizeText(payload.status || "ACTIVE") || "ACTIVE",
    source: normalizeText(payload.source || "PDV_OPERATIONAL")
  };
  inventoryRows.push(record);
  indexTinyCommitInventoryRecord(indexes, record);
  return record;
}

function assignTinyCommitProductToInventory(record = {}, datasetRow = {}, desiredStoreId = "", timestamp = nowIso(), availableQty = null) {
  Object.assign(record, {
    product_id: datasetRow.product_id,
    sku: datasetRow.sku || datasetRow.codigo,
    codigo: datasetRow.codigo,
    codigo_tiny: datasetRow.codigo_tiny,
    codigo_etiqueta: datasetRow.codigo_etiqueta,
    ean: datasetRow.ean,
    codigo_barras: datasetRow.codigo_barras,
    codigo_interno: datasetRow.codigo_interno,
    nome: datasetRow.nome,
    descricao: datasetRow.descricao,
    marca: datasetRow.marca,
    categoria: datasetRow.categoria,
    linha_genero: datasetRow.linha_genero,
    tipo: datasetRow.tipo,
    cor: datasetRow.cor,
    tamanho: datasetRow.tamanho,
    grade: datasetRow.grade,
    preco_venda: datasetRow.preco_venda,
    original_price: datasetRow.original_price,
    sale_price: datasetRow.sale_price,
    preco_custo: datasetRow.preco_custo,
    store_id: normalizeStoreId(desiredStoreId || datasetRow.store_id || DEFAULT_STORE_ID),
    available_qty: availableQty === null ? roundQty(datasetRow.estoque || 0) : roundQty(availableQty),
    tiny_stock_quantity: datasetRow.tiny_stock_quantity,
    imported_quantity_original: datasetRow.imported_quantity_original,
    observacao: datasetRow.observacao,
    media_id: datasetRow.media_id,
    photo_preview_url: datasetRow.photo_preview_url,
    media_url: datasetRow.media_url,
    foto: datasetRow.foto,
    source: datasetRow.source,
    origem: datasetRow.origem,
    estoque_status: datasetRow.estoque_status,
    inventory_status: datasetRow.inventory_status,
    import_batch_id: datasetRow.import_batch_id,
    imported_at: datasetRow.imported_at,
    imported_by: datasetRow.imported_by,
    import_mode: datasetRow.import_mode,
    stock_import_enabled: datasetRow.stock_import_enabled,
    sale_enabled: datasetRow.sale_enabled,
    parent_sku: datasetRow.parent_sku,
    gtin_tributavel: datasetRow.gtin_tributavel,
    unidade: datasetRow.unidade,
    ncm: datasetRow.ncm,
    origem_fiscal: datasetRow.origem_fiscal,
    cest: datasetRow.cest,
    loja_confirmacao: datasetRow.loja_confirmacao,
    usuario_confirmacao: datasetRow.usuario_confirmacao,
    data_confirmacao: datasetRow.data_confirmacao,
    status: datasetRow.status,
    last_movement_at: timestamp
  });
  updateRecordAvailabilityStatus(record);
  return record;
}

function pushTinyCommitMovement(movements = [], payload = {}, user = {}) {
  const movement = buildInventoryMovementRecord(payload, user);
  movements.unshift(movement);
  return movement;
}

function persistTinyNewProductInMemory(entry = {}, context = {}) {
  const { datasetRows, inventoryRows, movements, indexes, user, timestamp } = context;
  const normalized = normalizeManualProductPayload(entry.payload || {});
  if (!normalized.nome) {
    throw new Error("Informe o nome do produto para continuar.");
  }
  if (normalized.preco_venda <= 0) {
    throw new Error("Informe o preco de venda do produto.");
  }
  if (!buildProductComparableIdentifiers(normalized).length) {
    throw new Error("Informe pelo menos um identificador para o PDV reconhecer este produto.");
  }

  const productId = normalizeText(normalized.product_id || "");
  const existingDataset = productId ? indexes.datasetByProductId.get(productId) || null : null;
  const nextDatasetRow = {
    ...(existingDataset || {}),
    ...normalized,
    estoque: normalized.estoque,
    created_at: existingDataset?.created_at || timestamp,
    updated_at: timestamp,
    is_seed_data: existingDataset?.is_seed_data || false,
    batch_id: existingDataset?.batch_id || ""
  };
  if (existingDataset) {
    const datasetIndex = datasetRows.indexOf(existingDataset);
    if (datasetIndex >= 0) {
      datasetRows[datasetIndex] = nextDatasetRow;
    }
  } else {
    datasetRows.unshift(nextDatasetRow);
  }
  indexes.datasetByProductId.set(normalizeText(nextDatasetRow.product_id || ""), nextDatasetRow);

  const desiredStoreId = normalizeStoreId(normalized.store_id || DEFAULT_STORE_ID);
  let targetInventoryRecord = indexes.inventoryByProductStore.get(getInventoryProductStoreKey(nextDatasetRow.product_id, desiredStoreId)) || null;
  if (!targetInventoryRecord) {
    targetInventoryRecord = createTinyCommitInventoryRecord(inventoryRows, indexes, {
      ...nextDatasetRow,
      store_id: desiredStoreId,
      available_qty: normalized.estoque,
      source: normalized.source
    });
  }
  const beforeSnapshot = cloneInventorySnapshot(targetInventoryRecord);
  assignTinyCommitProductToInventory(targetInventoryRecord, nextDatasetRow, desiredStoreId, timestamp, normalized.estoque);
  indexTinyCommitInventoryRecord(indexes, targetInventoryRecord);

  if (!existingDataset && normalized.estoque > 0) {
    pushTinyCommitMovement(movements, {
      inventory_id: targetInventoryRecord.inventory_id,
      type: "IMPORT_INITIAL",
      product_id: targetInventoryRecord.product_id,
      sku: targetInventoryRecord.sku,
      codigo: targetInventoryRecord.codigo,
      nome: targetInventoryRecord.nome,
      store_id: targetInventoryRecord.store_id,
      quantity: normalized.estoque,
      direction: "IN",
      reference_type: "PRODUCT_CREATE",
      reference_id: targetInventoryRecord.product_id,
      reason: "Cadastro inicial do produto importado do Tiny no PDV.",
      before_qty: beforeSnapshot.available_qty,
      after_qty: targetInventoryRecord.available_qty,
      before_snapshot: beforeSnapshot,
      after_snapshot: cloneInventorySnapshot(targetInventoryRecord)
    }, user);
  }

  return {
    product: {
      ...targetInventoryRecord,
      availability_label: getProductAvailabilityLabel(targetInventoryRecord.available_qty)
    },
    duplicate: null
  };
}

function applyTinyDuplicateImportToStoreInMemory(entry = {}, context = {}) {
  const { datasetRows, inventoryRows, movements, indexes, user, timestamp } = context;
  const duplicate = entry.duplicate || null;
  if (!duplicate) {
    throw new Error("Produto duplicado sem referencia existente para sincronizar o estoque.");
  }
  const existingDataset = indexes.datasetByProductId.get(normalizeText(duplicate.existing_product_id || "")) || null;
  const existingInventory = indexes.inventoryById.get(normalizeText(duplicate.existing_inventory_id || "")) || null;
  const sourceRecord = existingDataset || existingInventory;
  if (!sourceRecord) {
    throw new Error("Nao foi possivel localizar o produto base para aplicar o estoque na nova loja.");
  }
  const desiredStoreId = normalizeStoreId(entry.payload?.store_id || entry.payload?.origem_estoque || DEFAULT_STORE_ID);
  let targetInventoryRecord = indexes.inventoryByProductStore.get(getInventoryProductStoreKey(sourceRecord.product_id, desiredStoreId)) || null;
  if (!targetInventoryRecord) {
    targetInventoryRecord = createTinyCommitInventoryRecord(inventoryRows, indexes, {
      ...sourceRecord,
      ...entry.payload,
      productId: sourceRecord.product_id,
      product_id: sourceRecord.product_id,
      storeId: desiredStoreId,
      store_id: desiredStoreId
    });
  }
  const beforeSnapshot = cloneInventorySnapshot(targetInventoryRecord);
  const shouldImportStock = entry.payload?.stock_import_enabled !== false;
  const nextAvailableQty = shouldImportStock
    ? roundQty(entry.payload?.estoque || 0)
    : roundQty(targetInventoryRecord.available_qty ?? sourceRecord.available_qty ?? sourceRecord.estoque ?? 0);
  const mergedRecord = {
    ...sourceRecord,
    ...entry.payload,
    product_id: normalizeText(sourceRecord.product_id || targetInventoryRecord.product_id || ""),
    sku: normalizeText(entry.payload?.sku || sourceRecord.sku || sourceRecord.codigo || ""),
    codigo: normalizeText(sourceRecord.codigo || entry.payload?.codigo || ""),
    codigo_tiny: normalizeText(entry.payload?.codigo_tiny || sourceRecord.codigo_tiny || ""),
    codigo_etiqueta: normalizeText(entry.payload?.codigo_etiqueta || sourceRecord.codigo_etiqueta || ""),
    ean: normalizeDigits(entry.payload?.ean || sourceRecord.ean || sourceRecord.codigo_barras || ""),
    codigo_barras: normalizeDigits(entry.payload?.ean || sourceRecord.codigo_barras || sourceRecord.ean || ""),
    codigo_interno: normalizeText(entry.payload?.codigo_interno || sourceRecord.codigo_interno || sourceRecord.codigo || ""),
    nome: normalizeText(entry.payload?.nome || sourceRecord.nome || ""),
    preco_venda: roundQty(entry.payload?.preco_venda || sourceRecord.preco_venda || 0),
    preco_custo: roundQty(entry.payload?.preco_custo || sourceRecord.preco_custo || 0),
    estoque: nextAvailableQty,
    store_id: desiredStoreId,
    tiny_stock_quantity: roundQty(entry.payload?.tiny_stock_quantity ?? sourceRecord.tiny_stock_quantity ?? entry.payload?.estoque ?? 0),
    imported_quantity_original: roundQty(entry.payload?.imported_quantity_original ?? sourceRecord.imported_quantity_original ?? entry.payload?.estoque ?? 0),
    media_id: Number(entry.payload?.media_id || sourceRecord.media_id || 0) || null,
    source: normalizeText(entry.payload?.source || sourceRecord.source || "TINY_IMPORT") || "TINY_IMPORT",
    origem: normalizeText(entry.payload?.origem || sourceRecord.origem || "tiny_import") || "tiny_import",
    estoque_status: normalizeText(entry.payload?.estoque_status || sourceRecord.estoque_status || "provisional") || "provisional",
    inventory_status: normalizeText(entry.payload?.inventory_status || sourceRecord.inventory_status || "pending_count") || "pending_count",
    imported_at: normalizeText(entry.payload?.imported_at || sourceRecord.imported_at || timestamp),
    imported_by: normalizeText(entry.payload?.imported_by || sourceRecord.imported_by || user?.name || user?.email || ""),
    stock_import_enabled: shouldImportStock,
    sale_enabled: typeof entry.payload?.sale_enabled === "boolean" ? entry.payload.sale_enabled : sourceRecord.sale_enabled,
    status: normalizeText(entry.payload?.status || sourceRecord.status || "ACTIVE") || "ACTIVE"
  };
  assignTinyCommitProductToInventory(targetInventoryRecord, mergedRecord, desiredStoreId, timestamp, nextAvailableQty);
  indexTinyCommitInventoryRecord(indexes, targetInventoryRecord);
  pushTinyCommitMovement(movements, {
    inventory_id: targetInventoryRecord.inventory_id,
    type: "IMPORT_STORE_SYNC",
    product_id: targetInventoryRecord.product_id,
    sku: targetInventoryRecord.sku,
    codigo: targetInventoryRecord.codigo,
    nome: targetInventoryRecord.nome,
    store_id: targetInventoryRecord.store_id,
    quantity: shouldImportStock ? roundQty(entry.payload?.estoque || 0) : 0,
    direction: "IN",
    reference_type: "TINY_IMPORT",
    reference_id: targetInventoryRecord.product_id,
    reason: "Sincronizacao de estoque Tiny para loja operacional especifica.",
    before_qty: beforeSnapshot.available_qty,
    after_qty: targetInventoryRecord.available_qty,
    before_snapshot: beforeSnapshot,
    after_snapshot: cloneInventorySnapshot(targetInventoryRecord)
  }, user);
  return targetInventoryRecord;
}

async function commitTinyInventoryImport(groupedItems = [], user = {}, options = {}) {
  const hasPreparedPreview = Array.isArray(options.previewRows) && options.previewRows.length;
  const preparedPreviewPayload = hasPreparedPreview
    ? {
        preview: options.previewRows,
        summary: options.previewSummary || {
          totalRows: options.previewRows.length,
          validRows: options.previewRows.filter((item) => item.can_import).length
        }
      }
    : previewTinyInventoryImport(groupedItems, {
        ...options,
        importedBy: options.importedBy || user?.name || user?.email || "",
        importBatchId: options.importBatchId || ""
      });
  const { preview, summary: previewSummary } = preparedPreviewPayload;
  const result = {
    totalRows: previewSummary.totalRows,
    imported: 0,
    pending: 0,
    duplicates: 0,
    ignored: 0,
    errors: 0,
    importedProducts: [],
    ignoredRows: [],
    errorRows: [],
    importedProductsTruncated: false,
    previewSummary
  };
  const datasetRows = loadProductsDataset();
  const inventoryRows = ensureInventorySeeded();
  const movements = loadInventoryMovements();
  const initialMovementCount = movements.length;
  const indexes = buildTinyCommitIndexes(datasetRows, inventoryRows);
  const batchContext = {
    datasetRows,
    inventoryRows,
    movements,
    indexes,
    user,
    timestamp: nowIso()
  };
  let processedRows = 0;
  for (const entry of preview) {
    processedRows += 1;
    if (entry.action === "duplicate") {
      result.duplicates += 1;
      result.ignored += 1;
      result.ignoredRows.push({
        line_number: entry.line_number,
        nome: entry.nome,
        sku: entry.sku,
        codigo_tiny: entry.codigo_tiny,
        codigo_etiqueta: entry.codigo_etiqueta,
        ean: entry.ean,
        motivo: "Produto já encontrado por este identificador. Revise antes de importar."
      });
      if (processedRows % TINY_IMPORT_COMMIT_CHUNK_SIZE === 0) {
        if (typeof options.onProgress === "function") {
          options.onProgress({ processedRows, totalRows: preview.length, result });
        }
        await waitForNextImportChunk();
      }
      continue;
    }
    if (entry.action === "error") {
      result.errors += 1;
      result.ignored += 1;
      result.errorRows.push({
        line_number: entry.line_number,
        nome: entry.nome,
        sku: entry.sku,
        codigo_tiny: entry.codigo_tiny,
        ean: entry.ean,
        motivo: entry.pendencias.join(", ") || "Linha inválida para importação."
      });
      if (processedRows % TINY_IMPORT_COMMIT_CHUNK_SIZE === 0) {
        if (typeof options.onProgress === "function") {
          options.onProgress({ processedRows, totalRows: preview.length, result });
        }
        await waitForNextImportChunk();
      }
      continue;
    }
    try {
      const created = entry.import_mode === "update" && entry.duplicate
        ? applyTinyDuplicateImportToStoreInMemory(entry, batchContext)
        : persistTinyNewProductInMemory(entry, batchContext);
      result.imported += 1;
      if (entry.action === "pending") {
        result.pending += 1;
      }
      if (result.importedProducts.length < MAX_TINY_IMPORT_RESPONSE_PRODUCTS) {
        result.importedProducts.push(created.product || created);
      } else {
        result.importedProductsTruncated = true;
      }
    } catch (error) {
      result.errors += 1;
      result.errorRows.push({
        line_number: entry.line_number,
        nome: entry.nome,
        sku: entry.sku,
        codigo_tiny: entry.codigo_tiny,
        ean: entry.ean,
        motivo: error.message || "Não foi possível salvar o produto importado."
      });
    }
    if (processedRows % TINY_IMPORT_COMMIT_CHUNK_SIZE === 0) {
      if (typeof options.onProgress === "function") {
        options.onProgress({ processedRows, totalRows: preview.length, result });
      }
      await waitForNextImportChunk();
    }
  }
  if (result.imported > 0) {
    saveProductsDataset(datasetRows);
    saveInventoryRecords(inventoryRows);
    saveInventoryMovements(movements);
    appendEvent("INVENTORY_MOVEMENT", {
      loja: resolveTinyImportManualStoreOverride(options.manualStoreOverride || "")?.store_id || DEFAULT_STORE_ID,
      reference_type: "TINY_IMPORT",
      reference_id: options.importBatchId || ""
    }, {
      type: "TINY_IMPORT_BATCH_COMMIT",
      import_batch_id: options.importBatchId || "",
      imported: result.imported,
      pending: result.pending,
      errors: result.errors,
      movements_added: Math.max(0, movements.length - initialMovementCount)
    }, user);
  }
  saveInventoryAudit("TINY_IMPORT_COMMIT", {
    store_id: resolveTinyImportManualStoreOverride(options.manualStoreOverride || "")?.store_id || DEFAULT_STORE_ID,
    reason: "Importação Tiny concluída para a base operacional de produtos do PDV.",
    before: {
      totalRows: previewSummary.totalRows,
      duplicateRows: previewSummary.duplicateRows,
      invalidRows: previewSummary.invalidRows
    },
    after: {
      imported: result.imported,
      pending: result.pending,
      duplicates: result.duplicates,
      errors: result.errors,
      appliedStore: previewSummary.appliedStoreLabel || ""
    }
  }, user);
  return result;
}

function createInventoryProduct(payload = {}, user = {}) {
  return persistInventoryProduct(payload, user, {});
}

function resolveExistingProductFromDuplicate(duplicate = {}, datasetRows = [], inventoryRows = []) {
  if (!duplicate) {
    return null;
  }
  const inventory = inventoryRows.find((row) => (
    normalizeText(row.inventory_id || "") === normalizeText(duplicate.existing_inventory_id || "")
    || (duplicate.existing_product_id && normalizeText(row.product_id || "") === normalizeText(duplicate.existing_product_id || ""))
  )) || null;
  const dataset = datasetRows.find((row) => normalizeText(row.product_id || "") === normalizeText(duplicate.existing_product_id || inventory?.product_id || "")) || null;
  return inventory || dataset || null;
}

function createInventoryProductFromLabel(payload = {}, user = {}) {
  const labelCode = normalizeText(payload.label_code || payload.labelCode || payload.codigo || payload.codigo_etiqueta || payload.codigo_interno || payload.sku || "");
  const barcode = normalizeDigits(payload.barcode || payload.codigo_barras || payload.ean || payload.gtin || payload.gtin_ean || "");
  const storeId = normalizeStoreId(payload.store_id || payload.storeId || payload.loja_confirmacao || DEFAULT_STORE_ID);
  const timestamp = nowIso();
  const normalizedPayload = {
    ...payload,
    sku: normalizeText(payload.sku || labelCode || ""),
    codigo: normalizeText(payload.codigo || labelCode || ""),
    codigo_etiqueta: normalizeText(payload.codigo_etiqueta || labelCode || ""),
    codigo_interno: normalizeText(payload.codigo_interno || labelCode || ""),
    ean: barcode,
    codigo_barras: barcode,
    preco_venda: roundMoneyLike(payload.preco_venda || payload.sale_price || payload.salePrice || payload.price || 0),
    original_price: roundMoneyLike(payload.original_price || payload.preco_original || payload.originalPrice || 0),
    estoque: roundQty(payload.estoque || payload.estoque_inicial || payload.available_qty || 0),
    store_id: storeId,
    origem_estoque: storeId,
    source: "etiqueta_aerostore",
    origem: "etiqueta_aerostore",
    estoque_status: "confirmado_fisicamente",
    loja_confirmacao: storeId,
    usuario_confirmacao: normalizeText(user.name || user.email || user.username || ""),
    data_confirmacao: timestamp,
    status: "ACTIVE"
  };
  const normalized = normalizeManualProductPayload(normalizedPayload);
  const datasetRows = loadProductsDataset();
  const inventoryRows = ensureInventorySeeded();
  const duplicate = findDuplicateProductByIdentifiers(datasetRows, inventoryRows, normalized);
  if (duplicate) {
    const existing = resolveExistingProductFromDuplicate(duplicate, datasetRows, inventoryRows);
    return {
      product: existing ? {
        ...existing,
        availability_label: getProductAvailabilityLabel(existing.available_qty ?? existing.estoque ?? 0)
      } : null,
      duplicate,
      created: false,
      existing: true,
      message: `Produto ja existente localizado por ${duplicate.label}.`
    };
  }
  return {
    ...persistInventoryProduct(normalizedPayload, user, {}),
    created: true,
    existing: false
  };
}

function updateInventoryProduct(productId = "", payload = {}, user = {}) {
  const normalizedProductId = normalizeText(productId || payload.product_id || "");
  if (!normalizedProductId) {
    throw new Error("Produto não encontrado para atualização.");
  }
  const datasetRows = loadProductsDataset();
  const currentProduct = datasetRows.find((row) => normalizeText(row.product_id || "") === normalizedProductId) || null;
  if (!currentProduct) {
    throw new Error("Produto não encontrado para atualização.");
  }
  return persistInventoryProduct({
    ...payload,
    product_id: normalizedProductId
  }, user, {
    currentProduct,
    currentInventoryId: payload.inventory_id || ""
  });
}

module.exports = {
  DEFAULT_STORE_ID,
  INVENTORY_MOVEMENT_TYPES,
  INVENTORY_ADJUSTMENT_REASONS,
  INTERNAL_CONSUMPTION_REASONS,
  ensureInventoryDirs,
  ensureInventorySeeded,
  getInventorySummary,
  listInventoryProducts,
  getInventoryProduct,
  getInventoryMovements,
  getInventoryAlerts,
  createInventoryProduct,
  createInventoryProductFromLabel,
  updateInventoryProduct,
  createManualAdjustment,
  createTransfer,
  getProductOperationalAvailability,
  resolveSaleItemFulfillment,
  resolveSaleFulfillmentPlan,
  FULFILLMENT_MODES,
  FULFILLMENT_STATUS,
  validateStockAvailability,
  applySaleInventory,
  restoreSaleInventory,
  holdReservationInventory,
  releaseReservationInventory,
  convertReservationInventory,
  applyInternalConsumptionInventory,
  applyExchangeInboundFromSale,
  applyExchangeInboundItem,
  releaseReservationById,
  convertReservationById,
  searchInventoryProducts,
  previewTinyInventoryImport,
  commitTinyInventoryImport
};
