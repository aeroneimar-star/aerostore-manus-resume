"use strict";

const {
  buildArgoxPplaCommand,
  buildLabelPreviewElements
} = require("../modules/pdv/services/pdvLabelPrintService");

const output = String(process.argv[2] || "prn-base64").toLowerCase();
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

if (output === "json") {
  process.stdout.write(JSON.stringify(buildLabelPreviewElements(product, request, config), null, 2));
  process.exit(0);
}

const command = buildArgoxPplaCommand(product, request, config);
process.stdout.write(Buffer.from(command, "ascii").toString("base64"));
