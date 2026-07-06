"use strict";

const assert = require("assert");
const {
  buildArgoxCommandFromAgentItems,
  isPplaCommand,
  validatePplaCommand
} = require("../modules/pdv/services/argoxCommandBuilder");

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
const built = buildArgoxCommandFromAgentItems(payload, { columns: 1 });
assert.strictEqual(built.language, "PPLA", "builder deve respeitar PPLA");
assert(isPplaCommand(built.command), "comando deve iniciar com STX");

const buffer = Buffer.from(built.command, "ascii");
assert.strictEqual(buffer[0], 0x02, "primeiro byte deve ser STX");
assert.strictEqual(buffer[1], 0x4c, "segundo byte deve ser L de \\x02L");
assert(buffer.includes(Buffer.from("CALCA TECH FIVE", "ascii")), "deve conter nome do produto");
assert(buffer.includes(Buffer.from("AEROSTORE", "ascii")), "deve conter marca");
assert(buffer.includes(Buffer.from("POR", "ascii")) || buffer.includes(Buffer.from("R$ 167,00", "ascii")), "deve conter preco");
assert.strictEqual(built.quantity_received, 1, "quantidade recebida deve ser 1");
assert.strictEqual(built.quantity_final, 1, "quantidade final deve ser 1");
assert(validatePplaCommand(built.command).ok, "envelope PPLA deve ser valido");

process.env.ARGOX_SAFE_TEST_MODE = "true";
const multiPayload = [payload[0], { ...payload[0], sku_variacao: "AERO-000099" }];
const safeBuilt = buildArgoxCommandFromAgentItems(multiPayload, { columns: 2, config: { safe_test_mode: true } });
assert.strictEqual(safeBuilt.quantity_received, 2, "safe mode deve registrar quantidade recebida");
assert.strictEqual(safeBuilt.quantity_final, 1, "safe mode deve forcar quantidade final 1");
assert.strictEqual(safeBuilt.safe_test_mode, true, "safe mode deve estar ativo");
assert(validatePplaCommand(safeBuilt.command).ok, "safe mode PPLA deve ser valido");

console.log("Argox PPLA agent command smoke passed.");
