"use strict";

const assert = require("assert");
const {
  buildArgoxPplaCommand,
  buildLabelPreviewElements
} = require("../modules/pdv/services/pdvLabelPrintService");

function assertValidatedPplaEnvelope(buffer) {
  const ascii = buffer.toString("ascii");
  assert.strictEqual(buffer[0], 0x02, "first byte must be STX");
  assert.strictEqual(buffer[1], 0x4c, "second byte must be L from \\x02L");
  assert(ascii.includes("D\r"), "must contain D\\r");
  assert(/\bH\d{3}\r/.test(ascii), "must contain H gap command");
  assert(/\bQ0480\r/.test(ascii) || /\bQ480\r/.test(ascii), "must contain Q480 label height");
  assert(/\bq0320\r/.test(ascii) || /\bq320\r/.test(ascii), "quantity 1 must use q320 width");
  assert(/\bP1\r/.test(ascii), "must contain P1 copy command");
  assert(!/\bP20\b/.test(ascii), "must not contain P20");
  assert(!/\bQ0001\b/.test(ascii), "must not use Q0001 as height");
  assert(ascii.endsWith("E\r") || ascii.includes("\rE\r"), "must end command with E and CR");
  assert(!buffer.includes(0x0c), "PRN must not contain FF byte 0x0C");
  assert(!buffer.includes(Buffer.from("\r\n", "ascii")), "PPLA output must use CR terminators, not CRLF");
}

(async () => {
  assert.strictEqual(typeof buildArgoxPplaCommand, "function", "service must export buildArgoxPplaCommand");
  assert.strictEqual(typeof buildLabelPreviewElements, "function", "service must export buildLabelPreviewElements");

  const product = {
    product_id: "TEST",
    sku: "AERO-000098-VERDE-MUSGO-42",
    codigo: "AERO-000098-VERDE-MUSGO-42",
    barcode: "",
    name: "CALCA TECH FIVE POCKET AEROSTORE",
    brand: "AEROSTORE",
    color: "VERDE-MUSGO",
    size: "42",
    price: 397
  };
  const request = {
    template_id: "aerostore_tag_40x60_2c",
    quantity: 1,
    show_barcode: true,
    show_price: true,
    show_sku: true,
    show_name: true,
    show_brand: true,
    show_size_color: true,
    show_store: false,
    show_compare_price: false,
    price_label: "R$ 397,00"
  };
  const config = {
    dpi: 203,
    label_width_mm: 40,
    label_height_mm: 60,
    label_columns: 2,
    label_gap_mm: 3
  };
  const elements = buildLabelPreviewElements(product, request, config);
  assert(Array.isArray(elements) && elements.length >= 7, "preview elements must describe the existing label layout");
  assert(elements.every((item) => ["type", "text", "x", "y", "fontSize", "align", "column", "isBarcode"].every((key) => Object.prototype.hasOwnProperty.call(item, key))), "each preview element must expose layout fields");
  assert.deepStrictEqual(
    elements.map((item) => item.type),
    ["text", "text", "text", "text", "barcode", "text", "price"],
    "element order must match the existing technical preview"
  );
  assert(elements.some((item) => item.isBarcode && item.text === "AERO-000098-VERDE-MUSGO-42"), "barcode element must come from preview data");
  assert(elements.some((item) => item.type === "text" && item.text === "COD AERO-000098-VERDE-MUSGO-42"), "COD text must come from preview data");
  assert(elements.some((item) => item.type === "price" && item.text === "R$ 397,00"), "price element must come from preview stub");

  const command = buildArgoxPplaCommand(product, request, config);

  const generated = Buffer.from(command, "ascii");
  assertValidatedPplaEnvelope(generated);

  assert(generated.includes(Buffer.from("CALCA TECH FIVE", "ascii")), "PRN must include product name from preview");
  assert(generated.includes(Buffer.from("VERDE-MUSGO / 42", "ascii")), "PRN must include size/color from preview");
  assert(generated.includes(Buffer.from("COD AERO-000098", "ascii")), "PRN must include COD text from preview");
  assert(generated.includes(Buffer.from("R$ 397,00", "ascii")), "PRN must include price from preview");

  console.log("Argox PPLA preview-derived PRN smoke passed.");
})();
