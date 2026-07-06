"use strict";

const path = require("path");
const {
  buildArgoxPplaMinimalCommand,
  validatePplaCommand,
  summarizeCommand
} = require("../modules/pdv/services/argoxPplaEnvelope");
const {
  isTransportAvailable,
  printRawBuffer
} = require(path.join(__dirname, "..", "agente-impressao-argox", "lib", "winspoolRaw"));

function resolveConfirmRealPrint() {
  return String(process.env.ARGOX_CONFIRM_REAL_PRINT || "").trim().toLowerCase() === "true";
}

function resolveSafeTestMode() {
  return String(process.env.ARGOX_SAFE_TEST_MODE || "true").trim().toLowerCase() === "true";
}

function main() {
  if (!resolveConfirmRealPrint()) {
    console.error("Impressao real bloqueada. Defina ARGOX_CONFIRM_REAL_PRINT=true para continuar.");
    process.exit(1);
  }
  if (!resolveSafeTestMode()) {
    console.error("Safe test mode deve estar ativo. Defina ARGOX_SAFE_TEST_MODE=true.");
    process.exit(1);
  }
  if (!isTransportAvailable()) {
    console.error("Transporte WINSPOOL_RAW disponivel apenas no Windows.");
    process.exit(1);
  }

  const printerName = String(process.env.ARGOX_PRINTER_NAME || "").trim();
  if (!printerName) {
    console.error("Defina ARGOX_PRINTER_NAME com o nome exato da fila Windows.");
    process.exit(1);
  }

  process.env.ARGOX_LANGUAGE = "PPLA";
  const command = buildArgoxPplaMinimalCommand();
  const validation = validatePplaCommand(command);
  const summary = summarizeCommand(command);

  if (!validation.ok) {
    console.error(`PPLA minimo invalido: ${validation.errors.join("; ")}`);
    process.exit(1);
  }

  console.log("Enviando teste minimo PPLA (quantidade 1) para:", printerName);
  console.log("Primeiras linhas:");
  summary.first_lines.forEach((line) => console.log(`  ${line}`));
  console.log("Ultimas linhas:");
  summary.last_lines.forEach((line) => console.log(`  ${line}`));

  const buffer = Buffer.from(command, "ascii");
  const result = printRawBuffer(printerName, buffer);
  console.log("Impressao minima enviada:", JSON.stringify({
    impressora: printerName,
    linguagem: "PPLA",
    quantidade_final: 1,
    safe_test_mode: true,
    metodo: result.metodo,
    bytes: result.bytes,
    job_id: result.jobId
  }));
}

main();
