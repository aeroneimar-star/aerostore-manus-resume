"use strict";

const fs = require("fs");
const path = require("path");
const {
  buildFullLabelImageSpec,
  buildFullLabelSampleAgentItems,
  buildFullLabelNormalSampleAgentItems,
  buildFullLabelSulSampleAgentItems,
  buildFullLabelOsklenSampleAgentItems
} = require("../agente-impressao-argox/lib/fullLabelDriver");
const { renderAndPrintLabel } = require("../agente-impressao-argox/lib/windowsDriverPrint");
const {
  FINAL_LABEL_LAYOUT,
  validateFinalLabelLayout
} = require("../agente-impressao-argox/lib/labelGridSpec");
const { assertValidLabelPrice } = require("../modules/pdv/services/pdvLabelPrintService");
const {
  DEFAULT_LABEL_HEADER,
  SUL_LABEL_HEADER
} = require("../modules/pdv/services/argoxLabelStorePolicy");

const OUTPUT_DIR = path.join(__dirname, "..", "agente-impressao-argox", "output");

function applyDryRunEnv() {
  process.env.ARGOX_LABEL_WIDTH_MM = process.env.ARGOX_LABEL_WIDTH_MM || "40";
  process.env.ARGOX_LABEL_HEIGHT_MM = process.env.ARGOX_LABEL_HEIGHT_MM || "60";
  process.env.ARGOX_LABEL_PRICE_BAND_MM = process.env.ARGOX_LABEL_PRICE_BAND_MM || "12";
  process.env.ARGOX_LABEL_GRID = "1x1";
  process.env.ARGOX_PRINT_CELL = "top-left";
  process.env.ARGOX_PRINT_TRANSPORT = process.env.ARGOX_PRINT_TRANSPORT || "WINDOWS_DRIVER";
  process.env.ARGOX_DRIVER_DEBUG_BORDER = process.env.ARGOX_DRIVER_DEBUG_BORDER || "true";
  process.env.ARGOX_DRIVER_SCALE_X = process.env.ARGOX_DRIVER_SCALE_X || "1";
  process.env.ARGOX_DRIVER_SCALE_Y = process.env.ARGOX_DRIVER_SCALE_Y || "1";
  process.env.ARGOX_DRIVER_OFFSET_X_MM = process.env.ARGOX_DRIVER_OFFSET_X_MM || "0";
  process.env.ARGOX_DRIVER_OFFSET_Y_MM = process.env.ARGOX_DRIVER_OFFSET_Y_MM || "0";
}

function assertBarcodeUnchanged(elements = []) {
  const barcode = elements.find((item) => item.role === "barcode" || item.isBarcode);
  const barcodeText = elements.find((item) => item.role === "barcode_text");
  if (!barcode) {
    throw new Error("Barcode ausente no layout final.");
  }
  if (!barcodeText) {
    throw new Error("Texto humano do barcode ausente no layout final.");
  }
  const expectedHeight = FINAL_LABEL_LAYOUT.BARCODE_BAR_HEIGHT_PX;
  if (Number(barcode.height) !== expectedHeight) {
    throw new Error(`Barcode height alterado: ${barcode.height}, esperado ${expectedHeight}.`);
  }
  if (barcodeText.y <= barcode.y) {
    throw new Error("Texto humano do barcode deve ficar abaixo das barras.");
  }
  const encodedValue = barcode.barcodeValue || barcode.text;
  const humanText = barcode.barcodeHumanText || barcodeText.text || encodedValue;
  if (!encodedValue) {
    throw new Error("Valor codificado do barcode ausente.");
  }
  if (barcodeText.text !== humanText) {
    throw new Error("Texto humano do barcode deve mostrar o SKU/codigo legivel.");
  }
}

function assertFooterPresent(elements = []) {
  const roles = new Set(elements.map((item) => item.role));
  if (!roles.has("code")) {
    throw new Error("Rodape COD ausente.");
  }
  if (!roles.has("price")) {
    throw new Error("Rodape preco ausente.");
  }
}

function assertPromoFooter(elements = []) {
  const compare = elements.find((item) => item.role === "compare_price");
  const price = elements.find((item) => item.role === "price");
  if (!compare) {
    throw new Error("Etiqueta promocional deve conter DE no rodape.");
  }
  if (!/^DE:/i.test(String(compare.text || ""))) {
    throw new Error(`Texto DE invalido: ${compare.text}`);
  }
  if (!/^POR:/i.test(String(price?.text || ""))) {
    throw new Error(`Texto POR invalido: ${price?.text}`);
  }
}

function assertNormalFooter(elements = []) {
  const compare = elements.find((item) => item.role === "compare_price");
  const price = elements.find((item) => item.role === "price");
  if (compare) {
    throw new Error("Etiqueta normal nao deve conter DE no rodape.");
  }
  if (!price) {
    throw new Error("Etiqueta normal deve conter preco no rodape.");
  }
  if (/^POR:/i.test(String(price.text || "")) || /^DE:/i.test(String(price.text || ""))) {
    throw new Error(`Preco normal nao deve usar prefixo DE/POR: ${price.text}`);
  }
  if (!/^R\$\s/.test(String(price.text || ""))) {
    throw new Error(`Preco normal deve comecar com R$: ${price.text}`);
  }
}

function assertHeaderText(elements = [], expectedHeader = "", scenario = "") {
  const brand = elements.find((item) => item.role === "brand");
  if (!brand) {
    throw new Error(`${scenario}: cabeçalho brand ausente.`);
  }
  if (brand.text !== expectedHeader) {
    throw new Error(`${scenario}: cabeçalho esperado "${expectedHeader}", recebido "${brand.text}".`);
  }
}

function runScenario(name, items, footerAssertFn, prefix, expectedHeader = DEFAULT_LABEL_HEADER) {
  const { imageSpec, previewElements, grid, layout } = buildFullLabelImageSpec({
    items,
    config: {
      label_grid: "2x2",
      allow_multi_cell_grid: false,
      debug_border: true
    }
  });

  if (imageSpec.widthPx === 640 || imageSpec.heightPx === 960) {
    throw new Error(`Regressao ${name}: env/config 2x2 gerou canvas 640x960.`);
  }

  validateFinalLabelLayout(imageSpec);
  assertBarcodeUnchanged(imageSpec.elements || []);
  assertFooterPresent(imageSpec.elements || []);
  footerAssertFn(imageSpec.elements || []);
  assertHeaderText(imageSpec.elements || [], expectedHeader, name);

  if (layout.top_block_offset_px !== FINAL_LABEL_LAYOUT.TOP_BLOCK_OFFSET_PX) {
    throw new Error(`${name}: TOP_BLOCK_OFFSET_PX invalido: ${layout.top_block_offset_px}`);
  }

  const result = renderAndPrintLabel("", imageSpec, {
    outputDir: OUTPUT_DIR,
    prefix,
    saveOnly: true
  });

  if (!result.imagem_path || !fs.existsSync(result.imagem_path)) {
    throw new Error(`${name}: falha ao gerar PNG.`);
  }

  if (result.width_px !== FINAL_LABEL_LAYOUT.CANVAS_WIDTH_PX
    || result.height_px !== FINAL_LABEL_LAYOUT.CANVAS_HEIGHT_PX) {
    throw new Error(`${name}: PNG deve ser 320x480, recebido ${result.width_px}x${result.height_px}.`);
  }

  if (grid.cols !== 1 || grid.rows !== 1) {
    throw new Error(`${name}: grade deve ser 1x1, recebido ${grid.grid}.`);
  }

  return {
    scenario: name,
    price_mode: name.includes("promo") ? "promo_compare" : "normal",
    metodo: result.metodo,
    imagem: result.imagem || path.basename(result.imagem_path),
    imagem_path: result.imagem_path,
    bytes: result.bytes,
    width_px: result.width_px,
    height_px: result.height_px,
    layout,
    grid: {
      cols: grid.cols,
      rows: grid.rows,
      cell: `${grid.cellWidthPx}x${grid.cellHeightPx}`,
      page: `${grid.pageWidthPx}x${grid.pageHeightPx}`
    },
    top_block_offset_px: FINAL_LABEL_LAYOUT.TOP_BLOCK_OFFSET_PX,
    preview_elements: previewElements.length,
    rendered_elements: imageSpec.elements?.length || 0,
    footer: (imageSpec.elements || [])
      .filter((item) => ["brand", "code", "compare_price", "price"].includes(item.role))
      .map((item) => ({ role: item.role, text: item.text }))
  };
}

function assertInvalidPriceBlocked() {
  try {
    assertValidLabelPrice({ price: 0, normal_price: 0 }, { show_price: true });
    throw new Error("Preco zero deveria ser bloqueado.");
  } catch (error) {
    if (error.message !== "Produto sem preço válido para etiqueta.") {
      throw error;
    }
  }
}

function main() {
  applyDryRunEnv();
  assertInvalidPriceBlocked();

  const promoResult = runScenario(
    "promo_de_por",
    buildFullLabelSampleAgentItems(),
    assertPromoFooter,
    "full-driver-dry-run-promo"
  );

  const normalResult = runScenario(
    "normal_price",
    buildFullLabelNormalSampleAgentItems(),
    assertNormalFooter,
    "full-driver-dry-run-normal",
    DEFAULT_LABEL_HEADER
  );

  const sulResult = runScenario(
    "sul_store_header",
    buildFullLabelSulSampleAgentItems(),
    assertNormalFooter,
    "full-driver-dry-run-sul",
    SUL_LABEL_HEADER
  );

  const osklenResult = runScenario(
    "osklen_normal_store",
    buildFullLabelOsklenSampleAgentItems(),
    assertNormalFooter,
    "full-driver-dry-run-osklen",
    DEFAULT_LABEL_HEADER
  );

  console.log("Argox WINDOWS_DRIVER full dry-run passed (promo + normal + sul + osklen).");
  console.log(JSON.stringify({
    scenarios: [promoResult, normalResult, sulResult, osklenResult]
  }, null, 2));
}

main();
