"use strict";

const fs = require("fs");
const path = require("path");
const { blockProduction, requireExplicitConfirmation, warnLocalOnly } = require("./scriptSafety");

blockProduction("seedPdvMultistoreQa.js");
warnLocalOnly("seedPdvMultistoreQa.js");

const {
  createInventoryProduct,
  updateInventoryProduct,
  getInventoryProduct,
  ensureInventorySeeded
} = require("../modules/pdv/inventory/pdvInventoryService");

const ROOT = process.cwd();
const DATASET_PATH = path.join(ROOT, "data", "imports", "pdv", "datasets", "produtos.json");
const INVENTORY_PATH = path.join(ROOT, "data", "pdv", "inventory", "inventory.json");
const MOVEMENTS_PATH = path.join(ROOT, "data", "pdv", "inventory", "movements.json");
const TRANSFERS_PATH = path.join(ROOT, "data", "pdv", "inventory", "transfers.json");

const QA_SOURCE = "QA_STAGE_8_17_1";
const QA_BRAND = "AEROSTORE TESTE";
const QA_CATEGORY = "QA PDV";
const QA_NAME_PREFIX = "QA PDV Multiloja -";
const QA_SKU_PREFIX = "QA-PDV-ML-";
const QA_CODE_PREFIX = "COD-QA-PDV-ML-";
const STORE_ORDER = ["vila_masc", "vila_fem_infant", "botanico", "camboriu"];
const STORE_LABELS = {
  vila_masc: "Vila Masc",
  vila_fem_infant: "Vila Fem/Infant",
  botanico: "Botânico",
  camboriu: "Camboriú"
};

const SYSTEM_USER = {
  id: "seed-stage-8-17-1",
  email: "seed.stage8171@aerostore.local",
  name: "Seed Stage 8.17.1",
  role: "admin"
};

const QA_PRODUCTS = [
  {
    sku: "QA-PDV-ML-001",
    codigo: "COD-QA-PDV-ML-001",
    nome: "QA PDV Multiloja - Camiseta Local Vila Masc",
    datasetStoreId: "vila_masc",
    preco_venda: 129.9,
    preco_custo: 59.9,
    cor: "Preto",
    tamanho: "M",
    tipo: "Camiseta",
    scenario: "Local",
    stockByStore: { vila_masc: 5, vila_fem_infant: 0, botanico: 0, camboriu: 0 }
  },
  {
    sku: "QA-PDV-ML-002",
    codigo: "COD-QA-PDV-ML-002",
    nome: "QA PDV Multiloja - Camiseta Vizinha Vila Fem",
    datasetStoreId: "vila_masc",
    preco_venda: 139.9,
    preco_custo: 62.9,
    cor: "Off White",
    tamanho: "M",
    tipo: "Camiseta",
    scenario: "Vizinha",
    stockByStore: { vila_masc: 0, vila_fem_infant: 5, botanico: 0, camboriu: 0 }
  },
  {
    sku: "QA-PDV-ML-003",
    codigo: "COD-QA-PDV-ML-003",
    nome: "QA PDV Multiloja - Bermuda Vizinha Vila Masc",
    datasetStoreId: "vila_fem_infant",
    preco_venda: 159.9,
    preco_custo: 71.9,
    cor: "Areia",
    tamanho: "42",
    tipo: "Bermuda",
    scenario: "Vizinha inversa",
    stockByStore: { vila_masc: 5, vila_fem_infant: 0, botanico: 0, camboriu: 0 }
  },
  {
    sku: "QA-PDV-ML-004",
    codigo: "COD-QA-PDV-ML-004",
    nome: "QA PDV Multiloja - Polo Botânico Transferência",
    datasetStoreId: "vila_masc",
    preco_venda: 189.9,
    preco_custo: 84.9,
    cor: "Marinho",
    tamanho: "G",
    tipo: "Polo",
    scenario: "Botânico",
    stockByStore: { vila_masc: 0, vila_fem_infant: 0, botanico: 5, camboriu: 0 }
  },
  {
    sku: "QA-PDV-ML-005",
    codigo: "COD-QA-PDV-ML-005",
    nome: "QA PDV Multiloja - Bermuda Camboriú Análise",
    datasetStoreId: "vila_masc",
    preco_venda: 199.9,
    preco_custo: 92.9,
    cor: "Verde",
    tamanho: "44",
    tipo: "Bermuda",
    scenario: "Sul/análise",
    stockByStore: { vila_masc: 0, vila_fem_infant: 0, botanico: 0, camboriu: 5 }
  },
  {
    sku: "QA-PDV-ML-006",
    codigo: "COD-QA-PDV-ML-006",
    nome: "QA PDV Multiloja - Tênis Sem Estoque",
    datasetStoreId: "vila_masc",
    preco_venda: 249.9,
    preco_custo: 119.9,
    cor: "Branco",
    tamanho: "41",
    tipo: "Tênis",
    scenario: "Indisponível",
    stockByStore: { vila_masc: 0, vila_fem_infant: 0, botanico: 0, camboriu: 0 }
  },
  {
    sku: "QA-PDV-ML-007",
    codigo: "COD-QA-PDV-ML-007",
    nome: "QA PDV Multiloja - Produto Multiestoque",
    datasetStoreId: "vila_masc",
    preco_venda: 299.9,
    preco_custo: 141.9,
    cor: "Chocolate",
    tamanho: "U",
    tipo: "Produto",
    scenario: "Prioridade local",
    stockByStore: { vila_masc: 3, vila_fem_infant: 4, botanico: 5, camboriu: 2 }
  },
  {
    sku: "QA-PDV-ML-008",
    codigo: "COD-QA-PDV-ML-008",
    nome: "QA PDV Multiloja - Última Peça Vila Masc",
    datasetStoreId: "vila_masc",
    preco_venda: 89.9,
    preco_custo: 32.9,
    cor: "Cinza",
    tamanho: "P",
    tipo: "Camiseta",
    scenario: "Última peça",
    stockByStore: { vila_masc: 1, vila_fem_infant: 0, botanico: 0, camboriu: 0 }
  },
  {
    sku: "QA-PDV-ML-009-P",
    codigo: "COD-QA-PDV-ML-009-P",
    nome: "QA PDV Multiloja - Camiseta Variação Preto P",
    datasetStoreId: "vila_masc",
    preco_venda: 119.9,
    preco_custo: 49.9,
    cor: "Preto",
    tamanho: "P",
    tipo: "Camiseta",
    grade: "P/M/G/GG",
    scenario: "Variação local",
    stockByStore: { vila_masc: 2, vila_fem_infant: 0, botanico: 0, camboriu: 0 }
  },
  {
    sku: "QA-PDV-ML-009-M",
    codigo: "COD-QA-PDV-ML-009-M",
    nome: "QA PDV Multiloja - Camiseta Variação Preto M",
    datasetStoreId: "vila_masc",
    preco_venda: 119.9,
    preco_custo: 49.9,
    cor: "Preto",
    tamanho: "M",
    tipo: "Camiseta",
    grade: "P/M/G/GG",
    scenario: "Variação vizinha",
    stockByStore: { vila_masc: 0, vila_fem_infant: 2, botanico: 0, camboriu: 0 }
  },
  {
    sku: "QA-PDV-ML-009-G",
    codigo: "COD-QA-PDV-ML-009-G",
    nome: "QA PDV Multiloja - Camiseta Variação Preto G",
    datasetStoreId: "vila_masc",
    preco_venda: 119.9,
    preco_custo: 49.9,
    cor: "Preto",
    tamanho: "G",
    tipo: "Camiseta",
    grade: "P/M/G/GG",
    scenario: "Variação Botânico",
    stockByStore: { vila_masc: 0, vila_fem_infant: 0, botanico: 2, camboriu: 0 }
  },
  {
    sku: "QA-PDV-ML-009-GG",
    codigo: "COD-QA-PDV-ML-009-GG",
    nome: "QA PDV Multiloja - Camiseta Variação Preto GG",
    datasetStoreId: "vila_masc",
    preco_venda: 119.9,
    preco_custo: 49.9,
    cor: "Preto",
    tamanho: "GG",
    tipo: "Camiseta",
    grade: "P/M/G/GG",
    scenario: "Variação Sul/análise",
    stockByStore: { vila_masc: 0, vila_fem_infant: 0, botanico: 0, camboriu: 2 }
  },
  {
    sku: "QA-PDV-ML-010",
    codigo: "COD-QA-PDV-ML-010",
    nome: "QA PDV Multiloja - Cashback Teste Local",
    datasetStoreId: "vila_masc",
    preco_venda: 200,
    preco_custo: 88,
    cor: "Azul",
    tamanho: "M",
    tipo: "Camiseta",
    scenario: "Cashback/pagamento",
    stockByStore: { vila_masc: 10, vila_fem_infant: 10, botanico: 10, camboriu: 10 }
  }
];

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

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function isQaProductRow(row = {}) {
  const sku = normalizeText(row.sku || "");
  const codigo = normalizeText(row.codigo || "");
  const nome = normalizeText(row.nome || row.name || "");
  const source = normalizeText(row.source || "");
  return sku.startsWith(QA_SKU_PREFIX)
    || codigo.startsWith(QA_CODE_PREFIX)
    || nome.startsWith(QA_NAME_PREFIX)
    || source === QA_SOURCE;
}

function stableProductId(sku) {
  return `PRD_${normalizeText(sku).replace(/[^A-Za-z0-9]+/g, "_")}`;
}

function sortStoreIds(storeIds = []) {
  return [...storeIds].sort((left, right) => STORE_ORDER.indexOf(left) - STORE_ORDER.indexOf(right));
}

function buildPayload(definition, storeId, qty, productId) {
  return {
    product_id: productId,
    sku: definition.sku,
    codigo: definition.codigo,
    codigo_tiny: "",
    codigo_etiqueta: definition.sku,
    codigo_interno: definition.codigo,
    ean: "",
    codigo_barras: "",
    nome: definition.nome,
    descricao: `${definition.nome} | massa QA multiloja Stage 8.17.1`,
    marca: QA_BRAND,
    categoria: QA_CATEGORY,
    linha_genero: "QA",
    tipo: definition.tipo || "Produto",
    cor: definition.cor || "",
    tamanho: definition.tamanho || "",
    grade: definition.grade || "",
    preco_venda: definition.preco_venda,
    preco_custo: definition.preco_custo,
    estoque: qty,
    store_id: storeId,
    status: "ACTIVE",
    observacao: `QA Stage 8.17.1 | ${definition.scenario} | ${STORE_LABELS[storeId]}`,
    source: QA_SOURCE
  };
}

function loadInventoryRows() {
  return readJson(INVENTORY_PATH, []);
}

function loadDatasetRows() {
  return readJson(DATASET_PATH, []);
}

function findExactInventoryRecord(sku, storeId) {
  return loadInventoryRows().find((row) => normalizeText(row.sku || "") === normalizeText(sku) && normalizeText(row.store_id || "") === normalizeText(storeId)) || null;
}

function findExistingBySkuAcrossStores(sku) {
  return loadInventoryRows().find((row) => normalizeText(row.sku || "") === normalizeText(sku)) || null;
}

function getDesiredPositiveStores(definition) {
  return sortStoreIds(
    Object.entries(definition.stockByStore || {})
      .filter(([, qty]) => Number(qty || 0) > 0)
      .map(([storeId]) => storeId)
  );
}

function syncQaDatasetRows() {
  const rows = loadDatasetRows();
  const definitionBySku = new Map(QA_PRODUCTS.map((definition) => [definition.sku, definition]));
  let changed = false;
  const nextRows = rows.map((row) => {
    if (!isQaProductRow(row)) {
      return row;
    }
    const definition = definitionBySku.get(normalizeText(row.sku || ""));
    if (!definition) {
      return row;
    }
    changed = true;
    return {
      ...row,
      product_id: stableProductId(definition.sku),
      codigo: definition.codigo,
      sku: definition.sku,
      codigo_tiny: "",
      codigo_etiqueta: definition.sku,
      codigo_interno: definition.codigo,
      nome: definition.nome,
      descricao: `${definition.nome} | massa QA multiloja Stage 8.17.1`,
      marca: QA_BRAND,
      categoria: QA_CATEGORY,
      linha_genero: "QA",
      tipo: definition.tipo || "Produto",
      cor: definition.cor || "",
      tamanho: definition.tamanho || "",
      grade: definition.grade || "",
      preco_venda: definition.preco_venda,
      preco_custo: definition.preco_custo,
      estoque: Number(definition.stockByStore?.[definition.datasetStoreId || "vila_masc"] || 0),
      store_id: definition.datasetStoreId || "vila_masc",
      status: "ACTIVE",
      observacao: `QA Stage 8.17.1 | ${definition.scenario}`,
      source: QA_SOURCE
    };
  });
  if (changed) {
    writeJson(DATASET_PATH, nextRows);
  }
}

function pruneQaInventoryRows() {
  const rows = loadInventoryRows();
  const definitionBySku = new Map(QA_PRODUCTS.map((definition) => [definition.sku, definition]));
  const nextRows = [];
  rows.forEach((row) => {
    if (!isQaProductRow(row)) {
      nextRows.push(row);
      return;
    }
    const definition = definitionBySku.get(normalizeText(row.sku || ""));
    if (!definition) {
      return;
    }
    const desiredQty = Number(definition.stockByStore?.[normalizeText(row.store_id || "")] || 0);
    if (desiredQty <= 0) {
      return;
    }
    nextRows.push({
      ...row,
      product_id: stableProductId(definition.sku),
      codigo: definition.codigo,
      sku: definition.sku,
      codigo_tiny: "",
      codigo_etiqueta: definition.sku,
      codigo_interno: definition.codigo,
      nome: definition.nome,
      descricao: `${definition.nome} | massa QA multiloja Stage 8.17.1`,
      marca: QA_BRAND,
      categoria: QA_CATEGORY,
      linha_genero: "QA",
      tipo: definition.tipo || "Produto",
      cor: definition.cor || "",
      tamanho: definition.tamanho || "",
      grade: definition.grade || "",
      preco_venda: definition.preco_venda,
      preco_custo: definition.preco_custo,
      available_qty: desiredQty,
      source: QA_SOURCE,
      observacao: `QA Stage 8.17.1 | ${definition.scenario} | ${STORE_LABELS[normalizeText(row.store_id || "")] || normalizeText(row.store_id || "")}`
    });
  });
  writeJson(INVENTORY_PATH, nextRows);
}

function upsertQaProduct(definition, stats) {
  const existing = findExistingBySkuAcrossStores(definition.sku);
  const productId = normalizeText(existing?.product_id || stableProductId(definition.sku));
  let created = false;

  if (!existing) {
    const firstStoreId = STORE_ORDER[0];
    const result = createInventoryProduct(
      buildPayload(definition, firstStoreId, Number(definition.stockByStore[firstStoreId] || 0), productId),
      SYSTEM_USER
    );
    stats.productsCreated += 1;
    stats.inventoryTouched += 1;
    created = true;
    stats.productIds.add(result.product.product_id);
  } else {
    stats.productsUpdated += 1;
    stats.productIds.add(productId);
  }

  for (const storeId of getDesiredPositiveStores(definition)) {
    const qty = Number(definition.stockByStore[storeId] || 0);
    const currentStoreRecord = findExactInventoryRecord(definition.sku, storeId);
    const payload = buildPayload(definition, storeId, qty, productId);
    if (currentStoreRecord) {
      updateInventoryProduct(productId, {
        ...payload,
        inventory_id: currentStoreRecord.inventory_id
      }, SYSTEM_USER);
    } else {
      updateInventoryProduct(productId, payload, SYSTEM_USER);
    }
    if (!created || storeId !== STORE_ORDER[0]) {
      stats.inventoryTouched += 1;
    }
  }

  stats.matrix.push({
    sku: definition.sku,
    produto: definition.nome.replace(`${QA_NAME_PREFIX} `, ""),
    vila_masc: Number(definition.stockByStore.vila_masc || 0),
    vila_fem_infant: Number(definition.stockByStore.vila_fem_infant || 0),
    botanico: Number(definition.stockByStore.botanico || 0),
    camboriu: Number(definition.stockByStore.camboriu || 0),
    scenario: definition.scenario
  });
}

function runSeed() {
  ensureInventorySeeded();
  const stats = {
    productsCreated: 0,
    productsUpdated: 0,
    inventoryTouched: 0,
    matrix: [],
    productIds: new Set()
  };

  QA_PRODUCTS.forEach((definition) => upsertQaProduct(definition, stats));
  syncQaDatasetRows();
  pruneQaInventoryRows();

  return {
    mode: "seed",
    products_created: stats.productsCreated,
    products_updated: stats.productsUpdated,
    inventory_rows_touched: stats.inventoryTouched,
    product_ids: Array.from(stats.productIds),
    matrix: stats.matrix
  };
}

function runCleanup() {
  const datasetRows = readJson(DATASET_PATH, []);
  const inventoryRows = readJson(INVENTORY_PATH, []);
  const movementRows = readJson(MOVEMENTS_PATH, []);
  const transferRows = readJson(TRANSFERS_PATH, []);

  const qaProductIds = new Set(
    [...datasetRows, ...inventoryRows]
      .filter((row) => isQaProductRow(row))
      .map((row) => normalizeText(row.product_id || ""))
      .filter(Boolean)
  );

  const nextDatasetRows = datasetRows.filter((row) => !isQaProductRow(row));
  const nextInventoryRows = inventoryRows.filter((row) => !isQaProductRow(row) && !qaProductIds.has(normalizeText(row.product_id || "")));
  const nextMovementRows = movementRows.filter((row) => {
    const sku = normalizeText(row.sku || "");
    const productId = normalizeText(row.product_id || "");
    return !sku.startsWith(QA_SKU_PREFIX) && !qaProductIds.has(productId);
  });
  const nextTransferRows = transferRows.filter((row) => {
    const transferSku = normalizeText(row.sku || row.codigo || "");
    const transferProductId = normalizeText(row.product_id || "");
    return !transferSku.startsWith(QA_SKU_PREFIX) && !qaProductIds.has(transferProductId);
  });

  writeJson(DATASET_PATH, nextDatasetRows);
  writeJson(INVENTORY_PATH, nextInventoryRows);
  writeJson(MOVEMENTS_PATH, nextMovementRows);
  writeJson(TRANSFERS_PATH, nextTransferRows);

  return {
    mode: "cleanup",
    dataset_removed: datasetRows.length - nextDatasetRows.length,
    inventory_removed: inventoryRows.length - nextInventoryRows.length,
    movements_removed: movementRows.length - nextMovementRows.length,
    transfers_removed: transferRows.length - nextTransferRows.length,
    removed_product_ids: Array.from(qaProductIds)
  };
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

function main() {
  requireExplicitConfirmation("--confirm");
  const cleanupMode = process.argv.includes("--cleanup");
  const result = cleanupMode ? runCleanup() : runSeed();
  printResult(result);
}

main();
