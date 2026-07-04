"use strict";

const fs = require("fs");
const path = require("path");
const {
  buildArgoxPplbCommand,
  buildAgentPrintPayload,
  buildArgoxPplbFromAgentItems
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
  price_mode: "promo_compare"
};

const config = {
  dpi: 203,
  label_width_mm: 40,
  label_height_mm: 60,
  label_columns: 2,
  label_gap_mm: 3,
  label_language: "PPLB"
};

const outputDir = path.join(process.cwd(), "tmp", "labels");
fs.mkdirSync(outputDir, { recursive: true });

const command = buildArgoxPplbCommand(product, request, config);
const prnPath = path.join(outputDir, "argox-at-home-test.prn");
fs.writeFileSync(prnPath, Buffer.from(command, "ascii"));

const payload = buildAgentPrintPayload(product, request, config);
const agentCommand = buildArgoxPplbFromAgentItems(payload, { columns: 2 });
const agentPath = path.join(outputDir, "argox-at-home-agent.prn");
fs.writeFileSync(agentPath, Buffer.from(agentCommand, "ascii"));

console.log("Teste Argox em casa (sem impressora)");
console.log("");
console.log("Arquivos gerados:");
console.log(`  1. ${prnPath}`);
console.log(`  2. ${agentPath}`);
console.log("");
console.log("Conteudo PPLB (primeiras linhas):");
console.log(command.split("\n").slice(0, 18).join("\n"));
console.log("...");
console.log("");
console.log("Proximo passo para simular o fluxo completo:");
console.log("  Terminal 1: node server.js");
console.log("  Terminal 2: cd agente-impressao-argox");
console.log('             $env:ARGOX_AGENT_DRY_RUN="true"; node server.js');
console.log("  Depois: abra /pdv/produtos e clique Imprimir etiqueta");
console.log("");
console.log("Ou teste o agente direto:");
console.log('  curl http://localhost:4000/status');
console.log('  curl -X POST http://localhost:4000/imprimir -H "Content-Type: application/json" -d "[{\"nome\":\"CALCA TECH FIVE POCKET\",\"tamanho\":\"42\",\"cor\":\"VERDE-MUSGO\",\"sku_variacao\":\"AERO-000098\",\"codigo_barras\":\"7891234567890\",\"preco_original\":\"397,00\",\"preco_venda\":\"167,00\",\"colunas\":2},{\"nome\":\"CALCA TECH FIVE POCKET\",\"tamanho\":\"42\",\"cor\":\"VERDE-MUSGO\",\"sku_variacao\":\"AERO-000098\",\"codigo_barras\":\"7891234567890\",\"preco_original\":\"397,00\",\"preco_venda\":\"167,00\",\"colunas\":2}]"');
