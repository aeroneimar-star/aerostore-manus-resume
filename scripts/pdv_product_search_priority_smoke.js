"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "modules", "pdv", "services", "pdvOperationalService.js"),
  "utf8"
);
const appSource = fs.readFileSync(
  path.join(__dirname, "..", "public", "app.js"),
  "utf8"
);
const functionStart = source.indexOf("async function searchProductsDetailed");
const functionEnd = source.indexOf("\nfunction buildCustomerSignals", functionStart);
const body = source.slice(functionStart, functionEnd);
const normalizedIndex = body.indexOf("searchNormalizedProductParents");
const inventoryIndex = body.indexOf("listInventoryProducts");

assert(normalizedIndex >= 0, "Busca normalizada nao localizada.");
assert(inventoryIndex >= 0, "Busca legada de inventario nao localizada.");
assert(
  normalizedIndex < inventoryIndex,
  "SQLite normalizado deve ser consultado antes do inventario JSON."
);
assert(
  !appSource.includes("if (event.repeat || state.pdvSale.productSearching) return;"),
  "Enter deve iniciar nova busca mesmo quando uma requisicao anterior ficou presa."
);

console.log(JSON.stringify({
  normalized_first: true,
  stale_search_recovery: true
}, null, 2));
