"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

assert(
  /const pdvSaleCustomerSearchInput = event\.target\.closest\("#pdv-sale-customer-search"\);[\s\S]*?schedulePdvSaleCustomerSearch\(\);/.test(appSource),
  "Input de busca deve agendar debounce."
);
assert(
  !/const pdvSaleCustomerSearchInput = event\.target\.closest\("#pdv-sale-customer-search"\);[\s\S]{0,500}renderPdvSaleSurface\(/.test(appSource),
  "Input de busca nao deve re-renderizar a tela inteira."
);

assert(
  appSource.includes('const nextQuery = String(pdvSaleCustomerSearchInput.value || "");'),
  "Input deve preservar texto bruto durante a digitacao."
);
const searchFnBody = (appSource.match(/async function searchPdvSaleCustomers\(\) \{([\s\S]*?)\nasync function searchPdvSaleProducts/) || [])[1] || "";
assert(
  searchFnBody.includes("renderPdvSaleCustomerSearchPanel("),
  "Busca deve atualizar somente o painel de cliente."
);
assert(
  !searchFnBody.includes("renderPdvSaleSurface("),
  "Busca nao deve re-renderizar a tela inteira da venda."
);

const panelFnBody = (appSource.match(/function renderPdvSaleCustomerSearchPanel\(\) \{([\s\S]*?)\n\}/) || [])[1] || "";
assert(
  panelFnBody.includes(".pdv-sale-customer-results"),
  "Painel parcial deve atualizar resultados."
);
assert(
  panelFnBody.includes(".pdv-customer-selection-state"),
  "Painel parcial deve atualizar estado de selecao."
);

console.log(JSON.stringify({
  ok: true,
  checks: [
    "input handler without full render",
    "raw input value preserved",
    "debounced search scheduling",
    "partial panel render on search",
    "partial panel render helpers"
  ]
}, null, 2));
