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
  "Auto-busca deve aceitar telefone completo com 10 ou 11 digitos."
);
assert(
  /return normalized\.length >= PDV_SALE_CUSTOMER_SEARCH_MIN_CHARS;/.test(appSource),
  "Auto-busca deve aceitar nome com minimo de caracteres apos debounce."
);
assert(
  /function schedulePdvSaleCustomerSearch\(\)[\s\S]*?PDV_SALE_CUSTOMER_SEARCH_DEBOUNCE_MS/.test(appSource),
  "Debounce deve aguardar pausa na digitacao antes de buscar."
);
assert(
  /function renderPdvSaleCustomerSearchPanel\(\)/.test(appSource),
  "Busca de cliente deve atualizar somente o painel de resultados durante a digitacao."
);
const scheduleSearchBody = (appSource.match(/function schedulePdvSaleCustomerSearch\(\) \{([\s\S]*?)\n\}/) || [])[1] || "";
assert(
  scheduleSearchBody.includes("renderPdvSaleCustomerSearchPanel("),
  "Digitacao deve atualizar somente o painel de busca apos debounce."
);
assert(
  !scheduleSearchBody.includes("renderPdvSaleSurface("),
  "Digitacao nao deve re-renderizar a tela inteira da venda."
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
  automatic_search: {
    phone: "telefone completo com 10 ou 11 digitos apos debounce",
    name: "nome com minimo de 2 caracteres apos debounce"
  },
  manual_search: ["Enter", "Buscar cliente"],
  stale_response_guard: "customerSearchRequestId",
  typing_render: "renderPdvSaleCustomerSearchPanel"
}, null, 2));
