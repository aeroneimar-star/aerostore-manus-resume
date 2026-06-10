"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

assert(
  /function shouldAutoSearchPdvSaleCustomer\(query = ""\)/.test(appSource),
  "Frontend deve declarar regra explicita para auto-busca de cliente."
);
assert(
  /return digits\.length === 10 \|\| digits\.length === 11;/.test(appSource),
  "Auto-busca deve aceitar somente telefone completo com 10 ou 11 digitos."
);
assert(
  /function schedulePdvSaleCustomerSearch\(\)[\s\S]*?shouldAutoSearchPdvSaleCustomer\(query\)/.test(appSource),
  "Debounce deve consultar a regra de telefone completo antes de buscar."
);
assert(
  /data-pdv-sale-customer-search-form="true"/.test(appSource)
    && /searchPdvSaleCustomers\(\)\.catch/.test(appSource)
    && /async function searchPdvSaleCustomers\(\)[\s\S]*?if \(!query\)/.test(appSource),
  "Submit por Enter ou botao deve continuar executando busca manual."
);
assert(
  /customerSearchRequestId/.test(appSource),
  "Busca deve manter protecao contra resposta obsoleta."
);

console.log(JSON.stringify({
  ok: true,
  automatic_search: "telefone completo com 10 ou 11 digitos",
  manual_search: ["Enter", "Buscar cliente"],
  stale_response_guard: "customerSearchRequestId"
}, null, 2));
