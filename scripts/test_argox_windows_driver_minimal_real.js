"use strict";

const path = require("path");
const { buildMinimalImageSpec } = require("../agente-impressao-argox/lib/labelImageSpec");
const { renderAndPrintLabel, isTransportAvailable } = require("../agente-impressao-argox/lib/windowsDriverPrint");

const OUTPUT_DIR = path.join(__dirname, "..", "agente-impressao-argox", "output");

function resolveConfirmRealPrint() {
  return String(process.env.ARGOX_CONFIRM_REAL_PRINT || "").trim().toLowerCase() === "true";
}

function main() {
  if (!resolveConfirmRealPrint()) {
    console.error("Impressao real bloqueada. Defina ARGOX_CONFIRM_REAL_PRINT=true para continuar.");
    process.exit(1);
  }
  if (!isTransportAvailable()) {
    console.error("WINDOWS_DRIVER disponivel apenas no Windows.");
    process.exit(1);
  }

  const printerName = String(process.env.ARGOX_PRINTER_NAME || "").trim();
  if (!printerName) {
    console.error("Defina ARGOX_PRINTER_NAME com o nome exato da fila Windows.");
    process.exit(1);
  }

  const spec = buildMinimalImageSpec();
  const result = renderAndPrintLabel(printerName, spec, {
    outputDir: OUTPUT_DIR,
    prefix: "minimal-driver-real",
    saveOnly: false,
    copies: 1,
    forceSingleCopy: true
  });

  console.log("Impressao minima WINDOWS_DRIVER enviada:", JSON.stringify({
    impressora: printerName,
    print_transport: "WINDOWS_DRIVER",
    quantidade_final: 1,
    metodo: result.metodo,
    bytes: result.bytes,
    job_id: result.jobId,
    imagem_path: result.imagem_path,
    texto_esperado: ["TESTE AEROSTORE", "COD 123456"]
  }, null, 2));
}

main();
