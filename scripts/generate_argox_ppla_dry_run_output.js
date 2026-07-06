"use strict";

const fs = require("fs");
const path = require("path");
const {
  buildArgoxCommandFromAgentItems,
  summarizeCommand,
  validatePplaCommand
} = require("../modules/pdv/services/argoxCommandBuilder");

const OUTPUT_DIR = path.join(__dirname, "..", "agente-impressao-argox", "output");

const payload = [{
  nome: "CALCA TECH FIVE POCKET AEROSTORE MASC.",
  marca: "AEROSTORE",
  tamanho: "42",
  cor: "VERDE-MUSGO",
  sku_variacao: "AERO-000098",
  codigo_barras: "7891234567890",
  preco_original: "397,00",
  preco_venda: "167,00",
  colunas: 2,
  language: "PPLA"
}];

process.env.ARGOX_LANGUAGE = "PPLA";
process.env.ARGOX_SAFE_TEST_MODE = "true";

const built = buildArgoxCommandFromAgentItems(payload, {
  columns: 2,
  config: { safe_test_mode: true, label_columns: 2 }
});
const validation = validatePplaCommand(built.command);
const summary = summarizeCommand(built.command);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const filePath = path.join(OUTPUT_DIR, `label-dry-run-${Date.now()}.prn`);
fs.writeFileSync(filePath, Buffer.from(built.command, "ascii"));

console.log("PPLA dry-run gerado:", filePath);
console.log("Validacao:", validation.ok ? "OK" : validation.errors.join("; "));
console.log("Quantidade recebida:", built.quantity_received);
console.log("Quantidade final:", built.quantity_final);
console.log("Safe test mode:", built.safe_test_mode);
console.log("Primeiras linhas:");
summary.first_lines.forEach((line) => console.log(`  ${line}`));
console.log("Ultimas linhas:");
summary.last_lines.forEach((line) => console.log(`  ${line}`));

if (!validation.ok) {
  process.exit(1);
}
