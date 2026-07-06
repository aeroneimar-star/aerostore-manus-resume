"use strict";

const path = require("path");
const {
  applySafeTestToItems,
  mapAgentItemsToPrintContext
} = require(path.join(__dirname, "..", "..", "modules", "pdv", "services", "argoxCommandBuilder"));
const { buildLabelPreviewElements } = require(path.join(__dirname, "..", "..", "modules", "pdv", "services", "pdvLabelPrintService"));
const { buildGridImageSpec, resolveLabelGridConfig, FINAL_LABEL_LAYOUT } = require("./labelGridSpec");
const { readEnvBoolean } = require(path.join(__dirname, "..", "..", "modules", "pdv", "services", "argoxEnvBoolean"));

function buildFullLabelSampleAgentItems() {
  return [{
    nome: "CALCA TECH FIVE POCKET AEROSTORE MASC.",
    marca: "AEROSTORE",
    loja: "vila",
    store_id: "vila",
    tamanho: "42",
    cor: "VERDE-MUSGO",
    sku_variacao: "AERO-000098",
    codigo_barras: "4006381333931",
    preco_original: "397,00",
    preco_venda: "167,00",
    show_compare_price: true,
    colunas: 1,
    language: "PPLB"
  }];
}

function buildFullLabelNormalSampleAgentItems() {
  return [{
    nome: "CALCA TECH FIVE POCKET AEROSTORE MASC.",
    marca: "AEROSTORE",
    loja: "vila",
    store_id: "vila",
    tamanho: "42",
    cor: "VERDE-MUSGO",
    sku_variacao: "AERO-000098",
    codigo_barras: "4006381333931",
    preco_venda: "397,00",
    preco_original: "",
    show_compare_price: false,
    colunas: 1,
    language: "PPLB"
  }];
}

function buildFullLabelSulSampleAgentItems() {
  return [{
    nome: "CALCA TECH FIVE POCKET AEROSTORE MASC.",
    marca: "AEROSTORE",
    loja: "sul",
    store_id: "sul",
    tamanho: "42",
    cor: "VERDE-MUSGO",
    sku_variacao: "AERO-000098",
    codigo_barras: "4006381333931",
    preco_venda: "397,00",
    preco_original: "",
    show_compare_price: false,
    colunas: 1,
    language: "PPLB"
  }];
}

function buildFullLabelOsklenSampleAgentItems() {
  return [{
    nome: "CAMISA OSKLEN SLIM FIT",
    marca: "Osklen",
    loja: "vila",
    store_id: "vila",
    tamanho: "M",
    cor: "AZUL",
    sku_variacao: "OSK-000201",
    codigo_barras: "",
    preco_venda: "299,00",
    preco_original: "",
    show_compare_price: false,
    colunas: 1,
    language: "PPLB"
  }];
}

function buildFullLabelImageSpec(options = {}) {
  const allowMultiCellGrid = options.allowMultiCellGrid === true;
  const agentConfig = {
    dpi: 203,
    label_width_mm: 40,
    label_height_mm: 60,
    label_price_band_mm: 12,
    label_gap_mm: 3,
    label_columns: 1,
    label_grid: "1x1",
    print_cell: "top-left",
    allow_multi_cell_grid: allowMultiCellGrid,
    debug_border: readEnvBoolean(process.env.ARGOX_DRIVER_DEBUG_BORDER, false),
    safe_test_mode: readEnvBoolean(process.env.ARGOX_SAFE_TEST_MODE, false),
    ...options.config
  };

  if (!allowMultiCellGrid) {
    agentConfig.label_grid = "1x1";
    agentConfig.print_cell = "top-left";
    agentConfig.label_columns = 1;
    agentConfig.allow_multi_cell_grid = false;
  }
  const items = options.items || buildFullLabelSampleAgentItems();
  const safe = applySafeTestToItems(items, agentConfig);
  const context = mapAgentItemsToPrintContext(safe.items, agentConfig, {
    safeTestMode: safe.safeTestMode,
    quantityReceived: safe.received,
    quantityFinal: safe.final
  });

  context.config.label_columns = 1;
  context.request.quantity = 1;

  const previewElements = buildLabelPreviewElements(
    context.product,
    context.request,
    context.config
  ).filter((element) => Number(element.column || 0) === 0);

  const gridConfig = resolveLabelGridConfig(agentConfig);
  const imageSpec = buildGridImageSpec(previewElements, agentConfig);

  return {
    imageSpec,
    context,
    previewElements,
    grid: gridConfig,
    layout: imageSpec.layout || {
      top_block_offset_px: FINAL_LABEL_LAYOUT.TOP_BLOCK_OFFSET_PX,
      canvas: `${FINAL_LABEL_LAYOUT.CANVAS_WIDTH_PX}x${FINAL_LABEL_LAYOUT.CANVAS_HEIGHT_PX}`,
      grid: FINAL_LABEL_LAYOUT.GRID
    },
    quantity_received: safe.received,
    quantity_final: safe.final,
    safe_test_mode: safe.safeTestMode
  };
}

module.exports = {
  buildFullLabelSampleAgentItems,
  buildFullLabelNormalSampleAgentItems,
  buildFullLabelSulSampleAgentItems,
  buildFullLabelOsklenSampleAgentItems,
  buildFullLabelImageSpec
};
