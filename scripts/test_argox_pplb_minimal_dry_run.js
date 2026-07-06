"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  buildArgoxPplbMinimalCommand,
  validatePplbMinimalCommand
} = require("../modules/pdv/services/argoxPplbGenerator");
const { splitCommandLines } = require("../modules/pdv/services/argoxPplaEnvelope");

const OUTPUT_DIR = path.join(__dirname, "..", "agente-impressao-argox", "output");

function summarizePplb(command = "") {
  const lines = splitCommandLines(command);
  return {
    first_lines: lines.slice(0, 8),
    last_lines: lines.slice(-8)
  };
}

function main() {
  const command = buildArgoxPplbMinimalCommand();
  const validation = validatePplbMinimalCommand(command);
  const summary = summarizePplb(command);

  assert(validation.ok, `PPLB minimo invalido: ${validation.errors.join("; ")}`);
  assert(command.includes("\nN\n"), "PPLB minimo deve iniciar com N");
  assert(command.includes("q320"), "PPLB minimo deve conter q320");
  assert(command.includes("Q480"), "PPLB minimo deve conter Q480");
  assert(command.includes("P1"), "PPLB minimo deve conter P1");
  assert(!command.includes("P20"), "PPLB minimo nao pode conter P20");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filePath = path.join(OUTPUT_DIR, `minimal-pplb-dry-run-${Date.now()}.prn`);
  fs.writeFileSync(filePath, Buffer.from(command, "ascii"));

  console.log("Argox PPLB/EPL-like minimal dry-run passed.");
  console.log(`Arquivo: ${filePath}`);
  console.log("Primeiras linhas:");
  summary.first_lines.forEach((line) => console.log(`  ${line}`));
  console.log("Ultimas linhas:");
  summary.last_lines.forEach((line) => console.log(`  ${line}`));
}

main();
