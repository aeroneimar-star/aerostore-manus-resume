"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appPath = path.join(__dirname, "..", "public", "app.js");
const stylesPath = path.join(__dirname, "..", "public", "styles.css");
const app = fs.readFileSync(appPath, "utf8");
const styles = fs.readFileSync(stylesPath, "utf8");

assert.strictEqual(
  (app.match(/async function loadPdvProductsFront\(/g) || []).length,
  1,
  "Deve existir uma unica implementacao de loadPdvProductsFront."
);
assert(/\[25,\s*50,\s*100\]/.test(app), "Paginacao deve oferecer 25, 50 e 100.");
[
  "productTypeFilter",
  "brandFilter",
  "categoryFilter",
  "colorFilter",
  "sizeFilter",
  "stockModeFilter"
].forEach((name) => assert(app.includes(`name="${name}"`), `Filtro ${name} ausente.`));
[
  "physical_qty",
  "reserved_qty",
  "available_qty",
  "Ver variacoes",
  "Ver movimentos",
  "Cadastrar similar"
].forEach((text) => assert(app.includes(text), `Contrato visual ausente: ${text}`));
assert(app.includes('hasPermission("can_manage_users")'), "Gate de vendedores deve refletir a API.");
assert(app.includes('hasPermission("can_view_aerointel")'), "Gate de produtos estrategicos deve refletir a API.");
assert(styles.includes(".pdv-products-qty-grid"), "Estilos dos saldos agrupados ausentes.");

console.log(JSON.stringify({
  load_function_count: 1,
  pagination: [25, 50, 100],
  grouped_balances: true,
  bootstrap_permission_gates: true
}, null, 2));
