"use strict";

const fs = require("fs");
const path = require("path");
const {
  resolveLabelBarcode,
  deriveShortVariationScanCode,
  CODE128_PREFERRED_MAX_LENGTH,
  LABEL_BARCODE_ERROR,
  validateEan13Checksum
} = require("../modules/pdv/services/argoxLabelBarcode");
const {
  splitBarcodeHumanText
} = require("../agente-impressao-argox/lib/labelGridSpec");
const {
  buildFullLabelImageSpec,
  buildFullLabelNormalSampleAgentItems
} = require("../agente-impressao-argox/lib/fullLabelDriver");
const { renderAndPrintLabel } = require("../agente-impressao-argox/lib/windowsDriverPrint");
const { FINAL_LABEL_LAYOUT } = require("../agente-impressao-argox/lib/labelGridSpec");

const OUTPUT_DIR = path.join(__dirname, "..", "agente-impressao-argox", "output");

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: esperado "${expected}", recebido "${actual}"`);
  }
}

function assertThrows(fn, expectedMessage, message) {
  try {
    fn();
    throw new Error(`${message}: deveria lançar erro.`);
  } catch (error) {
    if (error.message !== expectedMessage) {
      throw new Error(`${message}: mensagem esperada "${expectedMessage}", recebida "${error.message}"`);
    }
  }
}

function testResolutionRules() {
  const ean = resolveLabelBarcode({
    barcode: "4006381333931",
    sku: "AERO-000098"
  });
  assertEqual(ean.symbology, "ean13", "EAN-13 prioritário");
  assertEqual(ean.value, "4006381333931", "EAN-13 valor");
  assertEqual(ean.human_text, "AERO-000098", "EAN-13 human text usa SKU");

  const aero = resolveLabelBarcode({ sku: "AERO-000098" });
  assertEqual(aero.symbology, "code128", "AERO Code128");
  assertEqual(aero.value, "AERO-000098", "AERO valor");

  const numericSku = resolveLabelBarcode({ sku: "44812" });
  assertEqual(numericSku.symbology, "code128", "44812 Code128");
  assertEqual(numericSku.value, "44812", "44812 valor");

  assertThrows(
    () => resolveLabelBarcode({ sku: "" }, { requireBarcode: true }),
    LABEL_BARCODE_ERROR,
    "Sem código válido"
  );

  if (!validateEan13Checksum("4006381333931")) {
    throw new Error("Checksum EAN de teste inválido.");
  }

  const variationSkuWins = resolveLabelBarcode({
    variation_id: "VAR_TEST_M",
    variant_barcode: "",
    variant_sku: "QA-VAR-M",
    barcode: "4006381333931",
    gtin_ean: "4006381333931",
    sku: "QA-PARENT"
  }, { requireBarcode: true });
  assertEqual(variationSkuWins.value, "QA-VAR-M", "Com variation_id, SKU curto da variacao vence EAN do pai");
  assertEqual(variationSkuWins.human_text, "QA-VAR-M", "Human text da variacao curta");
  assertEqual(variationSkuWins.source_field, "variation_code128", "Fonte da variacao");

  const longSkuEncoded = resolveLabelBarcode({
    variation_id: "VAR_AERO_000078",
    variant_barcode: "",
    variant_sku: "AERO-000078-BEGE-GG",
    sku: "AERO-000078-BEGE-GG"
  }, { requireBarcode: true });
  assertEqual(longSkuEncoded.value, deriveShortVariationScanCode("VAR_AERO_000078"), "SKU longo usa scan code curto");
  assertEqual(longSkuEncoded.human_text, "AERO-000078-BEGE-GG", "SKU longo mantem human text completo");
  assertEqual(longSkuEncoded.source_field, "variation_scan_code", "Fonte scan code");
  if (longSkuEncoded.value.length > CODE128_PREFERRED_MAX_LENGTH) {
    throw new Error("Encoded value longo demais para Code128 confortavel.");
  }

  const variationIdFallback = resolveLabelBarcode({
    variation_id: "VAR_FALLBACK_01"
  }, { requireBarcode: true });
  assertEqual(variationIdFallback.value, "FALLBACK01", "variation_id gera scan code curto");
  assertEqual(variationIdFallback.source_field, "variation_scan_code", "Fonte variation_scan_code");
}

function buildScenarioItems(barcodeValue, symbology, prefix) {
  const items = buildFullLabelNormalSampleAgentItems();
  items[0].codigo_barras = barcodeValue;
  items[0].sku_variacao = symbology === "code128" ? barcodeValue : "AERO-000098";
  items[0].label_barcode_symbology = symbology;
  return items;
}

function renderScenario(name, items, prefix) {
  const { imageSpec } = buildFullLabelImageSpec({ items });
  const barcode = (imageSpec.elements || []).find((item) => item.role === "barcode");
  const barcodeText = (imageSpec.elements || []).find((item) => item.role === "barcode_text");
  if (!barcode) {
    throw new Error(`${name}: elemento barcode ausente.`);
  }
  if (!barcodeText) {
    throw new Error(`${name}: elemento barcode_text ausente.`);
  }
  if (barcodeText.y <= barcode.y) {
    throw new Error(`${name}: barcode_text deve ficar abaixo das barras.`);
  }
  const humanText = barcode.barcodeHumanText || barcodeText.text;
  if (barcodeText.text !== humanText) {
    throw new Error(`${name}: barcode_text deve mostrar o texto humano (${humanText}).`);
  }
  if (barcodeText.fontFamily !== "Arial" || barcodeText.bold !== true) {
    throw new Error(`${name}: barcode_text deve usar Arial Bold.`);
  }
  if (barcodeText.fontSize < 15 && (barcodeText.textLines || []).length < 2) {
    throw new Error(`${name}: barcode_text pequeno demais (${barcodeText.fontSize}px).`);
  }
  if (Number(barcode.height) < 62 || Number(barcode.height) > 68) {
    throw new Error(`${name}: altura das barras fora da faixa (${barcode.height}px).`);
  }

  const result = renderAndPrintLabel("", imageSpec, {
    outputDir: OUTPUT_DIR,
    prefix,
    saveOnly: true
  });

  if (!result.imagem_path || !fs.existsSync(result.imagem_path)) {
    throw new Error(`${name}: PNG não gerado.`);
  }

  return {
    scenario: name,
    symbology: barcode.barcodeSymbology || "code128",
    barcode_value: barcode.barcodeValue || barcode.text,
    barcode_human_text: humanText,
    barcode_text_font: barcodeText.fontFamily,
    barcode_text_font_size: barcodeText.fontSize,
    barcode_text_lines: barcodeText.textLines || [barcodeText.text],
    barcode_text_y: barcodeText.y,
    barcode_bar_y: barcode.y,
    barcode_bar_height: barcode.height,
    imagem_path: result.imagem_path,
    width_px: result.width_px,
    height_px: result.height_px
  };
}

function main() {
  testResolutionRules();

  const eanPng = renderScenario(
    "ean13_valid",
    buildScenarioItems("4006381333931", "ean13", "barcode-ean13"),
    "barcode-dry-run-ean13"
  );
  assertEqual(eanPng.symbology, "ean13", "PNG EAN-13");

  const aeroPng = renderScenario(
    "code128_aero",
    buildScenarioItems("AERO-000098", "code128", "barcode-aero"),
    "barcode-dry-run-aero"
  );
  assertEqual(aeroPng.symbology, "code128", "PNG Code128 AERO");

  const skuPng = renderScenario(
    "code128_44812",
    buildScenarioItems("44812", "code128", "barcode-44812"),
    "barcode-dry-run-44812"
  );
  assertEqual(skuPng.symbology, "code128", "PNG Code128 44812");

  const longHumanSku = "AERO-000078-BEGE-GG";
  const longScanCode = deriveShortVariationScanCode("VAR_AERO_000078");
  const longCodeItems = [{
    nome: "Bermuda Osklen Yougue",
    marca: "AEROSTORE",
    loja: "sul",
    store_id: "sul",
    cor: "Bege",
    tamanho: "GG",
    variation_id: "VAR_AERO_000078",
    sku_variacao: longHumanSku,
    codigo_barras: longHumanSku,
    preco_venda: "397,00",
    preco_original: "",
    show_compare_price: false,
    colunas: 1,
    language: "PPLB"
  }];
  const longCodePng = renderScenario(
    "code128_long_aero",
    longCodeItems,
    "barcode-dry-run-aero-long"
  );
  assertEqual(longCodePng.barcode_value, longScanCode, "Code128 longo usa scan code curto");
  assertEqual(longCodePng.barcode_human_text, longHumanSku, "Code128 longo mantem SKU humano");
  assertEqual(longCodePng.barcode_text_lines.join("|"), "AERO-000078|BEGE-GG", "Code128 longo em 2 linhas");
  assertEqual(longCodePng.barcode_text_font_size, 16, "Code128 longo fonte 16px");
  if (longCodePng.barcode_value === longHumanSku) {
    throw new Error("Code128 longo: barras nao devem codificar SKU completo.");
  }
  if (longCodePng.barcode_text_y <= longCodePng.barcode_bar_y + longCodePng.barcode_bar_height) {
    throw new Error("Code128 longo: texto humano deve ficar abaixo das barras.");
  }

  const splitCheck = splitBarcodeHumanText("AERO-000078-BEGE-GG");
  assertEqual(splitCheck.join("|"), "AERO-000078|BEGE-GG", "Quebra por hifen");

  console.log("Argox label barcode dry-run passed.");
  console.log(JSON.stringify({
    library: "bwip-js",
    human_text: "manual abaixo das barras (role barcode_text)",
    encoded_vs_human: "barras usam valor curto; texto humano mostra SKU completo",
    rules: {
      ean13: "13 dígitos numéricos com checksum válido",
      code128: "codigo curto ou scan code da variacao quando SKU e longo"
    },
    scenarios: [eanPng, aeroPng, skuPng, longCodePng]
  }, null, 2));
}

main();
