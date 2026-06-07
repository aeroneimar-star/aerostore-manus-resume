"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const styleSource = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");

[
  "data-pdv-product-type",
  "data-pdv-grade-color",
  "data-pdv-grade-size",
  "data-pdv-grade-quantity",
  "data-pdv-grade-error",
  "data-pdv-variation-modal",
  "data-pdv-variation-color",
  "data-pdv-variation-size",
  "Sem opcoes disponiveis",
  "Sem estoque",
  "Sem disponivel",
  "Bloqueada",
  "variation_id",
  "direct_variation_match",
  "skip_variation_modal",
  "product_type: productType",
  "variants"
].forEach((token) => {
  assert(appSource.includes(token), `public/app.js deve conter ${token}`);
});

[
  ".pdv-variation-modal",
  ".pdv-variation-option",
  ".pdv-product-variant-row"
].forEach((token) => {
  assert(styleSource.includes(token), `public/styles.css deve conter ${token}`);
});

console.log(JSON.stringify({
  ok: true,
  variation_modal: true,
  grade_form: true,
  disabled_reasons: true
}, null, 2));
