"use strict";

const path = require("path");
const {
  buildArgoxPplbMinimalCommand,
  validatePplbMinimalCommand
} = require("../modules/pdv/services/argoxPplbGenerator");
const { splitCommandLines } = require("../modules/pdv/services/argoxPplaEnvelope");
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

function summarizePplb(command = "") {
  const lines = splitCommandLines(command);
  return {
    first_lines: lines.slice(0, 8),
    last_lines: lines.slice(-8)
  };
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

  process.env.ARGOX_PHYSICAL_LANGUAGE = "PPLB";
  const command = buildArgoxPplbMinimalCommand();
  const validation = validatePplbMinimalCommand(command);
  const summary = summarizePplb(command);

  if (!validation.ok) {
    console.error(`PPLB minimo invalido: ${validation.errors.join("; ")}`);
    process.exit(1);
  }

  console.log("Enviando teste minimo PPLB/EPL-like (quantidade 1) para:", printerName);
  console.log("Primeiras linhas:");
  summary.first_lines.forEach((line) => console.log(`  ${line}`));
  console.log("Ultimas linhas:");
  summary.last_lines.forEach((line) => console.log(`  ${line}`));

  const buffer = Buffer.from(String(command || "").replace(/\r\n/g, "\n"), "ascii");
  const result = printRawBuffer(printerName, buffer);
  console.log("Impressao minima enviada:", JSON.stringify({
    impressora: printerName,
    linguagem: "PPLB",
    linguagem_fisica: "PPLB",
    quantidade_final: 1,
    safe_test_mode: true,
    metodo: result.metodo,
    bytes: result.bytes,
    job_id: result.jobId
  }));
}

main();
