"use strict";

const fs = require("fs");
const path = require("path");
const { buildFullLabelImageSpec } = require("../agente-impressao-argox/lib/fullLabelDriver");
const { FINAL_LABEL_LAYOUT } = require("../agente-impressao-argox/lib/labelGridSpec");
const {
  buildLabelLayoutDocument,
  validateLabelLayoutDocument
} = require("../agente-impressao-argox/lib/labelLayoutSchema");

const OUTPUT = path.join(
  __dirname,
  "..",
  "agente-impressao-argox",
  "layouts",
  "aerostore-tag-40x60.label-layout.json"
);

function buildSampleItems() {
  return [{
    nome: "Bermuda Osklen Yougue",
    marca: "AEROSTORE",
    loja: "sul",
    store_id: "sul",
    cor: "Bege",
    tamanho: "GG",
    sku_variacao: "AERO-000078-BEGE-GG",
    codigo_barras: "AERO-000078-BEGE-GG",
    preco_venda: "397,00",
    preco_original: "",
    show_compare_price: false,
    colunas: 1,
    language: "PPLB"
  }];
}

function main() {
  const { imageSpec } = buildFullLabelImageSpec({ items: buildSampleItems() });
  const elements = (imageSpec.elements || []).map((element) => {
    const mapped = {
      role: element.role,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height || undefined,
      fontSize: element.fontSize,
      fontFamily: element.fontFamily || "Arial",
      bold: element.bold !== false,
      align: element.align || "center",
      maxLines: element.maxLines || 1
    };
    if (element.isBarcode) {
      mapped.isBarcode = true;
      mapped.renderBarcodeText = false;
    }
    if (element.role === "barcode_text" && Array.isArray(element.textLines)) {
      mapped.lineHeight = element.lineHeight;
      mapped.sampleTextLines = element.textLines;
    }
    return mapped;
  });

  const doc = buildLabelLayoutDocument({
    id: "aerostore-tag-40x60",
    name: "AEROSTORE Tag 40x60 (aprovado)",
    source: "code-export",
    canvas: {
      width_px: imageSpec.widthPx,
      height_px: imageSpec.heightPx,
      dpi: imageSpec.dpi,
      label_width_mm: imageSpec.labelWidthMm,
      label_height_mm: imageSpec.labelHeightMm,
      price_band_mm: imageSpec.priceBandMm
    },
    constants: {
      top_block_offset_px: FINAL_LABEL_LAYOUT.TOP_BLOCK_OFFSET_PX,
      barcode_bar_height_px: FINAL_LABEL_LAYOUT.BARCODE_BAR_HEIGHT_PX,
      barcode_bar_lift_px: FINAL_LABEL_LAYOUT.BARCODE_BAR_LIFT_PX,
      barcode_footer_gap_mm: FINAL_LABEL_LAYOUT.BARCODE_FOOTER_GAP_MM
    },
    elements,
    notes: [
      "Snapshot do layout aprovado exportado do codigo atual.",
      "Use como referencia no Penpot ou como entrada futura do agente (ARGOX_LABEL_LAYOUT_PATH).",
      "Camadas no Penpot devem usar prefixo role: com as mesmas roles deste arquivo."
    ]
  });

  const validation = validateLabelLayoutDocument(doc);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    output: OUTPUT,
    elements: elements.length,
    roles: elements.map((item) => item.role)
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
}
