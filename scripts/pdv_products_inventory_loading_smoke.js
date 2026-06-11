"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");

function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0, `Inicio ausente: ${startMarker}`);
  assert(end > start, `Fim ausente: ${endMarker}`);
  return source.slice(start, end);
}

const productsState = sliceBetween("pdvProducts: {", "pdvCustomers: {");
const productsLoader = sliceBetween(
  "async function loadPdvProductsFront(options = {})",
  "function applyPdvCustomersFiltersFromForm"
);
const stockLoader = sliceBetween(
  "async function loadPdvStockFront(options = {})",
  "function getDefaultAerointelStoreFilter"
);
const productsRenderer = sliceBetween(
  "function renderPdvProductsOfficialFront",
  "async function loadPdvProductsFront"
);
const stockRenderer = sliceBetween(
  "function renderPdvStockOfficialFront",
  "async function loadPdvStockFront"
);

assert(
  /loadingRequestId:\s*0/.test(productsState),
  "/pdv/produtos deve possuir loadingRequestId."
);
assert(
  /const requestId = Number\(state\.pdvProducts\.loadingRequestId \|\| 0\) \+ 1;/.test(productsLoader),
  "/pdv/produtos deve gerar requestId monotonico."
);
assert(
  productsLoader.match(/state\.pdvProducts\.loadingRequestId !== requestId/g)?.length >= 3,
  "/pdv/produtos deve ignorar resposta antiga no sucesso, erro e finalizacao."
);
assert(
  stockLoader.match(/state\.pdvStock\.loadingRequestId !== requestId/g)?.length >= 3,
  "/pdv/estoque deve preservar a protecao contra respostas antigas."
);
assert(
  /state\.pdvProducts\.items = \[\]/.test(productsLoader)
    && /total:\s*0/.test(productsLoader)
    && /state\.pdvProducts\.selectedProductId = ""/.test(productsLoader),
  "Nova busca de produtos deve neutralizar resultado, total e selecao anteriores."
);
assert(
  /const previousSelectedProductId = normalizeText\(state\.pdvProducts\.selectedProductId \|\| ""\);/.test(productsLoader)
    && /normalizeText\(item\.id \|\| ""\) === previousSelectedProductId/.test(productsLoader),
  "Recargas que pedem preserveSelection devem reutilizar o ID anterior sem manter cards antigos visiveis."
);
assert(
  productsRenderer.includes("Buscando produtos...")
    && productsRenderer.includes("Nenhum produto encontrado para esta busca.")
    && productsRenderer.includes("Não foi possível buscar produtos. Tente novamente."),
  "/pdv/produtos deve renderizar loading, vazio e erro amigavel."
);
assert(
  stockRenderer.includes("Buscando produtos no estoque...")
    && stockRenderer.includes("Nenhum produto encontrado para esta busca.")
    && stockRenderer.includes("Não foi possível buscar produtos. Tente novamente."),
  "/pdv/estoque deve renderizar loading, vazio e erro amigavel."
);
assert(
  styles.includes(".pdv-search-result-state")
    && styles.includes(".pdv-search-result-skeleton"),
  "Loading local deve possuir estilos de estado e skeleton."
);

console.log(JSON.stringify({
  ok: true,
  products_request_guard: true,
  stock_request_guard: true,
  products_loading_state: true,
  stock_loading_state: true,
  empty_state: true,
  error_state: true
}, null, 2));
