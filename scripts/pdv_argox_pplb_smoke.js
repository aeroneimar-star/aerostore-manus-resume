"use strict";

const assert = require("assert");
const {
  buildArgoxPplbCommand,
  buildAgentPrintPayload,
  buildArgoxPplbFromAgentItems,
  mapProductToPplbInput
} = require("../modules/pdv/services/argoxPplbGenerator");

const product = {
  product_id: "TEST",
  sku: "AERO-000098",
  codigo: "AERO-000098",
  barcode: "7891234567890",
  name: "CALCA TECH FIVE POCKET AEROSTORE MASC.",
  brand: "AEROSTORE",
  color: "VERDE-MUSGO",
  size: "42",
  price: 397,
  normal_price: 397,
  promotional_price: 167,
  has_promotional_price: true
};

const request = {
  template_id: "aerostore_tag_40x60_2c",
  quantity: 2,
  show_barcode: true,
  show_price: true,
  show_sku: true,
  show_name: true,
  show_brand: true,
  show_size_color: true,
  show_store: false,
  show_compare_price: true,
  price_mode: "promo_compare",
  normal_price_label: "R$ 397,00",
  promotional_price_label: "R$ 167,00"
};

const config = {
  dpi: 203,
  label_width_mm: 40,
  label_height_mm: 60,
  label_columns: 2,
  label_gap_mm: 3,
  label_language: "PPLB"
};

const command = buildArgoxPplbCommand(product, request, config);
assert(typeof command === "string" && command.includes("\nN\n"), "PPLB command must start with N");
assert(command.includes("q664") || command.includes("q672"), "two-up label must use combined width");
assert(command.includes("Q480"), "label height must be 480 dots");
assert(command.includes("AEROSTORE"), "brand must be present");
assert(command.includes("CALCA TECH FIVE POCKET"), "product name must be present");
assert(command.includes("VERDE-MUSGO / TAM.: 42"), "size/color line must match photo format");
assert(command.includes("AERO-000098"), "sku must be present");
assert(command.includes("DE: R$ 397,00"), "compare price must be present");
assert(command.includes("POR: R$ 167,00"), "sale price must be present");
assert(command.includes("COD. AERO-000098"), "stub code must be present");
assert(command.includes('B30,148,0,E30'), "barcode command must be present");

const payload = buildAgentPrintPayload(product, request, config);
assert(Array.isArray(payload) && payload.length === 2, "agent payload must expand quantity");
assert(payload[0].preco_venda === "167,00", "agent payload must use sale price");

const fromAgent = buildArgoxPplbFromAgentItems(payload, { columns: 2 });
assert(fromAgent.includes("POR: R$ 167,00"), "agent batch must render sale price");

const input = mapProductToPplbInput(product, request);
assert(input.show_compare_price, "promo compare must be enabled");

console.log("Argox PPLB AEROSTORE smoke passed.");
