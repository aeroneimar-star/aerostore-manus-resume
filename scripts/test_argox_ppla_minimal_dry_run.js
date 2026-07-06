"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  buildArgoxPplaMinimalCommand,
  validatePplaCommand,
  summarizeCommand
} = require("../modules/pdv/services/argoxPplaEnvelope");

const OUTPUT_DIR = path.join(__dirname, "..", "agente-impressao-argox", "output");

function main() {
  const command = buildArgoxPplaMinimalCommand();
  const validation = validatePplaCommand(command);
  const summary = summarizeCommand(command);

  assert(validation.ok, `PPLA minimo invalido: ${validation.errors.join("; ")}`);
  assert(summary.ends_with_p1, "PPLA minimo deve conter P1");
  assert(!summary.contains_p20, "PPLA minimo nao pode conter P20");
  assert(!summary.contains_q0001, "PPLA minimo nao pode conter Q0001");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filePath = path.join(OUTPUT_DIR, `minimal-dry-run-${Date.now()}.prn`);
  fs.writeFileSync(filePath, Buffer.from(command, "ascii"));

  console.log("Argox PPLA minimal dry-run passed.");
  console.log(`Arquivo: ${filePath}`);
  console.log("Primeiras linhas:");
  summary.first_lines.forEach((line) => console.log(`  ${line}`));
  console.log("Ultimas linhas:");
  summary.last_lines.forEach((line) => console.log(`  ${line}`));
}

main();
