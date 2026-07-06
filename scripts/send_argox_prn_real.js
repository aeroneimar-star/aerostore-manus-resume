"use strict";

const fs = require("fs");
const path = require("path");
const {
  isTransportAvailable,
  listPrinterNames,
  printRawBuffer
} = require(path.join(__dirname, "..", "agente-impressao-argox", "lib", "winspoolRaw"));

const OUTPUT_DIR = path.join(__dirname, "..", "agente-impressao-argox", "output");

function resolveConfirmRealPrint() {
  return String(process.env.ARGOX_CONFIRM_REAL_PRINT || "").trim().toLowerCase() === "true";
}

function toHexPreview(buffer = Buffer.alloc(0), size = 16) {
  return buffer.subarray(0, size).toString("hex").match(/.{1,2}/g)?.join(" ") || "";
}

function toHexTail(buffer = Buffer.alloc(0), size = 16) {
  if (buffer.length <= size) return toHexPreview(buffer, size);
  return buffer.subarray(buffer.length - size).toString("hex").match(/.{1,2}/g)?.join(" ") || "";
}

function toTextPreview(buffer = Buffer.alloc(0), size = 240) {
  return buffer
    .subarray(0, size)
    .toString("latin1")
    .replace(/\x02/g, "<STX>")
    .replace(/\x0c/g, "<FF>")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function resolveInputPath(rawPath = "") {
  const input = String(rawPath || process.argv[2] || "").trim();
  if (!input) {
    console.error("Uso: node scripts/send_argox_prn_real.js caminho\\arquivo.prn");
    process.exit(1);
  }
  return path.resolve(input);
}

function main() {
  if (!isTransportAvailable()) {
    console.error("Transporte WINSPOOL_RAW disponivel apenas no Windows.");
    process.exit(1);
  }

  const filePath = resolveInputPath();

  if (!resolveConfirmRealPrint()) {
    console.error("Impressao real bloqueada. Defina ARGOX_CONFIRM_REAL_PRINT=true para continuar.");
    process.exit(1);
  }

  const printerName = String(process.env.ARGOX_PRINTER_NAME || "").trim();
  if (!printerName) {
    console.error("Defina ARGOX_PRINTER_NAME com o nome exato da fila Windows.");
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`Arquivo nao encontrado: ${filePath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(filePath);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    console.error("Arquivo PRN vazio ou invalido.");
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const auditPath = path.join(OUTPUT_DIR, `oficial-enviado-${Date.now()}.prn`);
  fs.writeFileSync(auditPath, buffer);

  console.log("Enviando PRN externo bruto via Winspool RAW");
  console.log(JSON.stringify({
    impressora: printerName,
    arquivo_origem: filePath,
    arquivo_auditoria: auditPath,
    bytes: buffer.length,
    hex_inicio: toHexPreview(buffer),
    hex_fim: toHexTail(buffer),
    preview_texto: toTextPreview(buffer)
  }, null, 2));

  const availablePrinters = listPrinterNames();
  if (availablePrinters.length && !availablePrinters.includes(printerName)) {
    console.warn("Aviso: ARGOX_PRINTER_NAME nao aparece na lista local de impressoras.");
    console.warn("Impressoras detectadas:", availablePrinters.join(" | "));
  }

  const result = printRawBuffer(printerName, buffer);
  console.log("Envio concluido:", JSON.stringify({
    sucesso: true,
    impressora: result.impressora || printerName,
    metodo: result.metodo || "WINSPOOL_RAW",
    bytes: result.bytes || buffer.length,
    job_id: result.jobId,
    interpretacao: "Se a etiqueta imprimir, o transporte RAW esta OK e o gerador deve copiar o envelope deste PRN oficial."
  }, null, 2));
}

main();
